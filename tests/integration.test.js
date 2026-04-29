'use strict';

/**
 * tests/integration.test.js
 *
 * End-to-end flow through the real Express app with mocked I/O:
 *   1. Register  → POST /api/auth/register
 *   2. Login     → POST /api/auth/login
 *   3. Publish   → POST /api/posts/publish (with access token from step 2)
 *   4. Fetch     → GET  /api/posts/:id     (verify DB entries via response)
 *
 * The DB, Redis, and queue are mocked — but bcrypt, JWT, and all service
 * logic run for real. The mock state is tracked across steps so each
 * call sees the data written by the previous one.
 *
 * What this proves:
 *   - The auth flow produces tokens that downstream routes accept.
 *   - The publish flow creates a post with platformPosts and enqueues jobs.
 *   - The response shapes match the documented API contract end-to-end.
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../src/config/prisma', () => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  $use:      jest.fn(),
  post:         { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() },
  platformPost: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  user:         { create: jest.fn(), findUnique: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
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
  publishingQueue: { add: jest.fn().mockResolvedValue({ id: 'job-integration' }), on: jest.fn() },
  QUEUE_NAME:      'platform-publishing',
  redisConnection: {},
}));

jest.mock('../src/queue/worker', () => ({
  shutdownWorker: jest.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

const request    = require('supertest');
const app        = require('../src/app');
const prismaMock = require('../src/config/prisma');
const { publishingQueue } = require('../src/queue/queue');

// ── In-memory DB state shared across the integration steps ────────────────────

// State is populated by mock implementations below and read by later steps.
let registeredUser = null;    // set after register
let storedRefreshToken = null; // set after register / login
let createdPost = null;        // set after publish

// ── Full integration flow ─────────────────────────────────────────────────────

describe('Full user flow: register → login → publish → fetch post', () => {
  const EMAIL    = `integration-${Date.now()}@postly.test`;
  const PASSWORD = 'TestPassword1!';

  // Tokens extracted across steps
  let accessToken  = null;
  let refreshToken = null;
  let postId       = null;

  // ── Step 1: Register ────────────────────────────────────────────────────────

  it('Step 1 — registers a new user and returns an access + refresh token', async () => {
    // No existing user
    prismaMock.user.findUnique.mockResolvedValue(null);

    prismaMock.user.create.mockImplementation(async ({ data }) => {
      registeredUser = {
        id:           'integration-user-1',
        email:        data.email,
        passwordHash: data.passwordHash,   // kept for login step (bcrypt compare)
        name:         data.name,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };
      // Prisma's select clause in register() returns only id, email, name, createdAt.
      // The mock must match that behaviour — passwordHash must NOT appear in the
      // returned object even though we save it to `registeredUser` for step 2 (login).
      const { passwordHash: _pw, updatedAt: _ua, ...selected } = registeredUser;
      return selected;
    });

    prismaMock.refreshToken.create.mockImplementation(async ({ data }) => {
      storedRefreshToken = data.tokenHash;
      return { id: 'rt-1', ...data };
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD, name: 'Integration Tester' });

    expect(res.status).toBe(201);

    // Both tokens must be present
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');

    // User object — no password material
    expect(res.body.user).toMatchObject({ email: EMAIL, name: 'Integration Tester' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    accessToken  = res.body.access_token;
    refreshToken = res.body.refresh_token;

    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  // ── Step 2: Login ───────────────────────────────────────────────────────────

  it('Step 2 — logs in and returns a fresh token pair', async () => {
    // Return the user that was "stored" in step 1 (with real bcrypt hash)
    prismaMock.user.findUnique.mockResolvedValue(registeredUser);

    prismaMock.refreshToken.create.mockImplementation(async ({ data }) => {
      storedRefreshToken = data.tokenHash;
      return { id: 'rt-2', ...data };
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');

    // Update tokens for subsequent steps
    accessToken  = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('Step 2b — rejects login with the wrong password', async () => {
    prismaMock.user.findUnique.mockResolvedValue(registeredUser);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  // ── Step 3: Publish a post ──────────────────────────────────────────────────

  it('Step 3 — publishes a post using the access token from login', async () => {
    const platformPosts = [
      { id: 'pp-int-1', postId: 'post-int-1', platform: 'TWITTER',  content: 'Twitter draft', status: 'PENDING', attempts: 0, publishedAt: null, errorMessage: null },
      { id: 'pp-int-2', postId: 'post-int-1', platform: 'LINKEDIN', content: 'LinkedIn draft', status: 'PENDING', attempts: 0, publishedAt: null, errorMessage: null },
    ];

    createdPost = {
      id:            'post-int-1',
      userId:        'integration-user-1',
      idea:          'Launch Postly to the world',
      postType:      'TEXT',
      tone:          'professional',
      language:      null,
      modelUsed:     null,
      publishAt:     null,
      status:        'QUEUED',
      deletedAt:     null,
      createdAt:     new Date().toISOString(),
      platformPosts,
    };

    prismaMock.post.create.mockResolvedValue(createdPost);
    prismaMock.platformPost.updateMany.mockResolvedValue({ count: 2 });
    publishingQueue.add.mockClear();

    const res = await request(app)
      .post('/api/posts/publish')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        idea:      'Launch Postly to the world',
        post_type: 'TEXT',
        tone:      'professional',
        platforms: {
          TWITTER:  { content: 'Twitter draft' },
          LINKEDIN: { content: 'LinkedIn draft' },
        },
      });

    expect(res.status).toBe(201);

    postId = res.body.data.id;
    expect(postId).toBe('post-int-1');

    // Verify the post structure returned
    expect(res.body.data.status).toBe('QUEUED');
    expect(res.body.data.platformPosts).toHaveLength(2);

    // Verify BullMQ received exactly 2 jobs — one per platform
    expect(publishingQueue.add).toHaveBeenCalledTimes(2);
  });

  // ── Step 4: Fetch the post ──────────────────────────────────────────────────

  it('Step 4 — fetches the published post and verifies its structure', async () => {
    prismaMock.post.findFirst.mockResolvedValue(createdPost);

    const res = await request(app)
      .get(`/api/posts/${postId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    const post = res.body.data;
    expect(post.id).toBe('post-int-1');
    expect(post.idea).toBe('Launch Postly to the world');

    // All platform rows are present with correct initial status
    expect(post.platformPosts).toHaveLength(2);
    for (const pp of post.platformPosts) {
      expect(pp).toHaveProperty('platform');
      expect(pp).toHaveProperty('status');
      expect(['TWITTER', 'LINKEDIN']).toContain(pp.platform);
    }
  });

  // ── Auth edge cases ─────────────────────────────────────────────────────────

  it('Rejects protected routes when no token is supplied', async () => {
    const res = await request(app).get('/api/posts');
    expect(res.status).toBe(401);
  });

  it('Returns 409 when registering with an already-used email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(registeredUser);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD, name: 'Duplicate' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });
});
