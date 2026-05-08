import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recordId, cubby, order } = req.body;

  if (!recordId || cubby === undefined || cubby === null) {
    return res.status(400).json({ error: 'Missing recordId or cubby' });
  }

  try {
    const updatePayload: Record<string, unknown> = { cubby: typeof cubby === 'number' ? cubby : null };
    if (order !== undefined && order !== null) {
      updatePayload['order'] = order;
    }

    const { data, error } = await supabase
      .from('records')
      .update(updatePayload)
      .eq('id', recordId)
      .select('id,cubby')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Cubby update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
