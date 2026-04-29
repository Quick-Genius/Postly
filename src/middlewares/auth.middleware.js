const { verifyAccessToken } = require('../utils/jwt');

function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ error: message });
}

// Extract token from Authorization header (Bearer token) or query param (?token=...)
function extractToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, headerToken] = header.split(' ');

  if (scheme === 'Bearer' && headerToken) {
    return headerToken;
  }

  return req.query?.token || null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
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

// Accepts token from Authorization header (Bearer) or query param (?token=...).
// Populates req.userId if a valid token is present, but allows the request to
// proceed even if missing or invalid. Controllers must validate req.userId
// presence if authentication is required for the flow.
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    if (payload?.sub) req.userId = payload.sub;
  } catch (_err) {
    // Ignore — controller will reject if authentication is required.
  }
  return next();
}

// Populates req.userId when a valid Bearer token is present, but does
// not reject the request when it is missing or invalid. Used to let
// downstream middleware (e.g. rate limiting) key on user_id when
// available without forcing every endpoint to be authenticated.
function attachUserIfPresent(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    if (payload?.sub) req.userId = payload.sub;
  } catch (_err) {
    // Ignore — requireAuth will reject if the route demands it.
  }
  return next();
}

module.exports = { requireAuth, optionalAuth, attachUserIfPresent };
