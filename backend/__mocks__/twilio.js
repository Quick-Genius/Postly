'use strict';

/**
 * Manual Jest mock for the `twilio` npm package.
 *
 * Placed at <rootDir>/__mocks__/twilio.js so Jest uses it automatically
 * for any require('twilio') call during test runs — no explicit jest.mock()
 * needed in test files.
 *
 * The mock surfaces only the surface area that whatsapp.controller.js uses:
 *   - twilio.validateRequest(authToken, signature, url, body) → boolean
 *   - twilio.twiml.MessagingResponse                          → class
 */

const validateRequest = jest.fn().mockReturnValue(true);

class MessagingResponse {
  constructor() {
    this._messages = [];
  }

  message(text) {
    this._messages.push(text ?? '');
    return this;
  }

  toString() {
    const body = this._messages.join('');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${body}</Message></Response>`;
  }
}

const twilio = jest.fn().mockReturnValue({});

twilio.validateRequest = validateRequest;
twilio.twiml = { MessagingResponse };

module.exports = twilio;
