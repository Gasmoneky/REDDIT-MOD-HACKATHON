import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';

export const menu = new Hono();

menu.post('/configure', async (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'configForm',
        form: {
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
                { label: 'Gemini (Google AI)', value: 'gemini' },
              ],
              defaultValue: ['xai'],
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
              defaultValue: 75,
              helpText: 'Posts scoring between 50% and 89% are reported but stay up.',
            },
            {
              name: 'autoRemovalThreshold',
              label: 'Auto-Removal Threshold (%)',
              type: 'number',
              defaultValue: 90,
              helpText: 'Posts scoring 90% or higher are automatically taken down.',
            },
          ],
          title: 'JijiGuard: Global AI Moderation Setup',
          acceptLabel: 'Save and Activate Guard',
        },
      },
    },
    200
  );
});

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});
