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

function getArtistSortKey(name: string) {
  const clean = normalizeArtistName(name).replace(/^The\s+/i, "");
  if (!clean) return "";

  if (clean.includes(",")) {
    return normalizeText(clean.split(",")[0]).toLowerCase();
  }

  const words = clean.split(/\s+/).filter(Boolean);
  const lower = clean.toLowerCase();
  const bandHint = /(\&|\band\b|\bband\b|\borchestra\b|\bensemble\b|\btrio\b|\bquartet\b|\bproject\b)/i.test(lower);

  if (!bandHint && words.length <= 3) {
    return words[words.length - 1].toLowerCase();
  }

  return words[0].toLowerCase();
}

type SortRecord = {
  id: number;
  currentOrder: number;
  currentCubby: number | null;
  genre: string;
  artistKey: string;
  title: string;
  targetCubby: number;
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

  const raw = Number.parseInt(String(req.body?.groupSize ?? ""), 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return res.status(400).json({ error: "groupSize must be a positive integer" });
  }

  const groupSize = Math.floor(raw);
  const styleByCubby = parseStyleByCubby(req.body?.styleByCubby);

  try {
    const { data, error } = await supabase
      .from("records")
      .select("id,title,order,cubby,genre:genres(name),artists(name)");

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const sortable: SortRecord[] = (data || []).map((rec: any) => {
      const genre = normalizeText(rec.genre?.name).toLowerCase();
      const artistKey = (rec.artists || [])
        .map((a: any) => getArtistSortKey(a.name || ""))
        .sort((a: string, b: string) => a.localeCompare(b))
        .join(", ");
      const title = normalizeText(rec.title).toLowerCase();

      return {
        id: rec.id,
        currentOrder: Number(rec.order || 0),
        currentCubby: rec.cubby ?? null,
        genre,
        artistKey,
        title,
        targetCubby: 0,
      };
    });

    // Collapse all cubbies by canonical genre->artist order before regrouping.
    sortable.sort((a, b) => {
      const keyCmp = getOrderingKey(a, "genre-artist").localeCompare(getOrderingKey(b, "genre-artist"));
      if (keyCmp !== 0) return keyCmp;
      return a.id - b.id;
    });

    for (let idx = 0; idx < sortable.length; idx += 1) {
      sortable[idx].targetCubby = Math.floor(idx / groupSize) + 1;
    }

    const byTargetCubby = new Map<number, SortRecord[]>();
    for (const rec of sortable) {
      if (!byTargetCubby.has(rec.targetCubby)) byTargetCubby.set(rec.targetCubby, []);
      byTargetCubby.get(rec.targetCubby)!.push(rec);
    }

    const orderedForWrite: Array<SortRecord & { desiredOrder: number; desiredCubby: number }> = [];
    const cubbies = Array.from(byTargetCubby.keys()).sort((a, b) => a - b);
    for (const cubby of cubbies) {
      const style = resolveStyle(cubby, styleByCubby);
      const rows = byTargetCubby.get(cubby) || [];
      rows.sort((a, b) => {
        const keyCmp = getOrderingKey(a, style).localeCompare(getOrderingKey(b, style));
        if (keyCmp !== 0) return keyCmp;
        return a.id - b.id;
      });

      for (let idx = 0; idx < rows.length; idx += 1) {
        orderedForWrite.push({
          ...rows[idx],
          desiredCubby: cubby,
          desiredOrder: (idx + 1) * 1000,
        });
      }
    }

    let changed = 0;

    for (const rec of orderedForWrite) {
      const desiredOrder = rec.desiredOrder;
      const desiredCubby = rec.desiredCubby;

      if (rec.currentOrder === desiredOrder && rec.currentCubby === desiredCubby) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("records")
        .update({ order: desiredOrder, cubby: desiredCubby })
        .eq("id", rec.id);

      if (updateError) {
        throw new Error(`Failed to update record ${rec.id}: ${updateError.message}`);
      }

      changed += 1;
    }

    const cubbiesCreated = sortable.length === 0 ? 0 : Math.ceil(sortable.length / groupSize);

    return res.status(200).json({
      success: true,
      total: sortable.length,
      changed,
      groupSize,
      styleByCubby,
      cubbiesCreated,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
