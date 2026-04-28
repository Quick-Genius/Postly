'use strict';

/**
 * tests/helpers/tokens.js — JWT generation helpers for test suites.
 *
 * Uses the real jsonwebtoken library against the test secret so the tokens
 * pass through the real auth middleware without any additional mocking.
 */

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function generateAccessToken(userId = 'test-user-id') {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '15m' });
}

function generateExpiredToken(userId = 'test-user-id') {
  // expiresIn: 0 makes the token expired the moment it is issued.
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: 0 });
}

function generateTokenWithWrongSecret(userId = 'test-user-id') {
  return jwt.sign({ sub: userId }, 'completely-wrong-secret', { expiresIn: '15m' });
}

module.exports = { generateAccessToken, generateExpiredToken, generateTokenWithWrongSecret };
