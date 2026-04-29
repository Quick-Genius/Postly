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

function reportAiProviders() {
  const available = {
    openai:    Boolean(env.openaiApiKey),
    anthropic: Boolean(env.anthropicApiKey),
    groq:      Boolean(env.groqApiKey),
  };
  const enabled = Object.entries(available).filter(([, v]) => v).map(([k]) => k);

  if (enabled.length === 0) {
    console.warn('[startup] No system AI provider keys configured — generation will only work for users who supply their own keys.');
    return;
  }

  console.log(`[startup] AI providers available: ${enabled.join(', ')}`);

  if (enabled.length === 1 && enabled[0] === 'groq') {
    console.warn('[startup] Only the Groq fallback is configured — primary providers (OpenAI, Anthropic) are unavailable.');
  }
}

async function start() {
  try {
    await verifyConnections();
  } catch (err) {
    console.error('[startup] Connection verification failed:', err.message);
    process.exit(1);
  }

  // Bind to 0.0.0.0 so Render's port scanner can detect the open port.
  // Without an explicit host, Node may bind to ::1/127.0.0.1 only on some setups.
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[startup] Postly API listening on port ${env.port} (${env.nodeEnv})`);
    console.log(`[startup] Base URL: ${env.baseUrl}`);
    reportAiProviders();
    startScheduler();
  });

  // shutdown is defined here so it closes over `server` via the function scope.
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

    // Force exit if connections don't drain in time.
    setTimeout(() => {
      console.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

// These two handlers must be registered before start() so they catch errors
// that occur during the async startup phase as well as at runtime.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

start();
