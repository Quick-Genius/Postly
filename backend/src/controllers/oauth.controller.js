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
const env = require('../config/env');

// ── Twitter ───────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/twitter/connect
 * Requires authenticated user. Token can be passed via Authorization header or ?token= query param.
 * Redirects the browser to Twitter's authorization page.
 */
async function twitterConnect(req, res, next) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { from } = req.query;
    const { auth_url } = await oauthService.twitterConnect(req.userId, from);
    return res.redirect(auth_url);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/oauth/twitter/callback
 * Unauthenticated — called by Twitter after user authorizes.
 * Query params: code, state
 *
 * On completion (success or failure) the browser is redirected back to the
 * frontend's /platforms page so the user sees the result in the app, rather
 * than a bare JSON response on the API domain.
 */
async function twitterCallback(req, res, next) {
  const { code, state } = req.query;

  try {
    if (!code)  return res.redirect(`${env.frontendUrl}/platforms?error=missing_code`);
    if (!state) return res.redirect(`${env.frontendUrl}/platforms?error=missing_state`);

    const result = await oauthService.twitterCallback(code, state);

    try {
      const { createPublisher } = require('../lib/ipcChannel');
      if (!global.ipcPublisher) {
        global.ipcPublisher = createPublisher(process.env.REDIS_URL || 'redis://localhost:6379');
      }
      await global.ipcPublisher.publish({
        type: 'account_linked',
        userId: result.userId,
        payload: { platform: 'TWITTER' },
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      // IPC failure must never break the OAuth success response
      console.warn('IPC publish failed for account_linked', e);
    }

    const params = new URLSearchParams({ connected: 'twitter' });
    if (result.from) params.set('from', result.from);
    return res.redirect(`${env.frontendUrl}/platforms?${params}`);
  } catch (err) {
    return res.redirect(`${env.frontendUrl}/platforms?error=${encodeURIComponent(err.message)}`);
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
    const { from } = req.query;
    const { auth_url } = await oauthService.linkedinConnect(req.userId, from);
    return res.redirect(auth_url);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/oauth/linkedin/callback
 * Unauthenticated — called by LinkedIn after user authorizes.
 * Query params: code, state
 *
 * On completion (success or failure) the browser is redirected back to the
 * frontend's /platforms page so the user sees the result in the app, rather
 * than a bare JSON response on the API domain.
 */
async function linkedinCallback(req, res, next) {
  const { code, state } = req.query;

  try {
    if (!code)  return res.redirect(`${env.frontendUrl}/platforms?error=missing_code`);
    if (!state) return res.redirect(`${env.frontendUrl}/platforms?error=missing_state`);

    const result = await oauthService.linkedinCallback(code, state);

    try {
      const { createPublisher } = require('../lib/ipcChannel');
      if (!global.ipcPublisher) {
        global.ipcPublisher = createPublisher(process.env.REDIS_URL || 'redis://localhost:6379');
      }
      await global.ipcPublisher.publish({
        type: 'account_linked',
        userId: result.userId,
        payload: { platform: 'LINKEDIN' },
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.warn('IPC publish failed for account_linked', e);
    }

    const params = new URLSearchParams({ connected: 'linkedin' });
    if (result.from) params.set('from', result.from);
    return res.redirect(`${env.frontendUrl}/platforms?${params}`);
  } catch (err) {
    return res.redirect(`${env.frontendUrl}/platforms?error=${encodeURIComponent(err.message)}`);
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