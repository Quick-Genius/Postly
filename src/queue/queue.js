'use strict';

/**
 * queue.js — BullMQ Queue singleton for the Postly publishing pipeline.
 *
 * Design notes:
 *  - BullMQ requires an ioredis-compatible connection, distinct from the
 *    node-redis client used elsewhere in the app. We parse REDIS_URL and
 *    pass it as a connection config object so we never maintain two
 *    top-level Redis clients in the same process — the Queue and Worker
 *    each create their own ioredis connection under the hood.
 *  - The queue is exported as a singleton. Importing this module twice
 *    returns the same Queue instance.
 *  - `defaultJobOptions` are intentionally conservative — the actual
 *    retry/backoff config lives in publish.service.js when jobs are added,
 *    so callers have full control per job type without touching this file.
 */

const { Queue } = require('bullmq');

// ── Redis connection config ───────────────────────────────────────────────────

/**
 * Parses a Redis URL string into the connection object BullMQ expects.
 * Supports: redis://[user:pass@]host[:port][/db]
 *
 * @param {string} url
 * @returns {{ host: string, port: number, password?: string, db?: number }}
 */
function parseRedisUrl(url) {
  const parsed = new URL(url);
  const config = {
    host: parsed.hostname || '127.0.0.1',
    port: parseInt(parsed.port, 10) || 6379,
  };
  if (parsed.password) config.password = decodeURIComponent(parsed.password);
  if (parsed.pathname && parsed.pathname !== '/') {
    const db = parseInt(parsed.pathname.slice(1), 10);
    if (!Number.isNaN(db)) config.db = db;
  }
  return config;
}

const redisConnection = parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:6379');

// ── Queue name ────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'platform-publishing';

// ── Queue singleton ───────────────────────────────────────────────────────────

const publishingQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    // Jobs are removed from the completed set after 24 h to keep Redis lean.
    removeOnComplete: { age: 86_400 },
    // Failed jobs are kept for 7 days for inspection/manual retry.
    removeOnFail: { age: 604_800 },
  },
});

publishingQueue.on('error', (err) => {
  // Queue-level errors (e.g. Redis connection drops). Never crash the process.
  console.error('[Queue] BullMQ queue error:', err.message);
});

module.exports = { publishingQueue, QUEUE_NAME, redisConnection };
