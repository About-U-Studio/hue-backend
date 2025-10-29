import { OpenAI } from 'openai';
import { Agent, Runner, withTrace } from '@openai/agents';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const hue = new Agent({
  name: 'Hue',
  instructions: `You are Hue, About U Studio's Creative Audit AI — a witty, fast-thinking creative director who helps potential clients explore Branding, Motion Design, and Web Design.`,
  model: 'gpt-4o-mini',
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

export async function runAgent(userText) {
  const workflowId = process.env.AGENT_OR_ASSISTANT_ID;
  if (!client.apiKey || !workflowId) {
    console.error('OpenAI API key or Workflow ID missing');
    return 'Agent not configured yet.';
  }

  try {
    return await withTrace('About U Studio | Hue AI', async () => {
      const conversationHistory = [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }]
        }
      ];

      const runner = new Runner({
        traceMetadata: {
          __trace_source__: 'agent-builder',
          workflow_id: workflowId
        }
      });

      const result = await runner.run(hue, conversationHistory);

      if (!result.finalOutput) {
        throw new Error('Agent result is undefined');
      }

      return result.finalOutput;
    });
  } catch (e) {
    console.error('OpenAI Agent SDK error', e);
    return 'Sorry, something went wrong.';
  }
}
