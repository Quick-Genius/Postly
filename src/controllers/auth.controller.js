const authService = require('../services/auth.service');
const { AuthError } = authService;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const NAME_MIN = 1;
const NAME_MAX = 100;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validateEmail(email) {
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email) || email.length > 254) {
    throw badRequest('Invalid email');
  }
  return email.toLowerCase().trim();
}

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN ||
    password.length > PASSWORD_MAX
  ) {
    throw badRequest(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`);
  }
  return password;
}

function validateName(name) {
  if (
    typeof name !== 'string' ||
    name.trim().length < NAME_MIN ||
    name.trim().length > NAME_MAX
  ) {
    throw badRequest('Name is required');
  }
  return name.trim();
}

async function register(req, res, next) {
  try {
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const name = validateName(req.body?.name);

    const result = await authService.register({ email, password, name });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);

    const tokens = await authService.login({ email, password });
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
}

async function syncClerk(req, res, next) {
  try {
    const { clerkId, email, name, role } = req.body;
    if (!clerkId || !email) {
      throw badRequest('clerkId and email are required');
    }

    const tokens = await authService.upsertClerkUser({ clerkId, email, name, role });
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const token = req.body?.refresh_token;
    if (!token) throw badRequest('refresh_token is required');

    const tokens = await authService.rotateRefreshToken(token);
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const token = req.body?.refresh_token;
    if (!token) throw badRequest('refresh_token is required');

    await authService.logout(token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await authService.getUserById(req.userId);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, syncClerk, refresh, logout, me, AuthError };
