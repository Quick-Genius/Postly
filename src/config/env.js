require('dotenv').config();

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

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
  redisUrl: process.env.REDIS_URL || null,
  jwtSecret: process.env.JWT_SECRET,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
};

env.isProd = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

module.exports = env;
