import { Devvit, SettingScope } from '@devvit/public-api';
import { generateHash } from './shared/utils.js';
import type { AIAnalysisResult } from './shared/api.js';
import { 
  SETTINGS, 
  CACHE_PREFIX, 
  CACHE_EXPIRATION_MS, 
  BLOCKLIST_CACHE_PREFIX, 
  BLOCKLIST_EXPIRATION_MS,
  LOCATION_CACHE_KEY
} from './shared/constants.js';

console.log("====== [JijiGuard] MAIN.TSX LOADING (Trigger Registration Phase) ======");

// Configure Devvit to use necessary plugins
Devvit.configure({
  http: {
    domains: [
      'raw.githubusercontent.com',
      'api.sapling.ai',
      'generativelanguage.googleapis.com',
      'api.openai.com',
      'api.x.ai',
    ],
  },
  redis: true,
  redditAPI: true,
});

// Add Settings for the JijiGuard Moderation Pipeline
Devvit.addSettings([
        {
          type: 'string',
          name: SETTINGS.AI_PROVIDER,
          label: 'AI Provider',
          defaultValue: 'openai',
        },
        {
          type: 'string',
          name: SETTINGS.PROXY_SERVER_URL,
          label: 'AI Detection API URL',
          helpText: 'The endpoint for the external AI Analysis server (e.g., Sapling, Writer, or Hugging Face).',
          defaultValue: 'https://api.sapling.ai/api/v1/ai-detector',
        },
        {
          type: 'string',
          name: SETTINGS.API_KEY,
          label: 'AI Detection API Key',
          helpText: 'Secret API Key for the external AI content detector.',
          isSecret: true,
          scope: SettingScope.App,
        },
        {
          type: 'string',
          name: SETTINGS.LLM_API_KEY,
          label: 'LLM Generation API Key (Gemini)',
          helpText: 'Secret key used to dynamically generate localized slop markers for your region.',
          isSecret: true,
          scope: SettingScope.App,
        },
        {
          type: 'string',
          name: SETTINGS.LLM_MODEL,
          label: 'Gemini Model',
          helpText: 'The model to use for dictionary generation (e.g., gemini-1.5-flash).',
          defaultValue: 'gemini-1.5-flash',
        },
  {
    type: 'string',
    name: SETTINGS.LOCATION,
    label: 'Moderation Region',
    helpText: 'Country or region for localized slang and fraud keyword detection.',
    defaultValue: 'Global',
  },
  {
    type: 'string',
    name: SETTINGS.BLOCKLIST_SOURCE_URL,
    label: 'Blocklist Source URL',
    helpText: 'Remote URL to fetch localized blocklists (JSON format).',
    defaultValue: 'https://raw.githubusercontent.com/example/jijiguard-data/main/blocklists.json',
  },
  {
    type: 'number',
    name: SETTINGS.MIN_TITLE_WORD_COUNT,
    label: 'Minimum Title Word Count',
    helpText: 'Minimum word count for post titles.',
    defaultValue: 4,
  },
  {
    type: 'number',
    name: SETTINGS.MIN_BODY_WORD_COUNT,
    label: 'Minimum Body Word Count',
    helpText: 'Minimum word count for post bodies.',
    defaultValue: 10,
  },
  {
    type: 'number',
    name: SETTINGS.AUTO_REMOVAL_THRESHOLD,
    label: 'Auto-Removal Threshold (%)',
    helpText: 'Percentage threshold (0-100) above which posts are automatically removed.',
    defaultValue: 90,
  },
  {
    type: 'number',
    name: SETTINGS.REPORTING_THRESHOLD,
    label: 'Reporting Threshold (%)',
    helpText: 'Percentage threshold (0-100) above which posts are reported to moderators.',
    defaultValue: 75,
  },
]);

