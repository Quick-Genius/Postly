const bcrypt = require('bcrypt');
const crypto = require('crypto');
const env = require('../config/env');

function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptSaltRounds);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateOpaqueToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  sha256,
};
