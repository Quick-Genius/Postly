const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Signs an access token embedding both the userId (sub) and the user's email.
 * The email claim allows downstream consumers to cross-validate the token owner
 * without an extra DB round-trip, preventing cross-user identity leakage.
 *
 * @param {string} userId - Internal DB UUID (becomes the `sub` claim).
 * @param {string} [email] - User's email address (becomes the `email` claim).
 */
function signAccessToken(userId, email) {
  const payload = { sub: userId };
  if (email) payload.email = email;
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { signAccessToken, verifyAccessToken };
