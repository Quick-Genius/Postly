'use strict';

/**
 * worker.js — BullMQ Worker for the Postly platform-publishing pipeline.
 *
 * Each job represents exactly ONE platform for ONE post.
 * Job payload: { platformPostId, postId, platform, userId }
 *
 * Worker flow per job:
 *  1. Fetch platform_post from DB — validate it exists and is not already published.
 *  2. Mark status → PUBLISHING (visible to observers, prevents double-run).
 *  3. Fetch the user's social account for this platform.
 *  4. Decrypt the access token (AES-256-GCM via encryption.js).
 *  5. Call the platform API (cleanly abstracted per platform).
 *  6. On success: status → PUBLISHED, set publishedAt.
 *  7. On failure: throw → BullMQ retries with exponential backoff.
 *     After all retries exhausted: status → FAILED, store error, increment attempts.
 *
 * Failure philosophy:
 *  - The worker processor NEVER catches errors silently — it always re-throws
 *    so BullMQ can apply its retry/backoff logic.
 *  - The `failed` event handler runs ONLY when all retries are exhausted —
 *    that is the single place we write the final FAILED status to the DB.
 *  - This means there is exactly one code path for "give up" and one for "retry".
 *
 * Server restart safety:
 *  - On startup, stale PUBLISHING rows (from a crashed worker) are reset to
 *    QUEUED so BullMQ can re-process them on the next job pickup.
 *  - QUEUED platform_posts whose BullMQ jobs may have been lost (e.g. after a
 *    Redis flush) are re-enqueued by the scheduler on its next run.
 */

const { Worker, UnrecoverableError } = require('bullmq');

const prisma              = require('../config/prisma');
const { decrypt }         = require('../utils/encryption');
const { syncPostStatus }  = require('../services/publish.service');
const { QUEUE_NAME, redisConnection } = require('./queue');
const logger              = require('../utils/logger').child('Worker');

// ── Platform API adapters ─────────────────────────────────────────────────────
// Each adapter receives { accessToken, content, platform } and throws on failure.
// Replace the mock implementations with real SDK calls per platform.

const platformAdapters = {
  async TWITTER({ accessToken, content }) {
    logger.info('Publishing to Twitter', { preview: content.slice(0, 60) });
    await new Promise((r) => setTimeout(r, 200));
    return { published_url: `https://twitter.com/i/web/status/${Date.now()}` };
  },

  async LINKEDIN({ accessToken, content }) {
    logger.info('Publishing to LinkedIn', { preview: content.slice(0, 60) });
    await new Promise((r) => setTimeout(r, 200));
    return { published_url: `https://www.linkedin.com/feed/update/urn:li:share:${Date.now()}` };
  },

  async INSTAGRAM({ accessToken, content }) {
    logger.info('Publishing to Instagram', { preview: content.slice(0, 60) });
    await new Promise((r) => setTimeout(r, 200));
    return { published_url: null };
  },

  async THREADS({ accessToken, content }) {
    logger.info('Publishing to Threads', { preview: content.slice(0, 60) });
    await new Promise((r) => setTimeout(r, 200));
    return { published_url: null };
  },

  async FACEBOOK({ accessToken, content }) {
    logger.info('Publishing to Facebook', { preview: content.slice(0, 60) });
    await new Promise((r) => setTimeout(r, 200));
    return { published_url: null };
  },
};

// ── Job processor ─────────────────────────────────────────────────────────────

