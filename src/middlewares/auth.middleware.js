const { verifyAccessToken } = require('../utils/jwt');

function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ error: message });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return unauthorized(res, 'Missing or malformed Authorization header');
  }

  try {
    const payload = verifyAccessToken(token);
    if (!payload?.sub) return unauthorized(res, 'Invalid token');
    req.userId = payload.sub;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired');
    return unauthorized(res, 'Invalid token');
  }
}

// Populates req.userId when a valid Bearer token is present, but does
// not reject the request when it is missing or invalid. Used to let
// downstream middleware (e.g. rate limiting) key on user_id when
// available without forcing every endpoint to be authenticated.
function attachUserIfPresent(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const payload = verifyAccessToken(token);
    if (payload?.sub) req.userId = payload.sub;
  } catch (_err) {
    // Ignore — requireAuth will reject if the route demands it.
  }
  return next();
}

module.exports = { requireAuth, attachUserIfPresent };
