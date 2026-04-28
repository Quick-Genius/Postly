const { Router } = require('express');
const prisma = require('../config/prisma');
const { redis } = require('../config/redis');
const env = require('../config/env');

const router = Router();

router.get('/', async (_req, res) => {
  const checks = { database: 'unknown', redis: 'unknown' };
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

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
    ai_providers,
  });
});

module.exports = router;
