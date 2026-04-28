'use strict';

/**
 * tests/setup.js — Runs before every test file (configured via jest.setupFiles).
 *
 * Sets the minimum env vars required by fail-fast modules:
 *   - env.js         (throws on missing required vars)
 *   - encryption.js  (validates ENCRYPTION_KEY at module load)
 *
 * Values here are test-only fixtures — never used in production.
 * Setting them before any require() prevents module-load crashes.
 */

process.env.NODE_ENV            = 'test';
process.env.DATABASE_URL        = 'postgresql://test:test@localhost:5432/postly_test';
process.env.REDIS_URL           = 'redis://localhost:6379/1';
process.env.JWT_SECRET          = 'test-jwt-secret-value-that-is-long-enough-32ch';
// 64 valid hex chars = 32 bytes. All-'a' is fine — it just needs to pass the regex.
process.env.ENCRYPTION_KEY      = 'a'.repeat(64);
// bcrypt round 1 keeps test execution fast without breaking the algorithm.
process.env.BCRYPT_SALT_ROUNDS  = '1';
process.env.PORT                = '0';
