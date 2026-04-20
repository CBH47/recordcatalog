import type { NextApiRequest, NextApiResponse } from 'next';
import { discogsFetch } from '../../lib/discogsRateLimit';

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const token = process.env.DISCOGS_TOKEN;

  if (!id || Array.isArray(id) || !token) {
    res.status(400).json({ error: 'Missing release id or Discogs token' });
    return;
  }

  try {
    const releaseRes = await discogsFetch(`https://api.discogs.com/releases/${encodeURIComponent(id)}?token=${token}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!releaseRes.ok) {
      res.status(releaseRes.status).json({ error: 'Discogs release lookup failed' });
      return;
    }

    const release = await releaseRes.json();
    const imageUrl = release?.images?.[0]?.uri150 || release?.images?.[0]?.uri || null;

    if (!imageUrl) {
      res.status(404).json({ error: 'No cover image for this release' });
      return;
    }

    const imageRes = await discogsFetch(imageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/*,*/*;q=0.8',
        Referer: 'https://www.discogs.com/',
      },
    });

    if (!imageRes.ok) {
      res.status(imageRes.status).json({ error: 'Discogs cover download failed' });
      return;
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    const cacheControl = imageRes.headers.get('cache-control') || 'public, s-maxage=86400, max-age=3600';
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.status(200).send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unexpected cover proxy error' });
  }
}
