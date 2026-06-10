'use strict';

const { loadEnvConfig } = require('../lib/envConfig');
const { createProcessManager } = require('../lib/processManager');
const { createWatchdog } = require('../lib/watchdog');
const { registerGracefulShutdown } = require('../lib/gracefulShutdown');
const logger = require('../utils/logger').child({ subsystem: 'primary', pid: process.pid });

async function main() {
  const config = loadEnvConfig();

  if (!config.multiProcessEnabled) {
    logger.info('ENABLE_MULTI_PROCESS is disabled — running single-process mode (api + worker + bot in one process)', {
      event: 'single_process_mode'
    });
    require('../server');
    return;
  }

  logger.info('ENABLE_MULTI_PROCESS is enabled — running multi-process mode', {
    event: 'multi_process_mode',
    maxThreads: config.maxThreads,
    clusterWorkers: config.clusterWorkers,
    workerReplicas: config.workerReplicas,
    botReplicas: config.botReplicas
  });

  const manager = createProcessManager(config);

  const watchdog = createWatchdog({
    intervalMs: config.healthCheckIntervalMs,
    processManager: manager
  });

  await manager.start();
  
  const pids = manager.getActivePids();
  
  const apiPids = pids.get('api');
  if (apiPids && apiPids.length > 0) {
    watchdog.register('api', `http://localhost:${process.env.PORT || 3000}/health`, apiPids[0]);
  }
  
  const workerPids = pids.get('worker');
  if (workerPids && workerPids.length > 0) {
    watchdog.register('worker', `http://localhost:${process.env.WORKER_HEALTH_PORT || 3001}/health`, workerPids[0]);
  }

  const botPids = pids.get('bot');
  if (botPids && botPids.length > 0) {
    watchdog.register('bot', `http://localhost:${process.env.BOT_HEALTH_PORT || 3002}/health`, botPids[0]);
  }

  watchdog.start();

  registerGracefulShutdown({
    subsystem: 'primary',
    drainTimeoutMs: 30000,
    drainFn: async () => {
      watchdog.stop();
      await manager.shutdown();
    },
    closeFn: async () => {}
  });
}

main().catch(err => {
  logger.error('Failed to start primary process', { err });
  process.exit(1);
});
