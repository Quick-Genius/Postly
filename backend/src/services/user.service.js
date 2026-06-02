'use strict';

/**
 * User service — profile, social accounts, AI key management.
 *
 * Security notes:
 *  - Tokens are encrypted before storage using AES-256-GCM (encryption.js).
 *  - Decrypted tokens are NEVER returned through public API endpoints.
 *  - AI keys: the GET endpoint returns only a presence mask (has_openai_key,
 *    has_anthropic_key) — never the plaintext key material.
 *  - Social account tokens are exposed only internally when posting to a
 *    platform (done in later PRs); the list endpoint omits all token fields.
 *  - Ownership is verified before any delete operation.
 */

const prisma = require('../config/prisma');
const { encrypt } = require('../utils/encryption');

const VALID_PLATFORMS = new Set(['TWITTER', 'LINKEDIN', 'INSTAGRAM', 'THREADS', 'FACEBOOK']);

// ── Domain error ─────────────────────────────────────────────────────────────

class UserError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * Returns the public profile fields for the given user.
 */
async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id:              true,
      name:            true,
      bio:             true,
      defaultTone:     true,
      defaultLanguage: true,
    },
  });

  if (!user) throw new UserError('User not found', 404);
  return user;
}

/**
 * Updates only the supplied profile fields (partial update).
 *
 * @param {string} userId
 * @param {{ name?, bio?, defaultTone?, defaultLanguage? }} fields
 */
async function updateProfile(userId, { name, bio, defaultTone, defaultLanguage }) {
  const data = {};
  if (name            !== undefined) data.name            = name;
  if (bio             !== undefined) data.bio             = bio;
  if (defaultTone     !== undefined) data.defaultTone     = defaultTone;
  if (defaultLanguage !== undefined) data.defaultLanguage = defaultLanguage;

  if (Object.keys(data).length === 0) {
    throw new UserError('No valid fields provided for update', 400);
  }

  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id:              true,
      name:            true,
      bio:             true,
      defaultTone:     true,
      defaultLanguage: true,
    },
  });
}

// ── Social accounts ───────────────────────────────────────────────────────────

/**
 * Adds or updates a social account for the user.
 * Tokens are encrypted before storage — never stored in plaintext.
 */
async function addSocialAccount(userId, { platform, access_token, refresh_token, handle }) {
  const normalizedPlatform = typeof platform === 'string' ? platform.toUpperCase() : '';

  if (!VALID_PLATFORMS.has(normalizedPlatform)) {
    throw new UserError(
      `Invalid platform. Allowed values: ${[...VALID_PLATFORMS].map((p) => p.toLowerCase()).join(', ')}`,
      400,
    );
  }
  if (!access_token || typeof access_token !== 'string' || access_token.trim() === '') {
    throw new UserError('access_token is required and must be a non-empty string', 400);
  }
  if (!handle || typeof handle !== 'string' || handle.trim() === '') {
    throw new UserError('handle is required and must be a non-empty string', 400);
  }

  // Encrypt before storage — NEVER store plaintext tokens.
  const accessTokenEnc  = encrypt(access_token.trim());
  const refreshTokenEnc = refresh_token && typeof refresh_token === 'string' && refresh_token.trim()
    ? encrypt(refresh_token.trim())
    : null;

  return prisma.socialAccount.upsert({
    where:  { userId_platform: { userId, platform: normalizedPlatform } },
    create: {
      userId,
      platform:        normalizedPlatform,
      accessTokenEnc,
      refreshTokenEnc,
      handle:          handle.trim(),
    },
    update: {
      accessTokenEnc,
      // Only overwrite refresh token when a new one was supplied.
      ...(refreshTokenEnc !== null && { refreshTokenEnc }),
      handle: handle.trim(),
    },
    // Return safe public fields only — no encrypted token material.
    select: { id: true, platform: true, handle: true, connectedAt: true },
  });
}

/**
 * Returns all social accounts for the user — public fields only.
 * Encrypted tokens are intentionally excluded from the result set.
 */
async function getSocialAccounts(userId) {
  return prisma.socialAccount.findMany({
    where:   { userId },
    select:  { id: true, platform: true, handle: true, connectedAt: true },
    orderBy: { connectedAt: 'asc' },
  });
}

/**
 * Deletes a social account after verifying ownership.
 */
async function deleteSocialAccount(userId, accountId) {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });

  if (!account)                    throw new UserError('Social account not found', 404);
  if (account.userId !== userId)   throw new UserError('Forbidden', 403);

  await prisma.socialAccount.delete({ where: { id: accountId } });
}

// ── AI keys ───────────────────────────────────────────────────────────────────

/**
 * Stores (upserts) AI API keys, encrypted.
 * Passing null or empty string for a key clears it.
 *
 * @param {string} userId
 * @param {{ openai_key?: string|null, anthropic_key?: string|null }} keys
 */
async function upsertAiKeys(userId, { openai_key, anthropic_key }) {
  if (openai_key === undefined && anthropic_key === undefined) {
    throw new UserError('Provide at least one key: openai_key or anthropic_key', 400);
  }

  const data = {};

  if (openai_key !== undefined) {
    // null / empty string → clear the stored key
    if (openai_key === null || openai_key === '') {
      data.openaiKeyEnc = null;
    } else if (typeof openai_key === 'string') {
      data.openaiKeyEnc = encrypt(openai_key);
    } else {
      throw new UserError('openai_key must be a string or null', 400);
    }
  }

  if (anthropic_key !== undefined) {
    if (anthropic_key === null || anthropic_key === '') {
      data.anthropicKeyEnc = null;
    } else if (typeof anthropic_key === 'string') {
      data.anthropicKeyEnc = encrypt(anthropic_key);
    } else {
      throw new UserError('anthropic_key must be a string or null', 400);
    }
  }

  await prisma.aiKey.upsert({
    where:  { userId },
    create: { userId, ...data },
    update: data,
  });
}

/**
 * Returns a *presence mask* for the user's AI keys.
 *
 * ⚠️  Security: plaintext key material is NEVER returned through API
 *     endpoints. Callers that actually need to use a key must call
 *     resolveAiKeys() (internal use only, not exposed via HTTP).
 *
 * @returns {{ has_openai_key: boolean, has_anthropic_key: boolean } | null}
 */
async function getAiKeysMask(userId) {
  const aiKey = await prisma.aiKey.findUnique({ where: { userId } });
  if (!aiKey) return null;

  return {
    has_openai_key:    aiKey.openaiKeyEnc    !== null,
    has_anthropic_key: aiKey.anthropicKeyEnc !== null,
  };
}

/**
 * Internal helper — decrypts and returns plaintext AI keys.
 * NOT exposed as an HTTP endpoint. Used by the AI generation service
 * to resolve which key to use for a given user request.
 */
async function resolveAiKeys(userId) {
  const { decrypt } = require('../utils/encryption');
  const aiKey = await prisma.aiKey.findUnique({ where: { userId } });
  if (!aiKey) return { openai_key: null, anthropic_key: null };

  return {
    openai_key:    aiKey.openaiKeyEnc    ? decrypt(aiKey.openaiKeyEnc)    : null,
    anthropic_key: aiKey.anthropicKeyEnc ? decrypt(aiKey.anthropicKeyEnc) : null,
  };
}

module.exports = {
  UserError,
  getProfile,
  updateProfile,
  addSocialAccount,
  getSocialAccounts,
  deleteSocialAccount,
  upsertAiKeys,
  getAiKeysMask,
  resolveAiKeys,   // internal use only — never called from controllers
};
