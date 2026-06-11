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
const prisma = require('../config/prisma');

const SESSION_TTL = 30 * 60; // 30 minutes in seconds

const keyFor = (platform, chatId) => `session:${platform}:${chatId}`;

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function getSession(platform, chatId) {
  const redis = await connectRedis();
  const raw   = await redis.get(keyFor(platform, chatId));
  if (raw) return JSON.parse(raw);

  // Fallback: Check database for a persistent connection
  let connection = null;
  if (platform === 'telegram') {
    connection = await prisma.telegramConnection.findUnique({
      where: { telegramChatId: chatId },
      include: { user: { select: { id: true, email: true } } },
    });
  } else if (platform === 'whatsapp') {
    connection = await prisma.whatsappConnection.findUnique({
      where: { phoneNumber: chatId },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  if (connection) {
    // Store the user's email alongside the userId so downstream services can
    // detect cross-user identity contamination without an extra DB lookup.
    const session = blankFlow(connection.userId, connection.user?.email ?? null);
    await setSession(platform, chatId, session);
    return session;
  }

  return null;
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
 * Returns a blank session. userId and userEmail are preserved so the account
 * link survives a /start reset. pendingChoices holds the last menu for WhatsApp
 * number mapping.
 *
 * @param {string|null} userId    - Internal DB UUID of the linked user.
 * @param {string|null} userEmail - Email of the linked user (for identity validation).
 */
function blankFlow(userId = null, userEmail = null) {
  return {
    userId,
    userEmail,   // stored for cross-user identity validation in conversationService
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

module.exports = {
  getSession,
  setSession,
  updateSession,
  clearSession,
  blankFlow,
  setLinkToken,
  getLinkToken,
  clearLinkToken,
};

