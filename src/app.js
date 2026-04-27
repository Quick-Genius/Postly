const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const healthRouter = require('./routes/health.routes');
const authRouter = require('./routes/auth.routes');
const userRouter = require('./routes/user.routes');
const oauthRouter     = require('./routes/oauth.routes');
const contentRouter   = require('./routes/content.routes');
const postsRouter     = require('./routes/posts.routes');
const dashboardRouter = require('./routes/dashboard.routes');
const telegramRouter  = require('./routes/telegram.routes');
const { attachUserIfPresent } = require('./middlewares/auth.middleware');
const { rateLimit } = require('./middlewares/rateLimit.middleware');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (!env.isTest) {
  app.use(morgan(env.isProd ? 'combined' : 'dev'));
}

app.use('/health', healthRouter);

// API: identify caller (if authenticated) before rate limiting so the
// limiter can key on user_id; falls back to IP for unauthenticated.
app.use('/api', attachUserIfPresent, rateLimit());
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/oauth',   oauthRouter);
app.use('/api/content',   contentRouter);
app.use('/api/posts',     postsRouter);
app.use('/api/dashboard', dashboardRouter);
// Telegram webhook — mounted outside JWT auth; secured by TELEGRAM_WEBHOOK_SECRET
app.use('/api/telegram',  telegramRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
