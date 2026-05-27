import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { forms as honoForms } from './routes/forms';
import { menu as honoMenu } from './routes/menu';
import { triggers as honoTriggers } from './routes/triggers';

// JijiGuard Core Dependencies
import { Devvit, SettingScope } from '@devvit/public-api';
import { generateHash } from '../shared/utils.js';
import { 
  SETTINGS, 
  CACHE_PREFIX, 
  CACHE_EXPIRATION_MS, 
  BLOCKLIST_CACHE_PREFIX, 
  LOCATION_CACHE_KEY
} from '../shared/constants.js';

console.log("====== [JijiGuard] STARTING MONOLITHIC INITIALIZATION ======");

// 1. CONFIGURE PLUGINS
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

// 2. REGISTER SETTINGS
Devvit.addSettings([
  { type: 'string', name: SETTINGS.AI_PROVIDER, label: 'AI Provider', defaultValue: 'xai' },
  { type: 'string', name: SETTINGS.LLM_API_KEY, label: 'Universal API Key', isSecret: true, scope: SettingScope.App },
  { type: 'string', name: SETTINGS.LLM_MODEL, label: 'AI Model', defaultValue: 'grok-2-latest' },
  { type: 'string', name: SETTINGS.LOCATION, label: 'Moderation Region', defaultValue: 'Global' },
  { type: 'number', name: SETTINGS.MIN_TITLE_WORD_COUNT, label: 'Min Title Words', defaultValue: 4 },
  { type: 'number', name: SETTINGS.MIN_BODY_WORD_COUNT, label: 'Min Body Words', defaultValue: 10 },
  { type: 'number', name: SETTINGS.AUTO_REMOVAL_THRESHOLD, label: 'Auto-Removal Threshold', defaultValue: 90 },
  { type: 'number', name: SETTINGS.REPORTING_THRESHOLD, label: 'Reporting Threshold', defaultValue: 50 },
]);

// 3. UTILITY LOGIC
async function loadBlocklist(context: any): Promise<void> {
  const cachedLocation = await context.redis.get(LOCATION_CACHE_KEY);
  const location = cachedLocation ?? (await context.settings.get(SETTINGS.LOCATION)) ?? 'Global';
  const cacheKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
  const exists = await context.redis.get(cacheKey);
  if (!exists) {
    console.warn(`[JijiGuard] No cached dictionary found for ${location}. Please use the Configure menu.`);
  } else {
    console.log(`[JijiGuard] Dictionary verified for ${location}.`);
  }
}

async function applyModeration(post: any, aiResult: any, context: any) {
  const { slopScore = 0, maliceScore = 0 } = aiResult;
  const maxSuspicionScore = Math.max(slopScore, maliceScore);

  const redisAutoRemoval = await context.redis.get(SETTINGS.AUTO_REMOVAL_THRESHOLD);
  const redisReporting = await context.redis.get(SETTINGS.REPORTING_THRESHOLD);
  
  const autoRemovalThreshold = redisAutoRemoval ? parseInt(redisAutoRemoval) : (await context.settings.get(SETTINGS.AUTO_REMOVAL_THRESHOLD)) ?? 90;
  const reportingThreshold = redisReporting ? parseInt(redisReporting) : (await context.settings.get(SETTINGS.REPORTING_THRESHOLD)) ?? 50;

  if (maxSuspicionScore >= autoRemovalThreshold) {
    console.log(`[JijiGuard] ACTION: Removing post ${post.id} (Score: ${maxSuspicionScore}%)`);
    await context.reddit.remove(post.id, true);
  } else if (maxSuspicionScore >= reportingThreshold) {
    console.log(`[JijiGuard] ACTION: Reporting/Flairing post ${post.id} (Score: ${maxSuspicionScore}%)`);
    const fullPost = await context.reddit.getPostById(post.id);
    
    // Truncate reason to 100 characters for Reddit API compliance
    let reportReason = `JijiGuard AI Flagged (${maxSuspicionScore}%): ${aiResult.reason || 'Suspicious content'}`;
    if (reportReason.length > 100) {
      reportReason = reportReason.substring(0, 97) + '...';
    }
    
    await context.reddit.report(fullPost, { reason: reportReason });
    try {
      await context.reddit.setPostFlair({
        subredditName: context.subredditName,
        postId: post.id,
        text: `⚠️ AI Suspicion: ${maxSuspicionScore}%`,
        backgroundColor: '#FF4500',
        textColor: 'white'
      });
    } catch (e) {}
  } else {
    console.log(`[JijiGuard] ACTION: Passed AI Scan (Score: ${maxSuspicionScore}%)`);
  }
}

