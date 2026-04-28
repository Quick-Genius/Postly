'use strict';

/**
 * tests/posts.publish.test.js
 *
 * Tests for:
 *   POST /api/posts/publish  — job creation and response structure
 *   GET  /api/posts/:id      — response includes platformPosts
 *   GET  /api/posts          — list returns paginated envelope
 *
 * Key assertions beyond status codes:
 *   - publishingQueue.add is called exactly once per platform in the payload.
 *   - The created post is returned with all expected fields.
 *   - platformPosts are included with platform + status.
 */

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
  publishingQueue: { add: jest.fn().mockResolvedValue({ id: 'job-mock' }), on: jest.fn() },
  QUEUE_NAME:      'platform-publishing',
  redisConnection: {},
}));

jest.mock('../src/queue/worker', () => ({
  shutdownWorker: jest.fn().mockResolvedValue(undefined),
}));

const request  = require('supertest');
const app      = require('../src/app');
const { generateAccessToken } = require('./helpers/tokens');
const { publishingQueue }     = require('../src/queue/queue');
const prismaMock              = require('../src/config/prisma');

const USER_ID = 'user-publish-test-id';
const AUTH    = `Bearer ${generateAccessToken(USER_ID)}`;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlatformPost(id, platform) {
  return { id, postId: 'post-1', platform, content: 'Test content', status: 'PENDING', publishedAt: null, errorMessage: null, attempts: 0 };
}

const CREATED_POST = {
  id:            'post-1',
  userId:        USER_ID,
  idea:          'Launch our new product',
  postType:      'TEXT',
  tone:          'professional',
  language:      null,
  modelUsed:     null,
  publishAt:     null,
  status:        'QUEUED',
  deletedAt:     null,
  createdAt:     new Date().toISOString(),
  platformPosts: [
    makePlatformPost('pp-1', 'TWITTER'),
    makePlatformPost('pp-2', 'LINKEDIN'),
  ],
};

// ── POST /api/posts/publish ───────────────────────────────────────────────────

describe('POST /api/posts/publish', () => {
  beforeEach(() => {
    prismaMock.post.create.mockResolvedValue(CREATED_POST);
    prismaMock.platformPost.updateMany.mockResolvedValue({ count: 2 });
  });

  it('returns 201 with the created post and its platformPosts', async () => {
    const res = await request(app)
      .post('/api/posts/publish')
      .set('Authorization', AUTH)
      .send({
        idea:      'Launch our new product',
        post_type: 'TEXT',
        tone:      'professional',
        platforms: {
          TWITTER:  { content: 'Twitter content here' },
          LINKEDIN: { content: 'LinkedIn content here that is longer and more professional' },
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id:     'post-1',
      status: 'QUEUED',
    });
    expect(Array.isArray(res.body.data.platformPosts)).toBe(true);
    expect(res.body.data.platformPosts).toHaveLength(2);
  });

  it('enqueues exactly one BullMQ job per platform', async () => {
    publishingQueue.add.mockClear();

    await request(app)
      .post('/api/posts/publish')
      .set('Authorization', AUTH)
      .send({
        idea:      'Launch our new product',
        post_type: 'TEXT',
        platforms: {
          TWITTER:  { content: 'Twitter content' },
          LINKEDIN: { content: 'LinkedIn content' },
        },
      });

    // One job per platform — the core of the publishing pipeline contract.
    expect(publishingQueue.add).toHaveBeenCalledTimes(2);

    const jobNames = publishingQueue.add.mock.calls.map(([name]) => name);
    expect(jobNames).toContain('publish:twitter');
    expect(jobNames).toContain('publish:linkedin');
  });

  it('returns 400 when idea is missing', async () => {
    const res = await request(app)
      .post('/api/posts/publish')
      .set('Authorization', AUTH)
      .send({ platforms: { TWITTER: { content: 'ok' } } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idea/i);
  });

  it('returns 400 when platforms object is empty', async () => {
    const res = await request(app)
      .post('/api/posts/publish')
      .set('Authorization', AUTH)
      .send({ idea: 'Test', platforms: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/platforms/i);
  });

  it('returns 400 when a platform has no content', async () => {
    const res = await request(app)
      .post('/api/posts/publish')
      .set('Authorization', AUTH)
      .send({ idea: 'Test', platforms: { TWITTER: { content: '' } } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content/i);
  });

  it('returns 401 without a valid token', async () => {
    const res = await request(app)
      .post('/api/posts/publish')
      .send({ idea: 'Test', platforms: { TWITTER: { content: 'ok' } } });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/posts/:id ────────────────────────────────────────────────────────

describe('GET /api/posts/:id', () => {
  const FULL_POST = {
    ...CREATED_POST,
    platformPosts: [
      { id: 'pp-1', platform: 'TWITTER',  content: 'Twitter content', status: 'PUBLISHED', publishedAt: new Date().toISOString(), errorMessage: null, attempts: 1 },
      { id: 'pp-2', platform: 'LINKEDIN', content: 'LinkedIn content', status: 'QUEUED',   publishedAt: null, errorMessage: null, attempts: 0 },
    ],
  };

  beforeEach(() => {
    prismaMock.post.findFirst.mockResolvedValue(FULL_POST);
  });

  it('returns the post with all platform statuses', async () => {
    const res = await request(app)
      .get('/api/posts/post-1')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('post-1');

    const platforms = res.body.data.platformPosts;
    expect(Array.isArray(platforms)).toBe(true);

    const twitter  = platforms.find((p) => p.platform === 'TWITTER');
    const linkedin = platforms.find((p) => p.platform === 'LINKEDIN');

    expect(twitter.status).toBe('PUBLISHED');
    expect(twitter.attempts).toBe(1);
    expect(linkedin.status).toBe('QUEUED');
  });

  it('returns 404 for a post that does not belong to this user', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/posts/not-my-post')
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/posts (list) ─────────────────────────────────────────────────────

describe('GET /api/posts', () => {
  beforeEach(() => {
    prismaMock.post.findMany.mockResolvedValue([CREATED_POST]);
    prismaMock.post.count.mockResolvedValue(1);
  });

  it('returns a paginated envelope { data, meta }', async () => {
    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({
      total: 1,
      page:  1,
      limit: expect.any(Number),
    });
  });

  it('returns 400 for an invalid status filter', async () => {
    const res = await request(app)
      .get('/api/posts?status=nonexistent')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/i);
  });
});
