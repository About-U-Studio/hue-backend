import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { runAgent, runAgentWithHistory } from '../../lib/openaiAgent';
import { isValidEmail, validateMessage, isValidUrl, sanitizeMessage } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { applySecurityHeaders } from '../../lib/securityHeaders';
import { checkRequestSize } from '../../lib/requestLimits';

const DAILY_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 5000;
const MIN_MESSAGE_LENGTH = 1;

function startEndUtcForTodayET() {
  const tz = 'America/New_York';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = fmt.format(now).split('-');
  const startET = new Date(`${y}-${m}-${d}T00:00:00`);
  const endET = new Date(`${y}-${m}-${d}T23:59:59`);
  return { startUtc: new Date(startET.toISOString()), endUtc: new Date(endET.toISOString()) };
}

export default async function handler(req, res) {
  // Apply security headers
  applySecurityHeaders(res);
  
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ reply: 'method_not_allowed' });
  
  // Check request size before processing
  if (checkRequestSize(req, res)) {
    return; // Response already sent
  }
  
  // Rate limiting - 200 messages per IP per hour (in addition to daily user limit)
  if (rateLimitMiddleware(req, res, 'chat')) {
    return; // Response already sent
  }

  try {
    const emailRaw = req.body?.email || 'anonymous@preview';
    
    // Validate email format (skip for anonymous@preview)
    if (emailRaw !== 'anonymous@preview' && !isValidEmail(emailRaw)) {
      return res.status(400).json({ reply: 'Invalid email format.' });
    }
    
    // Normalize email to lowercase for case-insensitive comparison
    const email = emailRaw.toLowerCase().trim();
    const messages = req.body?.messages || [];
    const imageUrl = req.body?.imageUrl || null;
    
    // Validate imageUrl if provided
    if (imageUrl && typeof imageUrl === 'string' && !isValidUrl(imageUrl) && !imageUrl.startsWith('data:image/')) {
      return res.status(400).json({ reply: 'Invalid image URL format.' });
    }

    // Ensure user exists (normalize email to lowercase in database)
    const { data: user, error: upsertErr } = await supabaseAdmin
      .from('users')
      .upsert({ email }, { onConflict: 'email' })
      .select('id, email_verified')
      .single();
    if (upsertErr) {
      console.error('ensure user error', upsertErr);
      return res.status(200).json({ reply: 'Sorry, something went wrong.' });
    }

    // SECURITY: Check if email is verified before allowing chat
    if (!user.email_verified) {
      return res.status(200).json({ 
        reply: 'Please verify your email address first. Check your inbox for a verification link.',
        emailNotVerified: true
      });
    }

    // Check daily limit
    const { startUtc, endUtc } = startEndUtcForTodayET();
    const { data: usageRows, error: usageErr } = await supabaseAdmin
      .from('message_usage')
      .select('id, created_at')
      .eq('user_id', user.id)
      .gte('created_at', startUtc.toISOString())
      .lte('created_at', endUtc.toISOString());
    if (usageErr) {
      console.error('usage query error', usageErr);
      return res.status(200).json({ reply: 'Sorry, something went wrong.' });
    }

    if ((usageRows?.length || 0) >= DAILY_LIMIT) {
      return res.status(200).json({ 
        reply: 'Oops! You\'ve used up your daily limit. Come back tomorrow for more design insights! 🎨',
        dailyLimitReached: true 
      });
    }

    // Record usage (non-blocking - don't wait for this to complete)
    const usagePromise = supabaseAdmin
      .from('message_usage')
      .insert({ user_id: user.id })
      .then(() => {})
      .catch((err) => console.error('insert usage error', err));

    // Get the latest user message
    const userMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const userTextRaw = userMessage?.content || '';
    
    // Sanitize user input to prevent XSS attacks
    const userText = userTextRaw ? sanitizeMessage(userTextRaw) : '';
    
    // Validate message content if provided
    if (userText) {
      const messageValidation = validateMessage(userText, MAX_MESSAGE_LENGTH, MIN_MESSAGE_LENGTH);
      if (!messageValidation.valid) {
        return res.status(400).json({ reply: messageValidation.error || 'Invalid message format.' });
      }
    }

    let replyText = '';
    
    // Try to use conversation history, but fall back if it fails
    try {
      // Retrieve conversation history from database - CRITICAL: Filter by user_id to prevent cross-user history
      const { data: historyRows, error: historyErr } = await supabaseAdmin
        .from('conversation_history')
        .select('role, content, created_at')
        .eq('user_id', user.id) // CRITICAL: Only get history for THIS user
        .order('created_at', { ascending: true })
        .limit(20);
      
      // Note: Already filtered by user_id in query above, so all rows belong to this user

      if (historyErr) {
        console.error('history query error (falling back to no history):', historyErr);
        // Fall back to single message mode
        replyText = await runAgent(userText, imageUrl);
      } else {
        // Use conversation history
        const formattedHistory = (historyRows || []).map(h => ({
          role: h.role,
          content: h.content
        }));

        // Store the user's message (non-blocking - don't wait)
        const storeUserPromise = userText ? supabaseAdmin
          .from('conversation_history')
          .insert({
            user_id: user.id,
            role: 'user',
            content: userText
          })
          .then(() => {})
          .catch((err) => console.error('store user message error:', err)) : Promise.resolve();

        // Run agent with history (this is the slow part, so we do it while storing user message)
        replyText = await runAgentWithHistory(formattedHistory, userText, imageUrl);

        // Store the assistant's reply (non-blocking - don't wait)
        const storeAIPromise = replyText ? supabaseAdmin
          .from('conversation_history')
          .insert({
            user_id: user.id,
            role: 'assistant',
            content: replyText
          })
          .then(() => {})
          .catch((err) => console.error('store AI message error:', err)) : Promise.resolve();

        // Wait for both storage operations to complete (but don't block response)
        await Promise.allSettled([storeUserPromise, storeAIPromise]);
      }
    } catch (historyError) {
      console.error('conversation history error (falling back):', historyError);
      // Fall back to single message mode
      replyText = await runAgent(userText, imageUrl);
    }

    return res.status(200).json({ reply: replyText || 'Sorry, something went wrong.' });
  } catch (e) {
    console.error('chat error', e);
    return res.status(200).json({ reply: 'Sorry, something went wrong.' });
  }
}
