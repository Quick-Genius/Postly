'use strict';

/**
 * tests/auth.middleware.test.js
 *
 * Unit tests for requireAuth and attachUserIfPresent.
 * These functions only use jwt.js + env.js — no DB, Redis, or queue needed.
 * We test the middleware functions directly with mock req/res/next objects.
 */

const { requireAuth, attachUserIfPresent } = require('../src/middlewares/auth.middleware');
const {
  generateAccessToken,
  generateExpiredToken,
  generateTokenWithWrongSecret,
} = require('./helpers/tokens');

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeReq(authorizationHeader) {
  return { headers: { authorization: authorizationHeader ?? '' } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  it('populates req.userId and calls next() for a valid Bearer token', () => {
    const token = generateAccessToken('user-42');
    const req   = makeReq(`Bearer ${token}`);
    const res   = makeRes();

    requireAuth(req, res, next);

    expect(req.userId).toBe('user-42');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 with "Token expired" for an expired token', () => {
    const token = generateExpiredToken('user-42');
    const req   = makeReq(`Bearer ${token}`);
    const res   = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Token expired' }),
    );
  });

  it('returns 401 when the Authorization header is absent', () => {
    const req = makeReq('');
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Missing') }),
    );
  });

  it('returns 401 when using Basic scheme instead of Bearer', () => {
    const token = generateAccessToken();
    const req   = makeReq(`Basic ${token}`);
    const res   = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for a token signed with the wrong secret', () => {
    const token = generateTokenWithWrongSecret('user-42');
    const req   = makeReq(`Bearer ${token}`);
    const res   = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Invalid token' }),
    );
  });

  it('returns 401 for a structurally malformed token string', () => {
    const req = makeReq('Bearer not.a.jwt');
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── attachUserIfPresent ───────────────────────────────────────────────────────

describe('attachUserIfPresent', () => {
  let next;

  beforeEach(() => {
    next = jest.fn();
  });

  it('sets req.userId and still calls next() for a valid token', () => {
    const token = generateAccessToken('user-99');
    const req   = makeReq(`Bearer ${token}`);
    const res   = makeRes();

    attachUserIfPresent(req, res, next);

    expect(req.userId).toBe('user-99');
    expect(next).toHaveBeenCalledTimes(1);
    // Unlike requireAuth — never sends a response
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() without setting req.userId when no header is present', () => {
    const req = makeReq('');
    const res = makeRes();

    attachUserIfPresent(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() without setting req.userId for an expired token', () => {
    const token = generateExpiredToken();
    const req   = makeReq(`Bearer ${token}`);
    const res   = makeRes();

    attachUserIfPresent(req, res, next);

    // Should not reject — the downstream requireAuth on protected routes does that.
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
  });
});
