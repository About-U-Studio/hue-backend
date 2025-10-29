import { applyCors } from '../../lib/cors';
import { appendToSheet } from '../../lib/sheets';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const { email, audience, firstName, lastName } = req.body || {};
    if (!email) {
      return res.status(400).json({ ok: false, reason: 'missing_email' });
    }

    // TEMP logs to verify requests and env
    console.log('register payload', { email, audience, firstName, lastName });
    console.log('has webhook', Boolean(process.env.SHEETS_WEBHOOK_URL));

    // Send to Make.com (Google Sheets)
    await appendToSheet({
      timestamp: new Date().toISOString(),
      role: audience || '',
      first_name: firstName || '',
      last_name: lastName || '',
      email,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
