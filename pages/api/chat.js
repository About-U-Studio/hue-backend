import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { runAgent } from '../../lib/openaiAgent';

const DAILY_LIMIT = 100; // per user, per ET day

function startEndUtcForTodayET() {
  const tz = 'America/New_York';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = fmt.format(now).split('-');
  const startET = new Date(`${y}-${m}-${d}T00:00:00`);
  const endET = new Date(`${y}-${m}-${d}T23:59:59`);
  // Convert ET to UTC by using toISOString windows (DB is in UTC)
  return { startUtc: new Date(startET.toISOString()), endUtc: new Date(endET.toISOString()) };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ reply: 'method_not_allowed' });

  try {
    const email = req.body?.email || 'anonymous@preview';
    const userText = req.body?.messages?.[0]?.content || '';

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

    // Count today’s usage (ET)
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
      return res.status(200).json({ reply: 'Thank you for trying out Hue, come back tomorrow...' });
    }

    // Record usage
    const { error: insertErr } = await supabaseAdmin
      .from('message_usage')
      .insert({ user_id: user.id });
    if (insertErr) console.error('insert usage error', insertErr);

    // Call your Agent
    const replyText = await runAgent(userText);
    return res.status(200).json({ reply: replyText || 'Sorry, something went wrong.' });
  } catch (e) {
    console.error('chat error', e);
    return res.status(200).json({ reply: 'Sorry, something went wrong.' });
  }
}
