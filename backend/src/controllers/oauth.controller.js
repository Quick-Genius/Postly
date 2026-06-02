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
 *  - /connect endpoints   → optionalAuth (token from header OR ?token= query param);
 *    controller enforces 401 when req.userId is missing. Responds with
 *    res.redirect(auth_url) so a browser hitting the URL is sent straight
 *    to the provider's authorization page.
 *  - /callback endpoints  → NO auth (browser redirect from provider,
 *    no JWT present; userId is recovered from Redis-stored state)
 */

const oauthService = require('../services/oauth.service');

// ── Twitter ───────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/twitter/connect
 * Requires authenticated user. Token can be passed via Authorization header or ?token= query param.
 * Redirects the browser to Twitter's authorization page.
 */
async function twitterConnect(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { auth_url } = await oauthService.twitterConnect(req.userId);
    return res.redirect(auth_url);
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
 * Requires authenticated user. Token can be passed via Authorization header or ?token= query param.
 * Redirects the browser to LinkedIn's authorization page.
 */
async function linkedinConnect(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { auth_url } = await oauthService.linkedinConnect(req.userId);
    return res.redirect(auth_url);
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

// ── Facebook ──────────────────────────────────────────────────────────────────

async function facebookConnect(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    // Placeholder — would call oauthService.facebookConnect
    return res.status(501).json({ error: 'Facebook OAuth not implemented' });
  } catch (err) {
    next(err);
  }
}

async function facebookCallback(req, res, next) {
  try {
    return res.status(501).json({ error: 'Facebook OAuth not implemented' });
  } catch (err) {
    next(err);
  }
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function instagramConnect(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    // Placeholder
    return res.status(501).json({ error: 'Instagram OAuth not implemented' });
  } catch (err) {
    next(err);
  }
}

async function instagramCallback(req, res, next) {
  try {
    return res.status(501).json({ error: 'Instagram OAuth not implemented' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  twitterConnect,
  twitterCallback,
  linkedinConnect,
  linkedinCallback,
  facebookConnect,
  facebookCallback,
  instagramConnect,
  instagramCallback,
};