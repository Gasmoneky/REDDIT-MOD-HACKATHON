import { generateHash } from '../../shared/utils.js';
import { context, reddit, redis, settings } from '@devvit/web/server';
import {
  SETTINGS,
  CACHE_PREFIX,
  CACHE_EXPIRATION_MS,
  BLOCKLIST_CACHE_PREFIX,
  LOCATION_CACHE_KEY,
} from '../../shared/constants.js';

export const loadBlocklist = async (): Promise<void> => {
  const cachedLocation = await redis.get(LOCATION_CACHE_KEY);
  const location = cachedLocation ?? (await settings.get<string>(SETTINGS.LOCATION)) ?? 'Global';
  const cacheKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
  const exists = await redis.get(cacheKey);

  if (!exists) {
    console.warn(`[JijiGuard] No cached dictionary found for ${location}. Please use the Configure menu.`);
  } else {
    console.log(`[JijiGuard] Dictionary verified for ${location}.`);
  }
};

const applyModeration = async (post: any, aiResult: any) => {
  const { slopScore = 0, maliceScore = 0 } = aiResult ?? {};
  const maxSuspicionScore = Math.max(slopScore, maliceScore);

  const toInt = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
    return undefined;
  };

  const redisAutoRemoval = await redis.get(SETTINGS.AUTO_REMOVAL_THRESHOLD);
  const redisReporting = await redis.get(SETTINGS.REPORTING_THRESHOLD);

  const autoRemovalThreshold =
    toInt(redisAutoRemoval) ?? toInt(await settings.get(SETTINGS.AUTO_REMOVAL_THRESHOLD)) ?? 90;
  const reportingThreshold =
    toInt(redisReporting) ?? toInt(await settings.get(SETTINGS.REPORTING_THRESHOLD)) ?? 50;

  if (maxSuspicionScore >= autoRemovalThreshold) {
    console.log(`[JijiGuard] ACTION: Removing post ${post.id} (Score: ${maxSuspicionScore}%)`);
    // Devvit expects IDs like `t3_xxxxx`.
    await reddit.remove(post.id, true);
  } else if (maxSuspicionScore >= reportingThreshold) {
    console.log(`[JijiGuard] ACTION: Reporting/Flairing post ${post.id} (Score: ${maxSuspicionScore}%)`);
    const fullPost = await reddit.getPostById(post.id);
    
    // Truncate reason to 100 characters for Reddit API compliance
    let reportReason = `JijiGuard AI Flagged (${maxSuspicionScore}%): ${aiResult.reason || 'Suspicious content'}`;
    if (reportReason.length > 100) {
      reportReason = reportReason.substring(0, 97) + '...';
    }
    
    await reddit.report(fullPost, { reason: reportReason });

    // 1. Notify Mods via Modmail
    try {
      await reddit.sendPrivateMessageAsSubreddit({
        to: context.subredditName,
        subject: `[JijiGuard] AI Flag Alert (${maxSuspicionScore}%)`,
        text: `The following post was flagged by JijiGuard.\n\n**Suspicion Score:** ${maxSuspicionScore}%\n**AI Reason:** ${aiResult.reason}\n**Post Link:** https://reddit.com${fullPost.permalink}\n**Author:** u/${fullPost.authorName}`
      });
    } catch (modmailError) {
      console.warn("[JijiGuard] Could not send modmail notification:", modmailError);
    }

    // 2. Attach a private Mod Note to the user
    try {
      await reddit.addModNote({
        subreddit: context.subredditName,
        user: fullPost.authorName,
        note: `JijiGuard AI Suspicion (${maxSuspicionScore}%): ${aiResult.reason}`,
        label: 'SPAM'
      });
    } catch (noteError) {
      console.warn("[JijiGuard] Could not add mod note:", noteError);
    }

    try {
      await reddit.setPostFlair({
        subredditName: context.subredditName,
        postId: post.id,
        text: `⚠️ AI Suspicion: ${maxSuspicionScore}%`,
        backgroundColor: '#FF4500',
        textColor: 'white', 
      });
    } catch {
      // Flair failures shouldn't stop moderation.
    }
  } else {
    console.log(`[JijiGuard] ACTION: Passed AI Scan (Score: ${maxSuspicionScore}%)`);
  }
};

