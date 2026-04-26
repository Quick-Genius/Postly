'use strict';

/**
 * User controller — profile, social accounts, AI key management.
 *
 * Responsibilities:
 *  - Parse and validate HTTP input
 *  - Delegate business logic to user.service.js
 *  - Return consistent HTTP responses
 *
 * Security:
 *  - All routes are protected by requireAuth middleware (see user.routes.js)
 *  - AI key GET endpoint returns a presence mask — never plaintext keys
 *  - No token material is ever included in responses
 */

const userService = require('../services/user.service');

// ── Field constraints ─────────────────────────────────────────────────────────

const NAME_MAX = 100;
const BIO_MAX  = 500;
const TONE_MAX = 50;
const LANG_MAX = 10;

// ── Validation helpers ────────────────────────────────────────────────────────

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Validates an optional string field.
 * Returns undefined when the field is absent (allows partial updates).
 * Throws 400 when the field is present but invalid.
 */
function validateOptionalString(value, field, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  if (value.trim().length > max) {
    throw badRequest(`${field} exceeds maximum length of ${max} characters`);
  }
  return value.trim();
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * GET /api/user/profile
 * Returns: name, bio, default_tone, default_language
 */
async function getProfile(req, res, next) {
  try {
    const profile = await userService.getProfile(req.userId);
    res.status(200).json({ user: profile });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/user/profile
 * Body (all optional): name, bio, default_tone, default_language
 * Updates only the fields that are provided.
 */
async function updateProfile(req, res, next) {
  try {
    const body = req.body || {};

    const name            = validateOptionalString(body.name,             'name',             NAME_MAX);
    const bio             = validateOptionalString(body.bio,              'bio',              BIO_MAX);
    const defaultTone     = validateOptionalString(body.default_tone,     'default_tone',     TONE_MAX);
    const defaultLanguage = validateOptionalString(body.default_language, 'default_language', LANG_MAX);

    const updated = await userService.updateProfile(req.userId, {
      name,
      bio,
      defaultTone,
      defaultLanguage,
    });

    res.status(200).json({ user: updated });
  } catch (err) {
    next(err);
  }
}

// ── Social accounts ───────────────────────────────────────────────────────────

/**
 * POST /api/user/social-accounts
 * Body: platform, access_token, refresh_token (optional), handle
 * Tokens are encrypted by the service before storage.
 */
async function addSocialAccount(req, res, next) {
  try {
    const { platform, access_token, refresh_token, handle } = req.body || {};

    if (!platform)     throw badRequest('platform is required');
    if (!access_token) throw badRequest('access_token is required');
    if (!handle)       throw badRequest('handle is required');

    const account = await userService.addSocialAccount(req.userId, {
      platform,
      access_token,
      refresh_token,
      handle,
    });

    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/user/social-accounts
 * Returns: id, platform, handle, connected_at — no token material.
 */
async function getSocialAccounts(req, res, next) {
  try {
    const accounts = await userService.getSocialAccounts(req.userId);
    res.status(200).json({ accounts });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/user/social-accounts/:id
 * Verifies ownership before deletion (403 if not owned by calling user).
 */
async function deleteSocialAccount(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) throw badRequest('Account ID is required');

    await userService.deleteSocialAccount(req.userId, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ── AI keys ───────────────────────────────────────────────────────────────────

/**
 * PUT /api/user/ai-keys
 * Body (at least one required): openai_key, anthropic_key
 * Keys are encrypted before storage. Pass null or "" to clear a key.
 */
async function upsertAiKeys(req, res, next) {
  try {
    const body = req.body || {};

    // Accept only explicit fields — reject unknown payload
    const { openai_key, anthropic_key } = body;

    if (openai_key === undefined && anthropic_key === undefined) {
      throw badRequest('Provide at least one field: openai_key or anthropic_key');
    }

    await userService.upsertAiKeys(req.userId, { openai_key, anthropic_key });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/user/ai-keys
 * Returns a *presence mask* only — never plaintext key material.
 * Response: { has_openai_key: boolean, has_anthropic_key: boolean }
 *
 * ⚠️  Security: actual key decryption happens only inside the AI generation
 *     pipeline (server-side, never over the wire).
 */
async function getAiKeys(req, res, next) {
  try {
    const mask = await userService.getAiKeysMask(req.userId);
    res.status(200).json({ ai_keys: mask });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  addSocialAccount,
  getSocialAccounts,
  deleteSocialAccount,
  upsertAiKeys,
  getAiKeys,
};
