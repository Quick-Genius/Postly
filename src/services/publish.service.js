'use strict';

/**
 * publish.service.js — Publishing orchestration layer.
 *
 * Responsibilities:
 *  - Enqueue one BullMQ job per platform per post (never one job per post).
 *  - Mark platform_posts as QUEUED before enqueuing (idempotency guard).
 *  - Provide helpers to aggregate post-level status from platform_posts rows.
 *
 * What this module does NOT do:
 *  - It does not call platform APIs — that lives in worker.js.
 *  - It does not validate business rules — that's the calling service's job.
 *  - It does not expose HTTP endpoints — that belongs in controllers.
 *
 * Retry / backoff config lives here (not in queue.js) so it can be adjusted
 * per job type without touching shared infrastructure.
 */

const prisma = require('../config/prisma');
const { publishingQueue } = require('../queue/queue');

// ── Retry strategy — matches ARCHITECTURE.md §5 exactly ──────────────────────

const JOB_ATTEMPTS = 3;

/**
 * BullMQ built-in exponential backoff.
 * delay(attempt) = initialDelay * (multiplier ^ (attempt - 1))
 *   attempt 1 → 1 000 ms  (1s)
 *   attempt 2 → 5 000 ms  (5s)
 *   attempt 3 → 25 000 ms (25s)
 */
const BACKOFF_CONFIG = {
  type: 'exponential',
  delay: 1_000,   // initial delay in ms
};

// ── Job options factory ───────────────────────────────────────────────────────

/**
 * Returns the BullMQ job options for a platform publishing job.
 * Delay is used for scheduled posts — 0 means "process immediately".
 *
 * @param {number} delayMs  Milliseconds from now before the job becomes active.
 * @returns {import('bullmq').JobsOptions}
 */
function jobOptions(delayMs = 0) {
  return {
    attempts: JOB_ATTEMPTS,
    backoff: BACKOFF_CONFIG,
    delay: delayMs,
    // Keep failed jobs for manual inspection; completed jobs auto-expire.
    removeOnComplete: { age: 86_400 },     // 24 h
    removeOnFail:     { age: 604_800 },    // 7 days
  };
}

// ── Core enqueue logic ────────────────────────────────────────────────────────

/**
 * Enqueues one BullMQ job per platform for the given platform_posts rows.
 *
 * Marks each platform_post as QUEUED *before* enqueuing to prevent
 * double-scheduling if the cron fires again before the job starts.
 *
 * @param {string}  postId
 * @param {string}  userId
 * @param {Array<{ id: string, platform: string }>} platformPosts
 * @param {number}  [delayMs=0]  For scheduled posts: ms until job should fire.
 * @returns {Promise<import('bullmq').Job[]>}
 */
async function enqueuePublishJobs(postId, userId, platformPosts, delayMs = 0) {
  // Step 1: Mark all platform_posts as QUEUED atomically before enqueuing.
  // This means if the process crashes after DB write but before enqueue,
  // the cron will *not* re-enqueue (status is already QUEUED, not PENDING).
  // The worker startup handles stale QUEUED jobs (see worker.js).
  await prisma.platformPost.updateMany({
    where: {
      id:     { in: platformPosts.map((pp) => pp.id) },
      status: 'PENDING',  // only update rows that haven't been touched
    },
    data: { status: 'QUEUED' },
  });

  // Step 2: Enqueue one job per platform.
  const jobs = await Promise.all(
    platformPosts.map((pp) =>
      publishingQueue.add(
        `publish:${pp.platform.toLowerCase()}`,  // human-readable job name
        {
          platformPostId: pp.id,
          postId,
          platform: pp.platform,
          userId,
        },
        jobOptions(delayMs),
      ),
    ),
  );

  return jobs;
}

// ── Post-level status aggregation ────────────────────────────────────────────

/**
 * Derives the parent post's aggregate status from its platform_posts.
 * Called by the worker after each job completes or fails.
 *
 * Logic (mirrors ARCHITECTURE.md §9):
 *  - All PUBLISHED         → PUBLISHED
 *  - All FAILED            → FAILED
 *  - Mix of PUBLISHED+FAILED → PARTIAL
 *  - Any still in progress → no change (returns null)
 *
 * @param {string} postId
 * @returns {Promise<'PUBLISHED'|'PARTIAL'|'FAILED'|null>}
 */
async function aggregatePostStatus(postId) {
  const rows = await prisma.platformPost.findMany({
    where:  { postId },
    select: { status: true },
  });

  const statuses = rows.map((r) => r.status);

  // If any row is still in-flight, don't update the parent yet.
  const inFlight = new Set(['PENDING', 'QUEUED', 'PUBLISHING']);
  if (statuses.some((s) => inFlight.has(s))) return null;

  const allPublished = statuses.every((s) => s === 'PUBLISHED');
  const allFailed    = statuses.every((s) => s === 'FAILED');

  if (allPublished) return 'PUBLISHED';
  if (allFailed)    return 'FAILED';
  return 'PARTIAL';
}

/**
 * Updates the parent post's status based on all platform outcomes.
 * Safe to call after every worker job — no-ops when jobs are still running.
 *
 * @param {string} postId
 */
async function syncPostStatus(postId) {
  const aggregated = await aggregatePostStatus(postId);
  if (!aggregated) return;  // still in-flight — nothing to do

  await prisma.post.update({
    where: { id: postId },
    data:  { status: aggregated },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = { enqueuePublishJobs, syncPostStatus };
