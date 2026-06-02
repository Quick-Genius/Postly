const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Placeholder hash — auth lands in a later PR. Real hashes will come
// from bcrypt at registration time. This value is *not* a valid login.
const PLACEHOLDER_PASSWORD_HASH = '$2b$10$seed.placeholder.hash.never.used.for.real.login.xxxxxx';

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@postly.dev' },
    update: {},
    create: {
      email: 'demo@postly.dev',
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      name: 'Demo User',
      bio: 'Building in public with Postly.',
      defaultTone: 'casual',
      defaultLanguage: 'en',
    },
  });

  await prisma.socialAccount.upsert({
    where: {
      userId_platform: { userId: user.id, platform: 'TWITTER' },
    },
    update: {},
    create: {
      userId: user.id,
      platform: 'TWITTER',
      accessTokenEnc: 'enc::dev-placeholder-access-token',
      refreshTokenEnc: 'enc::dev-placeholder-refresh-token',
      handle: '@demo_postly',
    },
  });

  const existingPosts = await prisma.post.count({ where: { userId: user.id } });
  if (existingPosts === 0) {
    await prisma.post.create({
      data: {
        userId: user.id,
        idea: 'Why developer experience matters more than ever in 2026',
        postType: 'TEXT',
        tone: 'professional',
        language: 'en',
        status: 'DRAFT',
        platformPosts: {
          create: [
            {
              platform: 'TWITTER',
              content:
                'DX is the new UX. Teams that win in 2026 obsess over their developer experience — every minute saved compounds.',
              status: 'PENDING',
            },
          ],
        },
      },
    });

    await prisma.post.create({
      data: {
        userId: user.id,
        idea: 'Lessons from shipping my first AI product',
        postType: 'TEXT',
        tone: 'casual',
        language: 'en',
        status: 'DRAFT',
      },
    });
  }

  console.log(`Seed complete. Demo user: ${user.email}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
