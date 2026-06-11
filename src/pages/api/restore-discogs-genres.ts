import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function getOrCreateGenreId(name: string) {
  const cleanName = normalizeText(name);
  if (!cleanName) return null;

  const { data: existing, error: existingError } = await supabase
    .from("genres")
    .select("id")
    .eq("name", cleanName)
    .maybeSingle();
  if (existingError) throw new Error(`Genre lookup failed (${cleanName}): ${existingError.message}`);
  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from("genres")
    .insert({ name: cleanName })
    .select("id")
    .single();
  if (insertError) throw new Error(`Genre insert failed (${cleanName}): ${insertError.message}`);

  return inserted.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { data: records, error: fetchError } = await supabase
      .from("records")
      .select("id,genre_id,discogs_genre_name");

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const rec of records || []) {
      const discogsGenre = normalizeText(rec.discogs_genre_name);
      if (!discogsGenre) {
        skipped += 1;
        continue;
      }

      const genreId = await getOrCreateGenreId(discogsGenre);
      if (!genreId) {
        skipped += 1;
        continue;
      }

      if (rec.genre_id === genreId) {
        unchanged += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("records")
        .update({ genre_id: genreId })
        .eq("id", rec.id);

      if (updateError) {
        throw new Error(`Failed updating record ${rec.id}: ${updateError.message}`);
      }

      updated += 1;
    }

    return res.status(200).json({
      success: true,
      total: (records || []).length,
      updated,
      unchanged,
      skipped,
      message: "Genres replaced with stored Discogs genres.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected restore-discogs-genres error" });
  }
}
