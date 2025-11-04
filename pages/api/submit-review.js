import { applyCors } from '../../lib/cors';
import { createClient } from '@supabase/supabase-js';
import { isValidEmail, validateMessage, sanitizeString, sanitizeMessage } from '../../lib/validation';
import { rateLimitMiddleware, checkRateLimit, getClientIP } from '../../lib/rateLimit';
import { applySecurityHeaders } from '../../lib/securityHeaders';
import { checkRequestSize } from '../../lib/requestLimits';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  // Apply security headers
  applySecurityHeaders(res);
  
  // Handle CORS
  if (applyCors(req, res)) return;
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Rate limiting - 10 reviews per IP per hour
  if (rateLimitMiddleware(req, res, 'submitReview')) {
    return; // Response already sent
  }

  const { email, review } = req.body;

  if (!email || !review) {
    return res.status(400).json({ error: 'Email and review required' });
  }
  
  // Sanitize and validate email format
  const sanitizedEmail = email ? sanitizeString(email.trim()) : '';
  if (!isValidEmail(sanitizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Sanitize and validate review content (max 2000 characters)
  const sanitizedReview = sanitizeMessage(review);
  const reviewValidation = validateMessage(sanitizedReview, 2000, 1);
  if (!reviewValidation.valid) {
    return res.status(400).json({ error: reviewValidation.error || 'Invalid review format' });
  }

  try {
    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = sanitizedEmail.toLowerCase().trim();
    
    // Verify user exists in your database (prevents spam from random people)
    // Use case-insensitive match
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, audience')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      // Don't reveal whether email exists or not (security best practice)
      console.error('User not found for review submission');
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Additional rate limiting - 3 reviews per user per day
    const userRateLimit = checkRateLimit(normalizedEmail, 'reviewPerUser');
    if (!userRateLimit.allowed) {
      const secondsUntilReset = Math.ceil((userRateLimit.resetAt - Date.now()) / 1000);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `You've reached your daily review limit. Please try again tomorrow.`,
        retryAfter: secondsUntilReset,
      });
    }

    // Get webhook URL from environment variable (secure, not exposed to frontend)
    const webhookUrl = process.env.MAKE_WEBHOOK_URL;
    
    if (!webhookUrl) {
      console.error('MAKE_WEBHOOK_URL environment variable not set');
      return res.status(500).json({ error: 'Service temporarily unavailable' });
    }

    // Send review to Make.com webhook (server-side, hidden from public)
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: normalizedEmail, // Use normalized email
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        audience: user.audience || '',
        review: sanitizedReview, // Use sanitized review
        timestamp: new Date().toISOString()
      })
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error('Make.com webhook failed:', errorText);
      return res.status(500).json({ error: 'Failed to submit review' });
    }

    console.log('Review submitted successfully');
    return res.status(200).json({ success: true, message: 'Review submitted' });
  } catch (error) {
    console.error('Submit review error:', error);
    // Don't expose internal error details to client
    return res.status(500).json({ error: 'Internal server error' });
  }
}
