'use strict';

/**
 * OAuth service — Twitter (OAuth 2.0 + PKCE) and LinkedIn (OAuth 2.0).
 *
 * Flow for each provider:
 *  1. *Connect* — authenticated user triggers the flow:
 *     - Generate cryptographic `state` (CSRF protection)
 *     - For Twitter: also generate PKCE `code_verifier` + `code_challenge`
 *     - Store { userId, [codeVerifier] } in Redis under the state key (TTL 10 min)
 *     - Return the provider's authorization URL to the client
 *
 *  2. *Callback* — provider redirects back with `code` + `state`:
 *     - Look up state in Redis → retrieve userId (+ codeVerifier for Twitter)
 *     - Delete the state key immediately (one-time use, prevents replay)
 *     - Exchange authorization code for access_token + refresh_token
 *     - Fetch the user's handle from the provider's user-info endpoint
 *     - Encrypt both tokens and upsert into social_accounts
 *
 * Security notes:
 *  - `state` is a 128-bit random hex string — prevents CSRF.
 *  - PKCE (S256) is used for Twitter to prevent authorization code interception.
 *  - Tokens are encrypted with AES-256-GCM before being written to the DB.
 *  - Tokens are never logged.
 *  - State keys are deleted before the token exchange so they cannot be reused.
 *  - Callback routes are intentionally *unauthenticated* (no JWT) because the
 *    OAuth provider redirects the browser directly; userId is recovered from
 *    the Redis state established during the connect step.
 */

const crypto = require('crypto');
const { redis, connectRedis } = require('../config/redis');
const prisma  = require('../config/prisma');
const { encrypt } = require('../utils/encryption');
const env = require('../config/env');

const STATE_TTL_SECONDS = 600; // 10 minutes — more than enough for user to complete OAuth

// ── Internal helpers ──────────────────────────────────────────────────────────

function createError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** 128-bit random hex string for OAuth state (CSRF token). */
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/** 256-bit random base64url string used as the PKCE code_verifier. */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256(verifier) in base64url — the PKCE code_challenge. */
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Encrypts tokens and upserts a social_accounts record.
 * Called by both twitterCallback and linkedinCallback.
 *
 * @param {string}      userId
 * @param {'TWITTER'|'LINKEDIN'} platform
 * @param {string}      accessToken
 * @param {string|null} refreshToken
 * @param {string}      handle
 */
async function storeSocialAccount(userId, platform, accessToken, refreshToken, handle) {
  // Always encrypt — never write plaintext token material to the database.
  const accessTokenEnc  = encrypt(accessToken);
  const refreshTokenEnc = refreshToken ? encrypt(refreshToken) : null;

  await prisma.socialAccount.upsert({
    where:  { userId_platform: { userId, platform } },
    create: { userId, platform, accessTokenEnc, refreshTokenEnc, handle },
    update: {
      accessTokenEnc,
      ...(refreshTokenEnc !== null && { refreshTokenEnc }),
      handle,
    },
  });
}

// ── Twitter OAuth 2.0 (PKCE) ─────────────────────────────────────────────────

/**
 * Step 1 — Generate Twitter authorization URL.
 * Requires an authenticated user (userId from JWT).
 */
async function twitterConnect(userId) {
  const clientId   = env.twitterClientId;
  const redirectUri = env.twitterRedirectUri;

  if (!clientId || !redirectUri) {
    throw createError('Twitter OAuth is not configured on this server', 503);
  }

  const state        = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await connectRedis();
  // Store { userId, codeVerifier } — we need both on callback
  await redis.set(
    `oauth:twitter:state:${state}`,
    JSON.stringify({ userId, codeVerifier }),
    { EX: STATE_TTL_SECONDS },
  );

  const params = new URLSearchParams({
    response_type:        'code',
    client_id:            clientId,
    redirect_uri:         redirectUri,
    scope:                'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge:       codeChallenge,
    code_challenge_method: 'S256',
  });

  return { auth_url: `https://twitter.com/i/oauth2/authorize?${params}` };
}

/**
 * Step 2 — Handle Twitter redirect callback.
 * Route is NOT protected by requireAuth; userId comes from Redis state.
 */
