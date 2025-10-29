// pages/api/register.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method_not_allowed' });

  // For now: echo and pretend success. We’ll wire real logic in Step 2.
  const { email, audience, firstName, lastName } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

  return res.status(200).json({ ok: true, received: { email, audience, firstName, lastName } });
}
