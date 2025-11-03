import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { appendToSheet } from '../../lib/sheets';
import { sendWelcomeEmail, sendVerificationEmail } from '../../lib/mailer';
import { isValidEmail, isValidName, validateRequiredFields } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { generateVerificationToken, getTokenExpiration } from '../../lib/tokens';
import { generateAuthToken, getAuthTokenExpiration } from '../../lib/auth';
import { verifyCaptcha } from '../../lib/captcha';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  
  // Rate limiting - 5 registrations per IP per hour
  if (rateLimitMiddleware(req, res, 'registration')) {
    return; // Response already sent
  }

  try {
    const { email, audience, firstName, lastName, captchaToken } = req.body || {};
    
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

    // Verify CAPTCHA token
    if (!captchaToken) {
      return res.status(400).json({ ok: false, reason: 'captcha_required' });
    }

    const captchaValid = await verifyCaptcha(captchaToken);
    if (!captchaValid) {
      return res.status(400).json({ ok: false, reason: 'captcha_invalid' });
    }

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

    // Check if this is a new user
    const isNewUser = !existingUser;

    // Generate verification token for new users
    const verificationToken = generateVerificationToken();
    const tokenExpiresAt = getTokenExpiration();

    // Generate auth token for new users
    const authToken = generateAuthToken();
    const authTokenExpiresAt = getAuthTokenExpiration();

    // Upsert user (create or update)
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .upsert(
        { 
          email: normalizedEmail, // Store normalized (lowercase) email
          first_name: firstName || null, 
          last_name: lastName || null, 
          audience: audience || null,
          // For new users, add verification token and auth token
          // For existing users, don't overwrite if already verified
          ...(isNewUser ? {
            email_verified: false,
            verification_token: verificationToken,
            verification_token_expires_at: tokenExpiresAt.toISOString(),
            auth_token: authToken,
            auth_token_created_at: new Date().toISOString(),
            auth_token_expires_at: authTokenExpiresAt.toISOString()
          } : {})
        },
        { onConflict: 'email' }
      )
      .select()
      .single();
    if (error) {
      console.error('Supabase upsert error', error);
      return res.status(500).json({ ok: false, reason: 'db_error' });
    }

    // Only log to Google Sheets and send emails for NEW users
    if (isNewUser) {
      // Send verification email
      await sendVerificationEmail(normalizedEmail, verificationToken);
      
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

    return res.status(200).json({ 
      ok: true, 
      userId: user?.id || null,
      authToken: isNewUser ? authToken : null // Only return token for new users
    });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
