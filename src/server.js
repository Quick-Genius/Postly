const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const { redis, connectRedis } = require('./config/redis');
const { shutdownWorker } = require('./queue/worker');
const { startScheduler, stopScheduler } = require('./queue/scheduler');

async function verifyConnections() {
  console.log('[startup] Verifying database connection...');
  await prisma.$queryRaw`SELECT 1`;
  console.log('[startup] Database connection OK');

  console.log('[startup] Verifying Redis connection...');
  await connectRedis();
  console.log('[startup] Redis connection OK');
}

async function start() {
  try {
    await verifyConnections();
  } catch (err) {
    console.error('[startup] Connection verification failed:', err.message);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[startup] Postly API listening on port ${env.port} (${env.nodeEnv})`);
    console.log(`[startup] Base URL: ${env.baseUrl}`);
    startScheduler();
  });

  async function shutdown(signal) {
    console.log(`${signal} received — shutting down gracefully`);

    server.close(async () => {
      try { stopScheduler(); }            catch (err) { console.error('Scheduler stop error:', err.message); }
      try { await shutdownWorker(); }     catch (err) { console.error('Worker shutdown error:', err.message); }
      try { await prisma.$disconnect(); } catch (err) { console.error('Prisma disconnect error:', err.message); }
      try {
        if (redis.isOpen) await redis.quit();
      } catch (err) {
        console.error('Redis disconnect error:', err.message);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

start();

async function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);

  server.close(async () => {
    try { stopScheduler(); }            catch (err) { console.error('Scheduler stop error:', err.message); }
    try { await shutdownWorker(); }     catch (err) { console.error('Worker shutdown error:', err.message); }
    try { await prisma.$disconnect(); } catch (err) { console.error('Prisma disconnect error:', err.message); }
    try {
      if (redis.isOpen) await redis.quit();
    } catch (err) {
      console.error('Redis disconnect error:', err.message);
    }
    process.exit(0);
  });

  // Force exit if connections don't drain in time
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
