'use strict';

/**
 * telegram.routes.js — Webhook endpoint for the Telegram bot.
 *
 * POST /api/telegram/webhook
 *   Grammy's webhookCallback validates the X-Telegram-Bot-Api-Secret-Token
 *   header (when TELEGRAM_WEBHOOK_SECRET is set) before passing the update
 *   to the bot. Requests with an invalid secret are rejected with 401.
 *
 * This route is intentionally mounted outside the JWT auth middleware — the
 * Telegram-level secret is the authentication mechanism here.
 */

const { Router }      = require('express');
const { handleWebhook } = require('../bot/telegram/bot');
const logger = require('../utils/logger').child('telegram-webhook');

const router = Router();

router.post('/webhook', (req, res, next) => {
  logger.info('Incoming Telegram webhook update', { body: req.body });
  if (!handleWebhook) {
    return res.status(503).json({ error: 'Telegram bot is not configured (TELEGRAM_BOT_TOKEN not set)' });
  }
  return handleWebhook(req, res, next);
});

module.exports = router;
