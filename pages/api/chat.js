import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { runAgentWithHistory } from '../../lib/openaiAgent';

const DAILY_LIMIT = 100;

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

  try {
    const email = req.body?.email || 'anonymous@preview';
    const messages = req.body?.messages || [];  // Full conversation history from frontend
    const imageUrl = req.body?.imageUrl || null;

    // Ensure user exists
    const { data: user, error: upsertErr } = await supabaseAdmin
      .from('users')
      .upsert({ email }, { onConflict: 'email' })
      .select()
      .single();
    if (upsertErr) {
      console.error('ensure user error', upsertErr);
      return res.status(200).json({ reply: 'Sorry, something went wrong.' });
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

    // Record usage
    const { error: insertErr } = await supabaseAdmin
      .from('message_usage')
      .insert({ user_id: user.id });
    if (insertErr) console.error('insert usage error', insertErr);

    // Get the latest user message
    const userMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const userText = userMessage?.content || '';

    // Retrieve conversation history from database
    const { data: historyRows, error: historyErr } = await supabaseAdmin
      .from('conversation_history')
      .select('role, content, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(20);  // Limit to last 20 messages for context

    if (historyErr) {
      console.error('history query error', historyErr);
    }

    // Combine database history with current messages
    const conversationHistory = historyRows || [];
    const formattedHistory = conversationHistory.map(h => ({
      role: h.role,
      content: h.content
    }));

    // Store the user's message in database
    if (userText) {
      await supabaseAdmin
        .from('conversation_history')
        .insert({
          user_id: user.id,
          role: 'user',
          content: userText
        });
    }

    // Run agent with full conversation history
    const replyText = await runAgentWithHistory(formattedHistory, userText, imageUrl);

    // Store the assistant's reply in database
    if (replyText) {
      await supabaseAdmin
        .from('conversation_history')
        .insert({
          user_id: user.id,
          role: 'assistant',
          content: replyText
        });
    }

    return res.status(200).json({ reply: replyText || 'Sorry, something went wrong.' });
  } catch (e) {
    console.error('chat error', e);
    return res.status(200).json({ reply: 'Sorry, something went wrong.' });
  }
}

