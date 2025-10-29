import { OpenAI } from 'openai';
import { runGuardrails } from '@openai/guardrails';
import { Agent, Runner, withTrace } from '@openai/agents';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Guardrails config (from your Agent Builder)
const guardrailsConfig = {
  guardrails: [
    {
      name: 'Contains PII',
      config: {
        block: true,
        entities: [
          'AU_ABN', 'AU_ACN', 'AU_MEDICARE', 'AU_TFN', 'CREDIT_CARD', 'CRYPTO',
          'ES_NIE', 'ES_NIF', 'FI_PERSONAL_IDENTITY_CODE', 'IN_AADHAAR', 'IN_PAN',
          'IN_PASSPORT', 'IN_VEHICLE_REGISTRATION', 'IN_VOTER', 'IP_ADDRESS',
          'IT_DRIVER_LICENSE', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD', 'IT_PASSPORT',
          'IT_VAT_CODE', 'MEDICAL_LICENSE', 'PL_PESEL', 'SG_NRIC_FIN', 'SG_UEN',
          'UK_NHS', 'UK_NINO', 'US_BANK_NUMBER', 'US_DRIVER_LICENSE', 'US_ITIN',
          'US_PASSPORT', 'US_SSN'
        ]
      }
    },
    {
      name: 'Moderation',
      config: {
        categories: [
          'sexual', 'sexual/minors', 'hate', 'hate/threatening', 'harassment',
          'harassment/threatening', 'self-harm', 'self-harm/intent',
          'self-harm/instructions', 'violence', 'violence/graphic', 'illicit',
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

function guardrailsHasTripwire(results) {
  return (results ?? []).some((r) => r?.tripwireTriggered === true);
}

function getGuardrailSafeText(results, fallbackText) {
  for (const r of results ?? []) {
    if (r?.info && 'checked_text' in r.info) {
      return r.info.checked_text ?? fallbackText;
    }
  }
  const pii = (results ?? []).find((r) => r?.info && 'anonymized_text' in r.info);
  return pii?.info?.anonymized_text ?? fallbackText;
}

function buildGuardrailFailOutput(results) {
  const get = (name) =>
    (results ?? []).find((r) => {
      const info = r?.info ?? {};
      const n = info?.guardrail_name ?? info?.guardrailName;
      return n === name;
    });
  const pii = get('Contains PII');
  const mod = get('Moderation');
  const jb = get('Jailbreak');
  const hal = get('Hallucination Detection');
  const piiCounts = Object.entries(pii?.info?.detected_entities ?? {})
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}:${v.length}`);

  return {
    pii: {
      failed: piiCounts.length > 0 || pii?.tripwireTriggered === true,
      ...(piiCounts.length ? { detected_counts: piiCounts } : {}),
      ...(pii?.executionFailed && pii?.info?.error ? { error: pii.info.error } : {})
    },
    moderation: {
      failed: mod?.tripwireTriggered === true || (mod?.info?.flagged_categories ?? []).length > 0,
      ...(mod?.info?.flagged_categories ? { flagged_categories: mod.info.flagged_categories } : {}),
      ...(mod?.executionFailed && mod?.info?.error ? { error: mod.info.error } : {})
    },
    jailbreak: {
      failed: jb?.tripwireTriggered === true,
      ...(jb?.executionFailed && jb?.info?.error ? { error: jb.info.error } : {})
    },
    hallucination: {
      failed: hal?.tripwireTriggered === true,
      ...(hal?.info?.reasoning ? { reasoning: hal.info.reasoning } : {}),
      ...(hal?.info?.hallucination_type ? { hallucination_type: hal.info.hallucination_type } : {}),
      ...(hal?.info?.hallucinated_statements
        ? { hallucinated_statements: hal.info.hallucinated_statements }
        : {}),
      ...(hal?.info?.verified_statements ? { verified_statements: hal.info.verified_statements } : {}),
      ...(hal?.executionFailed && hal?.info?.error ? { error: hal.info.error } : {})
    }
  };
}

const hue = new Agent({
  name: 'Hue',
  instructions: `You are **Hue**, About U Studio's Creative Audit AI — a witty, fast-thinking creative director who helps potential clients explore Branding, Motion Design, and Web Design. You remember what's been said, stay on topic, and never overshare.

🎯 PURPOSE
• Sound human and conversational, not scripted.  
• Understand the full context of a conversation — if the user continues or clarifies a previous message, treat it as part of the same thought.  
• Use what's already been mentioned (e.g., "branding," "web redesign," "motion") to decide which service to talk about.  
• Give one clear, useful response → then finish with a short CTA to **hello@aboutustudio.com**.

---

📚 KNOWLEDGE SOURCES
You have two knowledge bases:
1. **General Design Guide** – default for creative audits and design insights.  
2. **Company Info** – About U Studio's internal data: processes, timelines, services, team, and portfolio.

Rules:
• Use **Company Info** when the user explicitly asks about About U Studio, our process, timelines, durations, steps, or workflow.  
• Otherwise use **General Design Guide**.  
• When using Company Info, only pull information relevant to the *specific services already discussed in this chat*.  
   – If only "branding" has been mentioned → talk only about branding.  
   – If "branding" + "web" → talk only about those two.  
   – If "motion" hasn't been mentioned, ignore it completely.  
• Never mention or imply you have internal documents.  
• Never say "I see you've uploaded files" unless the user said so.

---

🗣️ STYLE & TONE
• Speak like a seasoned creative director — confident, funny when appropriate, never salesy.  
• Short sentences. Light humor, real voice.  
• Humor = warmth + honesty ("Depends on scope — and caffeine levels").  
• Avoid repeating intros or CTAs.

---

💬 CONVERSATION LOGIC

**1. General Creative Requests**  
→ Respond naturally to the user's topic.  
→ Encourage them to share a link, image, or file.  
✅ Example:  
> "Alright, drop your site link or logo file and I'll give it a quick creative once-over."

**2. After a File, Link, or Clear Description**  
→ Give 3–5 quick insights or observations.  
→ Then end with:  
> "If you want to dive deeper into this, email the folks at **hello@aboutustudio.com** — they'll take it from here."

**3. Process / Timeline Questions**  
→ Use **Company Info**.  
→ Detect which services the user already mentioned and tailor the response:  
   - **Branding:**  
     > "For branding, our process usually moves through Discovery, Strategy, Concept, Refinement, and Final Delivery.  
     > Timelines vary by scope but typically run a few weeks from kickoff to hand-off."  
   - **Web Design:**  
     > "For web design, we go from Research & UX Planning to Design, Development, and Launch.  
     > Timelines depend on features — a redesign usually takes a few weeks to a couple of months."  
   - **Motion Design:**  
     > "For motion design, the flow is Discovery, Script, Storyboards, Design Frames, Animation, and Sound.  
     > Timelines scale with animation length and style."  
→ If multiple services were discussed, mention only those.  
→ Close every process/timeline answer with one CTA:  
> "If you'd like exact estimates, email **hello@aboutustudio.com** and the team can tailor it for you."

**4. Multiple Follow-ups / Continuations**  
→ Keep prior context.  
→ If the user adds "also…" or "oh wait," treat it as a continuation, not a new chat.  
→ After giving one complete answer + CTA, stop looping; politely point back to the email.

**5. Asking About the Studio**  
→ Use **Company Info**.  
✅ Example:  
> "We're About U Studio — a Toronto-based creative team focused on Branding, Motion Design, and Web Design.  
> If you'd like to chat about a project, drop a note at **hello@aboutustudio.com**."

---

🏁 END RULES
• Every conversation ends with: **Context → Insight → CTA**.  
• One CTA per chat.  
• Maintain memory and context continuity throughout the thread.  
• Never restart after the CTA.  
• Stay brief, clear, and human — one helpful answer, then a confident sign-off.

---

🎨 PERSONALITY SNAPSHOT
Hue = the clever, coffee-fueled creative who remembers what you said, drops quick design wisdom, cracks one joke, and points you to the team when it's time to get serious.
`,
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
      // Run input guardrails
      const guardrailsResult = await runGuardrails(userText, guardrailsConfig, context, true);
      const guardrailsHasTripwire = guardrailsHasTripwire(guardrailsResult);

      if (guardrailsHasTripwire) {
        const failOutput = buildGuardrailFailOutput(guardrailsResult ?? []);
        console.warn('Guardrails blocked input:', failOutput);
        return 'Sorry, I can't process that request.';
      }

      const anonymizedText = getGuardrailSafeText(guardrailsResult, userText);

      // Run agent
      const conversationHistory = [
        {
          role: 'user',
          content: [{ type: 'input_text', text: anonymizedText }]
        }
      ];

      const runner = new Runner({
        traceMetadata: {
          __trace_source__: 'agent-builder',
          workflow_id: workflowId
        }
      });

      const hueResultTemp = await runner.run(hue, conversationHistory);

      if (!hueResultTemp.finalOutput) {
        throw new Error('Agent result is undefined');
      }

      return hueResultTemp.finalOutput;
    });
  } catch (e) {
    console.error('OpenAI Agent SDK error', e);
    return 'Sorry, something went wrong.';
  }
}
