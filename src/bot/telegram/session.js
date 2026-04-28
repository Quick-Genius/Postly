'use strict';

/**
 * session.js — Telegram-scoped session store.
 *
 * Thin wrapper around botSession with 'telegram' baked in as the platform key.
 * All existing imports (`require('./session')`) continue to work unchanged.
 */

const botSession = require('../botSession');

const PLATFORM = 'telegram';

module.exports = {
  getSession:    (chatId)        => botSession.getSession(PLATFORM, chatId),
  setSession:    (chatId, data)  => botSession.setSession(PLATFORM, chatId, data),
  updateSession: (chatId, patch) => botSession.updateSession(PLATFORM, chatId, patch),
  clearSession:  (chatId)        => botSession.clearSession(PLATFORM, chatId),
  blankFlow:     botSession.blankFlow,
};
