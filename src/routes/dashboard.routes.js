'use strict';

/**
 * dashboard.routes.js — Routes for aggregate dashboard metrics.
 *
 * Mounting point: /api/dashboard  (set in app.js)
 */

const { Router }      = require('express');
const postsController = require('../controllers/posts.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

router.use(requireAuth);

// GET /api/dashboard/stats
router.get('/stats', postsController.getDashboardStats);

module.exports = router;
