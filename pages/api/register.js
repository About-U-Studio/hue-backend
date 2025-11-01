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

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedFirstName = firstName ? firstName.toLowerCase().trim() : null;
    const normalizedLastName = lastName ? lastName.toLowerCase().trim() : null;

    // Check if user already exists (case-insensitive email match)
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .single();

    // Check for duplicate name combination if names are provided
    let duplicateName = false;
    if (normalizedFirstName && normalizedLastName && !existingUser) {
      const { data: nameMatches } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .ilike('first_name', normalizedFirstName)
        .ilike('last_name', normalizedLastName)
        .limit(1);
      
      if (nameMatches && nameMatches.length > 0) {
        duplicateName = true;
      }
    }

    // Return error if duplicate name found
    if (duplicateName) {
      return res.status(200).json({ 
        ok: false, 
        reason: 'duplicate_name',
        message: 'A user with this name already exists'
      });
    }

    // Upsert user by email (normalize email to lowercase in database)
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .upsert(
        { 
          email: normalizedEmail, // Store normalized (lowercase) email
          first_name: firstName || null, 
          last_name: lastName || null, 
          audience: audience || null 
        },
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
        email: normalizedEmail // Use normalized email
      });

      // Send welcome email only for new users (use original email for display)
      await sendWelcomeEmail(email, firstName);
    }

    return res.status(200).json({ ok: true, userId: user?.id || null });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
