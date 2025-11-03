import { applyCors } from '../../lib/cors';
import { createClient } from '@supabase/supabase-js';
import { isValidEmail, validateMessage } from '../../lib/validation';
import { rateLimitMiddleware, checkRateLimit, getClientIP } from '../../lib/rateLimit';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
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
  
  // Validate email format
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Validate review content (max 2000 characters)
  const reviewValidation = validateMessage(review, 2000, 1);
  if (!reviewValidation.valid) {
    return res.status(400).json({ error: reviewValidation.error || 'Invalid review format' });
  }

  try {
    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();
    
    // Verify user exists in your database (prevents spam from random people)
    // Use case-insensitive match
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, audience')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      console.error('User not found:', email);
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
      return res.status(500).json({ error: 'Webhook not configured' });
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
        review: review,
        timestamp: new Date().toISOString()
      })
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error('Make.com webhook failed:', errorText);
      return res.status(500).json({ error: 'Failed to submit review' });
    }

    console.log('Review submitted successfully for:', normalizedEmail);
    return res.status(200).json({ success: true, message: 'Review submitted' });
  } catch (error) {
    console.error('Submit review error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
