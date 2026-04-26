const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const { redis } = require('./config/redis');

const server = app.listen(env.port, () => {
  console.log(`Postly API listening on port ${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error('Error during prisma disconnect:', err);
    }
    try {
      if (redis.isOpen) await redis.quit();
    } catch (err) {
      console.error('Error during redis disconnect:', err);
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
