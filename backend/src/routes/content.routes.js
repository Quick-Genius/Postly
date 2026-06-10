'use strict';

/**
 * content.routes.js — Routes for the AI content generation API.
 *
 * POST /api/content/generate
 *   Requires a valid JWT Bearer token.
 *   Delegates to content.controller.generateContent.
 */

const { Router }           = require('express');
const contentController    = require('../controllers/content.controller');
const { requireAuth }      = require('../middlewares/auth.middleware');
const { rateLimit }        = require('../middlewares/rateLimit.middleware');

const router = Router();

// All content endpoints require an authenticated user so we can resolve
// their personal AI keys (with .env as a fallback).
router.use(requireAuth);

// AI generation calls are far more expensive (cost + latency) than typical
// API requests, so they get their own — still generous — limit on top of
// the global per-user/IP limit applied in app.js.
const aiGenerateLimit = rateLimit({
  max: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
  prefix: 'ai-generate',
});

// ── Content generation ────────────────────────────────────────────────────────
router.post('/generate', aiGenerateLimit, contentController.generateContent);

module.exports = router;
