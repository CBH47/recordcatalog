import type { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED_HOSTS = new Set([
  'i.discogs.com',
  'img.discogs.com',
  'st.discogs.com',
]);

const USER_AGENT = 'RecordCatalog/1.0 (+https://example.com)';

function discogsHeaders(accept: string) {
  return {
    'User-Agent': USER_AGENT,
    Accept: accept,
    Referer: 'https://www.discogs.com/',
  };
}

function isAllowedImageHost(hostname: string) {
  return ALLOWED_HOSTS.has(hostname.toLowerCase());
}

async function proxyImage(url: string) {
  return fetch(url, {
    headers: discogsHeaders('image/*,*/*;q=0.8'),
  });
}

async function fallbackReleaseImage(discogsId: string, token: string) {
  const releaseRes = await fetch(`https://api.discogs.com/releases/${encodeURIComponent(discogsId)}?token=${token}`, {
    headers: discogsHeaders('application/json'),
  });

  if (!releaseRes.ok) return null;
  const release = await releaseRes.json();
  const imageUrl = release?.images?.[0]?.uri150 || release?.images?.[0]?.uri || null;
  if (!imageUrl) return null;

  const url = new URL(imageUrl);
  if (!isAllowedImageHost(url.hostname)) return null;

  return proxyImage(imageUrl);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { src, id } = req.query;
  const token = process.env.DISCOGS_TOKEN;

  if (!src || Array.isArray(src)) {
    res.status(400).json({ error: 'Missing src query param' });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(src);
  } catch {
    res.status(400).json({ error: 'Invalid src URL' });
    return;
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    res.status(400).json({ error: 'Unsupported URL protocol' });
    return;
  }

  if (!isAllowedImageHost(targetUrl.hostname)) {
    res.status(403).json({ error: 'Host not allowed' });
    return;
  }

  try {
    const shouldFallbackToDiscogs = targetUrl.pathname.toLowerCase().includes('spacer.gif');
    let imageRes = shouldFallbackToDiscogs ? null : await proxyImage(targetUrl.toString());

    if ((!imageRes || !imageRes.ok) && id && !Array.isArray(id) && token) {
      imageRes = await fallbackReleaseImage(id, token);
    }

    if (!imageRes || !imageRes.ok) {
      const statusCode = imageRes?.status || 404;
      res.status(statusCode).json({ error: 'Image download failed' });
      return;
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
    const cacheControl = imageRes.headers.get('cache-control') || 'public, s-maxage=86400, max-age=3600';
    const bytes = Buffer.from(await imageRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.status(200).send(bytes);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unexpected image proxy error' });
  }
}
