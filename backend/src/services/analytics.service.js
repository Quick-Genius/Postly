'use strict';

const prisma = require('../config/prisma');
const logger = require('../utils/logger').child('AnalyticsService');

/**
 * AnalyticsService — SaaS BI & Trend Discovery Engine
 * 
 * Responsibilities:
 *  - Log user activity events (login, connect, post)
 *  - Update per-user metrics (counters, last active)
 *  - Aggregate system-wide KPIs
 *  - Analyze post content for trend discovery
 */

const EVENT_TYPES = {
  LOGIN: 'LOGIN',
  SIGNUP: 'SIGNUP',
  CONNECT_PLATFORM: 'CONNECT_PLATFORM',
  DISCONNECT_PLATFORM: 'DISCONNECT_PLATFORM',
  GENERATE_POST: 'GENERATE_POST',
  PUBLISH_POST: 'PUBLISHED_POST',
  FAILED_POST: 'FAILED_POST',
};

// ── Event Logging ─────────────────────────────────────────────────────────────

async function logEvent(userId, eventType, metadata = {}) {
  try {
    await prisma.userActivityLog.create({
      data: {
        userId,
        eventType,
        metadata,
      },
    });

    if (userId) {
      await updateUserMetrics(userId, eventType);
    }
  } catch (err) {
    logger.error('Failed to log event', { err, userId, eventType });
  }
}

async function updateUserMetrics(userId, eventType) {
  const data = { lastActive: new Date() };

  if (eventType === EVENT_TYPES.GENERATE_POST) {
    data.postsCreated = { increment: 1 };
  } else if (eventType === EVENT_TYPES.PUBLISH_POST) {
    data.postsPublished = { increment: 1 };
  } else if (eventType === EVENT_TYPES.FAILED_POST) {
    data.failedPosts = { increment: 1 };
  }

  await prisma.userMetric.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      postsCreated: eventType === EVENT_TYPES.GENERATE_POST ? 1 : 0,
      postsPublished: eventType === EVENT_TYPES.PUBLISH_POST ? 1 : 0,
      failedPosts: eventType === EVENT_TYPES.FAILED_POST ? 1 : 0,
    },
  });
}

// ── Trend Discovery ───────────────────────────────────────────────────────────

/**
 * Analyzes topics from posts to update trend scores.
 * Trend Score = (usage_count * growth_rate)
 */
async function processTrendingTopics() {
  logger.info('Processing trending topics...');
  
  // 1. Get usage in last 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentPosts = await prisma.post.findMany({
    where: { createdAt: { gte: yesterday } },
    select: { topics: true },
  });

  const topicCounts = {};
  recentPosts.forEach(p => {
    p.topics.forEach(t => {
      topicCounts[t] = (topicCounts[t] || 0) + 1;
    });
  });

  // 2. Update TopicAnalytic table
  for (const [topic, count] of Object.entries(topicCounts)) {
    const existing = await prisma.topicAnalytic.findUnique({ where: { topic } });
    const growth = existing ? (count - existing.usageCount) / (existing.usageCount || 1) : 1;
    
    await prisma.topicAnalytic.upsert({
      where: { topic },
      update: {
        usageCount: { increment: count },
        growthRate: growth,
        trendScore: count * (1 + growth),
        recordedAt: new Date(),
      },
      create: {
        topic,
        usageCount: count,
        growthRate: growth,
        trendScore: count * (1 + growth),
      },
    });
  }
}

// ── System Snapshots ──────────────────────────────────────────────────────────

async function takeSystemSnapshot() {
  const [users, posts, published, failed] = await Promise.all([
    prisma.user.count(),
    prisma.post.count(),
    prisma.platformPost.count({ where: { status: 'PUBLISHED' } }),
    prisma.platformPost.count({ where: { status: 'FAILED' } }),
  ]);

  const metrics = [
    { name: 'TOTAL_USERS', value: users },
    { name: 'TOTAL_POSTS', value: posts },
    { name: 'PUBLISHED_POSTS', value: published },
    { name: 'FAILED_POSTS', value: failed },
    { name: 'SUCCESS_RATE', value: posts > 0 ? (published / posts) * 100 : 0 },
  ];

  await prisma.systemMetric.createMany({
    data: metrics.map(m => ({
      metricName: m.name,
      metricValue: m.value,
    })),
  });
}

module.exports = {
  EVENT_TYPES,
  logEvent,
  processTrendingTopics,
  takeSystemSnapshot,
};
