const env = require('../config/env');
const { redis, connectRedis } = require('../config/redis');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({
  max = env.rateLimitMax,
  windowMs = env.rateLimitWindowMs,
  prefix = 'rl',
} = {}) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async function rateLimitMiddleware(req, res, next) {
    try {
      await connectRedis();

      const id = req.userId ? `user:${req.userId}` : `ip:${clientIp(req)}`;
      const key = `${prefix}:${id}`;

      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      const remaining = Math.max(0, max - count);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);

      if (count > max) {
        const ttl = await redis.ttl(key);
        const retryAfter = ttl > 0 ? ttl : windowSec;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ error: 'Too many requests' });
      }

      return next();
    } catch (err) {
      // Fail-open: if Redis is unreachable, do not block legitimate traffic.
      // The error is surfaced via the redis client's 'error' listener.
      return next();
    }
  };
}

module.exports = { rateLimit };
