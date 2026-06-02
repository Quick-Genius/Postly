const { Router } = require('express');
const prisma = require('../config/prisma');
const { redis, connectRedis } = require('../config/redis');
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

// Reachability probe — we don't have a user token here, so we hit an
// unauthenticated endpoint and treat any HTTP response (incl. 401/400) as "up".
// Only network/timeout/5xx counts as "down".
async function probeReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(url, { method: 'GET', signal: controller.signal });
    return resp.status < 500 ? 'ok' : 'down';
  } catch (_err) {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

async function checkTwitter() {
  if (!env.twitterClientId || !env.twitterClientSecret) return 'not_configured';
  // Public OAuth2 token endpoint — returns 400 without body, which proves reachability.
  return probeReachable('https://api.twitter.com/2/oauth2/token');
}

async function checkLinkedIn() {
  if (!env.linkedinClientId || !env.linkedinClientSecret) return 'not_configured';
  // Public userinfo endpoint — returns 401 without auth, which proves reachability.
  return probeReachable('https://api.linkedin.com/v2/userinfo');
}

router.get('/', async (_req, res) => {
  const checks = {
    database: 'unknown',
    redis: 'unknown',
    telegram: 'unknown',
    twilio: 'unknown',
    twitter: 'unknown',
    linkedin: 'unknown',
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
    const redisClient = await connectRedis();
    await redisClient.ping();
    checks.redis = 'ok';
  } catch (_err) {
    checks.redis = 'down';
    healthy = false;
  }

  const [telegramStatus, twilioStatus, twitterStatus, linkedinStatus] = await Promise.all([
    checkTelegram(),
    checkTwilio(),
    checkTwitter(),
    checkLinkedIn(),
  ]);
  checks.telegram = telegramStatus;
  checks.twilio = twilioStatus;
  checks.twitter = twitterStatus;
  checks.linkedin = linkedinStatus;
  if (
    telegramStatus === 'down' ||
    twilioStatus === 'down' ||
    twitterStatus === 'down' ||
    linkedinStatus === 'down'
  ) {
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
    ai_providers,
  });
});

module.exports = router;
