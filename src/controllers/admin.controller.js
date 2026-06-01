'use strict';

const prisma = require('../config/prisma');
const logger = require('../utils/logger').child('AdminController');

async function getGlobalStats(req, res, next) {
  try {
    const [userCount, postCount, platformPostStats, trendingTopics] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.platformPost.groupBy({
        by: ['platform'],
        _count: {
          id: true,
        },
      }),
      // Simplified trending topics: just get the most common tags in the last 1000 posts
      prisma.post.findMany({
        take: 1000,
        select: { topics: true },
        where: { topics: { isEmpty: false } }
      })
    ]);

    // Process trending topics
    const topicCounts = {};
    trendingTopics.forEach(post => {
      post.topics.forEach(topic => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });
    
    const sortedTopics = Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return res.status(200).json({
      users: userCount,
      posts: postCount,
      platforms: platformPostStats.map(s => ({
        platform: s.platform,
        count: s._count.id
      })),
      trendingTopics: sortedTopics
    });
  } catch (err) {
    logger.error('Failed to fetch global stats', { err });
    return next(err);
  }
}

async function getUserAnalytics(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        _count: {
          select: { posts: true }
        },
        posts: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            status: true,
            platformPosts: {
              select: { platform: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedUsers = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      postCount: u._count.posts,
      recentActivity: u.posts
    }));

    return res.status(200).json(formattedUsers);
  } catch (err) {
    logger.error('Failed to fetch user analytics', { err });
    return next(err);
  }
}

module.exports = { getGlobalStats, getUserAnalytics };
