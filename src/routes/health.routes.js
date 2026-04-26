const { Router } = require('express');
const prisma = require('../config/prisma');

const router = Router();

router.get('/', async (_req, res) => {
  const checks = { database: 'unknown' };
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (_err) {
    checks.database = 'down';
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
