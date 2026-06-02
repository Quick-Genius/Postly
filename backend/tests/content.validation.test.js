'use strict';

/**
 * tests/content.validation.test.js
 *
 * Tests content generation INPUT VALIDATION via the HTTP layer.
 * All tests expect 400 responses — the AI providers are never reached.
 *
 * Mocks: prisma, redis, queue, worker (needed because app.js loads them at startup).
 * The content service's validateInput() is what we're really exercising here.
 */

jest.mock('../src/config/prisma', () => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  $use:      jest.fn(),
  post:           { findMany: jest.fn(), count: jest.fn() },
  platformPost:   { findMany: jest.fn() },
  user:           { findUnique: jest.fn() },
  refreshToken:   { findUnique: jest.fn() },
}));

jest.mock('../src/config/redis', () => {
  const client = {
    get:    jest.fn().mockResolvedValue(null),
    set:    jest.fn().mockResolvedValue('OK'),
    setEx:  jest.fn().mockResolvedValue('OK'),
    del:    jest.fn().mockResolvedValue(1),
    incr:   jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl:    jest.fn().mockResolvedValue(900),
    ping:   jest.fn().mockResolvedValue('PONG'),
    on:     jest.fn(),
    isOpen: true,
  };
  return { redis: client, connectRedis: jest.fn().mockResolvedValue(client) };
});

jest.mock('../src/queue/queue', () => ({
  publishingQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }), on: jest.fn() },
  QUEUE_NAME:      'platform-publishing',
  redisConnection: {},
}));

jest.mock('../src/queue/worker', () => ({
  shutdownWorker: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app     = require('../src/app');
const { generateAccessToken } = require('./helpers/tokens');

const AUTH = `Bearer ${generateAccessToken('user-validation-test')}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function postGenerate(body) {
  return request(app)
    .post('/api/content/generate')
    .set('Authorization', AUTH)
    .send(body);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/content/generate — input validation', () => {
  it('returns 400 when idea is missing', async () => {
    const res = await postGenerate({
      post_type: 'announcement',
      platforms: ['twitter'],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea/i);
  });

  it('returns 400 when idea exceeds 500 characters', async () => {
    const res = await postGenerate({
      idea:      'x'.repeat(501),
      post_type: 'announcement',
      platforms: ['twitter'],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });

  it('returns 400 for an empty-string idea', async () => {
    const res = await postGenerate({
      idea:      '   ',
      post_type: 'announcement',
      platforms: ['twitter'],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea/i);
  });

  it('returns 400 when post_type is invalid', async () => {
    const res = await postGenerate({
      idea:      'Test idea',
      post_type: 'invalid_type',
      platforms: ['twitter'],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/post_type/i);
  });

  it('returns 400 when platforms array is empty', async () => {
    const res = await postGenerate({
      idea:      'Test idea',
      post_type: 'announcement',
      platforms: [],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platforms/i);
  });

  it('returns 400 for an unsupported platform value', async () => {
    const res = await postGenerate({
      idea:      'Test idea',
      post_type: 'announcement',
      platforms: ['tiktok'],
      tone:      'professional',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('returns 400 when tone is invalid', async () => {
    const res = await postGenerate({
      idea:      'Test idea',
      post_type: 'announcement',
      platforms: ['twitter'],
      tone:      'aggressive',
      model:     'openai',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tone/i);
  });

  it('returns 400 when model is not openai or anthropic', async () => {
    const res = await postGenerate({
      idea:      'Test idea',
      post_type: 'announcement',
      platforms: ['twitter'],
      tone:      'professional',
      model:     'gemini',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/i);
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .send({ idea: 'Test idea', post_type: 'announcement', platforms: ['twitter'], tone: 'professional', model: 'openai' });

    expect(res.status).toBe(401);
  });
});
