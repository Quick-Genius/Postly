const { Router } = require('express');
const prisma = require('../config/prisma');
const { redis } = require('../config/redis');
const env = require('../config/env');

const router = Router();

async function checkTelegram() {
  if (!env.telegramBotToken) return 'not_configured';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/getMe`,
      { signal: controller.signal },
    );
    if (!resp.ok) return 'down';
    const body = await resp.json();
    return body && body.ok ? 'ok' : 'down';
  } catch (_err) {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

async function checkTwilio() {
  if (!env.twilioAccountSid || !env.twilioAuthToken) return 'not_configured';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const auth = Buffer
      .from(`${env.twilioAccountSid}:${env.twilioAuthToken}`)
      .toString('base64');
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}.json`,
      { headers: { Authorization: `Basic ${auth}` }, signal: controller.signal },
    );
    return resp.ok ? 'ok' : 'down';
  } catch (_err) {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

router.get('/', async (_req, res) => {
  const checks = {
    database: 'unknown',
    redis: 'unknown',
    telegram: 'unknown',
    twilio: 'unknown',
  };
  const ai_providers = {
    openai:    Boolean(env.openaiApiKey),
    anthropic: Boolean(env.anthropicApiKey),
    groq:      Boolean(env.groqApiKey),
  };
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (_err) {
    checks.database = 'down';
    healthy = false;
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch (_err) {
    checks.redis = 'down';
    healthy = false;
  }

  const [telegramStatus, twilioStatus] = await Promise.all([
    checkTelegram(),
    checkTwilio(),
  ]);
  checks.telegram = telegramStatus;
  checks.twilio = twilioStatus;
  if (telegramStatus === 'down' || twilioStatus === 'down') healthy = false;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
    ai_providers,
  });
});

module.exports = router;
