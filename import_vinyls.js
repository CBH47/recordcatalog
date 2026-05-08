const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CSV_PATH = path.join(__dirname, 'vinyls.csv');
const PREVIEW_LIMIT = process.env.IMPORT_LIMIT ? parseInt(process.env.IMPORT_LIMIT, 10) : null;
const DISCOGS_MIN_INTERVAL_MS = 1200;
const DISCOGS_MAX_RETRIES = 3;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const discogsCache = new Map();
let lastDiscogsRequestAt = 0;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const COL = {
  TITLE: 0,
  ARTIST: 2,
  GENRE: 4,
  SUBGENRE: 6,
  OUT_FOR_THE_DAY: 8,
  ON_MY_WALL: 9,
  CUBBY: 10,
};

function parseArtists(artistRaw) {
  const normalized = normalizeText(artistRaw);
  if (!normalized) return [];

  return normalized
    .split(/\s+(?:and|&|\/|feat\.?|featuring)\s+/i)
    .map((name) => normalizeArtistDisplayName(name))
    .filter(Boolean);
}

function normalizeArtistDisplayName(name) {
  const clean = normalizeText(name).replace(/,$/, '');
  if (!clean) return '';

  // Discogs and CSV sometimes store names as "Last, First"; display as "First Last".
  const theMatch = clean.match(/^(.*),\s*The$/i);
  if (theMatch && theMatch[1]) return `The ${normalizeText(theMatch[1])}`;

  const parts = clean.split(',').map((p) => normalizeText(p)).filter(Boolean);
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  return clean;
}

