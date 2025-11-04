import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { isValidEmail, isValidName } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    
    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate name fields if provided
    if (firstName && !isValidName(firstName)) {
      return res.status(400).json({ error: 'Invalid first name format' });
    }
    
    if (lastName && !isValidName(lastName)) {
      return res.status(400).json({ error: 'Invalid last name format' });
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

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

