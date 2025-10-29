export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ reply: 'method_not_allowed' });

  // For now: fake reply. We’ll call your OpenAI Agent in Step 2.
  const userText = req.body?.messages?.[0]?.content || '';
  return res.status(200).json({ reply: `Hue (placeholder): You said "${userText}"` });
}
