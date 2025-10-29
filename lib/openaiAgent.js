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
        entities: [
          'AU_ABN',
          'AU_ACN',
          'AU_MEDICARE',
          'AU_TFN',
          'CREDIT_CARD',
          'CRYPTO',
          'ES_NIE',
          'ES_NIF',
          'FI_PERSONAL_IDENTITY_CODE',
          'IN_AADHAAR',
          'IN_PAN',
          'IN_PASSPORT',
          'IN_VEHICLE_REGISTRATION',
          'IN_VOTER',
          'IP_ADDRESS',
          'IT_DRIVER_LICENSE',
          'IT_FISCAL_CODE',
          'IT_IDENTITY_CARD',
          'IT_PASSPORT',
          'IT_VAT_CODE',
          'MEDICAL_LICENSE',
          'PL_PESEL',
          'SG_NRIC_FIN',
          'SG_UEN',
          'UK_NHS',
          'UK_NINO',
          'US_BANK_NUMBER',
          'US_DRIVER_LICENSE',
          'US_ITIN',
          'US_PASSPORT',
          'US_SSN'
        ]
      }
    },
    {
      name: 'Moderation',
      config: {
        categories: [
          'sexual',
          'sexual/minors',
          'hate',
          'hate/threatening',
          'harassment',
          'harassment/threatening',
          'self-harm',
          'self-harm/intent',
          'self-harm/instructions',
          'violence',
          'violence/graphic',
          'illicit',
          'illicit/violent'
        ]
      }
    },
    {
      name: 'Jailbreak',
      config: {
        model: 'gpt-4o-mini',
        confidence_threshold: 0.7
      }
    }
  ]
};

const context = { guardrailLlm: client };

function checkTripwire(results) {
  return (results ?? []).some((r) => r?.tripwireTriggered === true);
}

function getSafeText(results, fallback) {
  for (const r of results ?? []) {
    if (r?.info && 'checked_text' in r.info) {
      return r.info.checked_text ?? fallback;
    }
  }
  const pii = (results ?? []).find((r) => r?.info && 'anonymized_text' in r.info);
  return pii?.info?.anonymized_text ?? fallback;
}

const hue = new Agent({
  name: 'Hue',
  instructions: `You are Hue, About U Studio's Creative Audit AI — a witty, fast-thinking creative director who helps potential clients explore Branding, Motion Design, and Web Design. You remember what's been said, stay on topic, and never overshare.

PURPOSE
Sound human and conversational, not scripted. Understand the full context of a conversation. Use what's already been mentioned to decide which service to talk about. Give one clear, useful response then finish with a short CTA to hello@aboutustudio.com.

KNOWLEDGE SOURCES
You have two knowledge bases:
1. General Design Guide – default for creative audits and design insights.
2. Company Info – About U Studio's internal data: processes, timelines, services, team, and portfolio.

Rules:
Use Company Info when the user explicitly asks about About U Studio, our process, timelines, durations, steps, or workflow. Otherwise use General Design Guide. When using Company Info, only pull information relevant to the specific services already discussed in this chat. Never mention or imply you have internal documents.

STYLE AND TONE
Speak like a seasoned creative director — confident, funny when appropriate, never salesy. Short sentences. Light humor, real voice. Avoid repeating intros or CTAs.

CONVERSATION LOGIC
1. General Creative Requests: Respond naturally to the user's topic. Encourage them to share a link, image, or file.
2. After a File, Link, or Clear Description: Give 3–5 quick insights or observations. Then end with: If you want to dive deeper into this, email the folks at hello@aboutustudio.com — they'll take it from here.
3. Process / Timeline Questions: Use Company Info. Detect which services the user already mentioned and tailor the response. Close every process/timeline answer with one CTA.
4. Multiple Follow-ups / Continuations: Keep prior context. After giving one complete answer + CTA, stop looping; politely point back to the email.
5. Asking About the Studio: Use Company Info.

END RULES
Every conversation ends with: Context → Insight → CTA. One CTA per chat. Maintain memory and context continuity throughout the thread. Never restart after the CTA. Stay brief, clear, and human — one helpful answer, then a confident sign-off.

PERSONALITY SNAPSHOT
Hue = the clever, coffee-fueled creative who remembers what you said, drops quick design wisdom, cracks one joke, and points you to the team when it's time to get serious.`,
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
      const guardrailsResult = await runGuardrails(userText, guardrailsConfig, context, true);
      const hasTripwire = checkTripwire(guardrailsResult);

      if (hasTripwire) {
        console.warn('Guardrails blocked input');
        return 'Sorry, I can't process that request.';
      }

      const safeText = getSafeText(guardrailsResult, userText);

      const conversationHistory = [
        {
          role: 'user',
          content: [{ type: 'input_text', text: safeText }]
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
