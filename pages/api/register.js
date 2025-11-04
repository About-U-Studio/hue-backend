import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { appendToSheet } from '../../lib/sheets';
import { sendWelcomeEmail, sendVerificationEmail } from '../../lib/mailer';
import { isValidEmail, isValidName, validateRequiredFields, sanitizeString } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { generateAuthToken, getAuthTokenExpiration } from '../../lib/auth';
import { generateVerificationToken, getTokenExpiration } from '../../lib/tokens';
import { applySecurityHeaders } from '../../lib/securityHeaders';
import { checkRequestSize } from '../../lib/requestLimits';
import { verifyCaptcha } from '../../lib/captcha';
import { validatePassword, hashPassword, verifyPassword } from '../../lib/password';

export default async function handler(req, res) {
  // Apply security headers
  applySecurityHeaders(res);
  
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  
  // Check request size before processing
  if (checkRequestSize(req, res)) {
    return; // Response already sent
  }
  
  const { isLogin } = req.body || {};
  
  // Rate limiting - 15 registrations/login attempts per IP per hour
  if (rateLimitMiddleware(req, res, 'registration')) {
    return; // Response already sent
  }
  
  // Verify CAPTCHA for registration (optional but recommended)
  // Only require CAPTCHA for registration, not login
  if (!isLogin) {
    const captchaToken = req.body?.captchaToken;
    if (captchaToken) {
      const captchaValid = await verifyCaptcha(captchaToken);
      if (!captchaValid) {
        return res.status(400).json({ ok: false, reason: 'captcha_failed', message: 'CAPTCHA verification failed. Please try again.' });
      }
    }
    // Note: If CAPTCHA is not provided, we'll still allow registration
    // You can make it required by changing the condition above
  }

  try {
    const { email, audience, firstName, lastName, password } = req.body || {};
    
    // Validate required fields
    const requiredCheck = validateRequiredFields(req.body, ['email']);
    if (!requiredCheck.valid) {
      return res.status(400).json({ ok: false, reason: 'missing_email' });
    }
    
    // Sanitize and validate email format
    const sanitizedEmail = email ? sanitizeString(email.trim()) : '';
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ ok: false, reason: 'invalid_email' });
    }
    
    // Sanitize and validate name fields if provided
    const sanitizedFirstName = firstName ? sanitizeString(firstName.trim()) : null;
    const sanitizedLastName = lastName ? sanitizeString(lastName.trim()) : null;
    
    if (sanitizedFirstName && !isValidName(sanitizedFirstName)) {
      return res.status(400).json({ ok: false, reason: 'invalid_first_name' });
    }
    
    if (sanitizedLastName && !isValidName(sanitizedLastName)) {
      return res.status(400).json({ ok: false, reason: 'invalid_last_name' });
    }
    
    // Validate name length (enforce max 100 chars as per validation function)
    if (sanitizedFirstName && sanitizedFirstName.length > 100) {
      return res.status(400).json({ ok: false, reason: 'first_name_too_long' });
    }
    
    if (sanitizedLastName && sanitizedLastName.length > 100) {
      return res.status(400).json({ ok: false, reason: 'last_name_too_long' });
    }

    // Validate and hash password if provided
    let passwordHash = null;
    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ ok: false, reason: 'invalid_password', message: passwordValidation.error });
      }
      try {
        passwordHash = await hashPassword(password);
      } catch (error) {
        console.error('Password hashing error:', error);
        return res.status(500).json({ ok: false, reason: 'error', message: 'Failed to process password. Please try again.' });
      }
    }

    // Beta cap: max 100 users
    const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= 100) return res.status(200).json({ ok: false, reason: 'beta_full' });

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = sanitizedEmail.toLowerCase().trim();
    const normalizedFirstName = sanitizedFirstName ? sanitizedFirstName.toLowerCase().trim() : null;
    const normalizedLastName = sanitizedLastName ? sanitizedLastName.toLowerCase().trim() : null;

    // Check if user already exists (case-insensitive email match)
    // For login, we need to get full user data including email_verified status and password_hash
    const userFields = isLogin 
      ? 'id, email, email_verified, auth_token, auth_token_expires_at, password_hash' 
      : 'id';
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from('users')
      .select(userFields)
      .ilike('email', normalizedEmail)
      .maybeSingle(); // Use maybeSingle() to handle no user found (won't throw error)

    // HANDLE LOGIN ATTEMPT
    if (isLogin) {
      if (!existingUser) {
        // User doesn't exist - need to register first
        return res.status(200).json({ 
          ok: false, 
          reason: 'user_not_found',
          message: 'Email not found. Please register first.'
        });
      }
      
      // Check if email is verified
      if (!existingUser.email_verified) {
        return res.status(200).json({ 
          ok: false, 
          reason: 'email_not_verified',
          message: 'Please verify your email address first. Check your inbox for a verification link.'
        });
      }
      
      // Verify password if user has one
      const loginPassword = req.body?.password || '';
      if (existingUser.password_hash) {
        // User has a password - require it for login
        if (!loginPassword) {
          return res.status(400).json({ 
            ok: false, 
            reason: 'password_required',
            message: 'Password is required for this account.'
          });
        }
        
        const passwordValid = await verifyPassword(loginPassword, existingUser.password_hash);
        if (!passwordValid) {
          return res.status(401).json({ 
            ok: false, 
            reason: 'invalid_password',
            message: 'Incorrect password. Please try again.'
          });
        }
      } else {
        // User doesn't have a password yet - allow email-only login (backward compatibility)
        // Optionally, you can require password setup here
      }
      
      // Generate new auth token for login
      const authToken = generateAuthToken();
      const authTokenExpiresAt = getAuthTokenExpiration();
      
      // Update user with new auth token
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          auth_token: authToken,
          auth_token_expires_at: authTokenExpiresAt
        })
        .eq('id', existingUser.id);
      
      if (updateError) {
        console.error('Failed to update auth token:', updateError);
        return res.status(500).json({ ok: false, reason: 'error', message: 'Failed to authenticate. Please try again.' });
      }
      
      // Login successful - return auth token
      return res.status(200).json({ 
        ok: true, 
        userId: existingUser.id,
        authToken: authToken
      });
    }

    // HANDLE REGISTRATION ATTEMPT
    // SECURITY FIX: If email already exists, return error (don't allow re-registration)
    // Only block duplicate emails (allow duplicate names - multiple people can have same name)
    if (existingUser) {
      return res.status(200).json({ 
        ok: false, 
        reason: 'email_exists',
        message: 'An account with this email already exists. Please sign in instead.'
      });
    }

    // Generate verification token
    const verificationToken = generateVerificationToken();
    const tokenExpiresAt = getTokenExpiration();

    // Upsert user by email (normalize email to lowercase in database)
    // Since we checked existingUser above, this should only create new users
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        email: normalizedEmail, // Store normalized (lowercase) email
        first_name: sanitizedFirstName || null, 
        last_name: sanitizedLastName || null, 
        audience: audience || null,
        email_verified: false, // Email not verified yet
        verification_token: verificationToken,
        verification_token_expires_at: tokenExpiresAt,
        password_hash: passwordHash // Store hashed password (null if no password provided)
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
      first_name: sanitizedFirstName || '',
      last_name: sanitizedLastName || '',
      email: normalizedEmail // Use normalized email
    });

    // Send verification email (use sanitized values for display)
    try {
      await sendVerificationEmail(sanitizedEmail, sanitizedFirstName, verificationToken);
      console.log('Verification email sent successfully to:', email);
    } catch (e) {
      console.error('Failed to send verification email:', e);
      console.error('Error details:', JSON.stringify(e, null, 2));
      // Still return success - verification email can be resent later
      // But log the error for debugging
    }

    // Don't send welcome email until verified
    // Welcome email will be sent after verification

    return res.status(200).json({ 
      ok: true, 
      userId: user?.id || null,
      needsVerification: true,
      message: 'Registration successful! Please check your email to verify your account.'
    });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
