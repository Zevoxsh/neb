/**
 * Auth Controller (Refactored)
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AuthController');

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

// Helper for cookie options
function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
    secure: (process.env.COOKIE_SECURE === 'true') || (process.env.NODE_ENV === 'production'),
    sameSite: 'lax'
  };
}

// Web login (redirects on success)
const webLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  logger.debug('Web login attempt', { username });

  if (!username || !password) {
    return res.status(400).send('Username and password required');
  }

  const user = await userModel.findByUsername(username);

  if (!user) {
    logger.warn('Login failed - user not found', { username });
    return res.status(401).send('Invalid credentials');
  }

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    logger.warn('Login failed - wrong password', { username });
    return res.status(401).send('Invalid credentials');
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '1h'
  });

  logger.info('Web login successful', { username, userId: user.id });

  res.cookie('token', token, cookieOptions());
  res.redirect('/');
});

// API login (returns JSON)
const apiLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  logger.debug('API login attempt', { username });

  if (!username || !password) {
    throw new AppError('Username and password required', 400);
  }

  const user = await userModel.findByUsername(username);

  if (!user) {
    logger.warn('API login failed - user not found', { username });
    throw new AppError('Invalid credentials', 401);
  }

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    logger.warn('API login failed - wrong password', { username });
    throw new AppError('Invalid credentials', 401);
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '1h'
  });

  logger.info('API login successful', { username, userId: user.id });

  res.cookie('token', token, cookieOptions());
  res.json({ ok: true });
});

// Logout
const logout = (req, res) => {
  logger.debug('Logout');
  res.clearCookie('token');
  res.redirect('/login');
};

module.exports = { webLogin, apiLogin, logout };
