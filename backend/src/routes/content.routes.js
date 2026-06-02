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

const router = Router();

// All content endpoints require an authenticated user so we can resolve
// their personal AI keys (with .env as a fallback).
router.use(requireAuth);

// ── Content generation ────────────────────────────────────────────────────────
router.post('/generate', contentController.generateContent);

module.exports = router;
