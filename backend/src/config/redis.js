const { createClient } = require('redis');
const env = require('./env');

const redis = createClient({ url: env.redisUrl });

redis.on('error', (err) => {
  if (!env.isTest) {
    // eslint-disable-next-line no-console
    console.error('Redis client error:', err.message);
  }
});

let connectPromise = null;
async function connectRedis() {
  if (redis.isOpen) return redis;
  if (!connectPromise) {
    connectPromise = redis.connect().catch((err) => {
      connectPromise = null; // allow retry on next call
      throw err;
    });
  }
  await connectPromise;
  return redis;
}

module.exports = { redis, connectRedis };
