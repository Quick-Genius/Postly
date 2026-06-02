'use strict';

/**
 * bot.js — Grammy bot wiring: command registration, update routing, error boundary.
 *
 * Design decisions:
 *  - Webhook mode only (no polling). The Express route calls handleWebhook.
 *  - Commands are handled directly here to keep stateMachine pure state-routing.
 *  - Every message/callback routes through stateMachine.dispatch so new states
 *    can be added without touching this file.
 *  - If TELEGRAM_BOT_TOKEN is not set (bot feature disabled), both exports
 *    are null and the route handler returns 503 gracefully.
 */

const env         = require('../../config/env');
const session     = require('./session');
const stateMachine = require('./stateMachine');
const handlers    = require('./handlers');
const logger      = require('../../utils/logger').child('TelegramBot');

// Guard: bot is optional.  The route layer checks for null before calling.
if (!env.telegramBotToken) {
  module.exports = { bot: null, handleWebhook: null };
  // CommonJS does not support early return at module level, so we use a flag.
}

// Only initialise grammy when a token is present — avoids crashing the server
// in environments where the bot feature is intentionally disabled.
let bot         = null;
let handleWebhook = null;

if (env.telegramBotToken) {
  const { Bot, webhookCallback } = require('grammy');

  bot = new Bot(env.telegramBotToken);

  // ── Helper ──────────────────────────────────────────────────────────────────

  /** Returns the stable chat ID as a string for Redis keying. */
  function chatId(ctx) {
    return String(ctx.chat?.id ?? ctx.from?.id);
  }

  /** Fetches the current session, falling back to a blank one for unknown chats. */
  async function getsess(ctx) {
    return (await session.getSession(chatId(ctx))) ?? session.blankFlow(null);
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  bot.command('start', (ctx) => handlers.handleStart(ctx));

  bot.command('status', async (ctx) => {
    const sess = await getsess(ctx);
    await handlers.handleStatus(ctx, sess);
  });

  bot.command('accounts', async (ctx) => {
    const sess = await getsess(ctx);
    await handlers.handleAccounts(ctx, sess);
  });

  bot.command('help', (ctx) => handlers.handleHelp(ctx));

  // ── Text messages (non-command) ─────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    // Commands are fully handled above — skip them here.
    if (ctx.message.text.startsWith('/')) return;

    const sess = await getsess(ctx);
    await stateMachine.dispatch(ctx, sess, 'text');
  });

  // ── Inline keyboard callbacks ───────────────────────────────────────────────

  bot.on('callback_query:data', async (ctx) => {
    // Always fetch a fresh session so toggled-platform state is current.
    const sess = await getsess(ctx);
    await stateMachine.dispatch(ctx, sess, 'callback');
  });

  // ── Global error boundary ───────────────────────────────────────────────────

  bot.catch(async (err) => {
    const ctx = err.ctx;
    logger.error('Unhandled error in update handler', {
      err: err.error ?? err,
      updateType: ctx?.update ? Object.keys(ctx.update).filter((k) => k !== 'update_id')[0] : null,
      chatId:     ctx?.chat?.id,
      from:       ctx?.from?.username ?? ctx?.from?.id,
    });
    try {
      await ctx.reply('⚠️ An unexpected error occurred. Type /start to begin again.');
    } catch (replyErr) {
      logger.warn('Failed to deliver error reply', { err: replyErr });
    }
  });

  // ── Webhook handler ─────────────────────────────────────────────────────────

  handleWebhook = webhookCallback(bot, 'express', {
    // When set, Grammy validates the X-Telegram-Bot-Api-Secret-Token header
    // and rejects requests that don't carry it — protects the endpoint from
    // unauthenticated Telegram updates.
    secretToken: env.telegramWebhookSecret ?? undefined,
  });
}

module.exports = { bot, handleWebhook };
