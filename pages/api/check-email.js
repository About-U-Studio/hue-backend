import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { isValidEmail, isValidName, sanitizeString } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { applySecurityHeaders } from '../../lib/securityHeaders.js';
import { checkRequestSize } from '../../lib/requestLimits.js';

export default async function handler(req, res) {
  // Apply security headers
  applySecurityHeaders(res);
  
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Check request size before processing
  if (checkRequestSize(req, res)) {
    return; // Response already sent
  }
  
  // Rate limiting - 10 email checks per IP per hour
  if (rateLimitMiddleware(req, res, 'checkEmail')) {
    return; // Response already sent
  }

  try {
    const { email, firstName, lastName } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    // Sanitize and validate email format
    const sanitizedEmail = email ? sanitizeString(email.trim()) : '';
    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Sanitize and validate name fields if provided
    const sanitizedFirstName = firstName ? sanitizeString(firstName.trim()) : null;
    const sanitizedLastName = lastName ? sanitizeString(lastName.trim()) : null;
    
    if (sanitizedFirstName && !isValidName(sanitizedFirstName)) {
      return res.status(400).json({ error: 'Invalid first name format' });
    }
    
    if (sanitizedLastName && !isValidName(sanitizedLastName)) {
      return res.status(400).json({ error: 'Invalid last name format' });
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = sanitizedEmail.toLowerCase().trim();

    // Check if user exists (case-insensitive email match)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, email_verified')
      .ilike('email', normalizedEmail) // Case-insensitive match
      .maybeSingle();

    // NOTE: Duplicate names are now allowed (people can have same names)
    // Only checking for duplicate email
    
    // Ensure verified is explicitly a boolean (handle null, undefined, etc.)
    const isVerified = user?.email_verified === true || user?.email_verified === 'true' || user?.email_verified === 1;
    
    return res.status(200).json({ 
      exists: !!user,
      verified: isVerified, // Explicitly boolean
      duplicateName: false // Always false - duplicate names are allowed
    });
  } catch (e) {
    console.error('Check email error:', e);
    // If error (e.g., user not found), return false
    return res.status(200).json({ exists: false, duplicateName: false });
  }
}