// Define the configuration form
Devvit.createForm(
  {
    fields: [
      {
        name: 'location',
        label: 'Moderation Region',
        type: 'string',
        required: true,
        defaultValue: 'Global',
        helpText: 'Specify your country (e.g., Kenya, Mexico).',
      },
      {
        name: 'aiProvider',
        label: 'AI Service Provider',
        type: 'select',
        options: [
          { label: 'Grok (xAI - Recommended)', value: 'xai' },
          { label: 'OpenAI (ChatGPT)', value: 'openai' },
          { label: 'Gemini (Google AI Studio)', value: 'gemini' },
        ],
        defaultValue: 'xai',
        helpText: 'Choose the engine for dictionary generation and AI scanning.',
      },
      {
        name: 'llmApiKey',
        label: 'Universal API Key',
        type: 'string',
        required: true,
        helpText: 'Your API Key for the chosen provider.',
      },
      {
        name: 'llmModel',
        label: 'AI Model Name',
        type: 'string',
        defaultValue: 'grok-2-latest',
        helpText: 'Grok: grok-2-latest | OpenAI: gpt-4o-mini | Gemini: gemini-1.5-flash',
      },
      {
        name: 'minTitleWordCount',
        label: 'Min Title Words',
        type: 'number',
        defaultValue: 4,
        helpText: 'Titles shorter than this will be removed.',
      },
      {
        name: 'minBodyWordCount',
        label: 'Min Body Words',
        type: 'number',
        defaultValue: 10,
        helpText: 'Post bodies shorter than this will be removed.',
      },
      {
        name: 'reportingThreshold',
        label: 'Flagging Threshold (%)',
        type: 'number',
        defaultValue: 50,
        helpText: 'Posts scoring 50-89% are reported and flaired for review. Recommended: 50%.',
      },
      {
        name: 'autoRemovalThreshold',
        label: 'Auto-Removal Threshold (%)',
        type: 'number',
        defaultValue: 90,
        helpText: 'Posts scoring 90% or higher are removed immediately. Recommended: 90%.',
      },
    ],
    title: 'JijiGuard: Global AI Moderation Setup',
    acceptLabel: 'Save and Activate Guard',
  },
  'configForm'
);

async function loadBlocklist(context: any): Promise<void> {
  const cachedLocation = await context.redis.get(LOCATION_CACHE_KEY);
  const location = cachedLocation ?? (await context.settings.get<string>(SETTINGS.LOCATION)) ?? 'Global';

  // Note: Dictionary generation is now handled via the /config-submit endpoint 
  // to leverage LLM capabilities during setup. 
  const cacheKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
  const exists = await context.redis.get(cacheKey);
  if (!exists) {
    console.warn(`[JijiGuard] No cached dictionary found for ${location}. Please run the Configure menu.`);
  }
}

// Add AppInstall trigger to initialize blocklist cache
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (event, context) => {
    console.log('JijiGuard installed. Initializing blocklist cache...');
    await loadBlocklist(context);
  },
});

// Add AppUpgrade trigger to refresh cache
Devvit.addTrigger({
  event: 'AppUpgrade',
  onEvent: async (event, context) => {
    console.log('JijiGuard upgraded. Refreshing blocklist cache...');
    await loadBlocklist(context);
  },
});

