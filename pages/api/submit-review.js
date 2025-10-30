import { applyCors } from '../../lib/cors';
import { createClient } from '@supabase/supabase-js';

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

  const { email, review } = req.body;

  if (!email || !review) {
    return res.status(400).json({ error: 'Email and review required' });
  }

  try {
    // Verify user exists in your database (prevents spam from random people)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, last_name, audience')
      .eq('email', email)
      .single();

    if (userError || !user) {
      console.error('User not found:', email);
      return res.status(404).json({ error: 'User not found' });
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
        email: email,
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

    console.log('Review submitted successfully for:', email);
    return res.status(200).json({ success: true, message: 'Review submitted' });
  } catch (error) {
    console.error('Submit review error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

