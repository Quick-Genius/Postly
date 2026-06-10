'use strict';

const prisma = require('../config/prisma');
const logger = require('../utils/logger').child('AdminBI');

/**
 * Admin BI Controller — SaaS Analytics & Metrics
 */

async function getBIOverview(req, res, next) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const monthStart = new Date(todayStart);
    monthStart.setMonth(monthStart.getMonth() - 1);

    const [
      totalUsers,
      activeToday,
      newToday,
      newWeek,
      newMonth,
      connectedAccounts,
      postsGenerated,
      postsPublished,
      postsFailed,
      waUsers,
      tgUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.userActivityLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: todayStart } },
      }).then(res => res.length),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.socialAccount.count(),
      prisma.post.count(),
      prisma.platformPost.count({ where: { status: 'PUBLISHED' } }),
      prisma.platformPost.count({ where: { status: 'FAILED' } }),
      prisma.whatsappConnection.count(),
      prisma.telegramConnection.count(),
    ]);

    const successRate = postsGenerated > 0 ? (postsPublished / postsGenerated) * 100 : 0;

    return res.status(200).json({
      overview: {
        totalUsers,
        activeUsersToday: activeToday,
        newUsers: { today: newToday, week: newWeek, month: newMonth },
        totalConnectedAccounts: connectedAccounts,
        posts: { generated: postsGenerated, published: postsPublished, failed: postsFailed, successRate },
        botUsers: { whatsapp: waUsers, telegram: tgUsers }
      }
    });
  } catch (err) {
    logger.error('Failed to fetch BI overview', { err });
    return next(err);
  }
}

async function getUserBI(req, res, next) {
  try {
    const { page = 1, limit = 20, search = '', role, platform } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (role) where.role = role;
    if (platform) {
      where.socialAccounts = { some: { platform: platform.toUpperCase() } };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          userMetric: true,
          socialAccounts: { select: { platform: true } },
          _count: { select: { posts: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return res.status(200).json({
      data: users.map(u => ({
        ...u,
        mostUsedPlatform: u.socialAccounts[0]?.platform || 'None',
        metrics: u.userMetric || { postsCreated: 0, postsPublished: 0, failedPosts: 0, lastActive: u.createdAt }
      })),
      meta: { total, page, limit }
    });
  } catch (err) {
    logger.error('Failed to fetch User BI', { err });
    return next(err);
  }
}

async function getPlatformBI(req, res, next) {
  try {
    const stats = await prisma.platformPost.groupBy({
      by: ['platform', 'status'],
      _count: { id: true },
    });

    const formatted = {};
    stats.forEach(s => {
      if (!formatted[s.platform]) {
        formatted[s.platform] = { connected: 0, published: 0, failed: 0 };
      }
      if (s.status === 'PUBLISHED') formatted[s.platform].published = s._count.id;
      if (s.status === 'FAILED') formatted[s.platform].failed = s._count.id;
    });

    // Add connection counts
    const connections = await prisma.socialAccount.groupBy({
      by: ['platform'],
      _count: { id: true }
    });
    connections.forEach(c => {
      if (formatted[c.platform]) formatted[c.platform].connected = c._count.id;
    });

    return res.status(200).json(formatted);
  } catch (err) {
    logger.error('Failed to fetch Platform BI', { err });
    return next(err);
  }
}

async function getTopicBI(req, res, next) {
  try {
    const [trending, analytics] = await Promise.all([
      prisma.topicAnalytic.findMany({
        orderBy: { trendScore: 'desc' },
        take: 10
      }),
      prisma.post.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: { topics: true, status: true }
      })
    ]);

    return res.status(200).json({
      trending,
      recentTopicActivity: analytics
    });
  } catch (err) {
    logger.error('Failed to fetch Topic BI', { err });
    return next(err);
  }
}

async function getGlobalStats(req, res, next) {
  try {
    const [usersCount, postsCount, platformStats, topics] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.platformPost.groupBy({
        by: ['platform'],
        _count: { id: true }
      }),
      prisma.topicAnalytic.findMany({
        take: 10,
        orderBy: { usageCount: 'desc' }
      })
    ]);

    const platforms = platformStats.map(p => ({
      platform: p.platform.toLowerCase(),
      count: p._count.id
    }));

    const trendingTopics = topics.map(t => ({
      name: t.topic,
      count: t.usageCount
    }));

    return res.status(200).json({
      users: usersCount,
      posts: postsCount,
      platforms,
      trendingTopics
    });
  } catch (err) {
    logger.error('Failed to get global stats', { err });
    return next(err);
  }
}

async function getUserAnalytics(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      include: {
        posts: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            platformPosts: {
              select: { platform: true }
            }
          }
        },
        _count: {
          select: { posts: true }
        }
      }
    });

    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      postCount: u._count.posts,
      recentActivity: u.posts.map(p => ({
        createdAt: p.createdAt,
        status: p.status,
        platformPosts: p.platformPosts
      }))
    }));

    return res.status(200).json(result);
  } catch (err) {
    logger.error('Failed to get user analytics', { err });
    return next(err);
  }
}

module.exports = {
  getBIOverview,
  getUserBI,
  getPlatformBI,
  getTopicBI,
  getGlobalStats,
  getUserAnalytics
};
