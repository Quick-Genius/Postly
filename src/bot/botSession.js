'use strict';

/**
 * botSession.js — Platform-aware Redis session store shared by all bot adapters.
 *
 * Key format : session:{platform}:{chatId}
 *              e.g.  session:telegram:123456789
 *                    session:whatsapp:+14155238886
 *
 * TTL: 30 minutes, reset on every write.
 *
 * Adapters (Telegram, WhatsApp) should import this directly or via their own
 * thin wrapper that bakes in the platform string.
 */

const { connectRedis } = require('../config/redis');

const SESSION_TTL = 30 * 60; // 30 minutes in seconds

const keyFor = (platform, chatId) => `session:${platform}:${chatId}`;

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function getSession(platform, chatId) {
  const redis = await connectRedis();
  const raw   = await redis.get(keyFor(platform, chatId));
  return raw ? JSON.parse(raw) : null;
}

async function setSession(platform, chatId, data) {
  const redis = await connectRedis();
  await redis.setEx(keyFor(platform, chatId), SESSION_TTL, JSON.stringify(data));
}

async function updateSession(platform, chatId, patch) {
  const existing = (await getSession(platform, chatId)) ?? {};
  await setSession(platform, chatId, { ...existing, ...patch });
}

async function clearSession(platform, chatId) {
  const redis = await connectRedis();
  await redis.del(keyFor(platform, chatId));
}

// ── Linking Tokens ────────────────────────────────────────────────────────────

const LINK_TOKEN_TTL = 15 * 60; // 15 minutes
const linkTokenKey = (token) => `link_token:${token}`;

async function setLinkToken(token, platform, chatId) {
  const redis = await connectRedis();
  await redis.setEx(linkTokenKey(token), LINK_TOKEN_TTL, JSON.stringify({ platform, chatId }));
}

async function getLinkToken(token) {
  const redis = await connectRedis();
  const raw   = await redis.get(linkTokenKey(token));
  return raw ? JSON.parse(raw) : null;
}

async function clearLinkToken(token) {
  const redis = await connectRedis();
  await redis.del(linkTokenKey(token));
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns a blank session. userId is preserved so the account link survives
 * a /start reset. pendingChoices holds the last menu for WhatsApp number mapping.
 */
function blankFlow(userId = null) {
  return {
    userId,
    state:            'IDLE',
    contentType:      null,
    platforms:        [],
    tone:             null,
    model:            null,
    idea:             null,
    generatedContent: null,
    modelUsed:        null,
    tokensUsed:       null,
    pendingChoices:   null, // WhatsApp adapter maps "1","2",… to these choices
  };
}

module.exports = { getSession, setSession, updateSession, clearSession, blankFlow };
