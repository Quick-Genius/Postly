'use strict';

/**
 * User routes — all require a valid JWT Bearer token.
 *
 * Profile
 *   GET  /api/user/profile          → getProfile
 *   PUT  /api/user/profile          → updateProfile
 *
 * Social accounts
 *   POST   /api/user/social-accounts       → addSocialAccount
 *   GET    /api/user/social-accounts       → getSocialAccounts
 *   DELETE /api/user/social-accounts/:id   → deleteSocialAccount
 *
 * AI keys
 *   GET /api/user/ai-keys   → returns presence mask (has_openai_key, has_anthropic_key)
 *   PUT /api/user/ai-keys   → upsert encrypted keys
 */

const { Router } = require('express');
const userController = require('../controllers/user.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

// All user routes require a valid JWT.
router.use(requireAuth);

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);

// ── Social accounts ───────────────────────────────────────────────────────────
router.post('/social-accounts',     userController.addSocialAccount);
router.get('/social-accounts',      userController.getSocialAccounts);
router.delete('/social-accounts/:id', userController.deleteSocialAccount);

// ── AI keys ───────────────────────────────────────────────────────────────────
router.get('/ai-keys', userController.getAiKeys);
router.put('/ai-keys', userController.upsertAiKeys);

module.exports = router;