import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeArtistName(name: string) {
  return normalizeText(name).replace(/\s+\(\d+\)$/, "");
}

function getArtistSortKey(name: string, isBand?: boolean) {
  const clean = normalizeArtistName(name).replace(/^The\s+/i, "");
  if (!clean) return "";

  if (clean.includes(",")) {
    return normalizeText(clean.split(",")[0]).toLowerCase();
  }

  const words = clean.split(/\s+/).filter(Boolean);
  
  // If we have explicit is_band flag from DB, use it. Otherwise fall back to pattern matching.
  let isBandGroup = isBand;
  if (isBand === undefined || isBand === null) {
    const lower = clean.toLowerCase();
    const bandKeywords = /(\&|\bband\b|\borchestra\b|\bensemble\b|\btrio\b|\bquartet\b|\bquintet\b|\bsextet\b|\bproject\b|\bcollective\b|\bchoir\b|\bclub\b|\bcrew\b|\bboys\b|\bgirls\b|\bbrothers\b|\bsisters\b|\bsons\b|\bdaughters\b|\boverdrive\b|\bexperience\b|\bgang\b|\bmachine\b|\bsystem\b|\bunion\b|\border\b|\bsociety\b)/i;
    const hasBandKeyword = bandKeywords.test(lower);
    const hasConjunction = /\s(and|&|\+|or)\s/i.test(lower);
    const commonBandEndings = /\b(dead|floyd|police|genesis|journey|eagles|boston|chicago|phish|heads|stones|beetles|monkees|doors|cure|smiths|ramones|pistols|clash|animals|byrds|hollies|seekers|cream|zeppelin|sabbath|maiden|priest|judas|guns|roses|skid|row|deep|purple|overdrive|experience)\b/i;

    // 3+ word names are usually bands unless they match a strong person-name pattern.
    const hasSuffix = /\b(jr\.?|sr\.?|ii|iii|iv)\b/i.test(lower);
    const hasInitial = words.some((w) => /^[a-z]\.?$/i.test(w));
    const personMiddleNames = new Set(["lee", "marie", "ann", "anne", "jean", "ray", "rae", "jo", "joe"]);
    const looksLikeThreePartPerson = words.length === 3 && (hasInitial || personMiddleNames.has(words[1].toLowerCase()) || hasSuffix);
    const likelyBandByLength = words.length >= 3 && !looksLikeThreePartPerson;

    isBandGroup = hasBandKeyword || hasConjunction || (words.length >= 2 && commonBandEndings.test(lower)) || likelyBandByLength;
  }

  // Only apply Last,First sorting to solo artists (not detected as bands)
  if (!isBandGroup && words.length <= 3) {
    return words[words.length - 1].toLowerCase();
  }

  return words[0].toLowerCase();
}

type SortRecord = {
  id: number;
  currentOrder: number;
  cubby: number;
  genre: string;
  artistKey: string;
  title: string;
};

type OrderingStyle = "genre-artist" | "artist-only";

type StyleByCubby = Record<number, OrderingStyle>;

function getOrderingKey(parts: Pick<SortRecord, "genre" | "artistKey" | "title">, style: OrderingStyle) {
  const { genre, artistKey, title } = parts;

  if (style === "artist-only") {
    return `${artistKey}|||${title}|||${genre}`;
  }

  return `${genre}|||${artistKey}|||${title}`;
}

function parseStyleByCubby(input: any): StyleByCubby {
  const styleByCubby: StyleByCubby = {};
  if (!input || typeof input !== "object") return styleByCubby;

  for (const [key, value] of Object.entries(input)) {
    const cubbyNum = Number.parseInt(key, 10);
    if (!Number.isFinite(cubbyNum)) continue;
    styleByCubby[cubbyNum] = value === "artist-only" ? "artist-only" : "genre-artist";
  }

  return styleByCubby;
}

function resolveStyle(cubby: number, styleByCubby: StyleByCubby): OrderingStyle {
  return styleByCubby[cubby] || "genre-artist";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const applyChanges = Boolean(req.body?.apply);
  const styleByCubby = parseStyleByCubby(req.body?.styleByCubby);

  try {
    const { data, error } = await supabase
      .from("records")
      .select("id,title,order,cubby,genre:genres(name),artists(name,is_band)");

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const sortable: SortRecord[] = (data || []).map((rec: any) => {
      const genre = normalizeText(rec.genre?.name).toLowerCase();
      const artistKey = (rec.artists || [])
        .map((a: any) => getArtistSortKey(a.name || "", a.is_band))
        .sort((a: string, b: string) => a.localeCompare(b))
        .join(", ");
      const title = normalizeText(rec.title).toLowerCase();

      return {
        id: rec.id,
        currentOrder: Number(rec.order || 0),
        cubby: typeof rec.cubby === "number" ? rec.cubby : 0,
        genre,
        artistKey,
        title,
      };
    });

    const byCubby = new Map<number, SortRecord[]>();
    for (const rec of sortable) {
      if (!byCubby.has(rec.cubby)) byCubby.set(rec.cubby, []);
      byCubby.get(rec.cubby)!.push(rec);
    }

    const desired: Array<{ id: number; currentOrder: number; desiredOrder: number }> = [];
    const cubbies = Array.from(byCubby.keys()).sort((a, b) => a - b);
    for (const cubby of cubbies) {
      const style = resolveStyle(cubby, styleByCubby);
      const rows = byCubby.get(cubby) || [];
      rows.sort((a, b) => {
        const keyCmp = getOrderingKey(a, style).localeCompare(getOrderingKey(b, style));
        if (keyCmp !== 0) return keyCmp;
        return a.id - b.id;
      });

      for (let idx = 0; idx < rows.length; idx += 1) {
        desired.push({
          id: rows[idx].id,
          currentOrder: rows[idx].currentOrder,
          desiredOrder: (idx + 1) * 1000,
        });
      }
    }

    const toUpdate = desired.filter((row) => row.currentOrder !== row.desiredOrder);

    if (!toUpdate.length) {
      return res.status(200).json({
        success: true,
        alreadyOrdered: true,
        dryRun: !applyChanges,
        styleByCubby,
        needsUpdate: 0,
        updated: 0,
        total: desired.length,
      });
    }

    if (!applyChanges) {
      return res.status(200).json({
        success: true,
        alreadyOrdered: false,
        dryRun: true,
        styleByCubby,
        needsUpdate: toUpdate.length,
        updated: 0,
        total: desired.length,
      });
    }

    for (const row of toUpdate) {
      const { error: updateError } = await supabase
        .from("records")
        .update({ order: row.desiredOrder })
        .eq("id", row.id);

      if (updateError) {
        throw new Error(`Failed to update record ${row.id}: ${updateError.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      alreadyOrdered: false,
      dryRun: false,
      styleByCubby,
      needsUpdate: toUpdate.length,
      updated: toUpdate.length,
      total: desired.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
