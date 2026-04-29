'use strict';

/**
 * scheduler.js — Cron-based scheduled post dispatcher.
 *
 * Runs every minute. Finds posts with:
 *   status = SCHEDULED AND publish_at <= NOW() AND deleted_at IS NULL
 *
 * For each due post:
 *  1. Atomically updates the Post to QUEUED (prevents double-dispatch if the
 *     cron overlaps or the process is restarted mid-tick).
 *  2. Fetches the associated platform_posts (PENDING rows only).
 *  3. Calls publish.service.enqueuePublishJobs(), which:
 *       a. Marks platform_posts as QUEUED.
 *       b. Adds one BullMQ job per platform.
 *
 * Idempotency guarantees:
 *  - Post.status is set to QUEUED *before* jobs are enqueued. A second cron
 *    tick will not find this post (it is no longer SCHEDULED).
 *  - If the process crashes after the Post update but before enqueuing,
 *    the post is left in QUEUED with PENDING platform_posts. A future
 *    recovery mechanism (or a manual admin action) can re-enqueue.
 *    This is documented as a known trade-off — full two-phase commit would
 *    require a transactional outbox pattern.
 *
 * Server restart safety:
 *  - The scheduler re-starts cleanly — node-cron fires immediately on the
 *    next minute boundary. Any post that slipped through during a restart
 *    window will be caught on the next tick because its publish_at is still
 *    in the past and its status is still SCHEDULED.
 */

const cron   = require('node-cron');
const prisma = require('../config/prisma');
const { enqueuePublishJobs } = require('../services/publish.service');
const logger = require('../utils/logger').child('Scheduler');

// ── Cron tick handler ─────────────────────────────────────────────────────────

/**
 * Finds all scheduled posts that are due and dispatches them to the queue.
 * Errors are caught per-post so a single failure doesn't abort the whole batch.
 */
async function dispatchDuePosts() {
  const now = new Date();

  // Find all posts that are due.
  const duePosts = await prisma.post.findMany({
    where: {
      status:    'SCHEDULED',
      publishAt: { lte: now },
      deletedAt: null,
    },
    include: {
      platformPosts: {
        where: { status: 'PENDING' },
        select: { id: true, platform: true },
      },
    },
  });

  if (duePosts.length === 0) return;

  logger.info('Found due posts', { count: duePosts.length, tickAt: now.toISOString() });

  for (const post of duePosts) {
    try {
      await dispatchPost(post);
    } catch (err) {
      // Isolate per-post failures — one bad post must not block others.
      logger.error('Failed to dispatch post', { postId: post.id, err });
    }
  }
}

/**
 * Dispatches a single due post to the publishing queue.
 *
 * @param {object} post  Prisma Post row with platformPosts included.
 */
async function dispatchPost(post) {
  if (post.platformPosts.length === 0) {
    // No PENDING platform rows — nothing to publish.
    // Still advance the post status so it doesn't remain SCHEDULED forever.
    logger.warn('Post has no PENDING platform_posts — marking QUEUED and skipping', { postId: post.id });
    await prisma.post.update({
      where: { id: post.id },
      data:  { status: 'QUEUED' },
    });
    return;
  }

  // ── Atomic status advance — MUST happen before enqueuing ──────────────────
  // Using updateMany with a status filter as an optimistic lock:
  // if another process already advanced this post, count = 0 and we bail.
  const { count } = await prisma.post.updateMany({
    where: { id: post.id, status: 'SCHEDULED' },
    data:  { status: 'QUEUED' },
  });

  if (count === 0) {
    // Another scheduler instance already claimed this post.
    logger.info('Post already claimed by another instance — skipping', { postId: post.id });
    return;
  }

  // ── Enqueue one job per platform ──────────────────────────────────────────
  const jobs = await enqueuePublishJobs(post.id, post.userId, post.platformPosts);

  logger.info('Enqueued publish jobs', {
    postId: post.id,
    jobCount: jobs.length,
    platforms: post.platformPosts.map((pp) => pp.platform),
  });
}

// ── Cron setup ────────────────────────────────────────────────────────────────

let schedulerTask = null;

/**
 * Starts the cron scheduler.
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 */
function startScheduler() {
  if (schedulerTask) return;

  // '* * * * *' = every minute at :00 seconds
  schedulerTask = cron.schedule('* * * * *', () => {
    dispatchDuePosts().catch((err) => {
      // Top-level guard — must never let an unhandled rejection crash the process.
      logger.error('Unhandled error in dispatchDuePosts', { err });
    });
  });

  logger.info('Started — polling for scheduled posts every minute');
}

/**
 * Stops the cron scheduler gracefully.
 * Called from server.js on SIGTERM / SIGINT.
 */
function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Stopped');
  }
}

module.exports = { startScheduler, stopScheduler };
