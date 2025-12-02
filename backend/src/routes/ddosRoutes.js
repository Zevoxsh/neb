const express = require('express');
const router = express.Router();
const ddosProtection = require('../services/ddosProtection');
const geoBlocking = require('../services/geoBlocking');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('DDoSRoutes');

/**
 * GET /api/ddos/stats
 * Get DDoS protection statistics
 */
router.get('/api/ddos/stats', asyncHandler(async (req, res) => {
  const stats = ddosProtection.getStats();
  res.json(stats);
}));

/**
 * POST /api/ddos/ban
 * Manually ban an IP address
 */
router.post('/api/ddos/ban', asyncHandler(async (req, res) => {
  const { ip, durationMs } = req.body;

  if (!ip) {
    throw new AppError('IP address is required', 400);
  }

  const duration = durationMs || 24 * 60 * 60 * 1000; // Default 24 hours

  ddosProtection.banIP(ip, duration);

  logger.info('IP manually banned', { ip, duration, by: req.user?.username });

  res.json({
    ok: true,
    message: `IP ${ip} has been banned for ${Math.round(duration / 1000 / 60)} minutes`
  });
}));

/**
 * POST /api/ddos/unban
 * Unban an IP address
 */
router.post('/api/ddos/unban', asyncHandler(async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    throw new AppError('IP address is required', 400);
  }

  ddosProtection.unbanIP(ip);

  logger.info('IP manually unbanned', { ip, by: req.user?.username });

  res.json({
    ok: true,
    message: `IP ${ip} has been unbanned`
  });
}));

/**
 * GET /api/geo-blocking/stats
 * Get geo-blocking statistics and configuration
 */
router.get('/api/geo-blocking/stats', asyncHandler(async (req, res) => {
  const stats = geoBlocking.getStats();
  res.json(stats);
}));

/**
 * POST /api/geo-blocking/enable
 * Enable geo-blocking
 */
router.post('/api/geo-blocking/enable', asyncHandler(async (req, res) => {
  geoBlocking.enable();

  logger.info('Geo-blocking enabled', { by: req.user?.username });

  res.json({
    ok: true,
    message: 'Geo-blocking has been enabled'
  });
}));

/**
 * POST /api/geo-blocking/disable
 * Disable geo-blocking
 */
router.post('/api/geo-blocking/disable', asyncHandler(async (req, res) => {
  geoBlocking.disable();

  logger.info('Geo-blocking disabled', { by: req.user?.username });

  res.json({
    ok: true,
    message: 'Geo-blocking has been disabled'
  });
}));

/**
 * POST /api/geo-blocking/mode
 * Set geo-blocking mode (whitelist or blacklist)
 */
router.post('/api/geo-blocking/mode', asyncHandler(async (req, res) => {
  const { mode } = req.body;

  if (!mode || (mode !== 'whitelist' && mode !== 'blacklist')) {
    throw new AppError('Mode must be "whitelist" or "blacklist"', 400);
  }

  geoBlocking.setMode(mode);

  logger.info('Geo-blocking mode changed', { mode, by: req.user?.username });

  res.json({
    ok: true,
    message: `Geo-blocking mode set to ${mode}`
  });
}));

/**
 * POST /api/geo-blocking/blacklist/add
 * Add country to blacklist
 */
router.post('/api/geo-blocking/blacklist/add', asyncHandler(async (req, res) => {
  const { countryCode } = req.body;

  if (!countryCode || countryCode.length !== 2) {
    throw new AppError('Valid 2-letter country code is required', 400);
  }

  geoBlocking.addToBlacklist(countryCode);

  logger.info('Country added to blacklist', { countryCode, by: req.user?.username });

  res.json({
    ok: true,
    message: `Country ${countryCode} added to blacklist`
  });
}));

/**
 * POST /api/geo-blocking/blacklist/remove
 * Remove country from blacklist
 */
router.post('/api/geo-blocking/blacklist/remove', asyncHandler(async (req, res) => {
  const { countryCode } = req.body;

  if (!countryCode) {
    throw new AppError('Country code is required', 400);
  }

  geoBlocking.removeFromBlacklist(countryCode);

  logger.info('Country removed from blacklist', { countryCode, by: req.user?.username });

  res.json({
    ok: true,
    message: `Country ${countryCode} removed from blacklist`
  });
}));

/**
 * POST /api/geo-blocking/whitelist/add
 * Add country to whitelist
 */
router.post('/api/geo-blocking/whitelist/add', asyncHandler(async (req, res) => {
  const { countryCode } = req.body;

  if (!countryCode || countryCode.length !== 2) {
    throw new AppError('Valid 2-letter country code is required', 400);
  }

  geoBlocking.addToWhitelist(countryCode);

  logger.info('Country added to whitelist', { countryCode, by: req.user?.username });

  res.json({
    ok: true,
    message: `Country ${countryCode} added to whitelist`
  });
}));

/**
 * POST /api/geo-blocking/whitelist/remove
 * Remove country from whitelist
 */
router.post('/api/geo-blocking/whitelist/remove', asyncHandler(async (req, res) => {
  const { countryCode } = req.body;

  if (!countryCode) {
    throw new AppError('Country code is required', 400);
  }

  geoBlocking.removeFromWhitelist(countryCode);

  logger.info('Country removed from whitelist', { countryCode, by: req.user?.username });

  res.json({
    ok: true,
    message: `Country ${countryCode} removed from whitelist`
  });
}));

/**
 * POST /api/geo-blocking/lookup
 * Look up country code for an IP address
 */
router.post('/api/geo-blocking/lookup', asyncHandler(async (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    throw new AppError('IP address is required', 400);
  }

  const countryCode = geoBlocking.getCountryCode(ip);
  const allowed = geoBlocking.isAllowed(ip, {});

  res.json({
    ip,
    countryCode,
    allowed: allowed.allowed,
    reason: allowed.reason
  });
}));

module.exports = router;
