import type { NextApiRequest, NextApiResponse } from "next";
import { discogsFetch } from "../../lib/discogsRateLimit";

const USER_AGENT = "RecordCatalog/1.0 (+https://example.com)";

type TrendResponse = {
  discogsId: number;
  matchedTitle: string;
  matchedArtist: string;
  checkedAt: string;
  currency: string | null;
  lowestPrice: number | null;
  medianPrice: number | null;
  numForSale: number | null;
};

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const maybe = Number(value);
  return Number.isFinite(maybe) ? maybe : null;
}

function normalizeArtistName(name: string) {
  return String(name || "").replace(/\s+\(\d+\)$/, "").trim();
}

async function resolveDiscogsId(token: string, title: string, artist: string): Promise<number | null> {
  const searchUrl = `https://api.discogs.com/database/search?type=release&release_title=${encodeURIComponent(
    title
  )}&artist=${encodeURIComponent(artist)}&per_page=5&token=${token}`;

  const res = await discogsFetch(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  const first = results.find((entry: any) => parseNumber(entry?.id) !== null) || null;
  return first ? Number(first.id) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "DISCOGS_TOKEN is not configured" });
  }

  const title = (firstString(req.query.title) || "").trim();
  const artist = (firstString(req.query.artist) || "").trim();
  const discogsIdParam = firstString(req.query.discogsId);

  let discogsId = parseNumber(discogsIdParam);

  try {
    if (!discogsId) {
      if (!title) {
        return res.status(400).json({ error: "Provide title or discogsId" });
      }

      discogsId = await resolveDiscogsId(token, title, artist);
      if (!discogsId) {
        return res.status(404).json({ error: "No matching Discogs release found" });
      }
    }

    const releaseUrl = `https://api.discogs.com/releases/${encodeURIComponent(String(discogsId))}?token=${token}`;
    const releaseRes = await discogsFetch(releaseUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!releaseRes.ok) {
      const details = (await releaseRes.text()).slice(0, 300);
      return res.status(releaseRes.status).json({ error: "Discogs release lookup failed", details });
    }

    const release = await releaseRes.json();

    const statsUrl = `https://api.discogs.com/marketplace/stats/${encodeURIComponent(String(discogsId))}?token=${token}`;
    const statsRes = await discogsFetch(statsUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    let lowestPrice = parseNumber(release?.lowest_price);
    let numForSale = parseNumber(release?.num_for_sale);
    let medianPrice: number | null = null;
    let currency: string | null = null;

    if (statsRes.ok) {
      const stats = await statsRes.json();
      const lowest = stats?.lowest_price;
      const median = stats?.median_price;
      lowestPrice = parseNumber(lowest?.value) ?? lowestPrice;
      medianPrice = parseNumber(median?.value);
      numForSale = parseNumber(stats?.num_for_sale) ?? numForSale;
      currency = typeof lowest?.currency === "string" ? lowest.currency : null;
    } else if (release?.lowest_price && typeof release.lowest_price === "object") {
      const low = release.lowest_price;
      lowestPrice = parseNumber(low?.value);
      currency = typeof low?.currency === "string" ? low.currency : null;
    }

    const response: TrendResponse = {
      discogsId,
      matchedTitle: String(release?.title || title || "Unknown title"),
      matchedArtist: Array.isArray(release?.artists)
        ? release.artists.map((a: any) => normalizeArtistName(String(a?.name || ""))).filter(Boolean).join(", ")
        : artist,
      checkedAt: new Date().toISOString(),
      currency,
      lowestPrice,
      medianPrice,
      numForSale,
    };

    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected trend lookup error" });
  }
}
