'use strict';

/**
 * setup-webhooks.js — One-shot script to register live webhook URLs with
 * Telegram after deployment. Run once per environment (not on every boot).
 *
 * Usage:
 *   node src/scripts/setup-webhooks.js
 *
 * Required env vars:
 *   BASE_URL               — public HTTPS URL of this deployment
 *   TELEGRAM_BOT_TOKEN     — token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET — secret forwarded in X-Telegram-Bot-Api-Secret-Token
 */

require('dotenv').config();

const https = require('https');

const BASE_URL               = process.env.BASE_URL || process.env.APP_URL;
const TELEGRAM_BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// ── Helpers ───────────────────────────────────────────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      },
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function setupTelegram() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — skipping');
    return;
  }
  if (!BASE_URL) {
    console.error('[telegram] BASE_URL not set — cannot register webhook');
    process.exitCode = 1;
    return;
  }

  const webhookUrl = `${BASE_URL}/api/bot/telegram/webhook`;
  const apiUrl     = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;

  const body = { url: webhookUrl };
  if (TELEGRAM_WEBHOOK_SECRET) {
    body.secret_token = TELEGRAM_WEBHOOK_SECRET;
  }

  console.log(`[telegram] Registering webhook → ${webhookUrl}`);

  const result = await post(apiUrl, body);

  if (result.ok) {
    console.log('[telegram] Webhook registered successfully');
    console.log(`[telegram] Description: ${result.description}`);
  } else {
    console.error('[telegram] Failed to register webhook:', result);
    process.exitCode = 1;
  }
}

async function getWebhookInfo() {
  if (!TELEGRAM_BOT_TOKEN) return;

  const url    = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`;
  const result = await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });

  if (result.ok) {
    console.log('[telegram] Current webhook info:');
    console.log(`           url:             ${result.result.url || '(none)'}`);
    console.log(`           pending_updates: ${result.result.pending_update_count}`);
    if (result.result.last_error_message) {
      console.warn(`           last_error:     ${result.result.last_error_message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('=== Postly webhook setup ===');
  console.log(`BASE_URL: ${BASE_URL || '(not set)'}`);
  console.log('');

  await setupTelegram();
  await getWebhookInfo();

  console.log('');
  console.log('=== Done ===');
})();
