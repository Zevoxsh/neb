/**
 * Security Controller (Refactored)
 */

const blockedIpModel = require('../models/blockedIpModel');
const trustedIpModel = require('../models/trustedIpModel');
const settingsModel = require('../models/settingsModel');
const proxyManager = require('../services/proxyManager');
const alertService = require('../services/alertService');
const { normalizeSecurityConfig } = require('../utils/securityConfig');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SecurityController');

// ============================================================================
// Blocked IPs
// ============================================================================

const listBlocked = asyncHandler(async (req, res) => {
  logger.debug('Listing blocked IPs');
  const rows = await blockedIpModel.listBlockedIps();
  res.json(rows || []);
});

const createBlocked = asyncHandler(async (req, res) => {
  const { ip, reason } = req.body || {};

  if (!ip) throw new AppError('IP required', 400);

  logger.debug('Blocking IP', { ip, reason });
  const entry = await blockedIpModel.blockIp(ip, reason);

  // Reload blocked IPs in proxy manager
  await reloadBlockedIps();

  logger.info('IP blocked', { ip });
  res.json(entry);
});

const removeBlocked = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) throw new AppError('Invalid ID', 400);

  logger.debug('Unblocking IP', { id });
  await blockedIpModel.unblockIp(id);

  // Reload blocked IPs in proxy manager
  await reloadBlockedIps();

  logger.info('IP unblocked', { id });
  res.sendStatus(204);
});

// ============================================================================
// Trusted IPs
// ============================================================================

const listTrusted = asyncHandler(async (req, res) => {
  logger.debug('Listing trusted IPs');
  const rows = await trustedIpModel.listTrustedIps();
  res.json(rows || []);
});

const createTrusted = asyncHandler(async (req, res) => {
  const { ip, label } = req.body || {};

  if (!ip) throw new AppError('IP required', 400);

  logger.debug('Adding trusted IP', { ip, label });
  const entry = await trustedIpModel.addTrustedIp(ip, label);

  // Reload trusted IPs in proxy manager
  await reloadTrustedIps();

  logger.info('Trusted IP added', { ip });
  res.json(entry);
});

const removeTrusted = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) throw new AppError('Invalid ID', 400);

  logger.debug('Removing trusted IP', { id });
  await trustedIpModel.removeTrustedIp(id);

  // Reload trusted IPs in proxy manager
  await reloadTrustedIps();

  logger.info('Trusted IP removed', { id });
  res.sendStatus(204);
});

// ============================================================================
// Security Configuration
// ============================================================================

const getSecurityConfig = asyncHandler(async (req, res) => {
  logger.debug('Getting security config');
  const raw = await settingsModel.getSetting('security_config');
  const config = normalizeSecurityConfig(raw);
  res.json(config);
});

const updateSecurityConfig = asyncHandler(async (req, res) => {
  const currentRaw = await settingsModel.getSetting('security_config');
  const current = normalizeSecurityConfig(currentRaw);
  const incoming = req.body || {};

  const merged = normalizeSecurityConfig({
    ...current,
    ...incoming,
    smtp: { ...current.smtp, ...(incoming.smtp || {}) }
  });

  logger.debug('Updating security config');

  await settingsModel.setSetting('security_config', JSON.stringify(merged));
  proxyManager.updateSecurityConfig(merged);
  alertService.configure(merged.smtp);

  logger.info('Security config updated');
  res.json(merged);
});

// ============================================================================
// Helper Functions
// ============================================================================

async function reloadBlockedIps() {
  try {
    const ips = await blockedIpModel.listIpsOnly();
    proxyManager.setBlockedIps(ips);
  } catch (e) {
    logger.error('Failed to reload blocked IPs', { error: e.message });
  }
}

async function reloadTrustedIps() {
  try {
    const ips = await trustedIpModel.listIpsOnly();
    proxyManager.setTrustedIps(ips);
  } catch (e) {
    logger.error('Failed to reload trusted IPs', { error: e.message });
  }
}

const dismissAlerts = asyncHandler(async (req, res) => {
  logger.debug('Dismissing all alerts');
  const alertModel = require('../models/alertModel');
  const count = await alertModel.dismissAllAlerts();
  logger.info('Alerts dismissed', { count });
  res.json({ dismissed: count });
});

module.exports = {
  listBlocked,
  createBlocked,
  removeBlocked,
  listTrusted,
  createTrusted,
  removeTrusted,
  getSecurityConfig,
  updateSecurityConfig,
  reloadBlockedIps,
  reloadTrustedIps,
  dismissAlerts
};

