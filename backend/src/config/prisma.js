const { PrismaClient } = require('@prisma/client');
const env = require('./env');

const prisma = new PrismaClient({
  log: env.isProd ? ['error'] : ['warn', 'error'],
});

// Soft-delete middleware: automatically exclude deleted Post records from all
// read operations. To intentionally query deleted rows, include `deletedAt` in
// the `where` clause (e.g. `where: { deletedAt: { not: null } }`).
prisma.$use(async (params, next) => {
  if (params.model !== 'Post') return next(params);

  const readActions = new Set([
    'findFirst', 'findFirstOrThrow',
    'findMany', 'count', 'aggregate', 'groupBy',
  ]);

  if (readActions.has(params.action)) {
    params.args       = params.args       ?? {};
    params.args.where = params.args.where ?? {};
    if (!('deletedAt' in params.args.where)) {
      params.args.where.deletedAt = null;
    }
  }

  // findUnique only accepts unique-key fields; adding deletedAt breaks it.
  // Downgrade to findFirst so the soft-delete filter can be applied safely.
  if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
    params.args       = params.args       ?? {};
    params.args.where = params.args.where ?? {};
    if (!('deletedAt' in params.args.where)) {
      params.args.where.deletedAt = null;
      params.action =
        params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
    }
  }

  return next(params);
});

module.exports = prisma;
