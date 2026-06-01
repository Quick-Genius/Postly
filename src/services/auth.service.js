const prisma = require('../config/prisma');
const env = require('../config/env');
const { hashPassword, verifyPassword, generateOpaqueToken, sha256 } = require('../utils/hash');
const { signAccessToken } = require('../utils/jwt');

const REFRESH_TTL_MS = () => env.jwtRefreshExpiresInDays * 24 * 60 * 60 * 1000;

class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function issueRefreshToken(userId) {
  const raw = generateOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS()),
    },
  });
  return raw;
}

async function issueTokenPair(userId) {
  const [accessToken, refreshToken] = await Promise.all([
    Promise.resolve(signAccessToken(userId)),
    issueRefreshToken(userId),
  ]);
  return { access_token: accessToken, refresh_token: refreshToken };
}

async function register({ email, password, name }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError('Email already registered', 409);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  const tokens = await issueTokenPair(user.id);
  return { user, ...tokens };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always run a compare to avoid leaking account existence via timing.
  const dummyHash = '$2b$12$abcdefghijklmnopqrstuuQ7G3M8gK5nW3kJ8wH9oP2qR1sT4uV5xW';
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : (await verifyPassword(password, dummyHash), false);

  if (!user || !ok) {
    throw new AuthError('Invalid credentials', 401);
  }

  return issueTokenPair(user.id);
}

async function upsertClerkUser({ clerkId, email, name, role }) {
  let user = await prisma.user.findUnique({ where: { clerkId } });

  if (!user) {
    // Check if a user with this email already exists without a clerkId
    user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Link the existing account to Clerk
      user = await prisma.user.update({
        where: { id: user.id },
        data: { 
          clerkId, 
          name: name || user.name,
          role: role || user.role,
        },
      });
    } else {
      // Create a new user
      const dummyPasswordHash = await hashPassword(generateOpaqueToken());
      user = await prisma.user.create({
        data: {
          email,
          clerkId,
          name: name || 'Clerk User',
          passwordHash: dummyPasswordHash, // clerk users don't use this, but DB requires it
          role: role || 'USER',
        },
      });
    }
  }

  return issueTokenPair(user.id);
}

async function rotateRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    throw new AuthError('Invalid refresh token', 401);
  }

  const tokenHash = sha256(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored) {
    throw new AuthError('Invalid refresh token', 401);
  }

  if (stored.expiresAt <= new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => {});
    throw new AuthError('Refresh token expired', 401);
  }

  // Rotate atomically: invalidate the presented token before issuing the new pair.
  await prisma.refreshToken.delete({ where: { id: stored.id } });
  return issueTokenPair(stored.userId);
}

async function logout(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return;
  await prisma.refreshToken
    .delete({ where: { tokenHash: sha256(rawToken) } })
    .catch(() => {
      // Token already gone — logout is idempotent.
    });
}

async function getUserById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      bio: true,
      defaultTone: true,
      defaultLanguage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) throw new AuthError('User not found', 404);
  return user;
}

module.exports = {
  AuthError,
  register,
  login,
  upsertClerkUser,
  rotateRefreshToken,
  logout,
  getUserById,
};
