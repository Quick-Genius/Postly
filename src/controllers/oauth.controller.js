'use strict';

/**
 * OAuth controller — thin HTTP adapter.
 *
 * Responsibilities:
 *  - Validate HTTP input (presence of `code`, `state`)
 *  - Delegate all business logic to oauth.service.js
 *  - Return consistent responses
 *
 * Route protection:
 *  - /connect endpoints   → requireAuth (user must be logged in to initiate)
 *  - /callback endpoints  → NO requireAuth (browser redirect from provider,
 *    no JWT present; userId is recovered from Redis-stored state)
 */

const oauthService = require('../services/oauth.service');

// ── Twitter ───────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/twitter/connect
 * Protected. Returns the Twitter authorization URL.
 */
async function twitterConnect(req, res, next) {
  try {
    const result = await oauthService.twitterConnect(req.userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/oauth/twitter/callback
 * Unauthenticated — called by Twitter after user authorizes.
 * Query params: code, state
 */
async function twitterCallback(req, res, next) {
  try {
    const { code, state } = req.query;

    if (!code)  return res.status(400).json({ error: 'Missing authorization code' });
    if (!state) return res.status(400).json({ error: 'Missing state parameter' });

    const result = await oauthService.twitterCallback(code, state);
    res.status(200).json({ message: 'Twitter account connected successfully', ...result });
  } catch (err) {
    next(err);
  }
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/linkedin/connect
 * Protected. Returns the LinkedIn authorization URL.
 */
async function linkedinConnect(req, res, next) {
  try {
    const result = await oauthService.linkedinConnect(req.userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/oauth/linkedin/callback
 * Unauthenticated — called by LinkedIn after user authorizes.
 * Query params: code, state
 */
async function linkedinCallback(req, res, next) {
  try {
    const { code, state } = req.query;

    if (!code)  return res.status(400).json({ error: 'Missing authorization code' });
    if (!state) return res.status(400).json({ error: 'Missing state parameter' });

    const result = await oauthService.linkedinCallback(code, state);
    res.status(200).json({ message: 'LinkedIn account connected successfully', ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  twitterConnect,
  twitterCallback,
  linkedinConnect,
  linkedinCallback,
};