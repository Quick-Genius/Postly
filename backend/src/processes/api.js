'use strict';

const cluster = require('cluster');
const { loadEnvConfig } = require('../lib/envConfig');
const { createWorkerThreadPool } = require('../lib/workerThreadPool');
const { createPublisher } = require('../lib/ipcChannel');
const { registerGracefulShutdown } = require('../lib/gracefulShutdown');
const logger = require('../utils/logger').child({ subsystem: 'api', pid: process.pid });

if (cluster.isPrimary) {
  const config = loadEnvConfig();
  for (let i = 0; i < config.clusterWorkers; i++) {
    cluster.fork();
  }

  const { createCrashLoopGuard } = require('../lib/crashLoopGuard');
  const slots = new Map();

  cluster.on('fork', (worker) => {
    if (!slots.has(worker.id)) {
      slots.set(worker.id, createCrashLoopGuard({ windowMs: 60000, maxRestarts: 6 }));
    }
  });

  cluster.on('exit', (worker, code, signal) => {
    logger.warn('Cluster worker exited', { pid: worker.process.pid, code, signal });
    const guard = slots.get(worker.id);
    if (guard) {
      const halted = guard.record(worker.process.pid);
      if (halted) {
        logger.error('Crash loop halted for API worker slot', {
          event: 'crash_loop_halted',
          subsystem: 'api',
          restartHistory: guard.getHistory(),
          windowMs: 60000
        });
      } else {
        setTimeout(() => cluster.fork(), 1000);
      }
    }
  });
} else {
  const app = require('../app');
  const config = loadEnvConfig();
  
  const pool = createWorkerThreadPool({
    minThreads: 2,
    maxThreads: config.workerThreadPoolSize
  });
  app.locals.threadPool = pool;

  const ipc = createPublisher(process.env.REDIS_URL || 'redis://localhost:6379');
  app.locals.ipcPublisher = ipc;
  global.ipcPublisher = ipc;

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    logger.info(`API Process listening on port ${port}`);
  });

  registerGracefulShutdown({
    subsystem: 'api',
    drainTimeoutMs: 5000,
    drainFn: () => new Promise(resolve => server.close(resolve)),
    closeFn: async () => {
      await pool.shutdown();
      await ipc.close();
      const prisma = require('../config/prisma');
      try { await prisma.$disconnect(); } catch (e) {}
    }
  });
}
