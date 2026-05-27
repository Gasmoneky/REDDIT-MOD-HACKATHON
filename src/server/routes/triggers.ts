import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { handleSubmission, loadBlocklist } from '../core/guard';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    await loadBlocklist();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Loaded blocklist for ${context.subredditName} (trigger: onAppInstall)`,
      },
      200
    );
  } catch (error) {
    console.error(`Error handling onAppInstall: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to load blocklist',
      },
      400
    );
  }
});

triggers.post('/on-app-upgrade', async (c) => {
  try {
    await loadBlocklist();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Loaded blocklist for ${context.subredditName} (trigger: onAppUpgrade)`,
      },
      200
    );
  } catch (error) {
    console.error(`Error handling onAppUpgrade: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to load blocklist',
      },
      400
    );
  }
});

triggers.post('/on-post-submit', async (c) => {
  try {
    const input = await c.req.json<any>();
    await handleSubmission({ type: 'PostSubmit', post: input.post });
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Handled onPostSubmit for post ${input?.post?.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error handling onPostSubmit: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to handle onPostSubmit',
      },
      400
    );
  }
});

triggers.post('/on-post-create', async (c) => {
  try {
    const input = await c.req.json<any>();
    await handleSubmission({ type: 'PostCreate', post: input.post });
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Handled onPostCreate for post ${input?.post?.id}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error handling onPostCreate: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to handle onPostCreate',
      },
      400
    );
  }
});
