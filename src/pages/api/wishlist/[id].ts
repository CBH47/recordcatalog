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

function calcTrend(
  existingSnapshots: any[],
  newLowest: number | null
): "up" | "down" | "flat" | "unknown" {
  if (newLowest === null) return "unknown";
  const prev = [...existingSnapshots]
    .reverse()
    .find((s) => typeof s.lowestPrice === "number" && s.lowestPrice !== null);
  if (!prev) return "unknown";
  const delta = newLowest - prev.lowestPrice;
  if (Math.abs(delta) < 0.0001) return "flat";
  return delta > 0 ? "up" : "down";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const itemId = Array.isArray(id) ? id[0] : id;
  if (!itemId) return res.status(400).json({ error: "Missing id" });

  if (req.method === "PATCH") {
    const { type, status, snapshot } = req.body || {};

    if (type === "status") {
      if (status !== "wanted" && status !== "acquired") {
        return res.status(400).json({ error: "Invalid status value" });
      }
      const { data, error } = await supabase
        .from("wishlist_items")
        .update({ status })
        .eq("id", itemId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(rowToItem(data));
    }

    if (type === "snapshot") {
      const { data: current, error: fetchErr } = await supabase
        .from("wishlist_items")
        .select("price_snapshots, discogs_id")
        .eq("id", itemId)
        .single();
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      const existing: any[] = current?.price_snapshots ?? [];
      const lastTrend = calcTrend(existing, snapshot?.lowestPrice ?? null);
      const newSnapshots = [...existing, snapshot].slice(-30);

      const { data, error } = await supabase
        .from("wishlist_items")
        .update({
          price_snapshots: newSnapshots,
          last_trend: lastTrend,
          discogs_id: snapshot?.discogsId ?? current?.discogs_id ?? null,
        })
        .eq("id", itemId)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(rowToItem(data));
    }

    return res.status(400).json({ error: "Invalid patch type" });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("id", itemId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
