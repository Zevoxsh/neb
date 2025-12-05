/**
 * Auth Controller (Refactored)
 */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AuthController');

const JWT_SECRET = process.env.JWT_SECRET;

// Allow temporary secrets during installation
const isInstallationMode = JWT_SECRET && JWT_SECRET.startsWith('temporary_installation_secret_');

// Vérification critique du JWT secret
if (!JWT_SECRET || (JWT_SECRET.length < 32 && !isInstallationMode)) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
    console.error('Set JWT_SECRET in your .env file with a strong random value');
    process.exit(1);
}

// Vérifier que ce n'est pas un des secrets par défaut connus (skip in installation mode)
if (!isInstallationMode) {
    const BANNED_SECRETS = ['changeme', 'default-secret-change-me', 'secret', 'test', 'password'];
    if (BANNED_SECRETS.includes(JWT_SECRET)) {
        console.error('FATAL: JWT_SECRET cannot be a default/weak value');
        process.exit(1);
    }
}

// Helper for cookie options
function cookieOptions(req) {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHttps = req && (req.secure || req.headers['x-forwarded-proto'] === 'https');
  const cookieSecure = process.env.COOKIE_SECURE === 'true';

  return {
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
    // Only set secure when explicitly requested AND the incoming request is HTTPS.
    // Avoid forcing `secure` on local HTTP during development even if NODE_ENV=production.
    secure: cookieSecure && Boolean(isHttps),
    sameSite: isProduction ? 'strict' : 'lax'
  };
}

// Web login (redirects on success)
const webLogin = asyncHandler(async (req, res) => {
  const { username, password, twoFactorToken } = req.body;

  logger.debug('Web login attempt', { username, has2FA: !!twoFactorToken });

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

  // Check if 2FA is enabled
  const twoFactorAuth = require('../services/twoFactorAuth');
  if (twoFactorAuth.isRequired(user)) {
    if (!twoFactorToken) {
      // Credentials valid, but need 2FA token
      logger.debug('2FA required for login', { username });
      return res.status(200).send(`
        <html>
          <body>
            <h2>Two-Factor Authentication Required</h2>
            <form method="POST" action="/login">
              <input type="hidden" name="username" value="${username}">
              <input type="hidden" name="password" value="${password}">
              <label>Enter 2FA Code:</label>
              <input type="text" name="twoFactorToken" pattern="[0-9]{6}" required autofocus>
              <button type="submit">Verify</button>
            </form>
          </body>
        </html>
      `);
    }

    // Verify 2FA token
    const isValid = twoFactorAuth.verifyToken(twoFactorToken, user.twofa_secret);
    if (!isValid) {
      logger.warn('Login failed - invalid 2FA token', { username });
      return res.status(401).send('Invalid 2FA token');
    }

    logger.info('2FA verification successful', { username });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '1h'
  });

  logger.info('Web login successful', { username, userId: user.id });

  res.cookie('token', token, cookieOptions(req));
  res.redirect('/');
});

// API login (returns JSON)
const apiLogin = asyncHandler(async (req, res) => {
  const { username, password, twoFactorToken } = req.body;

  logger.debug('API login attempt', { username, has2FA: !!twoFactorToken });

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

  // Check if 2FA is enabled
  const twoFactorAuth = require('../services/twoFactorAuth');
  if (twoFactorAuth.isRequired(user)) {
    if (!twoFactorToken) {
      // Credentials valid, but need 2FA token
      logger.debug('2FA required for API login', { username });
      return res.status(200).json({
        ok: false,
        requires2FA: true,
        message: 'Two-factor authentication required'
      });
    }

    // Verify 2FA token
    const isValid = twoFactorAuth.verifyToken(twoFactorToken, user.twofa_secret);
    if (!isValid) {
      logger.warn('API login failed - invalid 2FA token', { username });
      throw new AppError('Invalid 2FA token', 401);
    }

    logger.info('2FA verification successful', { username });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '1h'
  });

  logger.info('API login successful', { username, userId: user.id });

  res.cookie('token', token, cookieOptions(req));
  res.json({ ok: true });
});

// Logout
const logout = (req, res) => {
  logger.debug('Logout');
  res.clearCookie('token');
  res.redirect('/login');
};

module.exports = { webLogin, apiLogin, logout };
