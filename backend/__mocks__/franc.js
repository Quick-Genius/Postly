'use strict';

/**
 * Manual Jest mock for the `franc` ESM-only package.
 *
 * franc v6+ is pure ESM (uses `import` statements), which Jest's default
 * CJS transformer cannot parse. Since our test suites only care about
 * the validation/publishing layers (not language detection), we mock
 * franc to always return 'eng' (English, ISO 639-3).
 *
 * Placed at <rootDir>/__mocks__/franc.js so Jest uses it automatically
 * for any require('franc') call during test runs.
 */

function franc(_text, _options) {
  return 'eng';
}

module.exports = { franc };
