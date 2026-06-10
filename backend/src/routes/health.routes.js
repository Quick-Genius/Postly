'use strict';

const { Router } = require('express');
const prisma = require('../config/prisma');
const { connectRedis } = require('../config/redis');
const env = require('../config/env');

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
  return probeReachable('https://api.twitter.com/2/oauth2/token');
}

async function checkLinkedIn() {
  if (!env.linkedinClientId || !env.linkedinClientSecret) return 'not_configured';
  return probeReachable('https://api.linkedin.com/v2/userinfo');
}

function createHealthRouter(subsystem) {
  const router = Router();

  async function buildHealthResponse() {
    const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
    // Remote managed Postgres (e.g. Neon) and Redis can take well over 200ms
    // to respond, especially after a cold start — 200ms was causing healthy
    // dependencies to be reported as down on every check.
    const PING_TIMEOUT_MS = 2000;

    let dbOk = false;
    let redisOk = false;

    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        timeoutPromise(PING_TIMEOUT_MS)
      ]);
      dbOk = true;
    } catch (e) {
      dbOk = false;
    }

    try {
      const redisClient = await connectRedis();
      await Promise.race([
        redisClient.ping(),
        timeoutPromise(PING_TIMEOUT_MS)
      ]);
      redisOk = true;
    } catch (e) {
      redisOk = false;
    }

    const status = (dbOk && redisOk) ? 'ok' : 'degraded';
    return {
      status,
      subsystem,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      redis: redisOk,
      db: dbOk
    };
  }

  // Watchdog minimal check
  router.get('/', async (req, res) => {
    const body = await buildHealthResponse();
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });

  // Old detailed check moved here
  router.get('/full', async (req, res) => {
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

  return router;
}

const router = createHealthRouter('api');

module.exports = { router, createHealthRouter };
