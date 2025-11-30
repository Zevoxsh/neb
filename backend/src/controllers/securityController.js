const blockedIpModel = require('../models/blockedIpModel');
const trustedIpModel = require('../models/trustedIpModel');
const settingsModel = require('../models/settingsModel');
const proxyManager = require('../services/proxyManager');
const alertService = require('../services/alertService');
const { normalizeSecurityConfig } = require('../utils/securityConfig');

async function listBlocked(req, res) {
  try {
    const rows = await blockedIpModel.listBlockedIps();
    res.json(rows);
  } catch (e) {
    console.error('security.listBlocked error', e);
    res.status(500).send('Server error');
  }
}

async function createBlocked(req, res) {
  try {
    const { ip, reason } = req.body || {};
    if (!ip) return res.status(400).send('IP required');
    const entry = await blockedIpModel.blockIp(ip, reason);
    await reloadBlockedIps();
    res.json(entry);
  } catch (e) {
    console.error('security.createBlocked error', e);
    res.status(500).send('Server error');
  }
}

async function removeBlocked(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).send('Invalid id');
    await blockedIpModel.unblockIp(id);
    await reloadBlockedIps();
    res.sendStatus(204);
  } catch (e) {
    console.error('security.removeBlocked error', e);
    res.status(500).send('Server error');
  }
}

async function listTrusted(req, res) {
  try {
    const rows = await trustedIpModel.listTrustedIps();
    res.json(rows);
  } catch (e) {
    console.error('security.listTrusted error', e);
    res.status(500).send('Server error');
  }
}

async function createTrusted(req, res) {
  try {
    const { ip, label } = req.body || {};
    if (!ip) return res.status(400).send('IP required');
    const entry = await trustedIpModel.addTrustedIp(ip, label);
    await reloadTrustedIps();
    res.json(entry);
  } catch (e) {
    console.error('security.createTrusted error', e);
    res.status(500).send('Server error');
  }
}

async function removeTrusted(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).send('Invalid id');
    await trustedIpModel.removeTrustedIp(id);
    await reloadTrustedIps();
    res.sendStatus(204);
  } catch (e) {
    console.error('security.removeTrusted error', e);
    res.status(500).send('Server error');
  }
}

async function getSecurityConfig(req, res) {
  try {
    const raw = await settingsModel.getSetting('security_config');
    const config = normalizeSecurityConfig(raw);
    res.json(config);
  } catch (e) {
    console.error('security.getConfig error', e);
    res.status(500).send('Server error');
  }
}

async function updateSecurityConfig(req, res) {
  try {
    const currentRaw = await settingsModel.getSetting('security_config');
    const current = normalizeSecurityConfig(currentRaw);
    const incoming = req.body || {};
    const merged = normalizeSecurityConfig({
      ...current,
      ...incoming,
      smtp: { ...current.smtp, ...(incoming.smtp || {}) }
    });
    await settingsModel.setSetting('security_config', JSON.stringify(merged));
    proxyManager.updateSecurityConfig(merged);
    alertService.configure(merged.smtp);
    res.json(merged);
  } catch (e) {
    console.error('security.updateConfig error', e);
    res.status(500).send('Server error');
  }
}

async function reloadBlockedIps() {
  try {
    const ips = await blockedIpModel.listIpsOnly();
    proxyManager.setBlockedIps(ips);
  } catch (e) {
    console.error('security.reloadBlockedIps error', e);
  }
}

async function reloadTrustedIps() {
  try {
    const ips = await trustedIpModel.listIpsOnly();
    proxyManager.setTrustedIps(ips);
  } catch (e) {
    console.error('security.reloadTrustedIps error', e);
  }
}

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
  reloadTrustedIps
};
