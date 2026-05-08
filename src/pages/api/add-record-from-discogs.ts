import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { discogsFetch } from '../../lib/discogsRateLimit';

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArtistName(name: string) {
  return normalizeText(name).replace(/\s+\(\d+\)$/, '');
}

function getArtistSortKey(name: string) {
  const clean = normalizeArtistName(name).replace(/^The\s+/i, '');
  if (!clean) return '';

  if (clean.includes(',')) {
    return normalizeText(clean.split(',')[0]).toLowerCase();
  }

  const words = clean.split(/\s+/).filter(Boolean);
  const lower = clean.toLowerCase();
  const bandHint = /(&|\band\b|\bband\b|\borchestra\b|\bensemble\b|\btrio\b|\bquartet\b|\bproject\b)/i.test(lower);

  if (!bandHint && words.length <= 3) {
    return words[words.length - 1].toLowerCase();
  }

  return words[0].toLowerCase();
}

async function getOrCreateGenreId(name: string | null) {
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

async function getOrCreateSubgenreId(name: string | null, genreId: number | null) {
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

async function getOrCreateArtistId(name: string) {
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

async function syncRecordArtists(recordId: number, artistNames: string[]) {
  const normalized = Array.from(new Set((artistNames || []).map((n) => normalizeArtistName(n)).filter(Boolean)));

  const artistIds: number[] = [];
  for (const name of normalized) {
    const artistId = await getOrCreateArtistId(name);
    if (artistId) artistIds.push(artistId);
  }

  const { error: clearError } = await supabase
    .from('record_artists')
    .delete()
    .eq('record_id', recordId);
  if (clearError) throw new Error(`Record-artist clear failed: ${clearError.message}`);

  if (!artistIds.length) return;

  const payload = artistIds.map((artistId) => ({ record_id: recordId, artist_id: artistId }));
  const { error: insertError } = await supabase.from('record_artists').insert(payload);
  if (insertError) throw new Error(`Record-artist insert failed: ${insertError.message}`);
}

async function calculateOrderValue(genreName: string, artistNames: string[], title: string) {
  const { data: allRecords, error } = await supabase
    .from('records')
    .select('id,title,order,genre:genres(name),artists(name)');
  if (error) throw new Error(`Failed to fetch records for order calculation: ${error.message}`);

  const newArtistKey = (artistNames || []).map(getArtistSortKey).sort().join(', ');
  const newKey = `${normalizeText(genreName).toLowerCase()}|||${newArtistKey}|||${normalizeText(title).toLowerCase()}`;

  const existing = (allRecords || []).map((rec: any) => {
    const recGenre = normalizeText(rec.genre?.name).toLowerCase();
    const recArtists = (rec.artists || []).map((a: any) => getArtistSortKey(a.name)).sort().join(', ');
    const recTitle = normalizeText(rec.title).toLowerCase();
    return {
      id: rec.id,
      order: Number(rec.order || 0),
      key: `${recGenre}|||${recArtists}|||${recTitle}`,
    };
  });

  const withNew = [...existing, { id: -1, order: 0, key: newKey }].sort((a, b) => a.key.localeCompare(b.key));
  const insertionIndex = withNew.findIndex((r) => r.id === -1);

  if (insertionIndex <= 0) {
    const minOrder = existing.length ? Math.min(...existing.map((r) => r.order)) : 0;
    return minOrder - 1000;
  }

  if (insertionIndex >= withNew.length - 1) {
    const maxOrder = existing.length ? Math.max(...existing.map((r) => r.order)) : 0;
    return maxOrder + 1000;
  }

  const prev = withNew[insertionIndex - 1];
  const next = withNew[insertionIndex + 1];
  const midpoint = Math.floor((prev.order + next.order) / 2);

  if (midpoint <= prev.order) return prev.order + 1;
  return midpoint;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.DISCOGS_TOKEN;
  const { discogsId, cubby } = req.body || {};

  if (!token || !discogsId) {
    return res.status(400).json({ error: 'Missing discogsId or DISCOGS_TOKEN' });
  }

  const cubbyNumber = Number.parseInt(String(cubby ?? ''), 10);
  const normalizedCubby = Number.isNaN(cubbyNumber) ? null : cubbyNumber;

  try {
    const releaseUrl = `https://api.discogs.com/releases/${encodeURIComponent(String(discogsId))}?token=${token}`;
    const releaseRes = await discogsFetch(releaseUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!releaseRes.ok) {
      const errText = await releaseRes.text();
      return res.status(releaseRes.status).json({ error: 'Discogs release lookup failed', details: errText.slice(0, 300) });
    }

    const release = await releaseRes.json();

    const title = normalizeText(release.title);
    const artistNames = (release.artists || []).map((a: any) => normalizeArtistName(a?.name || '')).filter(Boolean);
    const genreName = normalizeText((release.genres || [])[0] || '');
    const subgenreName = normalizeText((release.styles || [])[0] || '');
    const imageUrl = release?.images?.[0]?.uri || release?.thumb || null;

    if (!title) {
      return res.status(400).json({ error: 'Discogs release missing title' });
    }

    const genreId = await getOrCreateGenreId(genreName || null);
    const subgenreId = await getOrCreateSubgenreId(subgenreName || null, genreId);

    const { data: existing, error: existingError } = await supabase
      .from('records')
      .select('id')
      .eq('discogs_id', String(release.id))
      .maybeSingle();
    if (existingError) {
      throw new Error(`Existing record lookup failed: ${existingError.message}`);
    }

    const payload: Record<string, unknown> = {
      title,
      genre_id: genreId,
      subgenre_id: subgenreId,
      cubby: normalizedCubby,
      discogs_id: String(release.id),
      image_url: imageUrl,
      on_my_wall: false,
      out_for_the_day: false,
    };

    let recordId: number;

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('records')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .single();

      if (updateError) throw new Error(`Record update failed: ${updateError.message}`);
      recordId = updated.id;
    } else {
      const orderValue = await calculateOrderValue(genreName, artistNames, title);
      payload.order = orderValue;

      const { data: inserted, error: insertError } = await supabase
        .from('records')
        .insert(payload)
        .select('id')
        .single();

      if (insertError) throw new Error(`Record insert failed: ${insertError.message}`);
      recordId = inserted.id;
    }

    await syncRecordArtists(recordId, artistNames);

    return res.status(200).json({
      success: true,
      recordId,
      discogsId: String(release.id),
      title,
      artists: artistNames,
      genre: genreName,
      subgenre: subgenreName,
      cubby: normalizedCubby,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected add-from-discogs error' });
  }
}
