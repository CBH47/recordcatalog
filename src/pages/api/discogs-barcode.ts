import type { NextApiRequest, NextApiResponse } from 'next';
import { discogsFetch } from '../../lib/discogsRateLimit';

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

function normalizeArtistName(name: string) {
  return String(name || '').replace(/\s+\(\d+\)$/, '').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.DISCOGS_TOKEN;
  const upcParam = req.query.upc;
  const upc = Array.isArray(upcParam) ? upcParam[0] : upcParam;

  if (!token || !upc) {
    return res.status(400).json({ error: 'Missing upc or DISCOGS_TOKEN' });
  }

  const cleanUpc = String(upc).replace(/[^0-9]/g, '');
  if (!cleanUpc) {
    return res.status(400).json({ error: 'UPC must contain digits' });
  }

  try {
    const searchUrl = `https://api.discogs.com/database/search?barcode=${encodeURIComponent(cleanUpc)}&type=release&token=${token}`;
    const searchRes = await discogsFetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      return res.status(searchRes.status).json({ error: 'Discogs search failed', details: errText.slice(0, 300) });
    }

    const searchData = await searchRes.json();
    const results = searchData?.results || [];
    if (!results.length) {
      return res.status(404).json({ error: 'No Discogs release found for this UPC' });
    }

    const candidate = results[0];
    const discogsId = candidate?.id;
    if (!discogsId) {
      return res.status(404).json({ error: 'Discogs result missing release id' });
    }

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

    const preview = {
      discogsId: release.id,
      upc: cleanUpc,
      title: release.title || candidate?.title || '',
      artists: (release.artists || []).map((a: any) => normalizeArtistName(a?.name || '')).filter(Boolean),
      year: release.year || null,
      country: release.country || null,
      genres: release.genres || [],
      styles: release.styles || [],
      image_url: release?.images?.[0]?.uri || candidate?.cover_image || candidate?.thumb || null,
      uri: release.uri || candidate?.uri || null,
    };

    return res.status(200).json({ preview });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected barcode lookup error' });
  }
}
