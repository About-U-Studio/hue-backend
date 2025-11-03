import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendVerificationEmail } from '../../lib/mailer';
import { generateVerificationToken, getTokenExpiration } from '../../lib/tokens';
import { isValidEmail, validateRequiredFields } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  
  // Rate limiting - 5 resend attempts per IP per hour
  if (rateLimitMiddleware(req, res, 'registration')) {
    return; // Response already sent
  }

  try {
    const { email } = req.body || {};
    
    // Validate required fields
    const requiredCheck = validateRequiredFields(req.body, ['email']);
    if (!requiredCheck.valid) {
      return res.status(400).json({ ok: false, reason: 'missing_email' });
    }
    
    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, reason: 'invalid_email' });
    }

    // Normalize email to lowercase
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, email_verified')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (userError || !user) {
      return res.status(200).json({ 
        ok: false, 
        reason: 'user_not_found',
        message: 'Email not found. Please register first.'
      });
    }

    // If already verified, no need to resend
    if (user.email_verified) {
      return res.status(200).json({ 
        ok: false, 
        reason: 'already_verified',
        message: 'Your email is already verified.'
      });
    }

    // Generate new verification token
    const verificationToken = generateVerificationToken();
    const tokenExpiresAt = getTokenExpiration();

    // Update user with new verification token
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        verification_token: verificationToken,
        verification_token_expires_at: tokenExpiresAt
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Failed to update verification token:', updateError);
      return res.status(500).json({ ok: false, reason: 'error', message: 'Failed to update verification token.' });
    }

    // Send verification email
    try {
      await sendVerificationEmail(email, user.first_name, verificationToken);
      return res.status(200).json({ 
        ok: true, 
        message: 'Verification email sent! Please check your inbox.'
      });
    } catch (e) {
      console.error('Failed to send verification email:', e);
      return res.status(500).json({ 
        ok: false, 
        reason: 'error', 
        message: 'Failed to send verification email. Please try again later.'
      });
    }
  } catch (e) {
    console.error('resend-verification error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
