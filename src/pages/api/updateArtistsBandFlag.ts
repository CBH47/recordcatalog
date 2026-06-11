import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeArtistName(value: unknown) {
  return normalizeText(value).replace(/\s+\(\d+\)$/, '');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { artistNames, isBand } = req.body || {};
  if (!Array.isArray(artistNames) || typeof isBand !== 'boolean') {
    return res.status(400).json({ error: 'artistNames (array) and isBand (boolean) are required' });
  }

  const normalizedInput = Array.from(
    new Set(
      artistNames
        .map((name: unknown) => normalizeArtistName(name).toLowerCase())
        .filter(Boolean)
    )
  );

  if (!normalizedInput.length) {
    return res.status(400).json({ error: 'No valid artist names provided' });
  }

  try {
    const { data: allArtists, error: fetchError } = await supabase
      .from('artists')
      .select('id,name');

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    const idsToUpdate = new Set<number>();
    const matchedNames = new Set<string>();

    for (const artist of allArtists || []) {
      const normalizedDbName = normalizeArtistName(artist.name).toLowerCase();
      if (normalizedInput.includes(normalizedDbName)) {
        idsToUpdate.add(artist.id);
        matchedNames.add(normalizedDbName);
      }
    }

    const unmatchedNames = normalizedInput.filter((name) => !matchedNames.has(name));

    if (!idsToUpdate.size) {
      return res.status(200).json({
        success: true,
        updatedCount: 0,
        updatedArtists: [],
        unmatchedNames,
      });
    }

    const { data, error } = await supabase
      .from('artists')
      .update({ is_band: isBand })
      .in('id', Array.from(idsToUpdate))
      .select('id,name,is_band');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      updatedCount: (data || []).length,
      updatedArtists: data || [],
      unmatchedNames,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected updateArtistsBandFlag error' });
  }
}
