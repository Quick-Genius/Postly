const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const healthRouter = require('./routes/health.routes');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.disable('x-powered-by');

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (!env.isTest) {
  app.use(morgan(env.isProd ? 'combined' : 'dev'));
}

app.use('/health', healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
