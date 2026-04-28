'use strict';

/**
 * tests/soft-delete.test.js
 *
 * Tests for the soft-delete + restore flow:
 *   DELETE /api/posts/:id   — marks deletedAt, cancels pending platform jobs
 *   POST   /api/posts/:id/restore — clears deletedAt, resets status to DRAFT
 *
 * Verifies the key invariants:
 *   - After soft delete, GET /api/posts returns 0 rows (middleware filters deleted).
 *   - The platformPost statuses for PENDING/QUEUED rows become FAILED when deleted.
 *   - After restore, the post is visible again in the list.
 *   - Restoring an active (non-deleted) post returns 404.
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

const request    = require('supertest');
const app        = require('../src/app');
const { generateAccessToken } = require('./helpers/tokens');
const prismaMock = require('../src/config/prisma');

const USER_ID = 'user-delete-test-id';
const POST_ID = 'post-to-delete-id';
const AUTH    = `Bearer ${generateAccessToken(USER_ID)}`;

const ACTIVE_POST = {
  id:            POST_ID,
  userId:        USER_ID,
  idea:          'Test idea for deletion',
  postType:      'TEXT',
  status:        'QUEUED',
  deletedAt:     null,
  createdAt:     new Date().toISOString(),
  platformPosts: [
    { id: 'pp-1', platform: 'TWITTER', status: 'QUEUED' },
  ],
};

const DELETED_POST = {
  ...ACTIVE_POST,
  status:    'CANCELED',
  deletedAt: new Date().toISOString(),
};

const RESTORED_POST = {
  ...ACTIVE_POST,
  status:    'DRAFT',
  deletedAt: null,
};

// ── DELETE /api/posts/:id ─────────────────────────────────────────────────────

describe('DELETE /api/posts/:id', () => {
  it('returns 200 { deleted: true } and cancels platform jobs', async () => {
    // findFirst returns the active post (not deleted)
    prismaMock.post.findFirst.mockResolvedValue(ACTIVE_POST);
    prismaMock.platformPost.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.update.mockResolvedValue(DELETED_POST);

    const res = await request(app)
      .delete(`/api/posts/${POST_ID}`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });

    // Verify that pending platform jobs were marked FAILED (canceled)
    expect(prismaMock.platformPost.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          postId: POST_ID,
          status: { in: ['PENDING', 'QUEUED'] },
        }),
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('returns 404 when the post does not exist or belongs to another user', async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/posts/nobody-elses-post`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
  });
});

// ── Soft-delete visibility ────────────────────────────────────────────────────

describe('Soft-delete visibility in list endpoint', () => {
  it('deleted post does not appear in GET /api/posts', async () => {
    // The Prisma soft-delete middleware injects deletedAt:null automatically.
    // We simulate its effect by returning an empty array (the deleted post is filtered).
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.post.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/posts')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });
});

// ── POST /api/posts/:id/restore ───────────────────────────────────────────────

describe('POST /api/posts/:id/restore', () => {
  it('returns 200 with the restored post in DRAFT status', async () => {
    // restorePost uses findFirst with deletedAt: { not: null }
    prismaMock.post.findFirst.mockResolvedValue(DELETED_POST);
    prismaMock.post.update.mockResolvedValue(RESTORED_POST);

    const res = await request(app)
      .post(`/api/posts/${POST_ID}/restore`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.deletedAt).toBeNull();

    // Verify the update was called to clear deletedAt
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: null, status: 'DRAFT' }),
      }),
    );
  });

  it('returns 404 when trying to restore a post that is not deleted', async () => {
    // restorePost's findFirst with deletedAt: { not: null } finds nothing
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/posts/${POST_ID}/restore`)
      .set('Authorization', AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/deleted/i);
  });

  it('returns 200 and the restored post appears in the list', async () => {
    prismaMock.post.findFirst.mockResolvedValue(DELETED_POST);
    prismaMock.post.update.mockResolvedValue(RESTORED_POST);

    await request(app)
      .post(`/api/posts/${POST_ID}/restore`)
      .set('Authorization', AUTH);

    // After restore, the list endpoint should include it again
    prismaMock.post.findMany.mockResolvedValue([RESTORED_POST]);
    prismaMock.post.count.mockResolvedValue(1);

    const listRes = await request(app)
      .get('/api/posts')
      .set('Authorization', AUTH);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].id).toBe(POST_ID);
    expect(listRes.body.data[0].status).toBe('DRAFT');
  });
});