function toBoolean(value) {
  const v = normalizeText(value).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function toNullableInt(value) {
  const v = normalizeText(value);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function isPlaceholderImageUrl(value) {
  const url = normalizeText(value).toLowerCase();
  if (!url) return true;
  return url.includes('spacer.gif');
}

function isUsableImageUrl(value) {
  const url = normalizeText(value);
  if (!url) return false;
  if (isPlaceholderImageUrl(url)) return false;
  return /^https?:\/\//i.test(url);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeArtistForDiscogs(artistRaw) {
  const clean = normalizeText(artistRaw).replace(/,$/, '');
  const m = clean.match(/^(.*),\s*The$/i);
  if (m && m[1]) return `The ${normalizeText(m[1])}`;
  return clean;
}

async function getOrCreateGenreId(name) {
  const cleanName = normalizeText(name);
  if (!cleanName) return null;

  const { data: existing, error: existingError } = await supabase
    .from('genres')
    .select('id')
    .eq('name', cleanName)
    .maybeSingle();
  if (existingError) throw new Error(`Genre lookup failed (${cleanName}): ${existingError.message}`);
  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('genres')
    .insert({ name: cleanName })
    .select('id')
    .single();
  if (insertError) throw new Error(`Genre insert failed (${cleanName}): ${insertError.message}`);
  return inserted.id;
}

async function getOrCreateSubgenreId(name, genreId) {
  const cleanName = normalizeText(name);
  if (!cleanName || !genreId) return null;

  const { data: existing, error: existingError } = await supabase
    .from('subgenres')
    .select('id')
    .eq('name', cleanName)
    .eq('genre_id', genreId)
    .maybeSingle();
  if (existingError) throw new Error(`Subgenre lookup failed (${cleanName}): ${existingError.message}`);
  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('subgenres')
    .insert({ name: cleanName, genre_id: genreId })
    .select('id')
    .single();
  if (insertError) throw new Error(`Subgenre insert failed (${cleanName}): ${insertError.message}`);
  return inserted.id;
}

async function getOrCreateArtistId(name) {
  const cleanName = normalizeText(name);
  if (!cleanName) return null;

  const { data: existing, error: existingError } = await supabase
    .from('artists')
    .select('id')
    .eq('name', cleanName)
    .maybeSingle();
  if (existingError) throw new Error(`Artist lookup failed (${cleanName}): ${existingError.message}`);
  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('artists')
    .insert({ name: cleanName })
    .select('id')
    .single();
  if (insertError) throw new Error(`Artist insert failed (${cleanName}): ${insertError.message}`);
  return inserted.id;
}

async function upsertRecord(record, artistNames = []) {
  const cubby = toNullableInt(record.cubby);
  let lookupQuery = supabase
    .from('records')
    .select('id,title,genre_id,subgenre_id,cubby,on_my_wall,out_for_the_day,discogs_id,image_url')
    .eq('title', record.title)
    .limit(1);

  if (cubby === null) {
    lookupQuery = lookupQuery.is('cubby', null);
  } else {
    lookupQuery = lookupQuery.eq('cubby', cubby);
  }

  const { data: existingRows, error: lookupError } = await lookupQuery;
  if (lookupError) throw new Error(`Record lookup failed (${record.title}): ${lookupError.message}`);

  const existingId = existingRows?.[0]?.id;
  const existingDiscogsId = existingRows?.[0]?.discogs_id || null;
  const existingImageUrl = existingRows?.[0]?.image_url || null;
  const normalizedIncomingImageUrl = normalizeText(record.image_url || '');
  const existingHasUsableImage = isUsableImageUrl(existingImageUrl);
  const incomingHasUsableImage = isUsableImageUrl(normalizedIncomingImageUrl);

  const payload = {
    title: record.title,
    genre_id: record.genre_id,
    subgenre_id: record.subgenre_id,
    cubby,
    on_my_wall: toBoolean(record.on_my_wall),
    out_for_the_day: toBoolean(record.out_for_the_day),
  };

  if (record.discogs_id) {
    payload.discogs_id = String(record.discogs_id);
  } else if (!existingId || !existingDiscogsId) {
    payload.discogs_id = null;
  }

  // DB strategy: keep the first valid image forever. Only fill when missing/placeholder.
  if (!existingId) {
    payload.image_url = incomingHasUsableImage ? normalizedIncomingImageUrl : null;
  } else if (!existingHasUsableImage && incomingHasUsableImage) {
    payload.image_url = normalizedIncomingImageUrl;
  } else if (!existingHasUsableImage && !incomingHasUsableImage) {
    payload.image_url = null;
  }

  if (existingId) {
    const existing = existingRows[0];
    const hasDiff =
      existing.title !== payload.title ||
      existing.genre_id !== payload.genre_id ||
      existing.subgenre_id !== payload.subgenre_id ||
      existing.cubby !== payload.cubby ||
      existing.on_my_wall !== payload.on_my_wall ||
      existing.out_for_the_day !== payload.out_for_the_day ||
      ('discogs_id' in payload && (existing.discogs_id || null) !== (payload.discogs_id || null)) ||
      ('image_url' in payload && (existing.image_url || null) !== (payload.image_url || null));

    if (!hasDiff) {
      return existingId;
    }

    const { data: updated, error: updateError } = await supabase
      .from('records')
      .update(payload)
      .eq('id', existingId)
      .select('id')
      .single();
    if (updateError) throw new Error(`Record update failed (${record.title}): ${updateError.message}`);
    return updated.id;
  }

  // Calculate order value for new record based on alphabetical sorting
  const orderValue = await calculateOrderValue(record.genre_id, artistNames, record.title);
  payload['order'] = orderValue;

  const { data: inserted, error: insertError } = await supabase
    .from('records')
    .insert(payload)
    .select('id')
    .single();
  if (insertError) throw new Error(`Record insert failed (${record.title}): ${insertError.message}`);
  return inserted.id;
}

async function linkRecordArtist(recordId, artistId) {
  if (!recordId || !artistId) return;
  const { error } = await supabase
    .from('record_artists')
    .upsert({ record_id: recordId, artist_id: artistId }, { onConflict: 'record_id,artist_id' });
  if (error) throw new Error(`Record-artist link failed (record ${recordId}, artist ${artistId}): ${error.message}`);
}

async function syncRecordArtists(recordId, artistNames) {
  const desiredNames = Array.from(new Set((artistNames || []).map((n) => normalizeArtistDisplayName(n)).filter(Boolean)));
  if (!recordId || desiredNames.length === 0) return;

  const desiredArtistIds = [];
  for (const name of desiredNames) {
    const artistId = await getOrCreateArtistId(name);
    if (artistId) desiredArtistIds.push(artistId);
  }

  const { data: existingLinks, error: existingError } = await supabase
    .from('record_artists')
    .select('artist_id')
    .eq('record_id', recordId);
  if (existingError) throw new Error(`Record-artist fetch failed (record ${recordId}): ${existingError.message}`);

  const existingIds = (existingLinks || []).map((r) => r.artist_id).filter(Boolean);
  const toRemove = existingIds.filter((id) => !desiredArtistIds.includes(id));

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from('record_artists')
      .delete()
      .eq('record_id', recordId)
      .in('artist_id', toRemove);
    if (deleteError) throw new Error(`Record-artist cleanup failed (record ${recordId}): ${deleteError.message}`);
  }

  for (const artistId of desiredArtistIds) {
    await linkRecordArtist(recordId, artistId);
  }
}

async function calculateOrderValue(genreId, artistNames, title) {
  // Fetch all records with genre and artist info to calculate alphabetical order
  const { data: allRecords, error } = await supabase
    .from('records')
    .select('id,title,genre:genres(name),artists(name)');
  
  if (error) throw new Error(`Failed to fetch records for order calculation: ${error.message}`);

  // Get the genre name
  let genreName = '';
  if (genreId) {
    const { data: genreData } = await supabase
      .from('genres')
      .select('name')
      .eq('id', genreId)
      .single();
    genreName = genreData?.name || '';
  }

  // Create a sortable version of new record
  const artistString = (artistNames || []).sort().join(', ');
  const newRecordKey = `${genreName}|||${artistString}|||${title}`;

  // Build list of all records with their sort keys
  const recordKeys = (allRecords || []).map((rec) => {
    const recGenre = rec.genre?.name || '';
    const recArtists = (rec.artists || []).map(a => a.name).sort().join(', ');
    const recTitle = rec.title || '';
    return {
      id: rec.id,
      key: `${recGenre}|||${recArtists}|||${recTitle}`,
    };
  });

  // Sort the keys and find insertion point
  recordKeys.sort((a, b) => a.key.localeCompare(b.key));
  recordKeys.push({ id: null, key: newRecordKey });
  recordKeys.sort((a, b) => a.key.localeCompare(b.key));

  const insertionIndex = recordKeys.findIndex(r => r.key === newRecordKey);
  
  // Calculate order: use gaps of 1000 for insertion flexibility
  let orderValue;
  if (insertionIndex === 0) {
    orderValue = -1000000; // Start before first record
  } else if (insertionIndex === recordKeys.length - 1) {
    // Last position - find max order value in DB
    const { data: maxData } = await supabase
      .from('records')
      .select('"order"')
      .order('"order"', { ascending: false })
      .limit(1)
      .single();
    orderValue = (maxData?.['"order"'] || 0) + 1000;
  } else {
    // Middle position - insert between two records
    const prevRecord = recordKeys[insertionIndex - 1];
    const nextRecord = recordKeys[insertionIndex + 1];
    
    const { data: prevData } = await supabase
      .from('records')
      .select('"order"')
      .eq('id', prevRecord.id)
      .single();
    const { data: nextData } = await supabase
      .from('records')
      .select('"order"')
      .eq('id', nextRecord.id)
      .single();
    
    const prevOrder = prevData?.['"order"'] || 0;
    const nextOrder = nextData?.['"order"'] || (prevOrder + 1000);
    orderValue = Math.floor((prevOrder + nextOrder) / 2);
  }

  return orderValue;
}

async function fetchDiscogsRelease(title, artist) {
  if (!DISCOGS_TOKEN) return null;

  const cleanTitle = normalizeText(title);
  const cleanArtist = normalizeArtistForDiscogs(artist);
  const cacheKey = `${cleanArtist}|||${cleanTitle}`;

  if (discogsCache.has(cacheKey)) {
    return discogsCache.get(cacheKey);
  }

  const queries = [];
  if (cleanArtist && cleanTitle) {
    queries.push(`https://api.discogs.com/database/search?artist=${encodeURIComponent(cleanArtist)}&release_title=${encodeURIComponent(cleanTitle)}&type=release&token=${DISCOGS_TOKEN}`);
  }
  if (cleanTitle) {
    queries.push(`https://api.discogs.com/database/search?release_title=${encodeURIComponent(cleanTitle)}&type=release&token=${DISCOGS_TOKEN}`);
    queries.push(`https://api.discogs.com/database/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`.trim())}&type=release&token=${DISCOGS_TOKEN}`);
  }

  for (const url of queries) {
    for (let attempt = 1; attempt <= DISCOGS_MAX_RETRIES; attempt += 1) {
      try {
        const now = Date.now();
        const waitMs = DISCOGS_MIN_INTERVAL_MS - (now - lastDiscogsRequestAt);
        if (waitMs > 0) {
          await delay(waitMs);
        }

        const res = await fetch(url, {
          headers: {
            'User-Agent': 'RecordCatalog/1.0 (+https://example.com)',
            Accept: 'application/json',
          },
        });
        lastDiscogsRequestAt = Date.now();

        if (res.status === 429) {
          const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
          const backoff = Number.isNaN(retryAfter) ? attempt * 1500 : retryAfter * 1000;
          await delay(backoff);
          continue;
        }

        if (!res.ok) {
          if (attempt === DISCOGS_MAX_RETRIES) {
            console.warn(`Discogs request failed (${res.status}) for ${cleanArtist} - ${cleanTitle}`);
          }
          continue;
        }

        const data = await res.json();
        if (!data?.results?.length) break;

        const cmpArtist = cleanArtist.replace(/[^\w\s]/g, '').toLowerCase();
        const cmpTitle = cleanTitle.replace(/[^\w\s]/g, '').toLowerCase();

        let best = data.results.find((r) => {
          const rArtist = normalizeText(r.artist || r.artist_display || '').replace(/[^\w\s]/g, '').toLowerCase();
          const rTitle = normalizeText(r.title || '').replace(/[^\w\s]/g, '').toLowerCase();
          return (!cmpArtist || rArtist.includes(cmpArtist)) && rTitle.includes(cmpTitle);
        });

        if (!best) best = data.results[0];
        const release = {
          id: best?.id ?? null,
          image_url: best?.cover_image || best?.thumb || null,
          artist: normalizeText(best?.artist || best?.artist_display || '') || null,
        };
        discogsCache.set(cacheKey, release);
        return release;
      } catch {
        if (attempt === DISCOGS_MAX_RETRIES) {
          console.warn(`Discogs lookup error for ${cleanArtist} - ${cleanTitle}`);
        }
      }
    }
  }

  discogsCache.set(cacheKey, { id: null, image_url: null, artist: null });
  return null;
}

async function main() {
  if (!DISCOGS_TOKEN) {
    console.warn('DISCOGS_TOKEN is missing. Discogs lookups will return null.');
  }

  const parser = fs.createReadStream(CSV_PATH).pipe(
    parse({
      columns: false,
      skip_empty_lines: true,
      trim: true,
    })
  );

  let isHeader = true;
  let processed = 0;
  let insertedOrUpdated = 0;
  let skipped = 0;

  for await (const row of parser) {
    if (isHeader) {
      isHeader = false;
      continue;
    }

    if (PREVIEW_LIMIT && processed >= PREVIEW_LIMIT) break;

    const title = normalizeText(row[COL.TITLE]);
    const artistRaw = normalizeText(row[COL.ARTIST]);
    const genre = normalizeText(row[COL.GENRE]);
    const subgenre = normalizeText(row[COL.SUBGENRE]);
    const out_for_the_day = normalizeText(row[COL.OUT_FOR_THE_DAY]);
    const on_my_wall = normalizeText(row[COL.ON_MY_WALL]);
    const cubby = normalizeText(row[COL.CUBBY]);

    if (!title || !artistRaw) {
      skipped += 1;
      processed += 1;
      console.warn('Skipping row with missing title or artist');
      continue;
    }

    try {
      const artistNames = parseArtists(artistRaw);
      const primaryArtist = artistNames[0] || artistRaw;
      const discogsRelease = await fetchDiscogsRelease(title, primaryArtist);
      const discogsId = discogsRelease?.id || null;
      const imageUrl = discogsRelease?.image_url || null;
      // Use Discogs artist name if available — it's already in proper display format
      // (e.g. Discogs returns "Post Malone", not "Malone, Post" from CSV)
      const resolvedArtistNames = discogsRelease?.artist
        ? parseArtists(discogsRelease.artist)
        : artistNames;
      const genreId = await getOrCreateGenreId(genre);
      const subgenreId = await getOrCreateSubgenreId(subgenre, genreId);

      const recordId = await upsertRecord({
        title,
        genre_id: genreId,
        subgenre_id: subgenreId,
        out_for_the_day,
        on_my_wall,
        cubby,
        discogs_id: discogsId,
        image_url: imageUrl,
      }, resolvedArtistNames);

      await syncRecordArtists(recordId, resolvedArtistNames);

      insertedOrUpdated += 1;
      processed += 1;
      console.log(`[${processed}] Imported: ${resolvedArtistNames.join(', ')} - ${title} (record_id=${recordId}, discogs_id=${discogsId || 'null'})`);
    } catch (err) {
      processed += 1;
      console.error(`Failed row: ${artistRaw} - ${title}`);
      console.error(err.message);
    }
  }

  console.log(`\nImport complete. Processed ${processed} row(s). Imported/updated ${insertedOrUpdated}. Skipped ${skipped}.`);
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