/**
 * Core job processor. Called by BullMQ for every active job.
 * Must throw on failure — BullMQ uses the thrown error to trigger retries.
 *
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { platformPostId, postId, platform, userId } = job.data;
  const jobLog = logger.child('job', { jobId: job.id, postId, platform, attempt: job.attemptsMade + 1 });

  jobLog.info('Job started');

  // ── Step 1: Load platform_post ─────────────────────────────────────────────
  const platformPost = await prisma.platformPost.findUnique({
    where: { id: platformPostId },
  });

  if (!platformPost) {
    // DB record gone (e.g. post deleted). Discard — do not retry.
    jobLog.warn('platform_post not found — discarding job', { platformPostId });
    return;
  }

  // Guard: already published by a previous attempt that partially succeeded.
  if (platformPost.status === 'PUBLISHED') {
    jobLog.info('platform_post already PUBLISHED — skipping', { platformPostId });
    return;
  }

  // ── Step 2: Mark as PUBLISHING ────────────────────────────────────────────
  await prisma.platformPost.update({
    where: { id: platformPostId },
    data:  { status: 'PUBLISHING', attempts: { increment: 1 } },
  });

  // ── Step 3: Fetch social account ──────────────────────────────────────────
  const socialAccount = await prisma.socialAccount.findUnique({
    where: { userId_platform: { userId, platform } },
  });

  if (!socialAccount) {
    // Not a transient failure — no point retrying without the account.
    throw new UnrecoverableError(`No connected ${platform} account found for user ${userId}`);
  }

  // ── Step 4: Decrypt access token ──────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decrypt(socialAccount.accessTokenEnc);
  } catch (decryptErr) {
    throw new UnrecoverableError(`Token decryption failed for ${platform}: ${decryptErr.message}`);
  }

  // ── Step 5: Call platform API ─────────────────────────────────────────────
  const adapter = platformAdapters[platform];
  if (!adapter) {
    throw new UnrecoverableError(`No adapter registered for platform: ${platform}`);
  }

  const result = await adapter({ accessToken, content: platformPost.content, platform });

  // ── Step 6: Mark as PUBLISHED ─────────────────────────────────────────────
  await prisma.platformPost.update({
    where: { id: platformPostId },
    data: {
      status:      'PUBLISHED',
      publishedAt: new Date(),
      errorMessage: null,
    },
  });

  // Sync the parent post's aggregate status (PUBLISHED / PARTIAL / FAILED).
  await syncPostStatus(postId);

  jobLog.info('Job complete');
  return result;
}

// ── Worker instance ───────────────────────────────────────────────────────────

const worker = new Worker(QUEUE_NAME, processJob, {
  connection: redisConnection,
  concurrency: 5,  // process up to 5 jobs simultaneously across all platforms
});

// ── Event handlers ────────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  logger.info('Job succeeded', { jobId: job.id, name: job.name });
});

/**
 * Fires on every failed attempt. Only treat as terminal when retries are
 * exhausted OR the error is an UnrecoverableError (BullMQ stops retrying).
 */
worker.on('failed', async (job, err) => {
  if (!job) return;  // job may be undefined if it couldn't be fetched

  const { platformPostId, postId } = job.data;
  const errorMessage = err?.message ?? 'Unknown error';
  const maxAttempts = job.opts?.attempts ?? 1;
  const isUnrecoverable = err?.name === 'UnrecoverableError';
  const isTerminal = isUnrecoverable || job.attemptsMade >= maxAttempts;

  if (!isTerminal) {
    logger.warn('Job attempt failed — will retry', {
      jobId: job.id, attempt: job.attemptsMade, maxAttempts, error: errorMessage,
    });
    return;
  }

  logger.error('Job permanently failed', { jobId: job.id, err });

  try {
    await prisma.platformPost.update({
      where: { id: platformPostId },
      data: {
        status:       'FAILED',
        errorMessage: errorMessage.slice(0, 1000),  // guard against oversized messages
      },
    });

    await syncPostStatus(postId);
  } catch (dbErr) {
    // Never let a DB error crash the worker process.
    logger.error('Failed to write FAILED status to DB', { platformPostId, err: dbErr });
  }
});

worker.on('error', (err) => {
  // Worker-level errors (Redis disconnect, etc.) — log but never crash.
  logger.error('BullMQ worker error', { err });
});

// ── Startup: reset stale PUBLISHING rows ─────────────────────────────────────

/**
 * If the process crashed mid-job, platform_posts can be stuck in PUBLISHING.
 * Reset them to QUEUED so the scheduler (or a re-enqueue) can pick them up.
 * This runs once at worker startup, before any jobs are processed.
 */
async function resetStalePlatformPosts() {
  const { count } = await prisma.platformPost.updateMany({
    where:  { status: 'PUBLISHING' },
    data:   { status: 'QUEUED' },
  });
  if (count > 0) {
    logger.info('Reset stale PUBLISHING → QUEUED on startup', { count });
  }
}

resetStalePlatformPosts().catch((err) => {
  logger.error('Startup reset failed', { err });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

/**
 * Stops accepting new jobs and waits for active jobs to finish.
 * Called from server.js on SIGTERM / SIGINT.
 */
async function shutdownWorker() {
  logger.info('Shutting down — draining active jobs…');
  await worker.close();
  logger.info('Worker stopped');
}

module.exports = { worker, shutdownWorker };
