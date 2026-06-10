'use strict';

const express = require('express');
const { bot, handleWebhook } = require('../bot/telegram/bot');
const { createSubscriber } = require('../lib/ipcChannel');
const { registerGracefulShutdown } = require('../lib/gracefulShutdown');
const { createHealthRouter } = require('../routes/health.routes');
const logger = require('../utils/logger').child({ subsystem: 'bot', pid: process.pid });

const app = express();
app.use('/health', createHealthRouter('bot'));

const ipc = createSubscriber(process.env.REDIS_URL || 'redis://localhost:6379', (channel, msg) => {
  if (msg.type === 'account_linked') {
    return;
  }
  logger.warn('Unknown IPC message type — discarding', { type: msg.type, raw: msg });
});

ipc.connect().catch(e => logger.error('IPC connect failed', { err: e }));

const port = process.env.BOT_HEALTH_PORT || 3002;
app.listen(port, () => {
  logger.info(`Bot health server listening on port ${port}`);
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { err });
  process.kill(process.pid, 'SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason });
  process.kill(process.pid, 'SIGTERM');
});

registerGracefulShutdown({
  subsystem: 'bot',
  drainTimeoutMs: 10000,
  drainFn: async () => {
    await ipc.close();
  },
  closeFn: async () => {
    const prisma = require('../config/prisma');
    try { await prisma.$disconnect(); } catch (e) {}
  }
});
