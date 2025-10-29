import { applyCors } from '../../lib/cors';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'method_not_allowed' });
  }
  const userText = req.body?.messages?.[0]?.content || '';
  return res.status(200).json({ reply: `Hue (placeholder): You said "${userText}"` });
}
