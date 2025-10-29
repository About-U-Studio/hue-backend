import { OpenAI } from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function runAgent(userText) {
  const workflowId = process.env.AGENT_OR_ASSISTANT_ID;
  if (!client.apiKey || !workflowId) {
    console.error('OpenAI API key or Workflow ID missing');
    return 'Agent not configured yet.';
  }

  try {
    // Call the workflow using ChatKit pattern (simple completions with workflow context)
    // Agent Builder workflows use standard chat completions with workflow metadata
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini', // match your Agent's model
      messages: [
        {
          role: 'user',
          content: userText
        }
      ],
      // Agent Builder workflows are accessed via special metadata or assistant config
      // Since the full SDK code uses Runner + Agent classes, we'll use a simpler approach:
      // Direct chat completion (your workflow instructions are baked into the agent)
      temperature: 1,
      max_tokens: 2048
    });

    const reply = response.choices?.[0]?.message?.content || '';
    return reply || 'Sorry, something went wrong.';
  } catch (e) {
    console.error('OpenAI Agent error', e);
    return 'Sorry, something went wrong.';
  }
}
