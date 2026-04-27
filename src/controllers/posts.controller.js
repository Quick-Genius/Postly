'use strict';

/**
 * posts.controller.js — HTTP boundary for the Posts API.
 *
 * Responsibilities:
 *  - Extract params / query / body from the request.
 *  - Delegate entirely to posts.service.
 *  - Return a consistent { data, meta } JSON envelope.
 *  - Forward all errors to the global handler via next().
 *
 * No business logic lives here.
 */

const postsService = require('../services/posts.service');

// ── POST /api/posts/publish ───────────────────────────────────────────────────

async function publishPost(req, res, next) {
  try {
    const post = await postsService.publishPost(req.userId, req.body);
    return res.status(201).json({ data: post });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/posts/schedule ──────────────────────────────────────────────────

async function schedulePost(req, res, next) {
  try {
    const post = await postsService.schedulePost(req.userId, req.body);
    return res.status(201).json({ data: post });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/posts ────────────────────────────────────────────────────────────

async function listPosts(req, res, next) {
  try {
    const result = await postsService.listPosts(req.userId, req.query);
    return res.status(200).json(result); // already { data, meta }
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/posts/:id ────────────────────────────────────────────────────────

async function getPost(req, res, next) {
  try {
    const post = await postsService.getPost(req.userId, req.params.id);
    return res.status(200).json({ data: post });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/posts/:id/retry ─────────────────────────────────────────────────

async function retryPost(req, res, next) {
  try {
    const result = await postsService.retryPost(req.userId, req.params.id);
    return res.status(200).json({ data: result });
  } catch (err) {
    return next(err);
  }
}

// ── DELETE /api/posts/:id ─────────────────────────────────────────────────────

async function softDeletePost(req, res, next) {
  try {
    const result = await postsService.softDeletePost(req.userId, req.params.id);
    return res.status(200).json({ data: result });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/posts/:id/restore ───────────────────────────────────────────────

async function restorePost(req, res, next) {
  try {
    const post = await postsService.restorePost(req.userId, req.params.id);
    return res.status(200).json({ data: post });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/dashboard/stats ──────────────────────────────────────────────────

async function getDashboardStats(req, res, next) {
  try {
    const stats = await postsService.getDashboardStats(req.userId);
    return res.status(200).json({ data: stats });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/posts/:id/analytics ──────────────────────────────────────────────

async function getPostAnalytics(req, res, next) {
  try {
    const analytics = await postsService.getPostAnalytics(req.userId, req.params.id);
    return res.status(200).json({ data: analytics });
  } catch (err) {
    return next(err);
  }
}

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
