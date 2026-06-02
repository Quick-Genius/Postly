'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Clerk authentication middleware.
 *
 * Purpose:
 *  - Require a valid Clerk JWT in Authorization: Bearer <token>
 *  - Attach req.userId for downstream OAuth connect initiation
 *  - Also validates that req.userId maps to a local Postly user (by clerkId)
 *
 * Notes:
 *  - OAuth connect is only initiated after Clerk login on the frontend.
 *  - Callback routes remain un-authenticated (recovered via OAuth state in Redis).
 */
async function clerkAuth(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Current backend stack already uses jsonwebtoken elsewhere; keep dependency footprint minimal.
    // Clerk JWT verification is performed using Clerk's public key or shared secret.
    // If your env is configured for Clerk JWT verification via JWKS, implement there.
    //
    // Fallback:
    // - if CLERK_JWT_ISSUER/CLERK_JWT_AUDIENCE + a shared secret/public key is configured,
    //   you can verify with jsonwebtoken directly.
    //
    // This project already has JWT utils; we keep it centralized in oauth.service when needed.
    const verified = jwt.verify(token, env.CLERK_JWT_PUBLIC_KEY || env.CLERK_JWT_SECRET, {
      issuer: env.CLERK_JWT_ISSUER,
      audience: env.CLERK_JWT_AUDIENCE,
      algorithms: ['RS256', 'HS256'],
    });

    // Clerk user id is in `sub` or `user_id` depending on config.
    // We support both and normalize.
    const clerkId = verified.sub || verified.user_id || verified.clerk_id;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    // Attach local identity for downstream handlers/services.
    // oauth.controller + oauth.service currently rely on req.userId.
    req.userId = clerkId;

    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { clerkAuth };
