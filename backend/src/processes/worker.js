'use strict';

const express = require('express');
const { worker, shutdownWorker } = require('../queue/worker');
const { startScheduler, stopScheduler } = require('../queue/scheduler');
const { registerGracefulShutdown } = require('../lib/gracefulShutdown');
const { createHealthRouter } = require('../routes/health.routes');
const logger = require('../utils/logger').child({ subsystem: 'worker', pid: process.pid });

startScheduler();

const app = express();
app.use('/health', createHealthRouter('worker'));

const port = process.env.WORKER_HEALTH_PORT || 3001;
app.listen(port, () => {
  logger.info(`Worker health server listening on port ${port}`);
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
  subsystem: 'worker',
  drainTimeoutMs: 15000,
  drainFn: async () => {
    stopScheduler();
    await shutdownWorker();
  },
  closeFn: async () => {
    const prisma = require('../config/prisma');
    try { await prisma.$disconnect(); } catch (e) {}
  }
});
