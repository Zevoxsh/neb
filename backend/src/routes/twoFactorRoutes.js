const express = require('express');
const router = express.Router();
const twoFactorAuth = require('../services/twoFactorAuth');
const userModel = require('../models/userModel');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('2FARoutes');

/**
 * POST /api/2fa/setup
 * Generate 2FA secret and QR code for user enrollment
 * Requires authentication
 */
router.post('/api/2fa/setup', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;

  logger.info('2FA setup initiated', { userId, username });

  // Check if 2FA is already enabled
  const user = await userModel.getUserById(userId);
  if (user.twofa_enabled) {
    throw new AppError('2FA is already enabled. Disable it first to re-enroll.', 400);
  }

  // Generate secret and QR code
  const { secret, qrCodeUrl, backupCodes, otpauthUrl } =
    await twoFactorAuth.generateSecret(username, 'Nebula Proxy');

  // Hash backup codes for storage
  const hashedBackupCodes = await twoFactorAuth.hashBackupCodes(backupCodes);

  // Store the secret temporarily (not verified yet)
  await userModel.updateUser2FASetup(userId, secret, hashedBackupCodes);

  logger.info('2FA setup generated', { userId });

  // Return QR code and backup codes (backup codes shown only once!)
  res.json({
    qrCodeUrl,
    secret, // For manual entry if QR scan fails
    backupCodes, // Display these to user - they won't see them again!
    otpauthUrl
  });
}));

/**
 * POST /api/2fa/verify-setup
 * Verify setup token and enable 2FA
 * Requires authentication
 */
router.post('/api/2fa/verify-setup', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { token } = req.body;

  if (!token) {
    throw new AppError('Token is required', 400);
  }

  logger.debug('2FA setup verification attempt', { userId });

  const user = await userModel.getUserById(userId);

  if (!user.twofa_secret) {
    throw new AppError('No 2FA setup in progress. Call /api/2fa/setup first.', 400);
  }

  // Verify the token
  const isValid = twoFactorAuth.verifyToken(token, user.twofa_secret);

  if (!isValid) {
    logger.warn('2FA setup verification failed - invalid token', { userId });
    throw new AppError('Invalid token', 401);
  }

  // Enable 2FA for the user
  await userModel.enable2FA(userId);

  logger.info('2FA enabled successfully', { userId });

  res.json({
    ok: true,
    message: '2FA has been enabled successfully. Keep your backup codes safe!'
  });
}));

/**
 * POST /api/2fa/verify
 * Verify 2FA token during login
 * Public endpoint (used during login flow)
 */
router.post('/api/2fa/verify', asyncHandler(async (req, res) => {
  const { username, token } = req.body;

  if (!username || !token) {
    throw new AppError('Username and token are required', 400);
  }

  logger.debug('2FA verification attempt', { username });

  const user = await userModel.findByUsername(username);

  if (!user || !user.twofa_enabled) {
    throw new AppError('2FA not enabled for this user', 400);
  }

  // Verify token
  const isValid = twoFactorAuth.verifyToken(token, user.twofa_secret);

  if (!isValid) {
    logger.warn('2FA verification failed', { username });
    throw new AppError('Invalid 2FA token', 401);
  }

  logger.info('2FA verification successful', { username, userId: user.id });

  res.json({ ok: true });
}));

/**
 * POST /api/2fa/verify-backup
 * Verify backup code (one-time use)
 * Public endpoint (used during login flow)
 */
router.post('/api/2fa/verify-backup', asyncHandler(async (req, res) => {
  const { username, backupCode } = req.body;

  if (!username || !backupCode) {
    throw new AppError('Username and backup code are required', 400);
  }

  logger.debug('Backup code verification attempt', { username });

  const user = await userModel.findByUsername(username);

  if (!user || !user.twofa_enabled || !user.twofa_backup_codes) {
    throw new AppError('2FA not enabled for this user', 400);
  }

  // Verify backup code
  const hashedCodes = user.twofa_backup_codes;
  const matchIndex = await twoFactorAuth.verifyBackupCode(backupCode, hashedCodes);

  if (matchIndex === -1) {
    logger.warn('Backup code verification failed', { username });
    throw new AppError('Invalid backup code', 401);
  }

  // Remove used backup code
  hashedCodes.splice(matchIndex, 1);
  await userModel.updateBackupCodes(user.id, hashedCodes);

  logger.info('Backup code verified and consumed', { username, userId: user.id, remainingCodes: hashedCodes.length });

  res.json({
    ok: true,
    remainingBackupCodes: hashedCodes.length
  });
}));

/**
 * POST /api/2fa/disable
 * Disable 2FA for current user
 * Requires authentication
 */
router.post('/api/2fa/disable', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { password } = req.body;

  if (!password) {
    throw new AppError('Password is required to disable 2FA', 400);
  }

  logger.debug('2FA disable attempt', { userId });

  const user = await userModel.getUserById(userId);

  // Verify password before disabling
  const bcrypt = require('bcrypt');
  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    logger.warn('2FA disable failed - wrong password', { userId });
    throw new AppError('Invalid password', 401);
  }

  // Disable 2FA
  await userModel.disable2FA(userId);

  logger.info('2FA disabled', { userId });

  res.json({
    ok: true,
    message: '2FA has been disabled'
  });
}));

/**
 * GET /api/2fa/status
 * Get 2FA status for current user
 * Requires authentication
 */
router.get('/api/2fa/status', asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const user = await userModel.getUserById(userId);

  const backupCodesCount = user.twofa_backup_codes ? user.twofa_backup_codes.length : 0;

  res.json({
    enabled: user.twofa_enabled || false,
    verifiedAt: user.twofa_verified_at || null,
    backupCodesRemaining: user.twofa_enabled ? backupCodesCount : null
  });
}));

/**
 * POST /api/2fa/regenerate-backup-codes
 * Regenerate backup codes
 * Requires authentication and valid 2FA token
 */
router.post('/api/2fa/regenerate-backup-codes', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { token } = req.body;

  if (!token) {
    throw new AppError('2FA token is required to regenerate backup codes', 400);
  }

  logger.debug('Backup codes regeneration attempt', { userId });

  const user = await userModel.getUserById(userId);

  if (!user.twofa_enabled) {
    throw new AppError('2FA is not enabled', 400);
  }

  // Verify current token
  const isValid = twoFactorAuth.verifyToken(token, user.twofa_secret);

  if (!isValid) {
    logger.warn('Backup codes regeneration failed - invalid token', { userId });
    throw new AppError('Invalid 2FA token', 401);
  }

  // Generate new backup codes
  const newBackupCodes = twoFactorAuth.generateBackupCodes(8);
  const hashedBackupCodes = await twoFactorAuth.hashBackupCodes(newBackupCodes);

  // Update database
  await userModel.updateBackupCodes(userId, hashedBackupCodes);

  logger.info('Backup codes regenerated', { userId });

  res.json({
    ok: true,
    backupCodes: newBackupCodes // Show new codes (only time they'll see them!)
  });
}));

module.exports = router;
