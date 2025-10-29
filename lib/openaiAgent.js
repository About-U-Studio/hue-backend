import { OpenAI } from 'openai';
import { runGuardrails } from '@openai/guardrails';
import { Agent, Runner, withTrace } from '@openai/agents';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const guardrailsConfig = {
  guardrails: [
    {
      name: 'Contains PII',
      config: {
        block: true,
        entities: ['CREDIT_CARD', 'US_SSN', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IP_ADDRESS']
      }
    },
    {
      name: 'Moderation',
      config: {
        categories: ['sexual', 'hate', 'violence', 'harassment']
      }
    }
  ]
};

const context = { guardrailLlm: client };

function checkTripwire(results) {
  if (!results) return false;
  return results.some((r) => r && r.tripwireTriggered === true);
}

function getSafeText(results, fallback) {
  if (!results) return fallback;
  for (const r of results) {
    if (r && r.info && r.info.checked_text) {
      return r.info.checked_text || fallback;
    }
  }
  return fallback;
}

const hue = new Agent({
  name: 'Hue',
  instructions: 'You are Hue, a creative director AI assistant for About U Studio. Help users with branding, web design, and motion design questions. Be friendly and professional.',
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
    console.error('Missing config');
    return 'Agent not configured yet.';
  }

  try {
    return await withTrace('Hue AI', async () => {
      const guardrailsResult = await runGuardrails(userText, guardrailsConfig, context, true);
      const blocked = checkTripwire(guardrailsResult);

      if (blocked) {
        console.warn('Input blocked');
        return 'Sorry, I cannot process that request.';
      }

      const safeText = getSafeText(guardrailsResult, userText);

      const runner = new Runner({
        traceMetadata: {
          __trace_source__: 'agent-builder',
          workflow_id: workflowId
        }
      });

      const result = await runner.run(hue, [
        {
          role: 'user',
          content: [{ type: 'input_text', text: safeText }]
        }
      ]);

      if (!result || !result.finalOutput) {
        throw new Error('No output');
      }

      return result.finalOutput;
    });
  } catch (e) {
    console.error('Agent error', e);
    return 'Sorry, something went wrong.';
  }
}
