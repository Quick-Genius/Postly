const env = require('../config/env');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.message || 'Internal Server Error',
  };
  if (!env.isProd && err.stack) {
    payload.stack = err.stack;
  }
  res.status(status).json(payload);
}

module.exports = { notFoundHandler, errorHandler };
