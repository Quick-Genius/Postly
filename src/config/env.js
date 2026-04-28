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
  groqApiKey: process.env.GROQ_API_KEY || null,
  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY,
  // OAuth
  twitterClientId: process.env.TWITTER_CLIENT_ID || '',
  twitterClientSecret: process.env.TWITTER_CLIENT_SECRET || '',
  twitterRedirectUri: process.env.TWITTER_REDIRECT_URI || 'http://localhost:3000/api/oauth/twitter/callback',
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || '',
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
  linkedinRedirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/api/oauth/linkedin/callback',
  oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL || 'http://localhost:3000/api/oauth',
  // Telegram Bot (optional — bot feature is disabled when not set)
  telegramBotToken:      process.env.TELEGRAM_BOT_TOKEN      || null,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
  // Twilio / WhatsApp Bot (optional — signature validation skipped when absent)
  twilioAccountSid:      process.env.TWILIO_ACCOUNT_SID      || null,
  twilioAuthToken:       process.env.TWILIO_AUTH_TOKEN       || null,
  twilioWhatsappNumber:  process.env.TWILIO_WHATSAPP_NUMBER  || null,
  // Public base URL of this deployment — used for webhook registration and
  // Twilio signature validation. Must be set in production.
  baseUrl: process.env.BASE_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  // Keep APP_URL as a legacy alias so existing code (whatsapp.controller) works.
  get appUrl() { return this.baseUrl; },
};

env.isProd = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

module.exports = env;
