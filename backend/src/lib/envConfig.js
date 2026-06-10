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
 * Parses a boolean env var ("true"/"1"/"yes"/"on" → true, "false"/"0"/"no"/"off" → false),
 * logs WARNING on unrecognised values, and returns defaultValue when unset or non-parseable.
 *
 * @param {string} name
 * @param {string|undefined} raw
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBoolEnv(name, raw, defaultValue) {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const trimmed = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(trimmed)) return true;
  if (['false', '0', 'no', 'off'].includes(trimmed)) return false;

  logger.warn(`Environment variable ${name} could not be parsed as a boolean (got "${raw}"). Falling back to default: ${defaultValue}`);
  return defaultValue;
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

  // ENABLE_MULTI_PROCESS: when false (default), the app runs as a single
  // process (api + worker + bot all in one) — the lightest footprint, best
  // suited for memory-constrained instances (e.g. Render free tier).
  // When true, primary.js fans out into separate api/worker/bot processes
  // (and clusters the api process), governed by MAX_THREADS below.
  const multiProcessEnabled = parseBoolEnv('ENABLE_MULTI_PROCESS', process.env.ENABLE_MULTI_PROCESS, false);

  // MAX_THREADS caps how many OS processes/threads the multi-process mode
  // is allowed to fan out to. Render containers report the host's CPU count
  // via os.cpus(), which can be much higher than what the instance is
  // actually allotted, so this gives an explicit ceiling.
  const maxThreads = parseIntEnv('MAX_THREADS', process.env.MAX_THREADS, Math.min(cpus, 4), 1, 32);

  const clusterWorkers = Math.min(
    parseIntEnv('CLUSTER_WORKERS', process.env.CLUSTER_WORKERS, Math.min(cpus, 4), 1, 32),
    maxThreads
  );
  const workerReplicas = parseIntEnv('WORKER_REPLICAS', process.env.WORKER_REPLICAS, 1, 1, 16);

  const botReplicas = parseIntEnv('BOT_REPLICAS', process.env.BOT_REPLICAS, 1, 1, 4);
  if (botReplicas > 1) {
    logger.warn('Multiple bot instances running (BOT_REPLICAS > 1). This may cause double-processing of webhooks unless an upstream message queue is in place.');
  }

  const workerThreadPoolSize = Math.min(
    parseIntEnv('WORKER_THREAD_POOL_SIZE', process.env.WORKER_THREAD_POOL_SIZE, cpus, 1, 64),
    maxThreads
  );
  const healthCheckIntervalMs = parseIntEnv('HEALTH_CHECK_INTERVAL_MS', process.env.HEALTH_CHECK_INTERVAL_MS, 10000, 1000, 300000);

  return Object.freeze({
    processMode,
    multiProcessEnabled,
    maxThreads,
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
