'use strict';

/**
 * AES-256-GCM encryption utility.
 *
 * Design decisions:
 *  - 96-bit (12-byte) IV is the NIST-recommended size for GCM; it maximises
 *    performance and is the only IV length that avoids an extra GHASH call.
 *  - A fresh random IV is generated for every encrypt() call, so the same
 *    plaintext produces a different ciphertext every time.
 *  - The GCM auth tag (128 bits) prevents undetected tampering; decrypt()
 *    will throw if the ciphertext or tag have been modified.
 *  - The key is read once at module load and validated immediately so the
 *    process fails fast on misconfiguration rather than at runtime.
 *  - The encoded envelope is base64(JSON({iv, authTag, content})) — compact,
 *    self-describing, and easy to store in a VARCHAR column.
 *
 * ENV requirements:
 *  ENCRYPTION_KEY — exactly 64 lowercase hex characters (32 bytes).
 *  Generate with:  openssl rand -hex 32
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV — NIST SP 800-38D recommended
const TAG_LENGTH = 16;  // 128-bit GCM authentication tag

// ── Key bootstrap (fail-fast at startup) ────────────────────────────────────

const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;

function loadKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !HEX_KEY_REGEX.test(hex)) {
    throw new Error(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
      'Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

// Validate key at module load time — crash early, not mid-request.
const KEY = loadKey();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param {string} plainText  UTF-8 string to encrypt.
 * @returns {string}          Opaque base64-encoded envelope string.
 */
function encrypt(plainText) {
  if (typeof plainText !== 'string') {
    throw new TypeError('encrypt: plainText must be a string');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope = {
    iv:      iv.toString('base64'),
    authTag: authTag.toString('base64'),
    content: encrypted.toString('base64'),
  };

  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

/**
 * Decrypts an envelope string produced by encrypt().
 *
 * @param {string} encodedData  Opaque base64 envelope from encrypt().
 * @returns {string}            Original plaintext.
 * @throws {Error}              On tampered ciphertext, bad auth tag, or
 *                              malformed envelope.
 */
function decrypt(encodedData) {
  if (typeof encodedData !== 'string') {
    throw new TypeError('decrypt: encodedData must be a string');
  }

  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'));
  } catch {
    throw new Error('decrypt: invalid or corrupted encrypted payload');
  }

  if (!envelope.iv || !envelope.authTag || !envelope.content) {
    throw new Error('decrypt: malformed encrypted envelope — missing fields');
  }

  const iv      = Buffer.from(envelope.iv,      'base64');
  const authTag = Buffer.from(envelope.authTag,  'base64');
  const content = Buffer.from(envelope.content,  'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('decrypt: invalid IV length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  // If the auth tag or ciphertext has been tampered with, .final() throws
  // "Unsupported state or unable to authenticate data".
  const decrypted = Buffer.concat([
    decipher.update(content),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
