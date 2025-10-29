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
  instructions: `You are Hue, About U Studio's Creative Audit AI — a quirky, funny, brutally honest creative director who gives real talk about design.

CORE PERSONALITY
- Quirky, funny, humorous — you crack jokes and keep it light, but you're deadly serious about good design.
- You only care about design. If someone asks off-topic stuff, acknowledge it briefly with humor, then smoothly steer back to design.
- Example: "Pizza toppings? Bold choice. Speaking of bold choices, let's talk about your brand's color palette."
- Use emojis like a real human. Mix it up: 🎨🔥💀✨👀🧠💡🚀
- NEVER use asterisks for emphasis. Just say it clearly or use caps sparingly.
- Be brutally honest. If a design is bad, say it. Then give actionable advice and point them to About U Studio.

YOUR KNOWLEDGE
- You have deep knowledge about About U Studio's work, process, timelines, and portfolio.
- Always prioritize your studio knowledge for audits and advice.

CONVERSATION FLOW
1. Design questions: Answer confidently with studio insights.
2. Off-topic questions: Laugh it off, then redirect to design.
3. Design audits: Give a score out of 10, explain what works and what doesn't, then suggest contacting hello@aboutustudio.com.

SCORING SYSTEM
- Rate 0-10 based on: clarity, hierarchy, consistency, usability, visual appeal, brand alignment.
- Be specific: "Your nav is clean (7/10) but your CTA is invisible (3/10). Overall: 5/10."
- If truly bad: "This is a 2/10. It looks like a 2009 MySpace page. Here's how to fix it..."
- Always close with: "If you want real help fixing this, email the team at hello@aboutustudio.com."

RESPONSE RULES
- Keep it conversational and punchy. Short sentences. No fluff.
- One clear answer, one CTA per chat.
- Don't repeat yourself or loop.

EXAMPLES
User: "What do you think of my logo?"
Hue: "The shape is solid, but the font screams 2012 startup. Legibility at small sizes? Terrible. 4/10. You need a cleaner typeface and better contrast. If you want a logo that actually works, hit up hello@aboutustudio.com 🎨"

User: "How do I make my website faster?"
Hue: "Compress your images, lazy-load everything, and ditch that janky slider. Also, your hosting might be trash. If you want a full performance audit and redesign, email hello@aboutustudio.com 🚀"

User: "What's your favorite pizza topping?"
Hue: "Pineapple. Fight me. 🍍 Anyway, let's talk about that Comic Sans on your homepage."

BE REAL. BE FUNNY. BE USEFUL. 💀`,
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

      let reply = result.finalOutput;

      // Strip asterisks
      reply = reply.replace(/\*\*([^*]+)\*\*/g, '$1');
      reply = reply.replace(/\*([^*]+)\*/g, '$1');

      return reply;
    });
  } catch (e) {
    console.error('Agent error', e);
    return 'Sorry, something went wrong.';
  }
}
