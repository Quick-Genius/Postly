'use strict';

/**
 * posts.routes.js — Routes for the Posts API.
 *
 * All routes require a valid JWT Bearer token (requireAuth).
 * Ownership enforcement is handled inside posts.service, not here.
 *
 * Mounting point: /api/posts  (set in app.js)
 */

const { Router }       = require('express');
const postsController  = require('../controllers/posts.controller');
const { requireAuth }  = require('../middlewares/auth.middleware');

const router = Router();

router.use(requireAuth);

// ── Publish / schedule ────────────────────────────────────────────────────────
// Must be declared before /:id so Express doesn't treat "publish" as an ID.
router.post('/publish',  postsController.publishPost);
router.post('/schedule', postsController.schedulePost);

// ── Collection ────────────────────────────────────────────────────────────────
router.get('/', postsController.listPosts);

// ── Single post ───────────────────────────────────────────────────────────────
router.get('/:id',              postsController.getPost);
router.delete('/:id',           postsController.softDeletePost);

// ── Sub-resource actions ──────────────────────────────────────────────────────
router.post('/:id/retry',       postsController.retryPost);
router.post('/:id/restore',     postsController.restorePost);
router.get('/:id/analytics',    postsController.getPostAnalytics);

module.exports = router;
