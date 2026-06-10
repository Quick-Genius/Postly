'use strict';

const os = require('os');
const logger = require('../utils/logger');

/**
 * Parses an integer env var, clamps to [min, max], logs WARNING on out-of-range,
 * and returns defaultValue when unset or non-parseable.
 *
 * @param {string} name          — env var name for logging
 * @param {string|undefined} raw — process.env value
 * @param {number} defaultValue
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function parseIntEnv(name, raw, defaultValue, min, max) {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const trimmed = raw.trim();
  const num = Number(trimmed);
  if (!Number.isInteger(num)) {
    logger.warn(`Environment variable ${name} could not be parsed as an integer (got "${raw}"). Falling back to default: ${defaultValue}`);
    return defaultValue;
  }
  
  if (num < min || num > max) {
    logger.warn(`Environment variable ${name} is out of range [${min}, ${max}] (got ${num}). Falling back to default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
}

/**
 * @returns {Object} EnvConfig
 */
function loadEnvConfig() {
  let processMode = process.env.PROCESS_MODE;
  if (!processMode || processMode.trim() === '') {
    processMode = 'fork';
  } else {
    processMode = processMode.trim();
    if (!['fork', 'cluster', 'pm2'].includes(processMode)) {
      logger.warn(`Environment variable PROCESS_MODE has unrecognised value "${processMode}". Falling back to default: fork`);
      processMode = 'fork';
    }
  }

  const cpus = os.cpus().length;
  
  const clusterWorkers = parseIntEnv('CLUSTER_WORKERS', process.env.CLUSTER_WORKERS, Math.min(cpus, 4), 1, 32);
  const workerReplicas = parseIntEnv('WORKER_REPLICAS', process.env.WORKER_REPLICAS, 1, 1, 16);
  
  const botReplicas = parseIntEnv('BOT_REPLICAS', process.env.BOT_REPLICAS, 1, 1, 4);
  if (botReplicas > 1) {
    logger.warn('Multiple bot instances running (BOT_REPLICAS > 1). This may cause double-processing of webhooks unless an upstream message queue is in place.');
  }

  const workerThreadPoolSize = parseIntEnv('WORKER_THREAD_POOL_SIZE', process.env.WORKER_THREAD_POOL_SIZE, cpus, 1, 64);
  const healthCheckIntervalMs = parseIntEnv('HEALTH_CHECK_INTERVAL_MS', process.env.HEALTH_CHECK_INTERVAL_MS, 10000, 1000, 300000);

  return Object.freeze({
    processMode,
    clusterWorkers,
    workerReplicas,
    botReplicas,
    workerThreadPoolSize,
    healthCheckIntervalMs
  });
}

module.exports = {
  parseIntEnv,
  loadEnvConfig
};
