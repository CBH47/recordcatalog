import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function getOrCreateGenreId(name: string) {
  const cleanName = normalizeText(name);
  if (!cleanName) return null;

  const { data: existing, error: existingError } = await supabase
    .from('genres')
    .select('id')
    .eq('name', cleanName)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Genre lookup failed (${cleanName}): ${existingError.message}`);
  }

  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from('genres')
    .insert({ name: cleanName })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(`Genre insert failed (${cleanName}): ${insertError.message}`);
  }

  return inserted.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recordId, genre } = req.body || {};
  const parsedRecordId = Number.parseInt(String(recordId), 10);

  if (!Number.isFinite(parsedRecordId)) {
    return res.status(400).json({ error: 'Missing or invalid recordId' });
  }

  try {
    const cleanGenre = normalizeText(genre);
    const genreId = cleanGenre ? await getOrCreateGenreId(cleanGenre) : null;

    const { data, error } = await supabase
      .from('records')
      .update({ genre_id: genreId })
      .eq('id', parsedRecordId)
      .select('id,genre_id')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      data,
      genreName: cleanGenre,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unexpected updateRecordGenre error' });
  }
}
