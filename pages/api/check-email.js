import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Check if user exists
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    return res.status(200).json({ exists: !!user });
  } catch (e) {
    // If error (e.g., user not found), return false
    return res.status(200).json({ exists: false });
  }
}
