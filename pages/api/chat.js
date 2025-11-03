import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { runAgent, runAgentWithHistory } from '../../lib/openaiAgent';
import { isValidEmail, validateMessage, isValidUrl } from '../../lib/validation';
import { rateLimitMiddleware } from '../../lib/rateLimit';
import { verifyAuthToken } from '../../lib/auth';

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
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ reply: 'method_not_allowed' });
  
  // Rate limiting - 200 messages per IP per hour (in addition to daily user limit)
  if (rateLimitMiddleware(req, res, 'chat')) {
    return; // Response already sent
  }

  try {
    // Verify authentication token (unless anonymous preview)
    const authToken = req.headers.authorization?.replace('Bearer ', '') || req.body?.authToken;
    const emailRaw = req.body?.email || 'anonymous@preview';
    
    // Allow anonymous preview without auth token
    if (emailRaw === 'anonymous@preview') {
      // Skip auth check for anonymous preview
    } else {
      // Require auth token for registered users
      if (!authToken) {
        return res.status(401).json({ reply: 'Authentication required. Please log in.' });
      }

      const user = await verifyAuthToken(authToken, supabaseAdmin);
      if (!user) {
        return res.status(401).json({ reply: 'Invalid or expired authentication token. Please log in again.' });
      }

      // Use verified user
      const email = user.email;
      const userId = user.id;

      // Check if email is verified
      if (!user.email_verified) {
        return res.status(403).json({ 
          reply: 'Please verify your email address before chatting. Check your inbox for a verification link.',
          emailNotVerified: true 
        });
      }

      // Validate email format
      if (!isValidEmail(email)) {
        return res.status(400).json({ reply: 'Invalid email format.' });
      }

      const messages = req.body?.messages || [];
      const imageUrl = req.body?.imageUrl || null;
      
      // Validate imageUrl if provided
      if (imageUrl && typeof imageUrl === 'string' && !isValidUrl(imageUrl) && !imageUrl.startsWith('data:image/')) {
        return res.status(400).json({ reply: 'Invalid image URL format.' });
      }

      // Check daily limit
      const { startUtc, endUtc } = startEndUtcForTodayET();
      const { data: usageRows, error: usageErr } = await supabaseAdmin
        .from('message_usage')
        .select('id, created_at')
        .eq('user_id', userId)
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

      // Record usage
      const { error: insertErr } = await supabaseAdmin
        .from('message_usage')
        .insert({ user_id: userId });
      if (insertErr) console.error('insert usage error', insertErr);

      // Get the latest user message
      const userMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      const userText = userMessage?.content || '';
      
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
          .eq('user_id', userId) // CRITICAL: Only get history for THIS user
          .order('created_at', { ascending: true })
          .limit(20);

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

          // Store the user's message
          if (userText) {
            const { error: storeUserErr } = await supabaseAdmin
              .from('conversation_history')
              .insert({
                user_id: userId,
                role: 'user',
                content: userText
              });
            if (storeUserErr) {
              console.error('store user message error:', storeUserErr);
            }
          }

          // Run agent with history
          replyText = await runAgentWithHistory(formattedHistory, userText, imageUrl);

          // Store the assistant's reply
          if (replyText) {
            const { error: storeAIErr } = await supabaseAdmin
              .from('conversation_history')
              .insert({
                user_id: userId,
                role: 'assistant',
                content: replyText
              });
            if (storeAIErr) {
              console.error('store AI message error:', storeAIErr);
            }
          }
        }
      } catch (historyError) {
        console.error('conversation history error (falling back):', historyError);
        // Fall back to single message mode
        replyText = await runAgent(userText, imageUrl);
      }

      return res.status(200).json({ reply: replyText || 'Sorry, something went wrong.' });
    }
    
    // Anonymous preview mode (no auth required)
    const email = emailRaw.toLowerCase().trim();
    const messages = req.body?.messages || [];
    const imageUrl = req.body?.imageUrl || null;
    
    // Validate imageUrl if provided
    if (imageUrl && typeof imageUrl === 'string' && !isValidUrl(imageUrl) && !imageUrl.startsWith('data:image/')) {
      return res.status(400).json({ reply: 'Invalid image URL format.' });
    }

    // Get the latest user message
    const userMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const userText = userMessage?.content || '';
    
    // Validate message content if provided
    if (userText) {
      const messageValidation = validateMessage(userText, MAX_MESSAGE_LENGTH, MIN_MESSAGE_LENGTH);
      if (!messageValidation.valid) {
        return res.status(400).json({ reply: messageValidation.error || 'Invalid message format.' });
      }
    }

    // Run agent without history for anonymous preview
    const replyText = await runAgent(userText, imageUrl);

    return res.status(200).json({ reply: replyText || 'Sorry, something went wrong.' });
  } catch (e) {
    console.error('chat error', e);
    return res.status(200).json({ reply: 'Sorry, something went wrong.' });
  }
}
