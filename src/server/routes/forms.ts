import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { settings, redis } from '@devvit/web/server';
import { 
  SETTINGS, 
  BLOCKLIST_CACHE_PREFIX, 
  BLOCKLIST_EXPIRATION_MS,
  LOCATION_CACHE_KEY 
} from '../../shared/constants';

type ExampleFormValues = {
  message?: string;
};

export const forms = new Hono();

forms.post('/config-submit', async (c) => {
  const values = await c.req.json<any>();
  
  // Extract values, handling that 'select' fields return arrays in Devvit
  const location = values.location || 'Global';
  const aiProvider = Array.isArray(values.aiProvider) ? values.aiProvider[0] : values.aiProvider || 'xai';
  const llmApiKey = (values.llmApiKey || '').trim();
  const llmModel = (values.llmModel || '').trim();
  const proxyServerUrl = (values.proxyServerUrl || '').trim();
  
  const minTitleWordCount = values.minTitleWordCount;
  const minBodyWordCount = values.minBodyWordCount;
  const autoRemovalThreshold = values.autoRemovalThreshold;
  const reportingThreshold = values.reportingThreshold;
  
  try {
    // 1. Validate API Key Format
    if (llmApiKey) {
      if (aiProvider === 'gemini' && !llmApiKey.startsWith('AIza')) {
        console.warn('[JijiGuard] WARNING: Selected Gemini but API Key does not start with AIza. Auth may fail.');
      } else if (aiProvider === 'xai' && !llmApiKey.startsWith('xai-') && llmApiKey.startsWith('AIza')) {
        console.error('[JijiGuard] ERROR: Selected Grok (xAI) but provided a Google (AIza) API Key. Please switch Provider to Gemini or provide an xAI key.');
      }
    }

    // 2. Save all provided settings to Redis
    const settingsToSave: Record<string, string> = {
      [LOCATION_CACHE_KEY]: location,
      [SETTINGS.AI_PROVIDER]: aiProvider,
    };

    if (llmApiKey) {
      settingsToSave[SETTINGS.LLM_API_KEY] = llmApiKey;
      settingsToSave[SETTINGS.API_KEY] = llmApiKey;
    }
    if (llmModel) settingsToSave[SETTINGS.LLM_MODEL] = llmModel;
    if (proxyServerUrl) settingsToSave[SETTINGS.PROXY_SERVER_URL] = proxyServerUrl;
    if (minTitleWordCount !== undefined && minTitleWordCount !== null) settingsToSave[SETTINGS.MIN_TITLE_WORD_COUNT] = minTitleWordCount.toString();
    if (minBodyWordCount !== undefined && minBodyWordCount !== null) settingsToSave[SETTINGS.MIN_BODY_WORD_COUNT] = minBodyWordCount.toString();
    if (autoRemovalThreshold !== undefined && autoRemovalThreshold !== null) settingsToSave[SETTINGS.AUTO_REMOVAL_THRESHOLD] = autoRemovalThreshold.toString();
    if (reportingThreshold !== undefined && reportingThreshold !== null) settingsToSave[SETTINGS.REPORTING_THRESHOLD] = reportingThreshold.toString();

    for (const [key, val] of Object.entries(settingsToSave)) {
      await redis.set(key, val);
    }
    
    // 3. Dynamic Dictionary Generation via LLM
    const activeLLMModel = llmModel || await redis.get(SETTINGS.LLM_MODEL) || await settings.get<string>(SETTINGS.LLM_MODEL) || (aiProvider === 'xai' ? 'grok-2-latest' : 'gpt-4o-mini');
    const activeLLMKey = llmApiKey || await redis.get(SETTINGS.LLM_API_KEY) || await settings.get<string>(SETTINGS.LLM_API_KEY);

    if (activeLLMKey) {
      console.log(`[JijiGuard] Generating dynamic dictionary for location: ${location} using ${activeLLMModel} (${aiProvider})...`);
      
      const prompt = `Generate a JSON object with a single key "keywords" containing an array of 60 high-sensitivity "tripwire" strings for content moderation in ${location}. 
      The array MUST include:
      1. LOCAL AI SLOP EQUIVALENTS: Provide words or phrases in the native language(s) of ${location} that are the direct semantic equivalents of English AI markers like "delve deep", "rich tapestry", "testament to", "completely transformative", "nuanced approach", "shining beacon", "treasure trove".
      2. UNIVERSAL AI MARKERS: Always include the English versions: "delve", "rich tapestry", "treasure trove", "paradigm", "realm", "foster synergy".
      3. FILLER WORDS: Common low-value filler words used in ${location} (e.g., "um", "ah", "yaani", "basically") that indicate automated or low-effort content.
      4. LOCALIZED SCAM/FRAUD: Specific keywords, slang, and transaction markers commonly used in fraudulent posts within ${location} (e.g., "tuma fare", "wash wash").

      The goal is for this list to catch posts that look like they were translated from an English LLM or follow LLM speech patterns.
      
      Return ONLY the JSON object. Example: {"keywords": ["delve", "rich tapestry", "tuma fare", "yaani", "urgent 2k"]}`;

      try {
        let endpoint = '';
        let body: any = {};
        let headers: Record<string, string> = { 
          'Content-Type': 'application/json',
          'User-Agent': 'JijiGuard-Reddit-Bot/1.0'
        };

        // Fallback for model if missing
        const activeModel = llmModel || (aiProvider === 'gemini' ? 'gemini-1.5-flash' : (aiProvider === 'xai' ? 'grok-2-latest' : 'gpt-4o-mini'));

        if (aiProvider === 'gemini') {
          endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(activeLLMKey)}`;

          body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
          };
        } else {
          endpoint = aiProvider === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
          headers['Authorization'] = `Bearer ${activeLLMKey}`;
          body = {
            model: activeLLMModel,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const result = await response.json();
          let rawContent = '';
          
          if (aiProvider === 'gemini') {
            rawContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
          } else {
            rawContent = result.choices?.[0]?.message?.content;
          }

          if (rawContent) {
            const dictionary = JSON.parse(rawContent);
            const cacheKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
            await redis.set(cacheKey, JSON.stringify(dictionary), { expiration: new Date(Date.now() + BLOCKLIST_EXPIRATION_MS) });
            console.log(`[JijiGuard] Dynamic dictionary synced for ${location} via ${aiProvider}.`);
          }
        } else {
          const errorBody = await response.text();
          console.error(`[JijiGuard] ${aiProvider} dictionary generation failed with status: ${response.status}. Response: ${errorBody.substring(0, 200)}`);
        }
      } catch (llmError) {
        console.error(`[JijiGuard] Error calling ${aiProvider} API:`, llmError);
      }
    } else {
      console.warn(`[JijiGuard] No API key found for ${aiProvider}. Dictionary generation skipped.`);
    }

    return c.json<UiResponse>(
      {
        showToast: `JijiGuard fully configured for ${location}. settings synced.`,
      },
      200
    );
  } catch (error) {
    console.error('Error in config-submit:', error);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to update configuration.',
      },
      400
    );
  }
});

forms.post('/example-submit', async (c) => {
  const { message } = await c.req.json<ExampleFormValues>();
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  return c.json<UiResponse>(
    {
      showToast: trimmedMessage
        ? `Form says: ${trimmedMessage}`
        : 'Form submitted with no message',
    },
    200
  );
});
