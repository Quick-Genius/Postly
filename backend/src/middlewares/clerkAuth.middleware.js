'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');
const { verifyAccessToken } = require('../utils/jwt');

/**
 * Clerk & Postly unified authentication middleware for OAuth routes.
 *
 * Purpose:
 *  - Support token extraction from Authorization header (Bearer) or ?token= query param
 *  - Support verification of Clerk JWT tokens (using CLERK_SECRET_KEY)
 *  - Support verification of Postly JWT tokens (using JWT_SECRET)
 *  - Attach database user UUID to req.userId for downstream services
 */
async function clerkAuth(req, res, next) {
  let token = null;
  try {
    const authHeader = req.get('authorization') || '';
    const [scheme, headerToken] = authHeader.split(' ');

    if (scheme === 'Bearer' && headerToken) {
      token = headerToken;
    } else {
      token = req.query?.token || null;
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    // Try verifying as Postly Access Token first
    try {
      const payload = verifyAccessToken(token);
      if (payload?.sub) {
        req.userId = payload.sub; // This is already the user's DB UUID
        return next();
      }
    } catch (e) {
      // Not a valid Postly token, fallback to verifying as a Clerk token
      console.log('Postly token verification failed:', e.message);
    }

    // Verify as Clerk JWT. Only the Clerk secret key is an acceptable
    // verification key here — the publishable key is a PUBLIC value, and
    // accepting it (or any other fallback) would let an attacker forge an
    // HS256 token "signed" with a key they already know.
    if (!env.clerkSecretKey) {
      return res.status(401).json({ error: 'Unauthorized: Clerk auth not configured' });
    }
    const verified = jwt.verify(token, env.clerkSecretKey, {
      algorithms: ['RS256', 'HS256'],
    });

    const clerkId = verified.sub || verified.user_id || verified.clerk_id;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Clerk claim' });
    }

    // Map Clerk user to local DB User UUID
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not synchronized' });
    }

    req.userId = user.id; // Map Clerk identity to DB UUID
    return next();
  } catch (err) {
    console.error('clerkAuth verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Token verification failed', details: err.message });
  }
}

module.exports = { clerkAuth };
