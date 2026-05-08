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
  key: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const applyChanges = Boolean(req.body?.apply);

  try {
    const { data, error } = await supabase
      .from("records")
      .select("id,title,order,genre:genres(name),artists(name)");

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
        key: `${genre}|||${artistKey}|||${title}`,
      };
    });

    sortable.sort((a, b) => {
      const keyCmp = a.key.localeCompare(b.key);
      if (keyCmp !== 0) return keyCmp;
      return a.id - b.id;
    });

    const desired = sortable.map((rec, idx) => ({
      id: rec.id,
      currentOrder: rec.currentOrder,
      desiredOrder: (idx + 1) * 1000,
    }));

    const toUpdate = desired.filter((row) => row.currentOrder !== row.desiredOrder);

    if (!toUpdate.length) {
      return res.status(200).json({
        success: true,
        alreadyOrdered: true,
        dryRun: !applyChanges,
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
      needsUpdate: toUpdate.length,
      updated: toUpdate.length,
      total: desired.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
