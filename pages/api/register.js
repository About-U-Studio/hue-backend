import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { appendToSheet } from '../../lib/sheets';
import { sendWelcomeEmail } from '../../lib/mailer';
import { isValidEmail, isValidName, validateRequiredFields } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  
  // Rate limiting - 5 registrations per IP per hour
  if (rateLimitMiddleware(req, res, 'registration')) {
    return; // Response already sent
  }

  try {
    const { email, audience, firstName, lastName } = req.body || {};
    
    // Validate required fields
    const requiredCheck = validateRequiredFields(req.body, ['email']);
    if (!requiredCheck.valid) {
      return res.status(400).json({ ok: false, reason: 'missing_email' });
    }
    
    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, reason: 'invalid_email' });
    }
    
    // Validate name fields if provided
    if (firstName && !isValidName(firstName)) {
      return res.status(400).json({ ok: false, reason: 'invalid_first_name' });
    }
    
    if (lastName && !isValidName(lastName)) {
      return res.status(400).json({ ok: false, reason: 'invalid_last_name' });
    }
    
    // Validate name length (enforce max 100 chars as per validation function)
    if (firstName && firstName.length > 100) {
      return res.status(400).json({ ok: false, reason: 'first_name_too_long' });
    }
    
    if (lastName && lastName.length > 100) {
      return res.status(400).json({ ok: false, reason: 'last_name_too_long' });
    }

    // Beta cap: max 100 users
    const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= 100) return res.status(200).json({ ok: false, reason: 'beta_full' });

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedFirstName = firstName ? firstName.toLowerCase().trim() : null;
    const normalizedLastName = lastName ? lastName.toLowerCase().trim() : null;

    // Check if user already exists (case-insensitive email match)
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle(); // Use maybeSingle() to handle no user found (won't throw error)

    // SECURITY FIX: If email already exists, return error (don't allow re-registration)
    // Only block duplicate emails (allow duplicate names - multiple people can have same name)
    if (existingUser) {
      return res.status(200).json({ 
        ok: false, 
        reason: 'email_exists',
        message: 'An account with this email already exists. Please sign in instead.'
      });
    }

    // Upsert user by email (normalize email to lowercase in database)
    // Since we checked existingUser above, this should only create new users
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        email: normalizedEmail, // Store normalized (lowercase) email
        first_name: firstName || null, 
        last_name: lastName || null, 
        audience: audience || null 
      })
      .select()
      .single();
    if (error) {
      console.error('Supabase insert error', error);
      // If insert fails due to duplicate (race condition), return error
      if (error.code === '23505') { // PostgreSQL unique violation
        return res.status(200).json({ 
          ok: false, 
          reason: 'email_exists',
          message: 'An account with this email already exists. Please sign in instead.'
        });
      }
      return res.status(500).json({ ok: false, reason: 'db_error' });
    }

    // User is new (we already checked existingUser above and returned error if exists)
    // Log to Google Sheets
    await appendToSheet({
      timestamp: new Date().toISOString(),
      role: audience || '',
      first_name: firstName || '',
      last_name: lastName || '',
      email: normalizedEmail // Use normalized email
    });

    // Send welcome email (use original email for display)
    await sendWelcomeEmail(email, firstName);

    return res.status(200).json({ ok: true, userId: user?.id || null });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
