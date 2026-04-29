'use strict';

const app    = require('./app');
const env    = require('./config/env');
const prisma = require('./config/prisma');
const { redis, connectRedis } = require('./config/redis');
const { shutdownWorker }      = require('./queue/worker');
const { startScheduler, stopScheduler } = require('./queue/scheduler');
const logger = require('./utils/logger').child('server');

const SHUTDOWN_TIMEOUT_MS = 15_000;
const STEP_TIMEOUT_MS     = 5_000;

async function verifyConnections() {
  logger.info('Verifying database connection…');
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connection OK');

  logger.info('Verifying Redis connection…');
  await connectRedis();
  logger.info('Redis connection OK');
}

function reportAiProviders() {
  const available = {
    openai:    Boolean(env.openaiApiKey),
    anthropic: Boolean(env.anthropicApiKey),
    groq:      Boolean(env.groqApiKey),
  };
  const enabled = Object.entries(available).filter(([, v]) => v).map(([k]) => k);

  if (enabled.length === 0) {
    logger.warn('No system AI provider keys configured — generation will only work for users who supply their own keys');
    return;
  }

  logger.info('AI providers available', { providers: enabled });

  if (enabled.length === 1 && enabled[0] === 'groq') {
    logger.warn('Only the Groq fallback is configured — primary providers (OpenAI, Anthropic) are unavailable');
  }
}

/**
 * Wraps a shutdown step with a per-step timeout so a single hung resource
 * doesn't block the entire shutdown sequence past SHUTDOWN_TIMEOUT_MS.
 */
async function runStep(name, fn) {
  const start = Date.now();
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`step "${name}" timed out`)), STEP_TIMEOUT_MS),
      ),
    ]);
    logger.info(`Shutdown step OK: ${name}`, { durationMs: Date.now() - start });
  } catch (err) {
    logger.error(`Shutdown step failed: ${name}`, { err, durationMs: Date.now() - start });
  }
}

async function start() {
  try {
    await verifyConnections();
  } catch (err) {
    logger.error('Connection verification failed during startup', { err });
    process.exit(1);
  }

  // Bind to 0.0.0.0 so Render's port scanner can detect the open port.
  const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info(`Postly API listening on port ${env.port} (${env.nodeEnv})`);
    logger.info(`Base URL: ${env.baseUrl}`);
    reportAiProviders();
    startScheduler();
  });

  // Idempotent shutdown — multiple SIGTERMs cannot trigger overlapping cleanups.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) {
      logger.warn(`${signal} received during shutdown — ignoring`);
      return;
    }
    shuttingDown = true;

    logger.info(`${signal} received — shutting down gracefully`);

    // Hard cap: if shutdown takes too long, kill the process.
    const forceTimer = setTimeout(() => {
      logger.error(`Forced shutdown after ${SHUTDOWN_TIMEOUT_MS}ms timeout`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Stop accepting new HTTP connections first; in-flight requests get up to STEP_TIMEOUT_MS.
    await runStep('http server close', () => new Promise((resolve) => server.close(() => resolve())));

    // Stop the scheduler so no new jobs are enqueued during cleanup.
    await runStep('scheduler stop', () => stopScheduler());

    // Drain BullMQ workers (waits for active jobs to finish).
    await runStep('worker drain', () => shutdownWorker());

    // Close DB and Redis connections last — they may still be in use until workers drain.
    await runStep('prisma disconnect', () => prisma.$disconnect());
    await runStep('redis disconnect',  async () => {
      if (redis.isOpen) await redis.quit();
    });

    clearTimeout(forceTimer);
    logger.info('Shutdown complete — exiting');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// These two handlers must be registered before start() so they catch errors
// that occur during the async startup phase as well as at runtime.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { err: reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { err });
  // Give the logger one tick to flush before exiting.
  setImmediate(() => process.exit(1));
});

start();
