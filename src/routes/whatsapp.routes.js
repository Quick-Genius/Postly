'use strict';

/**
 * whatsapp.routes.js — Webhook route for the Twilio WhatsApp bot.
 *
 * Mounted at /api/bot/whatsapp (set in app.js).
 * Twilio signature validation is handled inside the controller.
 * This route intentionally sits outside JWT auth middleware.
 */

const { Router }          = require('express');
const whatsappController  = require('../bot/whatsapp/whatsapp.controller');

const router = Router();

// POST /api/bot/whatsapp
router.post('/', whatsappController.handle);

module.exports = router;
