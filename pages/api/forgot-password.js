import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendPasswordResetEmail } from '../../lib/mailer';
import { isValidEmail, sanitizeString } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { generateVerificationToken, getTokenExpiration } from '../../lib/tokens';
import { applySecurityHeaders } from '../../lib/securityHeaders';
import { checkRequestSize } from '../../lib/requestLimits';

/**
 * Forgot Password API Endpoint
 * Sends a password reset email to the user
 */
export default async function handler(req, res) {
  applySecurityHeaders(res);
  
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  
  if (checkRequestSize(req, res)) {
    return; // Response already sent
  }
  
  // Rate limiting - 5 password reset requests per IP per hour
  if (rateLimitMiddleware(req, res, 'password_reset')) {
    return; // Response already sent
  }
  
  try {
    const { email } = req.body || {};
    
    // Validate email
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'missing_email', message: 'Email is required.' });
    }
    
    const sanitizedEmail = email ? sanitizeString(email.trim()) : '';
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ ok: false, reason: 'invalid_email', message: 'Invalid email format.' });
    }
    
    // Normalize email to lowercase
    const normalizedEmail = sanitizedEmail.toLowerCase().trim();
    
    // Find user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, email_verified')
      .ilike('email', normalizedEmail)
      .single();
    
    // SECURITY: Always return success message (don't reveal if email exists)
    // This prevents email enumeration attacks
    if (userError || !user) {
      // User doesn't exist, but return success anyway
      console.log('Password reset requested for non-existent email:', normalizedEmail);
      return res.status(200).json({ 
        ok: true, 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }
    
    // Check if email is verified
    if (!user.email_verified) {
      // Still return success (security best practice)
      console.log('Password reset requested for unverified email:', normalizedEmail);
      return res.status(200).json({ 
        ok: true, 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }
    
    // Generate reset token
    const resetToken = generateVerificationToken();
    const tokenExpiresAt = getTokenExpiration(); // 24 hours
    
    // Store reset token in database
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_reset_token: resetToken,
        password_reset_token_expires_at: tokenExpiresAt
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('Failed to store password reset token:', updateError);
      // Still return success (security best practice)
      return res.status(200).json({ 
        ok: true, 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    }
    
    // Send password reset email
    try {
      await sendPasswordResetEmail(normalizedEmail, user.first_name, resetToken);
      console.log('✅ Password reset email sent to:', normalizedEmail);
    } catch (e) {
      console.error('Failed to send password reset email:', e);
      // Still return success (security best practice)
    }
    
    // Always return success (security best practice - prevents email enumeration)
    return res.status(200).json({ 
      ok: true, 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
    
  } catch (e) {
    console.error('Forgot password error:', e);
    return res.status(500).json({ ok: false, reason: 'error', message: 'Something went wrong. Please try again later.' });
  }
}

