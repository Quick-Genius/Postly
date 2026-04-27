'use strict';

/**
 * session.js — Redis-backed session store for the Telegram bot.
 *
 * Key format : session:telegram:{chatId}
 * TTL        : 30 minutes, reset on every write.
 *
 * Session shape:
 *  {
 *    userId          : string | null,   — Postly user ID (set on /link)
 *    state           : string,          — current state-machine state
 *    contentType     : string | null,   — announcement | thread | …
 *    platforms       : string[],        — ['twitter', 'linkedin', …]
 *    tone            : string | null,
 *    model           : string | null,   — 'openai' | 'anthropic'
 *    idea            : string | null,
 *    generatedContent: object | null,   — keyed by platform name
 *    modelUsed       : string | null,
 *    tokensUsed      : number | null,
 *  }
 */

const { connectRedis } = require('../../config/redis');

const SESSION_TTL = 30 * 60; // 30 minutes in seconds

const keyFor = (chatId) => `session:telegram:${chatId}`;

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Returns the current session for a chat, or null if it doesn't exist / expired.
 */
async function getSession(chatId) {
  const redis = await connectRedis();
  const raw   = await redis.get(keyFor(chatId));
  return raw ? JSON.parse(raw) : null;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Replaces the entire session and resets the TTL.
 */
async function setSession(chatId, data) {
  const redis = await connectRedis();
  await redis.setEx(keyFor(chatId), SESSION_TTL, JSON.stringify(data));
}

/**
 * Shallow-merges `patch` into the existing session and resets the TTL.
 * Safe to call with partial updates — preserves all other fields.
 */
async function updateSession(chatId, patch) {
  const existing = (await getSession(chatId)) ?? {};
  await setSession(chatId, { ...existing, ...patch });
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Removes the session immediately (e.g., on explicit /cancel or account unlink).
 */
async function clearSession(chatId) {
  const redis = await connectRedis();
  await redis.del(keyFor(chatId));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a blank session skeleton — userId preserved so the account link
 * is not lost when starting a new post flow.
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
  };
}

module.exports = { getSession, setSession, updateSession, clearSession, blankFlow };
