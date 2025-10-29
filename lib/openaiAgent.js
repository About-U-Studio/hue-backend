export async function runAgent(userText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const agentId = process.env.AGENT_OR_ASSISTANT_ID;
  if (!apiKey || !agentId) return 'Agent not configured yet.';
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    workflow_id: process.env.AGENT_OR_ASSISTANT_ID,
    input: [{ role: 'user', content: userText }]
  })
});
    if (!r.ok) {
      console.error('OpenAI error', r.status, await r.text().catch(() => ''));
      return 'Sorry, something went wrong.';
    }
    const data = await r.json();
    const text = data.output_text
      || data.output?.[0]?.content?.[0]?.text?.value
      || data.output?.[0]?.content?.[0]?.text
      || '';
    return text || 'Sorry, something went wrong.';
  } catch (e) {
    console.error('OpenAI fetch error', e);
    return 'Sorry, something went wrong.';
  }
}
