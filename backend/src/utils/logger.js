'use strict';

/**
 * logger.js — Lightweight structured logger.
 *
 * Levels:  debug < info < warn < error
 * Output:  ISO timestamp, level, scope, message, optional JSON context.
 * Sink:    stdout for debug/info, stderr for warn/error (Render captures both).
 *
 * Usage:
 *   const log = require('../utils/logger').child('Worker');
 *   log.info('Job started', { jobId, postId });
 *   log.error('Job failed', { jobId, err });   // Error objects auto-serialize.
 *
 * Context-aware logging:
 *   const log = baseLogger.child('WhatsApp', { chatId: '+91...' });
 *   log.warn('Unknown command');               // chatId included automatically.
 *
 * Design notes:
 *  - No external dependency — uses console under the hood, so existing log
 *    plumbing (Render, Docker, journalctl) keeps working.
 *  - Errors are serialised with name/message/stack so stack traces survive
 *    JSON.stringify (which by default drops non-enumerable Error properties).
 *  - LOG_LEVEL env var gates output; defaults to 'info' in prod, 'debug' otherwise.
 */

const env = require('../config/env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLevel() {
  const raw = (process.env.LOG_LEVEL || (env.isProd ? 'info' : 'debug')).toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

const ACTIVE_LEVEL = resolveLevel();

function serializeError(err) {
  if (!err || typeof err !== 'object') return err;
  return {
    name:    err.name,
    message: err.message,
    stack:   err.stack,
    ...(err.code  ? { code:  err.code  } : {}),
    ...(err.cause ? { cause: serializeError(err.cause) } : {}),
  };
}

function serializeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v instanceof Error) out[k] = serializeError(v);
    else if (k === 'err' || k === 'error') out[k] = serializeError(v);
    else out[k] = v;
  }
  return out;
}

function emit(level, scope, baseCtx, message, ctx) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const merged = { ...(baseCtx || {}), ...serializeContext(ctx) };
  const parts  = [
    new Date().toISOString(),
    level.toUpperCase().padEnd(5),
    scope ? `[${scope}]` : '',
    message,
  ].filter(Boolean);

  const line = parts.join(' ');
  const sink = level === 'warn' || level === 'error' ? console.error : console.log;

  if (Object.keys(merged).length > 0) {
    sink(line, JSON.stringify(merged));
  } else {
    sink(line);
  }
}

function build(scope, baseCtx) {
  return {
    debug: (msg, ctx) => emit('debug', scope, baseCtx, msg, ctx),
    info:  (msg, ctx) => emit('info',  scope, baseCtx, msg, ctx),
    warn:  (msg, ctx) => emit('warn',  scope, baseCtx, msg, ctx),
    error: (msg, ctx) => emit('error', scope, baseCtx, msg, ctx),
    child: (childScope, childCtx) => build(
      scope ? `${scope}:${childScope}` : childScope,
      { ...(baseCtx || {}), ...(childCtx || {}) },
    ),
  };
}

const root = build(null, null);

module.exports = root;
module.exports.LEVELS = LEVELS;
