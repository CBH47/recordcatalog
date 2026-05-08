import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

function rowToEntry(row: any) {
  return {
    id: row.id,
    recordId: row.record_id ?? null,
    title: row.title,
    artist: row.artist,
    playedAt: row.played_at,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("listening_history")
      .select("*")
      .order("played_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json((data || []).map(rowToEntry));
  }

  if (req.method === "POST") {
    const { recordId, title, artist } = req.body || {};

    if (!String(title || "").trim()) {
      return res.status(400).json({ error: "Title is required." });
    }

    const parsedRecordId = Number(recordId);
    const { data, error } = await supabase
      .from("listening_history")
      .insert({
        id: crypto.randomUUID(),
        record_id: Number.isFinite(parsedRecordId) && recordId != null ? parsedRecordId : null,
        title: String(title).trim(),
        artist: String(artist || "").trim(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(rowToEntry(data));
  }

  return res.status(405).json({ error: "Method not allowed" });
}