async function twitterCallback(code, state) {
  if (!code)  throw createError('Missing authorization code', 400);
  if (!state) throw createError('Missing state parameter', 400);

  const clientId     = env.twitterClientId;
  const clientSecret = env.twitterClientSecret;
  const redirectUri  = env.twitterRedirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    throw createError('Twitter OAuth is not configured on this server', 503);
  }

  await connectRedis();
  const raw = await redis.get(`oauth:twitter:state:${state}`);

  if (!raw) {
    throw createError('Invalid or expired OAuth state — please restart the connect flow', 400);
  }

  // Consume state immediately — one-time use (prevents replay attacks)
  await redis.del(`oauth:twitter:state:${state}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createError('Corrupted OAuth state — please restart the connect flow', 400);
  }

  const { userId, codeVerifier } = parsed;
  if (!userId || !codeVerifier) {
    throw createError('Incomplete OAuth state — please restart the connect flow', 400);
  }

  // Exchange authorization code for tokens using HTTP Basic Auth
  // (Twitter requires client_id:client_secret as Basic credentials)
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    // Avoid logging the raw body — it may contain sensitive data
    throw createError(`Twitter token exchange failed (HTTP ${tokenRes.status})`, 502);
  }

  const tokens = await tokenRes.json();

  if (!tokens.access_token) {
    throw createError('Twitter token exchange returned no access_token', 502);
  }

  // Fetch the Twitter username to store as the handle
  let handle = 'unknown';
  try {
    const meRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      handle = me?.data?.username ?? 'unknown';
    }
  } catch {
    // Non-fatal — account is stored with 'unknown' handle; user can re-connect to fix.
  }

  await storeSocialAccount(userId, 'TWITTER', tokens.access_token, tokens.refresh_token ?? null, handle);

  return { platform: 'TWITTER', handle };
}

// ── LinkedIn OAuth 2.0 ────────────────────────────────────────────────────────

/**
 * Step 1 — Generate LinkedIn authorization URL.
 * Requires an authenticated user (userId from JWT).
 */
async function linkedinConnect(userId) {
  const clientId    = env.linkedinClientId;
  const redirectUri = env.linkedinRedirectUri;

  if (!clientId || !redirectUri) {
    throw createError('LinkedIn OAuth is not configured on this server', 503);
  }

  const state = generateState();

  await connectRedis();
  // LinkedIn uses standard OAuth 2.0 (no PKCE required by default)
  await redis.set(
    `oauth:linkedin:state:${state}`,
    JSON.stringify({ userId }),
    { EX: STATE_TTL_SECONDS },
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  redirectUri,
    // openid + profile + email for user identity; w_member_social for posting
    scope:         'openid profile email w_member_social',
    state,
  });

  return { auth_url: `https://www.linkedin.com/oauth/v2/authorization?${params}` };
}

/**
 * Step 2 — Handle LinkedIn redirect callback.
 * Route is NOT protected by requireAuth; userId comes from Redis state.
 */
async function linkedinCallback(code, state) {
  if (!code)  throw createError('Missing authorization code', 400);
  if (!state) throw createError('Missing state parameter', 400);

  const clientId     = env.linkedinClientId;
  const clientSecret = env.linkedinClientSecret;
  const redirectUri  = env.linkedinRedirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    throw createError('LinkedIn OAuth is not configured on this server', 503);
  }

  await connectRedis();
  const raw = await redis.get(`oauth:linkedin:state:${state}`);

  if (!raw) {
    throw createError('Invalid or expired OAuth state — please restart the connect flow', 400);
  }

  // Consume state immediately — one-time use
  await redis.del(`oauth:linkedin:state:${state}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createError('Corrupted OAuth state — please restart the connect flow', 400);
  }

  const { userId } = parsed;
  if (!userId) {
    throw createError('Incomplete OAuth state — please restart the connect flow', 400);
  }

  // Exchange authorization code for tokens
  // LinkedIn expects credentials in the POST body (not Basic Auth)
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    throw createError(`LinkedIn token exchange failed (HTTP ${tokenRes.status})`, 502);
  }

  const tokens = await tokenRes.json();

  if (!tokens.access_token) {
    throw createError('LinkedIn token exchange returned no access_token', 502);
  }

  // Fetch profile using LinkedIn's OpenID Connect userinfo endpoint
  let handle = 'unknown';
  try {
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      // Prefer email, fall back to OIDC subject identifier
      handle = me?.email ?? me?.sub ?? 'unknown';
    }
  } catch {
    // Non-fatal — store with fallback handle
  }

  // LinkedIn access tokens typically don't include a refresh token unless
  // the app has been approved for the offline_access scope.
  await storeSocialAccount(
    userId,
    'LINKEDIN',
    tokens.access_token,
    tokens.refresh_token ?? null,
    handle,
  );

  return { platform: 'LINKEDIN', handle };
}

module.exports = {
  twitterConnect,
  twitterCallback,
  linkedinConnect,
  linkedinCallback,
};
