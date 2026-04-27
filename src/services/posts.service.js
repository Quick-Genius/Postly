'use strict';

/**
 * posts.service.js — Business logic for the Posts API.
 *
 * Handles: create, schedule, list, get, retry, soft-delete, restore,
 *          dashboard stats, and analytics caching.
 *
 * All queries on the Post model benefit from the Prisma soft-delete middleware
 * in config/prisma.js, which injects `deletedAt: null` into every read.
 * To intentionally reach deleted rows (restore, duplicate-delete guard), pass
 * `deletedAt: { not: null }` or omit the guard and let the 404 speak for itself.
 */

const prisma            = require('../config/prisma');
const { connectRedis }  = require('../config/redis');
const { enqueuePublishJobs } = require('./publish.service');

const ANALYTICS_CACHE_TTL = 300; // seconds (5 min)

const VALID_PLATFORMS  = new Set(['TWITTER', 'LINKEDIN', 'INSTAGRAM', 'FACEBOOK', 'THREADS']);
const VALID_POST_TYPES = new Set(['TEXT', 'IMAGE', 'VIDEO', 'CAROUSEL']);
const VALID_STATUSES   = new Set(['DRAFT', 'SCHEDULED', 'QUEUED', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELED']);

// ── Error factory ──────────────────────────────────────────────────────────────

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── Shared create logic (publish + schedule) ───────────────────────────────────

/**
 * Creates a Post with its PlatformPost children in a single Prisma transaction.
 * For immediate publish: publishAt = null, jobs enqueued right away.
 * For scheduled posts:   publishAt = future Date, cron scheduler dispatches later.
 *
 * @param {string}    userId
 * @param {object}    body
 * @param {Date|null} publishAt
 */
async function createPost(userId, body, publishAt) {
  const { idea, post_type = 'TEXT', tone, language, model_used, platforms } = body;

  if (!idea || typeof idea !== 'string' || !idea.trim()) {
    throw makeError('idea is required');
  }

  const postType = post_type.toUpperCase();
  if (!VALID_POST_TYPES.has(postType)) {
    throw makeError(`post_type must be one of: ${[...VALID_POST_TYPES].join(', ')}`);
  }

  if (
    !platforms ||
    typeof platforms !== 'object' ||
    Array.isArray(platforms) ||
    Object.keys(platforms).length === 0
  ) {
    throw makeError('platforms must be a non-empty object mapping platform name to { content }');
  }

  const platformEntries = Object.entries(platforms);
  for (const [platform, data] of platformEntries) {
    const p = platform.toUpperCase();
    if (!VALID_PLATFORMS.has(p)) throw makeError(`Unsupported platform: ${platform}`);
    if (!data?.content?.trim())  throw makeError(`content is required for platform: ${platform}`);
  }

  const isScheduled = publishAt !== null;

  const post = await prisma.post.create({
    data: {
      userId,
      idea:      idea.trim(),
      postType,
      tone:      tone       || null,
      language:  language   || null,
      modelUsed: model_used || null,
      publishAt: publishAt  || null,
      status:    isScheduled ? 'SCHEDULED' : 'QUEUED',
      platformPosts: {
        create: platformEntries.map(([platform, data]) => ({
          platform: platform.toUpperCase(),
          content:  data.content.trim(),
          status:   'PENDING',
        })),
      },
    },
    include: { platformPosts: true },
  });

  // Scheduled posts are dispatched by the cron scheduler (queue/scheduler.js).
  if (!isScheduled) {
    await enqueuePublishJobs(post.id, userId, post.platformPosts, 0);
  }

  return post;
}

// ── Publish ────────────────────────────────────────────────────────────────────

async function publishPost(userId, body) {
  return createPost(userId, body, null);
}

// ── Schedule ───────────────────────────────────────────────────────────────────

async function schedulePost(userId, body) {
  if (!body.publish_at) throw makeError('publish_at is required');

  const publishAt = new Date(body.publish_at);
  if (isNaN(publishAt.getTime())) throw makeError('publish_at must be a valid ISO 8601 date');
  if (publishAt <= new Date())    throw makeError('publish_at must be in the future');

  return createPost(userId, body, publishAt);
}

// ── List posts ─────────────────────────────────────────────────────────────────

async function listPosts(userId, query) {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip  = (page - 1) * limit;

  // Middleware adds `deletedAt: null` automatically — no need to repeat it.
  const where = { userId };

  if (query.status) {
    const s = query.status.toUpperCase();
    if (!VALID_STATUSES.has(s)) throw makeError(`Invalid status: ${query.status}`);
    where.status = s;
  }

  if (query.platform) {
    const p = query.platform.toUpperCase();
    if (!VALID_PLATFORMS.has(p)) throw makeError(`Invalid platform: ${query.platform}`);
    where.platformPosts = { some: { platform: p } };
  }

  if (query.date_from || query.date_to) {
    where.createdAt = {};
    if (query.date_from) {
      const from = new Date(query.date_from);
      if (isNaN(from.getTime())) throw makeError('date_from must be a valid ISO 8601 date');
      where.createdAt.gte = from;
    }
    if (query.date_to) {
      const to = new Date(query.date_to);
      if (isNaN(to.getTime())) throw makeError('date_to must be a valid ISO 8601 date');
      where.createdAt.lte = to;
    }
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      skip,
      take:     limit,
      orderBy:  { createdAt: 'desc' },
      include: {
        platformPosts: {
          select: { id: true, platform: true, status: true, publishedAt: true, attempts: true },
        },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return { data: posts, meta: { total, page, limit } };
}

// ── Get single post ────────────────────────────────────────────────────────────

async function getPost(userId, postId) {
  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    include: {
      platformPosts: {
        select: {
          id:           true,
          platform:     true,
          content:      true,
          status:       true,
          publishedAt:  true,
          errorMessage: true,
          attempts:     true,
        },
      },
    },
  });

  if (!post) throw makeError('Post not found', 404);
  return post;
}

// ── Retry failed platform jobs ─────────────────────────────────────────────────

async function retryPost(userId, postId) {
  const post = await prisma.post.findFirst({
    where:   { id: postId, userId },
    include: { platformPosts: { where: { status: 'FAILED' } } },
  });

  if (!post) throw makeError('Post not found', 404);
  if (post.platformPosts.length === 0) {
    throw makeError('No failed platform jobs to retry', 422);
  }

  const failedIds = post.platformPosts.map((pp) => pp.id);

  // Reset failed rows to PENDING (enqueuePublishJobs requires PENDING to mark QUEUED).
  await prisma.platformPost.updateMany({
    where: { id: { in: failedIds }, status: 'FAILED' },
    data:  { status: 'PENDING', errorMessage: null, attempts: 0 },
  });

  await prisma.post.update({
    where: { id: postId },
    data:  { status: 'QUEUED' },
  });

  await enqueuePublishJobs(postId, userId, post.platformPosts, 0);

  return { retried: failedIds.length };
}

// ── Soft delete ────────────────────────────────────────────────────────────────

async function softDeletePost(userId, postId) {
  // Middleware ensures this only finds non-deleted posts.
  const post = await prisma.post.findFirst({ where: { id: postId, userId } });
  if (!post) throw makeError('Post not found', 404);

  // Cancel any platform jobs that haven't started yet.
  await prisma.platformPost.updateMany({
    where: { postId, status: { in: ['PENDING', 'QUEUED'] } },
    data:  { status: 'FAILED', errorMessage: 'Post canceled' },
  });

  await prisma.post.update({
    where: { id: postId },
    data:  { deletedAt: new Date(), status: 'CANCELED' },
  });

  return { deleted: true };
}

// ── Restore ────────────────────────────────────────────────────────────────────

async function restorePost(userId, postId) {
  // Explicitly query deleted rows by overriding the middleware's default filter.
  const post = await prisma.post.findFirst({
    where: { id: postId, userId, deletedAt: { not: null } },
  });

  if (!post) throw makeError('No deleted post found with that ID', 404);

  // update targets by primary key; no middleware filter applies to write ops.
  const restored = await prisma.post.update({
    where: { id: postId },
    data:  { deletedAt: null, status: 'DRAFT' },
  });

  return restored;
}

// ── Dashboard stats ────────────────────────────────────────────────────────────

async function getDashboardStats(userId) {
  // Both queries below go through the soft-delete middleware (deletedAt: null added).
  const [total, byStatus] = await Promise.all([
    prisma.post.count({ where: { userId } }),
    prisma.post.groupBy({
      by:     ['status'],
      where:  { userId },
      _count: { _all: true },
    }),
  ]);

  // groupBy on PlatformPost doesn't support relation filters, so resolve post
  // IDs first (middleware-filtered), then group the child rows.
  const postIdRows = await prisma.post.findMany({
    where:  { userId },
    select: { id: true },
  });
  const postIds = postIdRows.map((r) => r.id);

  const platformRows = postIds.length > 0
    ? await prisma.platformPost.groupBy({
        by:     ['platform'],
        where:  { postId: { in: postIds } },
        _count: { _all: true },
      })
    : [];

  const statusMap = Object.fromEntries(
    byStatus.map((r) => [r.status.toLowerCase(), r._count._all])
  );

  const published  = statusMap.published ?? 0;
  const failed     = statusMap.failed    ?? 0;
  const partial    = statusMap.partial   ?? 0;
  const settled    = published + failed + partial;

  return {
    total_posts:        total,
    success_rate:       settled > 0 ? Math.round(((published + partial) / settled) * 100) : 0,
    posts_per_platform: Object.fromEntries(
      platformRows.map((r) => [r.platform.toLowerCase(), r._count._all])
    ),
    by_status: statusMap,
  };
}

// ── Post analytics (Redis-cached) ─────────────────────────────────────────────

async function getPostAnalytics(userId, postId) {
  // Ownership + existence check via the standard getPost (includes platformPosts).
  const post = await getPost(userId, postId);

  const cacheKey    = `analytics:${postId}`;
  const redisClient = await connectRedis();

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Mock engagement — replace with real platform API calls when available.
  const analytics = {
    post_id:      postId,
    generated_at: new Date().toISOString(),
    platforms: post.platformPosts.map((pp) => ({
      platform:   pp.platform.toLowerCase(),
      status:     pp.status.toLowerCase(),
      engagement: pp.status === 'PUBLISHED' ? mockEngagement() : null,
    })),
  };

  await redisClient.setEx(cacheKey, ANALYTICS_CACHE_TTL, JSON.stringify(analytics));

  return analytics;
}

function mockEngagement() {
  return {
    impressions: Math.floor(Math.random() * 10_000),
    likes:       Math.floor(Math.random() * 500),
    shares:      Math.floor(Math.random() * 100),
    comments:    Math.floor(Math.random() * 50),
    clicks:      Math.floor(Math.random() * 300),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  publishPost,
  schedulePost,
  listPosts,
  getPost,
  retryPost,
  softDeletePost,
  restorePost,
  getDashboardStats,
  getPostAnalytics,
};