// 5. EVENT HANDLER
async function handleSubmission(event: any, context: any) {
  const post = event.post;
  if (!post) {
    console.log(`[JijiGuard] Intercepted ${event.type} but post object is missing.`);
    return;
  }

  console.log(`====== [JijiGuard] INTERCEPTED: ${event.type} (${post.id}) ======`);

  // Immediate Heartbeat Comment
  try {
    const debugComment = await context.reddit.addComment({
      parentId: post.id,
      text: `🤖 [JijiGuard Debug] Intercepted ${event.type} successfully. Running bouncer & AI tiers...`,
    });
    await debugComment.distinguish(true);
  } catch (e) {
    console.error("[JijiGuard] Heartbeat comment failed:", e);
  }

  const titleText = post.title || "";
  const bodyText = (post as any).selftext || (post as any).body || post.url || "";
  const contentToAnalyze = `${titleText} ${bodyText}`.toLowerCase();

  // 1. BOUNCER (Low Effort)
  try {
    const redisMinTitle = await context.redis.get(SETTINGS.MIN_TITLE_WORD_COUNT);
    const redisMinBody = await context.redis.get(SETTINGS.MIN_BODY_WORD_COUNT);
    const minTitleWords = redisMinTitle ? parseInt(redisMinTitle) : (await context.settings.get(SETTINGS.MIN_TITLE_WORD_COUNT)) ?? 4;
    const minBodyWords = redisMinBody ? parseInt(redisMinBody) : (await context.settings.get(SETTINGS.MIN_BODY_WORD_COUNT)) ?? 10;
    
    const tWC = titleText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
    const bWC = bodyText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;

    console.log(`[JijiGuard] Bouncer Check: Title ${tWC}/${minTitleWords}, Body ${bWC}/${minBodyWords}`);

    if (tWC < minTitleWords || bWC < minBodyWords) {
      console.log(`[JijiGuard] ACTION: Removing post ${post.id} (Reason: Low Effort)`);
      await context.reddit.remove(post.id, true);
      return;
    }
  } catch (e) {
    console.error("[JijiGuard] Bouncer logic failed:", e);
  }

  // 2. TIER 1: DICTIONARY
  let isSuspicious = false;
  try {
    const cachedLocation = await context.redis.get(LOCATION_CACHE_KEY);
    const location = cachedLocation ?? (await context.settings.get(SETTINGS.LOCATION)) ?? 'Global';
    const blocklistKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
    const cachedBlocklist = await context.redis.get(blocklistKey);
    
    if (cachedBlocklist) {
      const { keywords = [] } = JSON.parse(cachedBlocklist);
      const matches = keywords.filter((flag: string) => contentToAnalyze.includes(flag.toLowerCase()));
      
      if (matches.length >= 1) {
        isSuspicious = true;
        console.log(`[JijiGuard] Tier 1 Flag: Keyword match (${matches[0]}). Sending to AI Scan.`);
      }
    } else {
      console.warn(`[JijiGuard] Tier 1 Skip: No dictionary for ${location}. Defaulting to suspicious.`);
      isSuspicious = true;
    }
  } catch (e) {
    console.error("[JijiGuard] Tier 1 failed:", e);
    isSuspicious = true;
  }

  if (!isSuspicious) {
    console.log(`[JijiGuard] Tier 1 Pass: Post looks clean.`);
    return;
  }

  // 3. TIER 2: AI SCAN
  try {
    const redisProvider = await context.redis.get(SETTINGS.AI_PROVIDER);
    const aiProvider = redisProvider ?? (await context.settings.get(SETTINGS.AI_PROVIDER)) ?? 'xai';
    const redisApiKey = await context.redis.get(SETTINGS.LLM_API_KEY);
    const apiKey = (redisApiKey ?? await context.settings.get(SETTINGS.LLM_API_KEY))?.trim();
    const rawModel = (await context.redis.get(SETTINGS.LLM_MODEL)) ?? (await context.settings.get(SETTINGS.LLM_MODEL)) ?? (aiProvider === 'xai' ? 'grok-2-latest' : 'gpt-4o-mini');
    const llmModel = rawModel.trim();

    if (!apiKey) {
      console.warn(`[JijiGuard] Tier 2 Skip: Missing API Key for ${aiProvider}.`);
      return;
    }

    const contentHash = await generateHash(contentToAnalyze);
    const cacheKey = `${CACHE_PREFIX}${contentHash}`;
    const cachedAI = await context.redis.get(cacheKey);

    if (cachedAI) {
      console.log(`[JijiGuard] Tier 2 Cache Hit: Applying previous result.`);
      await applyModeration(post, JSON.parse(cachedAI), context);
      return;
    }

    console.log(`[JijiGuard] Tier 2 Call: Requesting analysis from ${aiProvider} (${llmModel})...`);

    const prompt = `Analyze the following subreddit post content for AI-generated "slop" or malicious scam patterns. 
    Content: "${contentToAnalyze}"
    Return ONLY a JSON object: {"slopScore": 0-100, "maliceScore": 0-100, "reason": "Short explanation"}`;

    let endpoint = '';
    let body: any = {};
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (aiProvider === 'gemini') {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(llmModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } };
    } else {
      endpoint = aiProvider === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = { model: llmModel, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } };
    }

    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`AI API Error: ${response.status}`);

    const result = await response.json();
    let aiJson = '';
    if (aiProvider === 'gemini') aiJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
    else aiJson = result.choices?.[0]?.message?.content;

    if (aiJson) {
      const aiResult = JSON.parse(aiJson);
      console.log(`[JijiGuard] AI Report: Slop ${aiResult.slopScore}%, Malice ${aiResult.maliceScore}%`);
      await applyModeration(post, aiResult, context);
      await context.redis.set(cacheKey, aiJson, { expiration: new Date(Date.now() + CACHE_EXPIRATION_MS) });
    }
  } catch (e) {
    console.error("[JijiGuard] Tier 2 failed:", e);
  }
}

// These functions are kept for reference; trigger execution is handled by
// the Devvit Web internal trigger endpoints (see `devvit.json` + `src/server/core/guard.ts`).
void loadBlocklist;
void handleSubmission;

// Triggers are handled via Devvit Web "internal trigger endpoints" (see `devvit.json`),
// so we intentionally do not register Devvit public-api triggers here.

// 7. INITIALIZE HONO SERVER
const app = new Hono();
const internal = new Hono();

internal.route('/menu', honoMenu);
internal.route('/form', honoForms);
internal.route('/triggers', honoTriggers);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
  hostname: '0.0.0.0',
});

export default Devvit;