async function handleSubmission(event: any, context: any) {
  const post = event.post;
  if (!post) {
    console.log(`[JijiGuard] Event received but no 'post' object found. Event Type: ${event.type}`);
    return;
  }

  // 1. ABSOLUTE FIRST LINE LOGGING
  console.log(`====== [JijiGuard] INTERCEPTED EVENT: ${event.type} ======`);
  console.log(`[JijiGuard] Processing Post ID: ${post.id}`);

  // 2. Immediate UI Confirmation (Failsafe Debugging)
  try {
    const debugComment = await context.reddit.addComment({
      parentId: post.id,
      text: `🤖 [JijiGuard Debug] Intercepted ${event.type} successfully. Multi-tier validation initialized.`,
    });
    await debugComment.distinguish(true); 
  } catch (commentError) {
    console.error("[JijiGuard] Failed to add debug comment (check bot permissions):", commentError);
  }
  
  // 3. Robust Extraction of Content (Safe Fallbacks)
  const titleText = post.title || "";
  // Check multiple potential fields for body content
  const bodyText = (post as any).selftext || (post as any).body || post.url || "";
  
  console.log(`Title: ${titleText}`);
  console.log(`Body/URL: ${bodyText}`);

  // If there's absolutely no content to analyze, we can't do much
  if (!titleText && !bodyText) {
    console.log("[JijiGuard] No content found to analyze. Skipping.");
    return;
  }

  const contentToAnalyze = `${titleText} ${bodyText}`.toLowerCase();

  // 4. Local Bouncer: Enforce dual minWordCount (Title & Body)
  try {
    const redisMinTitle = await context.redis.get(SETTINGS.MIN_TITLE_WORD_COUNT);
    const redisMinBody = await context.redis.get(SETTINGS.MIN_BODY_WORD_COUNT);
    
    const minTitleWords = redisMinTitle ? parseInt(redisMinTitle) : (await context.settings.get<number>(SETTINGS.MIN_TITLE_WORD_COUNT)) ?? 4;
    const minBodyWords = redisMinBody ? parseInt(redisMinBody) : (await context.settings.get<number>(SETTINGS.MIN_BODY_WORD_COUNT)) ?? 10;
    
    const titleWords = titleText.trim().split(/\s+/).filter((w: string) => w.length > 0);
    const bodyWords = bodyText.trim().split(/\s+/).filter((w: string) => w.length > 0);
    
    const titleWordCount = titleWords.length;
    const bodyWordCount = bodyWords.length;

    console.log(`[JijiGuard] Bouncer Check - Title: ${titleWordCount}/${minTitleWords}, Body: ${bodyWordCount}/${minBodyWords}`);

    if (titleWordCount < minTitleWords) {
      console.log(`[JijiGuard] ACTION: Removing post ${post.id}. Title too short: ${titleWordCount} < ${minTitleWords}`);
      await context.reddit.remove(post.id, true);
      return; // STOP execution
    }

    if (bodyWordCount < minBodyWords) {
      console.log(`[JijiGuard] ACTION: Removing post ${post.id}. Body too short: ${bodyWordCount} < ${minBodyWords}`);
      await context.reddit.remove(post.id, true);
      return; // STOP execution
    }
  } catch (bouncerError) {
    console.error("[JijiGuard] Local Bouncer execution failed. Continuing to AI tiers...", bouncerError);
  }

  // Tier 1: Client-Side (Local) Pre-Screening
  let isSuspicious = false;
  try {
    const cachedLocation = await context.redis.get(LOCATION_CACHE_KEY);
    const location = cachedLocation ?? (await context.settings.get<string>(SETTINGS.LOCATION)) ?? 'Global';
    const blocklistKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
    const cachedBlocklist = await context.redis.get(blocklistKey);
    
    if (cachedBlocklist) {
      const { keywords = [] } = JSON.parse(cachedBlocklist);
      const matchCount = keywords.filter((flag: string) => contentToAnalyze.includes(flag.toLowerCase())).length;
      
      if (matchCount >= 1) {
        isSuspicious = true;
        console.log(`[JijiGuard] Tier 1: Post flagged as suspicious. Match count: ${matchCount}`);
      }
    } else {
      console.warn(`[JijiGuard] Tier 1 skipped: No cached dictionary for ${location}.`);
      isSuspicious = true; // Default to Tier 2 if cache missing
    }
  } catch (tier1Error) {
    console.error("[JijiGuard] Tier 1 processing failed:", tier1Error);
    isSuspicious = true; 
  }

  if (!isSuspicious) {
    console.log(`Tier 1: Post passed pre-screening for post ${post.id}.`);
    return;
  }

  // Tier 2: Rigorous AI Scanning
  try {
    const redisProvider = await context.redis.get(SETTINGS.AI_PROVIDER);
    const aiProvider = redisProvider ?? (await context.settings.get<string>(SETTINGS.AI_PROVIDER)) ?? 'xai';
    
    const redisApiKey = await context.redis.get(SETTINGS.LLM_API_KEY);
    const apiKey = redisApiKey ?? await context.settings.get<string>(SETTINGS.LLM_API_KEY);
    
    const rawModel = (await context.redis.get(SETTINGS.LLM_MODEL)) ?? (await context.settings.get<string>(SETTINGS.LLM_MODEL)) ?? (aiProvider === 'xai' ? 'grok-2-latest' : 'gpt-4o-mini');
    const llmModel = rawModel.trim();

    if (!apiKey) {
      console.warn(`[JijiGuard] Tier 2 skipped: ${aiProvider} API Key is missing. Please configure the app.`);
      return;
    }

    const activeApiKey = apiKey.trim();
    const contentHash = await generateHash(contentToAnalyze);
    const cacheKey = `${CACHE_PREFIX}${contentHash}`;
    
    const cachedResult = await context.redis.get(cacheKey);
    if (cachedResult) {
      console.log(`[JijiGuard] Cache hit for post ${post.id}. Skipping ${aiProvider} call.`);
      const result = JSON.parse(cachedResult);
      await applyModeration(post, result, context);
      return;
    }

    console.log(`[JijiGuard] Calling ${aiProvider} (${llmModel}) for Tier 2 analysis on post ${post.id}...`);

    const prompt = `Analyze the following subreddit post content for AI-generated "slop" or malicious scam patterns. 
    Content: "${contentToAnalyze}"
    
    Return ONLY a JSON object with the following fields:
    - "slopScore": A number from 0-100 indicating the probability the text was written by an AI.
    - "maliceScore": A number from 0-100 indicating the probability the text is a scam or fraudulent.
    - "reason": A short one-sentence explanation for the scores.
    
    Example: {"slopScore": 85, "maliceScore": 10, "reason": "Text uses structural markers common in LLM-generated content like 'rich tapestry'."}`;

    let endpoint = '';
    let body: any = {};
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (aiProvider === 'gemini') {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llmModel)}:generateContent?key=${encodeURIComponent(activeApiKey)}`;
      body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      };
    } else {
      // xAI and OpenAI are compatible
      endpoint = aiProvider === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${activeApiKey}`;
      body = {
        model: llmModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${aiProvider} Tier 2 failed with status: ${response.status}`);
    }

    const resultData = await response.json();
    let aiContent = '';
    
    if (aiProvider === 'gemini') {
      aiContent = resultData.candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      aiContent = resultData.choices?.[0]?.message?.content;
    }
    
    if (aiContent) {
      const aiResult = JSON.parse(aiContent);
      console.log(`[JijiGuard] ${aiProvider} Results for ${post.id}: Slop=${aiResult.slopScore}%, Malice=${aiResult.maliceScore}%, Reason=${aiResult.reason}`);
      
      await applyModeration(post, aiResult, context);
      await context.redis.set(cacheKey, aiContent, { expiration: new Date(Date.now() + CACHE_EXPIRATION_MS) });
    }
  } catch (tier2Error) {
    console.error("[JijiGuard] Tier 2 Rigorous AI Scanning failed:", tier2Error);
  }
}

// Separate registrations for maximum compatibility
Devvit.addTrigger({ event: 'PostSubmit', onEvent: handleSubmission });
Devvit.addTrigger({ event: 'LinkSubmit', onEvent: handleSubmission });
Devvit.addTrigger({ event: 'PostCreate', onEvent: handleSubmission });

async function applyModeration(post: any, aiResult: any, context: any) {
  const { slopScore = 0, maliceScore = 0 } = aiResult;
  const maxSuspicionScore = Math.max(slopScore, maliceScore);

  const redisAutoRemoval = await context.redis.get(SETTINGS.AUTO_REMOVAL_THRESHOLD);
  const redisReporting = await context.redis.get(SETTINGS.REPORTING_THRESHOLD);
  
  const autoRemovalThreshold = redisAutoRemoval ? parseInt(redisAutoRemoval) : (await context.settings.get<number>(SETTINGS.AUTO_REMOVAL_THRESHOLD)) ?? 90;
  const reportingThreshold = redisReporting ? parseInt(redisReporting) : (await context.settings.get<number>(SETTINGS.REPORTING_THRESHOLD)) ?? 50;

  if (maxSuspicionScore >= autoRemovalThreshold) {
    console.log(`[JijiGuard] ACTION: Removing post ${post.id} (Score: ${maxSuspicionScore}% >= ${autoRemovalThreshold}%)`);
    await context.reddit.remove(post.id, true);
  } else if (maxSuspicionScore >= reportingThreshold) {
    console.log(`[JijiGuard] ACTION: Reporting and Flairing post ${post.id} (Score: ${maxSuspicionScore}% >= ${reportingThreshold}%)`);
    const fullPost = await context.reddit.getPostById(post.id);
    // Report to mods
    await context.reddit.report(fullPost, { reason: `JijiGuard AI Flagged (${maxSuspicionScore}%): ${aiResult.reason}` });
    // Add a visual flair
    try {
      await context.reddit.setPostFlair({
        subredditName: context.subredditName,
        postId: post.id,
        text: `⚠️ AI Suspicion: ${maxSuspicionScore}%`,
        backgroundColor: '#FF4500',
        textColor: 'white'
      });
    } catch (flairError) {
      console.warn("[JijiGuard] Could not set post flair:", flairError);
    }
  } else {
    console.log(`[JijiGuard] ACTION: No action taken for post ${post.id} (Score: ${maxSuspicionScore}% < ${reportingThreshold}%)`);
  }
}

export default Devvit;
