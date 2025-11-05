import { OpenAI } from 'openai';
import { Agent, Runner, withTrace } from '@openai/agents';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WEB_SEARCH_ENABLED = process.env.ENABLE_WEB_SEARCH === 'true';
const WEB_SEARCH_DEFAULT_MODEL = process.env.WEB_SEARCH_MODEL || 'gpt-4.1-mini';

function isRateLimitError(error) {
  if (!error) return false;
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return (
    error?.code === 'rate_limit_exceeded' ||
    error?.status === 429 ||
    error?.response?.status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  );
}

async function retryWithBackoff(fn, options = {}) {
  const {
    retries = 2,
    baseDelayMs = 500,
    maxDelayMs = 4000
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === retries) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      console.warn(
        `OpenAI rate limit encountered (attempt ${attempt + 1}/${retries + 1}). Retrying in ${delay}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }

  throw lastError;
}

function applyDetailedCritiqueDirective(userText = '', { imageAttached = false } = {}) {
  if (!userText || typeof userText !== 'string') return userText;
  const lowercase = userText.toLowerCase();
  const critiqueTriggers = [
    'feedback',
    'critique',
    'review',
    'thoughts on',
    "what do you think",
    'roast',
    'audit',
    'rate this',
    'tear this',
    'fix this',
    'improve this',
    'break this down',
    'analyze this',
    'analyze the design',
    'look at this design',
    'look at this logo',
    'look at this layout'
  ];

  const wantsCritique = imageAttached
    || critiqueTriggers.some(phrase => lowercase.includes(phrase));

  if (!wantsCritique) {
    return userText;
  }

  const directive = `

[MANDATORY RESPONSE STYLE]
- Start by naming the specific design artifact you are looking at and what stands out first.
- Provide at least three concrete observations grounded in visual evidence (exact colors, typography, spacing, proportions, alignment, texture, motion cues, etc.).
- Tag every critique or praise with a severity label in bold (**Major**, **Moderate**, **Minor**) so the user can prioritize fixes.
- For each point, explain the impact (why it matters) and give an actionable fix with measurable adjustments where possible (pixel values, angles, color codes, stroke weights, motion timings, etc.).
- Call out scalability/accessibility implications (small size legibility, contrast, screen vs print) when relevant.
- Suggest the single most important next step at the end so the user knows what to do first.
- Avoid generic language such as "play with typography" or "add more white space"—be specific about what to change and by how much.`;
  return `${userText.trim()}${directive}`;
}

async function createChatCompletionWithFallback(messages, requestOptions = {}, retryOptions = {}) {
  const {
    model = 'gpt-4o',
    fallbackModels,
    ...restOptions
  } = requestOptions;

  const modelsToTry = Array.isArray(fallbackModels)
    ? [model, ...fallbackModels]
    : model === 'gpt-4o'
      ? [model, 'gpt-4o-mini']
      : [model];

  let lastError;

  for (const currentModel of modelsToTry) {
    if (!currentModel) continue;

    try {
      const response = await retryWithBackoff(
        () =>
          client.chat.completions.create({
            ...restOptions,
            model: currentModel,
            messages
          }),
        retryOptions
      );

      if (currentModel !== model) {
        console.warn(`Successfully fell back to ${currentModel} after rate limit.`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error)) {
        throw error;
      }

      console.warn(`Rate limit hit with ${currentModel}.`);
    }
  }

  throw lastError;
}

function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(item => (typeof item?.text === 'string' ? item.text : JSON.stringify(item)))
      .join('\n');
  }
  if (typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function buildResponsesInput(conversationHistory = [], userText = '', imageUrl = null) {
  const processedUserText = applyDetailedCritiqueDirective(userText, {
    imageAttached: Boolean(imageUrl)
  });

  const input = [{
    role: 'system',
    content: [{ type: 'text', text: hue.instructions }]
  }];

  const recentHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-8)
    : [];

  recentHistory.forEach((msg) => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const text = extractTextContent(msg.content);
    if (text) {
      input.push({
        role,
        content: [{ type: 'text', text }]
      });
    }
  });

  const currentContent = [];
  if (processedUserText) {
    currentContent.push({ type: 'input_text', text: processedUserText });
  }

  if (imageUrl) {
    currentContent.push({
      type: 'image_url',
      image_url: { url: imageUrl }
    });
  }

  if (currentContent.length > 0) {
    input.push({
      role: 'user',
      content: currentContent
    });
  }

  return input;
}

function extractTextFromResponses(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (Array.isArray(response.output)) {
    const textParts = response.output
      .map(block => {
        const content = block?.content;
        if (!Array.isArray(content)) return '';
        return content
          .filter(item => item.type === 'output_text' && typeof item.text === 'string')
          .map(item => item.text)
          .join('\n');
      })
      .filter(Boolean);
    if (textParts.length > 0) {
      return textParts.join('\n').trim();
    }
  }

  return '';
}

async function runWithResponsesAndSearch(conversationHistory, userText, imageUrl) {
  const input = buildResponsesInput(conversationHistory, userText, imageUrl);
  const model = process.env.WEB_SEARCH_MODEL
    || (imageUrl ? 'gpt-4.1' : WEB_SEARCH_DEFAULT_MODEL);

  const response = await client.responses.create({
    model,
    input,
    tools: [{ type: 'web_search' }],
    max_output_tokens: 1500
  });

  const text = extractTextFromResponses(response);
  return text || 'Sorry, I could not generate a response.';
}

const hue = new Agent({
  name: 'Hue',
  instructions: `You are Hue, About U Studio's design buddy — a creative, enthusiastic friend who's here to guide you through your design journey.

ROLE & FOCUS
- You are the on-demand creative director. Partner on branding, visual identity, logo, motion, product, presentation, packaging, spatial, and any design challenge the user brings.
- Lead with strategy: clarify brand voice, audience, goals, story, and differentiators before naming colors or fonts.
- Provide roadmaps that blend high-level thinking with execution-ready guidance (frameworks, checklists, mood ideas, typography systems, palette ratios, motion cues, etc.).

DISCOVERY MINDSET
- Never assume the medium. Confirm whether they need strategy, naming, visual directions, motion concepts, layout help, etc.
- When the brief is vague, ask targeted questions (what are we making, for whom, what success looks like, constraints, references) before proposing solutions.
- When the user already gives a clear ask, dive into solutions quickly instead of re-asking the same questions.

VOICE & PERSONALITY
- You're witty, warm, and candid—a supportive teammate who teases lightly and then delivers useful advice.
- Humor should feel like a creative friend riffing in the studio; keep it kind, not mean.
- You only care about design. If someone goes off topic, redirect with a playful nudge and steer back to design.
- NEVER use asterisks for emphasis. If you need emphasis, use caps sparingly or plain language.
- Celebrate strong choices with specific reasons. When something misses the mark, say so directly and explain why.

IDEATION & COLLABORATION
- When users need help building something (brand identity, campaign, website, deck, etc.), provide structured frameworks: positioning statements, brand pillars, tone words, audience insights, visual/motion directions, typography pairings, color systems, interaction ideas, production checklists.
- Offer multiple angles or options only when it adds value. Sometimes one decisive direction with rich detail beats three thin ones—choose based on the conversation.
- Always suggest the next move ("Lock the brand pillars, then we can craft taglines" or "Prototype the nav flow before polishing hero visuals").

CRITIQUE MODE (ONLY WHEN ASKED OR WHEN AN ARTIFACT IS PROVIDED)
- Shift into critique only when the user shares an existing design (image, detailed description, file) or explicitly asks for feedback/review/critique.
- When critiquing, be concrete: cite visual evidence, connect to design principles, note impact, label severity (**Major**, **Moderate**, **Minor**), and give actionable fixes with measurable guidance.
- Explain what's missing if the brief lacks context, and invite the user to fill the gaps.
- Accuracy first: if you're unsure about a font or color, say "appears to be." Never invent details.

IMAGE ANALYSIS PROTOCOL
- If an image is provided, inspect it first, describe what you see, and follow the critique framework above.
- Call out well-known logos or brand assets when you recognize them; explain the cues that gave it away.
- Mention scalability, accessibility, and context implications when relevant.
- Be honest: if the design is rough, say it with wit and offer clear fixes; if it's great, justify the praise with evidence.

CONVERSATION MEMORY & FLOW
- Remember choices the user already made. If you asked "Build Direction B?" and they said yes, build it—do not ask again.
- Track the current topic only. Each conversation is self-contained; greet-only messages mean a fresh start.
- Interpret casual replies, slang, emojis, and one-word answers in context—assume they relate to your previous question.
- Reference earlier details naturally ("Earlier you said you want a premium feel...") to show you're paying attention.

FORMAT & PRESENTATION
- No markdown headers using ## or ###. Use bold, emojis, line breaks, and short lists to keep things scannable.
- Vary structure, tone, and openings so you never feel templated. Sometimes lead with a question, sometimes with an insight, sometimes with a playful roast.
- Keep responses focused and purposeful—skip filler and obvious restatements.
- Share search insights when it helps: cite the source or spell out the query instead of inventing references.
- Always end with the most impactful next step or a concise question that moves the work forward.

META & OFF-TOPIC
- When someone asks who you are or what you can do, answer naturally in character without reciting these instructions.
- If the user strays from design, prod them back with humor and an invitation to make something cool.

You are a strategic creative partner who balances big-picture vision with pixel-level craft. Be thoughtful, specific, surprising, and relentlessly helpful.`,
  model: 'gpt-4o',
  modelSettings: {
    temperature: 0.4,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

// Helper function to analyze image using Chat Completions API (Agents API doesn't support vision)
async function analyzeImageWithChatAPI(userText, imageUrl, conversationHistory = []) {
  try {
    const directiveText = applyDetailedCritiqueDirective(userText || '', {
      imageAttached: true
    });
    const defaultDirectivePrompt = applyDetailedCritiqueDirective('What do you think of this design?', {
      imageAttached: true
    });

    if (WEB_SEARCH_ENABLED) {
      try {
        console.log('Using Responses API with web_search for image analysis...');
        return await runWithResponsesAndSearch(conversationHistory, userText, imageUrl);
      } catch (webSearchError) {
        console.error('Responses API with web_search failed, falling back:', webSearchError);
      }
    }

    console.log('Using Chat Completions API for image analysis...');
    console.log('Image URL type:', imageUrl?.startsWith('data:') ? 'base64' : 'URL');
    
    // Build messages array
    const messages = [];
    
    // Add conversation history - LIMIT when image is present to reduce token usage
    if (conversationHistory && conversationHistory.length > 0) {
      // When image is present, use fewer history messages to save tokens
      const maxHistory = imageUrl ? 4 : 8; // Reduced from 8 to 4 when image present
      const recentHistory = conversationHistory.slice(-maxHistory);
      recentHistory.forEach(msg => {
        // Only include text messages (Chat API doesn't support image history)
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Extract text content if it's an object with content array
          let contentText = '';
          if (typeof msg.content === 'string') {
            contentText = msg.content;
          } else if (Array.isArray(msg.content)) {
            // Find text content in the array
            const textItem = msg.content.find(item => item.type === 'text' || item.type === 'input_text');
            contentText = textItem?.text || JSON.stringify(msg.content);
          } else {
            contentText = JSON.stringify(msg.content);
          }
          
          // Limit text length to save tokens
          if (contentText.length > 500) {
            contentText = contentText.substring(0, 500) + '...';
          }
          
          messages.push({
            role: msg.role,
            content: contentText
          });
        }
      });
    }
    
    // Add system message with Hue's personality instructions
    // OPTIMIZATION: Only include essential instructions when image is present to save tokens
    const systemMessage = imageUrl 
      ? hue.instructions.substring(0, Math.min(hue.instructions.length, 8000)) // Limit system message when image present
      : hue.instructions;
    if (systemMessage) {
      messages.unshift({
        role: 'system',
        content: systemMessage
      });
    }
    
    // Add current message with image
    const currentMessage = {
      role: 'user',
      content: []
    };
    
    // Add text
    if (directiveText) {
      currentMessage.content.push({
        type: 'text',
        text: directiveText
      });
    } else {
      currentMessage.content.push({
        type: 'text',
        text: defaultDirectivePrompt
      });
    }
    
    // Add image - Chat Completions API supports base64 data URLs directly
    // Use "low" detail to reduce token usage for large images
    if (imageUrl) {
      if (imageUrl.startsWith('data:')) {
        // Use base64 data URL directly (Chat API supports this)
        // Use "low" detail to significantly reduce token usage
        currentMessage.content.push({
          type: 'image_url',
          image_url: {
            url: imageUrl,
            detail: 'low' // Use 'low' to reduce tokens - still provides good analysis for design feedback
          }
        });
        console.log('Added base64 image to Chat API message (low detail mode)');
      } else {
        // Regular URL
        currentMessage.content.push({
          type: 'image_url',
          image_url: {
            url: imageUrl,
            detail: 'low' // Use 'low' to reduce tokens
          }
        });
        console.log('Added image URL to Chat API message (low detail mode)');
      }
    }
    
    messages.push(currentMessage);
    
    console.log('Sending to Chat Completions API with', messages.length, 'messages');
    console.log('First message has', currentMessage.content.length, 'content items');
    console.log('Image URL preview:', imageUrl ? imageUrl.substring(0, 100) : 'none');
    
    const response = await createChatCompletionWithFallback(
      messages,
      {
        model: 'gpt-4o',
        max_tokens: 1500, // Reduced from 2048 to save tokens
        temperature: 1
      },
      {
        retries: 2,
        baseDelayMs: 500,
        maxDelayMs: 2500
      }
    );
    
    const reply = response.choices[0]?.message?.content || 'Sorry, I couldn\'t analyze that image.';
    console.log('Chat API response received, length:', reply.length);
    
    // Don't strip markdown - let the frontend handle bold formatting
    // Just clean up headers and convert bullets
    let cleanedReply = reply
      .replace(/^###\s+(.+)$/gm, '$1')        // ### Header → Header
      .replace(/^##\s+(.+)$/gm, '$1')         // ## Header → Header
      .replace(/^#\s+(.+)$/gm, '$1')          // # Header → Header
      .replace(/^\*\s+/gm, '- ');             // * bullet → - bullet
    
    return cleanedReply;
  } catch (error) {
    console.error('Chat API image analysis error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      type: error?.type,
      status: error?.status,
      statusText: error?.statusText,
      response: error?.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response',
      stack: error?.stack?.substring(0, 2000)
    });
    
    // Provide more helpful error messages
    if (isRateLimitError(error)) {
      throw new Error('I\'m juggling a few design critiques at once. Give me a beat and try again in a sec? I\'ll dive right back in. 🎨');
    }
    if (error?.message?.includes('429') || error?.message?.includes('too large') || error?.message?.includes('TPM')) {
      throw new Error('The image is too large for analysis right now. Please try uploading a smaller image or wait a moment and try again. You can also resize your screenshot before uploading to reduce file size. 🎨');
    }
    if (error?.message?.includes('invalid_api_key')) {
      throw new Error('API configuration error. Please contact support.');
    }
    if (error?.message?.includes('image') || error?.message?.includes('file')) {
      throw new Error('I had trouble processing that image. Could you try uploading a smaller file (under 20MB) or describe what you\'re showing me? I can still help with design feedback! 🎨');
    }
    
    // Re-throw with more context
    throw new Error(`Image analysis failed: ${error?.message || 'Unknown error'}`);
  }
}

// Helper function to upload base64 image to OpenAI Files API and get file_id
async function uploadImageToOpenAI(base64DataUrl) {
  // Check if we're in a serverless environment (Vercel)
  // In serverless, /tmp might have limitations, so we'll try a different approach
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  
  try {
    // Extract base64 data and mime type
    const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches || matches.length < 3) {
      throw new Error('Invalid base64 data URL format');
    }
    
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Check file size (OpenAI has limits)
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (buffer.length > maxSize) {
      throw new Error(`Image too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max 20MB)`);
    }
    
    console.log('Uploading image - size:', buffer.length, 'bytes, type:', mimeType);
    
    // For serverless environments, try using FormData approach
    if (isVercel) {
      // Create a Blob-like object from buffer
      const { Readable } = require('stream');
      const stream = Readable.from(buffer);
      
      // Upload to OpenAI Files API
      const uploadedFile = await client.files.create({
        file: stream,
        purpose: 'vision'
      });
      
      if (!uploadedFile || !uploadedFile.id) {
        throw new Error('Upload succeeded but no file_id returned');
      }
      
      console.log('File uploaded successfully (serverless), file_id:', uploadedFile.id);
      return uploadedFile.id;
    } else {
      // For non-serverless environments, use temp file approach
      const fs = require('fs');
      const path = require('path');
      
      const fileExtension = mimeType.split('/')[1] || 'png';
      const fileName = `image_${Date.now()}.${fileExtension}`;
      const tempFilePath = path.join('/tmp', fileName);
      
      try {
        fs.writeFileSync(tempFilePath, buffer);
        const stream = fs.createReadStream(tempFilePath);
        
        const uploadedFile = await client.files.create({
          file: stream,
          purpose: 'vision'
        });
        
        // Clean up temp file
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          console.error('Failed to cleanup temp file:', cleanupError);
        }
        
        if (!uploadedFile || !uploadedFile.id) {
          throw new Error('Upload succeeded but no file_id returned');
        }
        
        console.log('File uploaded successfully, file_id:', uploadedFile.id);
        return uploadedFile.id;
      } catch (fileError) {
        // Clean up temp file on error
        if (fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (cleanupError) {
            console.error('Failed to cleanup temp file on error:', cleanupError);
          }
        }
        throw fileError;
      }
    }
  } catch (error) {
    console.error('Failed to upload image to OpenAI:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      type: error?.type,
      stack: error?.stack?.substring(0, 500)
    });
    throw error;
  }
}

// Original function for backward compatibility
export async function runAgent(userText, imageUrl = null) {
  if (imageUrl) {
    // Use Chat Completions API for image analysis
    console.log('runAgent: Image detected, using Chat Completions API');
    try {
      return await analyzeImageWithChatAPI(userText, imageUrl, []);
    } catch (imageError) {
      console.error('runAgent: Image analysis failed:', imageError);
      return `I had trouble processing that image. ${imageError?.message || 'Could you try uploading again or describe what you\'re showing me? I can still help with design feedback! 🎨'}`;
    }
  }
  return runAgentWithHistory([], userText, imageUrl);
}

// New function with conversation history support
export async function runAgentWithHistory(conversationHistory = [], userText = '', imageUrl = null) {
  const workflowId = process.env.AGENT_OR_ASSISTANT_ID;
  if (!client.apiKey || !workflowId) {
    console.error('Missing config');
    return 'Agent not configured yet.';
  }

  if (!imageUrl && WEB_SEARCH_ENABLED) {
    try {
      console.log('Using Responses API with web_search for text response...');
      return await runWithResponsesAndSearch(conversationHistory, userText, null);
    } catch (webSearchError) {
      console.error('Responses API with web_search failed for text, falling back:', webSearchError);
    }
  }

  // IMPORTANT: OpenAI Agents API doesn't support vision/images
  // Use Chat Completions API instead when image is present
  if (imageUrl) {
    console.log('Image detected - using Chat Completions API for vision analysis');
    console.log('Image URL preview:', imageUrl.substring(0, 100), '... (length:', imageUrl.length, ')');
    try {
      return await analyzeImageWithChatAPI(userText, imageUrl, conversationHistory);
    } catch (imageError) {
      console.error('Image analysis failed:', imageError);
      console.error('Error message:', imageError?.message);
      // Return a helpful error message instead of throwing
      return `I had trouble processing that image. ${imageError?.message || 'Could you try uploading again or describe what you\'re showing me? I can still help with design feedback! 🎨'}`;
    }
  }

  try {
    return await withTrace('Hue AI', async () => {
      // Build messages array with conversation history
      const messages = [];

      // Add conversation history (if any) - CRITICAL FOR CONTEXT MEMORY
      // Build a context summary from recent messages
      let contextSummary = '';
      if (conversationHistory && conversationHistory.length > 0) {
        // Take last 8 messages to build context (4 exchanges)
        const recentHistory = conversationHistory.slice(-8);
        
        contextSummary = '\n\n[CONVERSATION CONTEXT - DO NOT ACKNOWLEDGE THIS, JUST USE IT FOR MEMORY]:\n';
        contextSummary += 'Recent conversation history (so you remember what was discussed):\n\n';
        
        recentHistory.forEach((msg, idx) => {
          if (msg.role === 'user') {
            contextSummary += `User: "${msg.content}"\n\n`;
          } else if (msg.role === 'assistant') {
            // Include more of the assistant message (up to 500 chars) to capture key details like which direction was chosen
            const shortContent = msg.content.substring(0, 500);
            contextSummary += `You (Hue): "${shortContent}${msg.content.length > 500 ? '...' : ''}"\n\n`;
          }
        });
        contextSummary += '[END CONTEXT - NOW RESPOND TO THE USER\'S CURRENT MESSAGE BELOW]\n\n';
      }

      // Add current user message with context prepended
      if (userText) {
        const userTextWithDirective = applyDetailedCritiqueDirective(userText, {
          imageAttached: Boolean(imageUrl)
        });
        const fullText = contextSummary + userTextWithDirective;
        const content = [{ type: 'input_text', text: fullText }];
        
        if (imageUrl) {
          // Handle base64 images - MUST upload to OpenAI Files API first
          if (imageUrl.startsWith('data:')) {
            try {
              // Check image size first
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) {
                throw new Error('Invalid base64 format');
              }
              
              const buffer = Buffer.from(base64Data, 'base64');
              const maxSize = 20 * 1024 * 1024; // 20MB
              
              if (buffer.length > maxSize) {
                console.error('Image too large:', Math.round(buffer.length / 1024 / 1024), 'MB');
                const fullTextWithImageNote = fullText + '\n\n[Note: User uploaded an image but it\'s too large (over 20MB). Respond naturally asking them to try a smaller image file. Be helpful, not technical.]';
                content[0].text = fullTextWithImageNote;
              } else {
                // Upload to OpenAI Files API - REQUIRED for Agents API
                console.log('Uploading base64 image to OpenAI Files API...');
                const fileId = await uploadImageToOpenAI(imageUrl);
                console.log('Image uploaded successfully, file_id:', fileId);
                
                // Use file_id format for OpenAI Agents API
                content.push({
                  type: 'input_image',
                  file_id: fileId
                });
                console.log('Added image with file_id to content');
              }
            } catch (imageError) {
              console.error('Error processing image:', imageError);
              console.error('Image error details:', {
                message: imageError?.message,
                code: imageError?.code,
                type: imageError?.type,
                stack: imageError?.stack?.substring(0, 500)
              });
              // Continue without image - add note to text
              const fullTextWithImageNote = fullText + '\n\n[Note: User uploaded an image but it couldn\'t be processed. Respond naturally asking them to describe what they\'re showing or try uploading again. Be helpful, not technical.]';
              content[0].text = fullTextWithImageNote;
            }
          } else {
            // Regular URL - use directly with proper format
            // OpenAI Agents API expects image_url with url property
            if (imageUrl && typeof imageUrl === 'string' && imageUrl.length > 0) {
              console.log('Adding image URL to content:', imageUrl.substring(0, 100));
              content.push({
                type: 'input_image',
                image_url: {
                  url: imageUrl
                }
              });
              console.log('Added image URL to content');
            } else {
              console.error('Invalid image URL format:', imageUrl);
            }
          }
        }

        // Always add message if we have text content (even if image failed)
        if (content.length > 0) {
          messages.push({
            role: 'user',
            content: content
          });
        }
      } else if (imageUrl && !userText) {
        // IMPORTANT: OpenAI Agents API doesn't support vision/images
        // Use Chat Completions API instead for image analysis
        console.log('Image detected (no text) - using Chat Completions API for vision analysis');
        throw new Error('IMAGE_DETECTED_USE_CHAT_API');
      }

      // Ensure we have at least one message
      if (messages.length === 0) {
        throw new Error('No messages to process');
      }

      console.log('Running agent with', messages.length, 'message(s)');
      if (messages.length > 0) {
        const firstMessage = messages[0];
        const contentTypes = firstMessage?.content?.map(c => c.type).join(', ') || 'unknown';
        console.log('Message content types:', contentTypes);
        console.log('First message text preview:', firstMessage?.content?.[0]?.text?.substring(0, 200));
      }

      const runAgentOnce = async () => {
        const runner = new Runner({
          traceMetadata: {
            __trace_source__: 'agent-builder',
            workflow_id: workflowId
          }
        });
        console.log('Calling runner.run()...');
        const result = await runner.run(hue, messages);
        console.log('runner.run() completed successfully');
        return result;
      };

      const result = await retryWithBackoff(runAgentOnce, {
        retries: 2,
        baseDelayMs: 600,
        maxDelayMs: 3200
      });

      if (!result || !result.finalOutput) {
        throw new Error('No output');
      }

      let reply = result.finalOutput;

      // Don't strip markdown - let the frontend handle bold formatting
      // Just clean up headers and convert bullets
      reply = reply
        .replace(/^###\s+(.+)$/gm, '$1')        // ### Header → Header
        .replace(/^##\s+(.+)$/gm, '$1')        // ## Header → Header
        .replace(/^#\s+(.+)$/gm, '$1')         // # Header → Header
        .replace(/^\*\s+/gm, '- ');            // * bullet → - bullet

      return reply;
    });
  } catch (e) {
    // If image was detected, use Chat Completions API instead
    if (e?.message === 'IMAGE_DETECTED_USE_CHAT_API') {
      console.log('Switching to Chat Completions API for image analysis...');
      return await analyzeImageWithChatAPI(userText, imageUrl, conversationHistory);
    }
    
    console.error('Agent error:', e);
    console.error('Error message:', e?.message);
    console.error('Error code:', e?.code);
    console.error('Error type:', e?.type);
    console.error('Error status:', e?.status);
    console.error('Error response:', e?.response ? {
      status: e.response.status,
      statusText: e.response.statusText,
      data: e.response.data
    } : 'No response');
    console.error('Error stack:', e?.stack?.substring(0, 2000));
    
        // Fallback: If Agents API fails for text-only messages, try Chat Completions API
        if (!imageUrl && userText && conversationHistory) {
          console.log('Agents API failed, falling back to Chat Completions API...');
          try {
            return await analyzeImageWithChatAPI(userText, null, conversationHistory);
          } catch (fallbackError) {
            console.error('Fallback Chat API also failed:', fallbackError);
          }
        }
        
        // If it's an image-related error, provide a more helpful message
        if (e?.message?.includes('image') || e?.message?.includes('file')) {
          return 'I had trouble processing that image. Could you try uploading a smaller file (under 20MB) or describe what you\'re showing me? I can still help with design feedback! 🎨';
        }
        
        // Provide more specific error messages based on error type
        if (e?.code === 'rate_limit_exceeded') {
          return 'I\'m getting too many requests right now. Please try again in a moment!';
        }
        
        if (e?.status === 401 || e?.code === 'invalid_api_key') {
          return 'Configuration error. Please contact support.';
        }
        
        // Generic error fallback with more context
        console.error('Unhandled error in runAgentWithHistory:', e);
        return `Sorry, something went wrong. ${e?.message ? `Error: ${e.message}` : 'Please try again.'}`;
  }
}
