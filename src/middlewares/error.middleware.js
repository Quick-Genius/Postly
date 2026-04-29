'use strict';

/**
 * error.middleware.js — 404 + central error handler.
 *
 * Behaviour:
 *  - 5xx errors are logged at error level with full stack and request context.
 *  - 4xx errors are logged at warn level (no stack — they're expected).
 *  - In dev/test, the response body includes the stack to aid debugging.
 *  - In prod, the body never leaks the stack.
 */

const env    = require('../config/env');
const logger = require('../utils/logger').child('HTTP');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: 'Not Found',
    path:  req.originalUrl,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  const requestCtx = {
    method:    req.method,
    path:      req.originalUrl,
    userId:    req.userId ?? null,
    ip:        req.ip,
    requestId: req.headers['x-request-id'] ?? undefined,
  };

  if (status >= 500) {
    logger.error(`Unhandled ${status} on ${req.method} ${req.originalUrl}`, { err, ...requestCtx });
  } else {
    logger.warn(`Client error ${status} on ${req.method} ${req.originalUrl}`, {
      message: err.message,
      ...requestCtx,
    });
  }

  const payload = { error: err.message || 'Internal Server Error' };
  if (!env.isProd && err.stack) payload.stack = err.stack;

  res.status(status).json(payload);
}

module.exports = { notFoundHandler, errorHandler };
