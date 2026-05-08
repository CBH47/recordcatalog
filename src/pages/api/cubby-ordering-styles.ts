import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type OrderingStyle = "genre-artist" | "artist-only";
type StyleByCubby = Record<number, OrderingStyle>;

function normalizeStyle(value: unknown): OrderingStyle {
  return value === "artist-only" ? "artist-only" : "genre-artist";
}

function parseStyleMap(input: unknown): StyleByCubby {
  const output: StyleByCubby = {};
  if (!input || typeof input !== "object") return output;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const cubby = Number.parseInt(key, 10);
    if (!Number.isFinite(cubby)) continue;
    output[cubby] = normalizeStyle(value);
  }

  return output;
}

function isMissingTableError(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("cubby_ordering_styles") && message.includes("does not exist");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("cubby_ordering_styles")
      .select("cubby,style");

    if (error) {
      if (isMissingTableError(error)) {
        return res.status(200).json({ styleByCubby: {}, missingTable: true });
      }
      return res.status(500).json({ error: error.message });
    }

    const styleByCubby: StyleByCubby = {};
    for (const row of data || []) {
      const cubby = Number(row.cubby);
      if (!Number.isFinite(cubby)) continue;
      styleByCubby[cubby] = normalizeStyle(row.style);
    }

    return res.status(200).json({ styleByCubby });
  }

  if (req.method === "PUT") {
    const styleByCubby = parseStyleMap(req.body?.styleByCubby);
    const rows = Object.entries(styleByCubby).map(([cubby, style]) => ({
      cubby: Number.parseInt(cubby, 10),
      style,
      updated_at: new Date().toISOString(),
    }));

    if (!rows.length) {
      return res.status(200).json({ success: true, saved: 0 });
    }

    const { error } = await supabase
      .from("cubby_ordering_styles")
      .upsert(rows, { onConflict: "cubby" });

    if (error) {
      if (isMissingTableError(error)) {
        return res.status(400).json({ error: "Missing cubby_ordering_styles table. Please run the SQL migration." });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, saved: rows.length });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
