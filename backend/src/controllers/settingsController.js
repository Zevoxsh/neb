/**
 * Settings Controller (Refactored)
 */

const proxyManager = require('../services/proxyManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SettingsController');

// Get security configuration
const getSecurityConfig = asyncHandler(async (req, res) => {
  logger.debug('Getting security config');
  const config = proxyManager.securityConfig || {};
  res.json(config);
});

// Update security configuration
const updateSecurityConfig = asyncHandler(async (req, res) => {
  const config = req.body;

  logger.debug('Updating security config', { config });

  if (!config || typeof config !== 'object') {
    throw new AppError('Invalid config object', 400);
  }

  proxyManager.updateSecurityConfig(config);
  logger.info('Security config updated');

  res.json({ message: 'Configuration updated', config: proxyManager.securityConfig });
});

module.exports = {
  getSecurityConfig,
  updateSecurityConfig,
  getLocalTlds: asyncHandler(async (req, res) => {
    const settingsModel = require('../models/settingsModel');
    const acmeManager = require('../services/acmeManager');

    logger.debug('Getting local TLDs');
    const raw = await settingsModel.getSetting('local_tlds');
    const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : acmeManager.getLocalTlds();
    res.json({ localTlds: list });
  }),
  updateLocalTlds: asyncHandler(async (req, res) => {
    const settingsModel = require('../models/settingsModel');
    const acmeManager = require('../services/acmeManager');

    const body = req.body || {};
    let list = [];
    if (Array.isArray(body.localTlds)) list = body.localTlds;
    else if (typeof body.localTlds === 'string') list = body.localTlds.split(',').map(s => s.trim()).filter(Boolean);
    else throw new AppError('localTlds required', 400);

    logger.debug('Updating local TLDs', { count: list.length });

    // Persist as comma-separated string
    await settingsModel.setSetting('local_tlds', list.join(','));

    // Update acmeManager runtime list
    acmeManager.setLocalTlds(list);

    logger.info('Local TLDs updated', { count: list.length });
    res.json({ ok: true, localTlds: list });
  })
};