export const handleSubmission = async (event: any) => {
  const post = event.post;
  if (!post) {
    console.log(`[JijiGuard] Intercepted ${event.type} but post object is missing.`);
    return;
  }

  // 0. COOLDOWN CHECK (to prevent double-processing and 429s)
  const cooldownKey = `jijiguard_cooldown_${post.id}`;
  const onCooldown = await redis.get(cooldownKey);
  if (onCooldown) {
    console.log(`[JijiGuard] Skip: Post ${post.id} recently processed. Cooldown active.`);
    return;
  }
  // Extend cooldown to 30 seconds for better rate limit protection
  await redis.set(cooldownKey, 'active', { expiration: new Date(Date.now() + 30000) });

  console.log(`====== [JijiGuard] INTERCEPTED: ${event.type} (${post.id}) ======`);

  // Immediate Heartbeat Comment (helps confirm the trigger fired)
  try {
    const debugComment = await reddit.submitComment({
      id: post.id,
      text: `🤖 [JijiGuard Debug] Intercepted ${event.type} successfully. Running bouncer & AI tiers...`,
    });
    await debugComment.distinguish(true);
  } catch (e) {
    console.error('[JijiGuard] Heartbeat comment failed:', e);
  }

  const titleText = post.title || '';
  const bodyText = post.selftext || post.body || post.url || '';
  const contentToAnalyze = `${titleText} ${bodyText}`.toLowerCase();

  // 1. BOUNCER (Low Effort)
  try {
    const redisMinTitle = await redis.get(SETTINGS.MIN_TITLE_WORD_COUNT);
    const redisMinBody = await redis.get(SETTINGS.MIN_BODY_WORD_COUNT);

    const minTitleWords = redisMinTitle
      ? parseInt(redisMinTitle)
      : (await settings.get(SETTINGS.MIN_TITLE_WORD_COUNT)) ?? 4;
    const minBodyWords = redisMinBody
      ? parseInt(redisMinBody)
      : (await settings.get(SETTINGS.MIN_BODY_WORD_COUNT)) ?? 10;

    const tWC = titleText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
    const bWC = bodyText.trim().split(/\s+/).filter((w: string) => w.length > 0).length;

    console.log(`[JijiGuard] Bouncer Check: Title ${tWC}/${minTitleWords}, Body ${bWC}/${minBodyWords}`);

    if (tWC < minTitleWords || bWC < minBodyWords) {
      console.log(`[JijiGuard] ACTION: Removing post ${post.id} (Reason: Low Effort)`);
      await reddit.remove(post.id, true);
      return;
    }
  } catch (e) {
    console.error('[JijiGuard] Bouncer logic failed:', e);
  }

  // 2. TIER 1: DICTIONARY
  let isSuspicious = false;
  try {
    const cachedLocation = await redis.get(LOCATION_CACHE_KEY);
    const location = cachedLocation ?? (await settings.get(SETTINGS.LOCATION)) ?? 'Global';
    const blocklistKey = `${BLOCKLIST_CACHE_PREFIX}${location}`;
    const cachedBlocklist = await redis.get(blocklistKey);

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
    console.error('[JijiGuard] Tier 1 failed:', e);
    isSuspicious = true;
  }

  if (!isSuspicious) {
    console.log('[JijiGuard] Tier 1 Pass: Post looks clean.');
    return;
  }

  // 3. TIER 2: AI SCAN
  try {
    const redisProvider = await redis.get(SETTINGS.AI_PROVIDER);
    const aiProvider = redisProvider ?? (await settings.get(SETTINGS.AI_PROVIDER)) ?? 'xai';
    const redisApiKey = await redis.get(SETTINGS.LLM_API_KEY);
    const apiKey = (redisApiKey ?? (await settings.get(SETTINGS.LLM_API_KEY)))?.trim();
    const rawModel =
      (await redis.get(SETTINGS.LLM_MODEL)) ??
      (await settings.get(SETTINGS.LLM_MODEL)) ??
      (aiProvider === 'xai' ? 'grok-2-latest' : 'gpt-4o-mini');
    const llmModel = rawModel.trim();

    if (!apiKey) {
      console.warn(`[JijiGuard] Tier 2 Skip: Missing API Key for ${aiProvider}.`);
      return;
    }

    const contentHash = await generateHash(contentToAnalyze);
    const cacheKey = `${CACHE_PREFIX}${contentHash}`;
    const cachedAI = await redis.get(cacheKey);

    if (cachedAI) {
      console.log('[JijiGuard] Tier 2 Cache Hit: Applying previous result.');
      await applyModeration(post, JSON.parse(cachedAI));
      return;
    }

    console.log(`[JijiGuard] Tier 2 Call: Requesting analysis from ${aiProvider} (${llmModel})...`);

    const prompt = `Perform a high-level content moderation analysis on the following post.
    
    CONTENT: "${contentToAnalyze}"

    INSTRUCTIONS:
    1. If the content is NOT in English, mentally translate/convert it into its direct English semantic equivalent.
    2. Analyze the (translated) text for structural AI hallmarks and "slop" patterns (e.g., use of phrases like "delving deep", "rich tapestry", "testament to", "shining beacon", or overly formal/robotic transitions).
    3. Determine the probability that this post was generated by an AI or is a localized scam.

    Return ONLY a JSON object: 
    {
      "slopScore": 0-100, 
      "maliceScore": 0-100, 
      "reason": "Explain in one short sentence, mentioning if detection was via English translation (e.g., 'Translated structure matches AI slop pattern: rich tapestry')."
    }`;

    let endpoint = '';
    let body: any = {};
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (aiProvider === 'gemini') {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        llmModel,
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;
      body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json' },
      };
    } else {
      endpoint = aiProvider === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: llmModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      };
    }

    let response;
    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      if (response.status === 429 && retries < maxRetries) {
        const waitTime = (retries + 1) * 2000;
        console.warn(`[JijiGuard] Rate limited (429). Retrying in ${waitTime}ms... (Attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
        continue;
      }
      break;
    }

    if (!response || !response.ok) throw new Error(`AI API Error: ${response?.status || 'Unknown'}`);

    const result = await response.json();
    let aiJson = '';
    if (aiProvider === 'gemini') aiJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
    else aiJson = result.choices?.[0]?.message?.content;

    if (aiJson) {
      const aiResult = JSON.parse(aiJson);
      console.log(`[JijiGuard] AI Report: Slop ${aiResult.slopScore}%, Malice ${aiResult.maliceScore}%`);
      await applyModeration(post, aiResult);
      await redis.set(cacheKey, aiJson, { expiration: new Date(Date.now() + CACHE_EXPIRATION_MS) });
    }
  } catch (e) {
    console.error('[JijiGuard] Tier 2 failed:', e);
  }
};

