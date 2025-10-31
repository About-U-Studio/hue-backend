import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { appendToSheet } from '../../lib/sheets';
import { sendWelcomeEmail } from '../../lib/mailer';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });

  try {
    const { email, audience, firstName, lastName } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

    // Beta cap: max 100 users
    const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= 100) return res.status(200).json({ ok: false, reason: 'beta_full' });

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    // Upsert user by email
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .upsert(
        { email, first_name: firstName || null, last_name: lastName || null, audience: audience || null },
        { onConflict: 'email' }
      )
      .select()
      .single();
    if (error) {
      console.error('Supabase upsert error', error);
      return res.status(500).json({ ok: false, reason: 'db_error' });
    }

    // Only log to Google Sheets and send welcome email for NEW users
    const isNewUser = !existingUser;
    
    if (isNewUser) {
      // Log to Google Sheets
      await appendToSheet({
        timestamp: new Date().toISOString(),
        role: audience || '',
        first_name: firstName || '',
        last_name: lastName || '',
        email
      });

      // Send welcome email only for new users
      await sendWelcomeEmail(email, firstName);
    }

    return res.status(200).json({ ok: true, userId: user?.id || null });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
