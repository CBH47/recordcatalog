import type { NextApiRequest, NextApiResponse } from 'next';
import { discogsFetch } from '../../lib/discogsRateLimit';

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const token = process.env.DISCOGS_TOKEN;
  if (!id || Array.isArray(id) || !token) {
    res.status(400).json({ error: 'Missing id or token' });
    return;
  }

  try {
    const apiRes = await discogsFetch(`https://api.discogs.com/releases/${encodeURIComponent(id)}?token=${token}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      res.status(apiRes.status).json({ error: 'Discogs API error', status: apiRes.status, details: errText.slice(0, 300) });
      return;
    }

    const data = await apiRes.json();
    res.setHeader('Cache-Control', 'public, s-maxage=43200, max-age=1800');
    res.status(200).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unknown Discogs API error' });
  }
}
