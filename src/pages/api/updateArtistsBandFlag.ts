import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { artistNames, isBand } = req.body || {};
  if (!Array.isArray(artistNames) || typeof isBand !== 'boolean') {
    return res.status(400).json({ error: 'artistNames (array) and isBand (boolean) are required' });
  }

  const normalized = Array.from(new Set(artistNames.map((name: unknown) => normalizeText(name)).filter(Boolean)));
  if (!normalized.length) {
    return res.status(400).json({ error: 'No valid artist names provided' });
  }

  try {
    const { data, error } = await supabase
      .from('artists')
      .update({ is_band: isBand })
      .in('name', normalized)
      .select('id,name,is_band');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      updatedCount: (data || []).length,
      updatedArtists: data || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected updateArtistsBandFlag error' });
  }
}
