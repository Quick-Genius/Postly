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

  console.log(`[Scheduler] ${now.toISOString()} — ${duePosts.length} post(s) due`);

  for (const post of duePosts) {
    try {
      await dispatchPost(post);
    } catch (err) {
      // Isolate per-post failures — one bad post must not block others.
      console.error(`[Scheduler] Failed to dispatch postId=${post.id}:`, err.message);
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
    console.warn(`[Scheduler] postId=${post.id} has no PENDING platform_posts — marking QUEUED and skipping.`);
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
    console.log(`[Scheduler] postId=${post.id} already claimed — skipping.`);
    return;
  }

  // ── Enqueue one job per platform ──────────────────────────────────────────
  const jobs = await enqueuePublishJobs(post.id, post.userId, post.platformPosts);

  console.log(
    `[Scheduler] postId=${post.id} — enqueued ${jobs.length} job(s): ` +
    post.platformPosts.map((pp) => pp.platform).join(', '),
  );
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
      console.error('[Scheduler] Unhandled error in dispatchDuePosts:', err.message);
    });
  });

  console.log('[Scheduler] Started — polling for scheduled posts every minute.');
}

/**
 * Stops the cron scheduler gracefully.
 * Called from server.js on SIGTERM / SIGINT.
 */
function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('[Scheduler] Stopped.');
  }
}

module.exports = { startScheduler, stopScheduler };
