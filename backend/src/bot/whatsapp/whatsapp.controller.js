'use strict';

/**
 * whatsapp.controller.js — HTTP boundary for the Twilio WhatsApp webhook.
 *
 * Responsibilities:
 *  1. Validate the Twilio request signature (rejects forged requests with 403).
 *  2. Extract From + Body from the parsed form body.
 *  3. Delegate to whatsapp.service.handleWebhook.
 *  4. Reply with TwiML <Message>.
 *
 * Twilio delivers webhook payloads as application/x-www-form-urlencoded.
 * Express parses this via `express.urlencoded({ extended: true })` (already in
 * app.js), so req.body is a plain key-value object — exactly what
 * twilio.validateRequest expects.
 *
 * Signature validation:
 *  Twilio signs each request using HMAC-SHA1 over the URL + sorted params,
 *  keyed with the account's Auth Token.  We validate with the official
 *  `twilio` npm helper.  If TWILIO_AUTH_TOKEN is not set (local dev / CI),
 *  validation is skipped — set it in production.
 */

const twilio          = require('twilio');
const env             = require('../../config/env');
const whatsappService = require('./whatsapp.service');
const logger          = require('../../utils/logger').child('WhatsApp');

const { MessagingResponse } = twilio.twiml;

// ── Signature validation ──────────────────────────────────────────────────────

/**
 * Returns true when the request carries a valid Twilio signature.
 * Always returns true when TWILIO_AUTH_TOKEN is absent (dev / CI mode).
 */
function isValidTwilioRequest(req) {
  if (!env.twilioAuthToken) return true; // skip in development

  const signature = req.headers['x-twilio-signature'] ?? '';
  const url       = `${env.appUrl}/api/bot/whatsapp`;

  return twilio.validateRequest(env.twilioAuthToken, signature, url, req.body);
}

// ── TwiML builder ─────────────────────────────────────────────────────────────

function twimlReply(message) {
  const response = new MessagingResponse();
  response.message(message);
  return response.toString();
}

// ── Controller ────────────────────────────────────────────────────────────────

async function handle(req, res) {
  try {
    if (!isValidTwilioRequest(req)) {
      logger.warn('Rejected request — invalid Twilio signature', {
        ip: req.ip,
        url: `${env.appUrl}/api/bot/whatsapp`,
      });
      return res.status(403).send('Forbidden');
    }

    const { From, Body, ButtonText, ListTitle, ButtonPayload } = req.body ?? {};
    const hasUserInput = Body != null || ButtonText != null || ListTitle != null || ButtonPayload != null;
    if (!From || !hasUserInput) {
      logger.warn('Bad request — missing From or message payload', {
        hasFrom: Boolean(From),
        hasBody: Body != null,
        hasButtonText: ButtonText != null,
        hasListTitle: ListTitle != null,
        hasButtonPayload: ButtonPayload != null,
      });
      return res.status(400).send('Bad Request');
    }

    // Normalize aggressively so numeric/typed payloads still work.
    const from = String(From).replace(/^whatsapp:/i, '').trim();
    const body = String(Body ?? '').trim();
    const buttonText = String(ButtonText ?? '').trim();
    const listTitle = String(ListTitle ?? '').trim();
    const buttonPayload = String(ButtonPayload ?? '').trim();

    const reqLog = logger.child('handle', {
      from,
      bodyType: typeof Body,
      bodyPreview: body.slice(0, 80),
      buttonText,
      listTitle,
      hasButtonPayload: Boolean(buttonPayload),
    });
    reqLog.info('Inbound WhatsApp webhook message');

    const replyText = await whatsappService.handleWebhook({
      from,
      body,
      inbound: {
        Body: body,
        ButtonText: buttonText,
        ListTitle: listTitle,
        ButtonPayload: buttonPayload,
      },
    });
    reqLog.info('Replying to WhatsApp webhook', { replyLength: replyText?.length ?? 0 });
    return res.type('text/xml').send(twimlReply(replyText));
  } catch (err) {
    logger.error('Unhandled error in webhook handler', { err, body: req.body });
    return res.type('text/xml').send(
      twimlReply('⚠️ Something went wrong. Send "start" to try again.'),
    );
  }
}

module.exports = { handle };
