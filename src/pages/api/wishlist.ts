import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

function rowToItem(row: any) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    targetPrice: row.target_price,
    notes: row.notes,
    status: row.status,
    discogsId: row.discogs_id ?? null,
    priceSnapshots: row.price_snapshots ?? [],
    lastTrend: row.last_trend ?? "unknown",
    createdAt: row.created_at,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("wishlist_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json((data || []).map(rowToItem));
  }

  if (req.method === "POST") {
    const { title, artist, targetPrice, notes, status, discogsId } = req.body || {};

    if (!String(title || "").trim()) {
      return res.status(400).json({ error: "Title is required." });
    }

    const parsedDiscogsId = Number(discogsId);
    const { data, error } = await supabase
      .from("wishlist_items")
      .insert({
        id: crypto.randomUUID(),
        title: String(title).trim(),
        artist: String(artist || "").trim(),
        target_price: String(targetPrice || "").trim(),
        notes: String(notes || "").trim(),
        status: status === "acquired" ? "acquired" : "wanted",
        discogs_id: Number.isFinite(parsedDiscogsId) && discogsId ? parsedDiscogsId : null,
        price_snapshots: [],
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(rowToItem(data));
  }

  return res.status(405).json({ error: "Method not allowed" });
}
