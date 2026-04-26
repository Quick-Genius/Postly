'use strict';

/**
 * OAuth routes
 *
 * Route protection strategy:
 *  ┌──────────────────────────────────┬───────────────┬────────────────────────────────────────────────┐
 *  │ Route                            │ Auth required │ Reason                                         │
 *  ├──────────────────────────────────┼───────────────┼────────────────────────────────────────────────┤
 *  │ GET /twitter/connect             │ YES           │ Must identify which user is initiating the flow │
 *  │ GET /linkedin/connect            │ YES           │ Same                                           │
 *  │ GET /twitter/callback            │ NO            │ Browser redirect from Twitter — no JWT present │
 *  │ GET /linkedin/callback           │ NO            │ Browser redirect from LinkedIn — no JWT present│
 *  └──────────────────────────────────┴───────────────┴────────────────────────────────────────────────┘
 *
 * The userId for callback routes is recovered from the Redis-stored state
 * that was created during the corresponding /connect call.
 */

const { Router } = require('express');
const oauthController = require('../controllers/oauth.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

// ── Initiate OAuth flow (requires authenticated user) ─────────────────────────
router.get('/twitter/connect',  requireAuth, oauthController.twitterConnect);
router.get('/linkedin/connect', requireAuth, oauthController.linkedinConnect);

// ── OAuth callbacks (NO requireAuth — browser redirect from provider) ─────────
router.get('/twitter/callback',  oauthController.twitterCallback);
router.get('/linkedin/callback', oauthController.linkedinCallback);

module.exports = router;