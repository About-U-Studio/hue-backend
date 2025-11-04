import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { validatePassword, hashPassword } from '../../lib/password';
import { isValidEmail, sanitizeString } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { applySecurityHeaders } from '../../lib/securityHeaders';
import { checkRequestSize } from '../../lib/requestLimits';

/**
 * Reset Password API Endpoint
 * Verifies reset token and updates password
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
  
  // Rate limiting - 10 password reset attempts per IP per hour
  if (rateLimitMiddleware(req, res, 'password_reset')) {
    return; // Response already sent
  }
  
  try {
    const { email, token, newPassword } = req.body || {};
    
    // Validate required fields
    if (!email || !token || !newPassword) {
      return res.status(400).json({ 
        ok: false, 
        reason: 'missing_fields', 
        message: 'Email, token, and new password are required.' 
      });
    }
    
    // Sanitize and validate email
    const sanitizedEmail = email ? sanitizeString(email.trim()) : '';
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ ok: false, reason: 'invalid_email', message: 'Invalid email format.' });
    }
    
    const normalizedEmail = sanitizedEmail.toLowerCase().trim();
    
    // Validate password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ 
        ok: false, 
        reason: 'invalid_password', 
        message: passwordValidation.error 
      });
    }
    
    // Find user and verify reset token
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, password_reset_token, password_reset_token_expires_at')
      .ilike('email', normalizedEmail)
      .single();
    
    if (userError || !user) {
      return res.status(400).json({ 
        ok: false, 
        reason: 'invalid_token', 
        message: 'Invalid or expired reset token.' 
      });
    }
    
    // Check if reset token exists
    if (!user.password_reset_token) {
      return res.status(400).json({ 
        ok: false, 
        reason: 'invalid_token', 
        message: 'Invalid or expired reset token.' 
      });
    }
    
    // Verify token matches
    const decodedToken = token.trim();
    const storedToken = user.password_reset_token.trim();
    
    if (storedToken !== decodedToken) {
      return res.status(400).json({ 
        ok: false, 
        reason: 'invalid_token', 
        message: 'Invalid or expired reset token.' 
      });
    }
    
    // Check if token expired
    if (user.password_reset_token_expires_at) {
      const expiresAt = new Date(user.password_reset_token_expires_at);
      if (new Date() > expiresAt) {
        return res.status(400).json({ 
          ok: false, 
          reason: 'token_expired', 
          message: 'This reset link has expired. Please request a new one.' 
        });
      }
    }
    
    // Hash new password
    let passwordHash;
    try {
      passwordHash = await hashPassword(newPassword);
    } catch (error) {
      console.error('Password hashing error:', error);
      return res.status(500).json({ 
        ok: false, 
        reason: 'error', 
        message: 'Failed to process password. Please try again.' 
      });
    }
    
    // Update password and clear reset token
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_token_expires_at: null
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('Failed to update password:', updateError);
      return res.status(500).json({ 
        ok: false, 
        reason: 'error', 
        message: 'Failed to reset password. Please try again.' 
      });
    }
    
    console.log('✅ Password reset successful for:', normalizedEmail);
    
    return res.status(200).json({ 
      ok: true, 
      message: 'Password has been reset successfully. You can now sign in with your new password.' 
    });
    
  } catch (e) {
    console.error('Reset password error:', e);
    return res.status(500).json({ ok: false, reason: 'error', message: 'Something went wrong. Please try again later.' });
  }
}
