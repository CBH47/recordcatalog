import type { NextApiRequest, NextApiResponse } from 'next';
import { discogsFetch } from '../../lib/discogsRateLimit';

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

function normalizeArtistName(name: string) {
  return String(name || '').replace(/\s+\(\d+\)$/, '').trim();
}

function extractReleaseId(input: string): string | null {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;

  const releaseMatch = trimmed.match(/\/releases?\/(\d+)/i) || trimmed.match(/\brelease\/(\d+)/i);
  if (releaseMatch?.[1]) return releaseMatch[1];

  return null;
}

function extractBarcodeValue(release: any): string {
  const identifiers = Array.isArray(release?.identifiers) ? release.identifiers : [];
  const barcode = identifiers.find((id: any) => String(id?.type || '').toLowerCase().includes('barcode'));
  return String(barcode?.value || '').replace(/[^0-9]/g, '');
}

function toAbsoluteUri(uri: string | null | undefined): string | null {
  const value = String(uri || '').trim();
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('/')) return `https://www.discogs.com${value}`;
  return `https://www.discogs.com/${value}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.DISCOGS_TOKEN;
  const urlParam = req.query.url;
  const input = Array.isArray(urlParam) ? urlParam[0] : urlParam;

  if (!token || !input) {
    return res.status(400).json({ error: 'Missing url or DISCOGS_TOKEN' });
  }

  const discogsId = extractReleaseId(String(input));
  if (!discogsId) {
    return res.status(400).json({ error: 'Could not parse a Discogs release id from the provided URL' });
  }

  try {
    const releaseUrl = `https://api.discogs.com/releases/${encodeURIComponent(discogsId)}?token=${token}`;
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
      upc: extractBarcodeValue(release),
      title: release.title || '',
      artists: (release.artists || []).map((a: any) => normalizeArtistName(a?.name || '')).filter(Boolean),
      year: release.year || null,
      country: release.country || null,
      genres: release.genres || [],
      styles: release.styles || [],
      image_url: release?.images?.[0]?.uri || release?.thumb || null,
      uri: toAbsoluteUri(release.uri),
    };

    return res.status(200).json({ preview });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected release lookup error' });
  }
}
