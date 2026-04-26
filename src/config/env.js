require('dotenv').config();

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL', 'ENCRYPTION_KEY'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in the values.',
  );
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS, 10) || 7,
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY,
  // OAuth
  twitterClientId: process.env.TWITTER_CLIENT_ID || '',
  twitterClientSecret: process.env.TWITTER_CLIENT_SECRET || '',
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || '',
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
  oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL || 'http://localhost:3000/api/oauth',
};

env.isProd = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

module.exports = env;
