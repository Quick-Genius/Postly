'use strict';

const { Router } = require('express');
const twilio = require('twilio');

const env = require('../config/env');
const logger = require('../utils/logger').child('UnifiedWebhook');
const whatsappService = require('../bot/whatsapp/whatsapp.service');
const { handleWebhook: telegramWebhook } = require('../bot/telegram/bot');

const { MessagingResponse } = twilio.twiml;
const router = Router();

const isWhatsappRequest = (req) => {
  const from = req.body?.From;
  return typeof from === 'string' && from.toLowerCase().startsWith('whatsapp:');
};

function twimlReply(message) {
  const response = new MessagingResponse();
  response.message(message);
  return response.toString();
}

router.post('/webhook', async (req, res, next) => {
  const userAgent = req.get('user-agent') || 'unknown';

  try {
    if (isWhatsappRequest(req)) {
      const from = String(req.body.From).replace(/^whatsapp:/i, '').trim();
      const body = String(req.body.Body ?? '').trim();

      logger.info('Webhook source detected: WhatsApp', {
        from,
        userAgent,
        bodyPreview: body.slice(0, 120),
      });

      const replyText = body
        ? await whatsappService.handleWebhook({ from, body })
        : 'Please send a message to continue.';

      return res.status(200).type('text/xml').send(twimlReply(replyText));
    }

    logger.info('Webhook source detected: Telegram', {
      userAgent,
      updateId: req.body?.update_id ?? null,
    });

    if (!telegramWebhook) {
      logger.warn('Rejected Telegram webhook: bot is not configured');
      return res.status(503).json({ error: 'Telegram bot is not configured' });
    }

    if (env.telegramWebhookSecret) {
      const providedSecret = req.get('x-telegram-bot-api-secret-token') || '';
      if (providedSecret !== env.telegramWebhookSecret) {
        logger.warn('Rejected Telegram webhook: invalid secret token', {
          userAgent,
          hasSecretHeader: Boolean(providedSecret),
        });
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    return telegramWebhook(req, res, next);
  } catch (err) {
    logger.error('Unified webhook processing failed', { err, userAgent });

    if (isWhatsappRequest(req)) {
      return res
        .status(200)
        .type('text/xml')
        .send(twimlReply('⚠️ Something went wrong. Please try again.'));
    }

    return next(err);
  }
});

module.exports = router;
