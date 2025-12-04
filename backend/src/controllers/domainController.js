/**
 * Domain Controller (Refactored with factory + custom methods)
 */

const domainModel = require('../models/domainModel');
const proxyModel = require('../models/proxyModel');
const backendModel = require('../models/backendModel');
const proxyManager = require('../services/proxyManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('DomainController');

// List all domain mappings
const list = asyncHandler(async (req, res) => {
  logger.debug('Listing domain mappings');
  const rows = await domainModel.listDomainMappings();
  res.json(rows || []);
});

// List mappings for specific proxy
const listForProxy = asyncHandler(async (req, res) => {
  const proxyId = parseInt(req.params.id, 10);
  if (!proxyId || isNaN(proxyId)) throw new AppError('Invalid proxy ID', 400);

  logger.debug('Listing mappings for proxy', { proxyId });
  const rows = await domainModel.listMappingsForProxy(proxyId);
  res.json(rows || []);
});

// Create domain mapping (with backend auto-creation logic)
const create = asyncHandler(async (req, res) => {
  const { hostname, proxyId, backendId, useProxyTarget } = req.body;

  logger.debug('Creating domain mapping', { hostname, proxyId, useProxyTarget });

  if (!hostname || !proxyId) {
    throw new AppError('Missing required fields: hostname, proxyId', 400);
  }

  let finalBackendId = null;

  if (useProxyTarget) {
    // Auto-create backend from proxy target
    const proxy = await proxyModel.getProxyById(parseInt(proxyId, 10));
    if (!proxy) throw new AppError('Proxy not found', 404);

    const targetHost = proxy.target_host;
    const targetPort = proxy.target_port;

    logger.debug('Using proxy target', { targetHost, targetPort });

    // Find or create backend
    let backend = await backendModel.findBackendByHostPort(targetHost, targetPort);
    if (!backend) {
      backend = await backendModel.createBackend({
        name: `from-proxy-${proxy.id}`,
        targetHost,
        targetPort,
        targetProtocol: proxy.target_protocol || proxy.protocol || 'tcp'
      });
      logger.info('Created backend for proxy target', { backendId: backend.id });
    }
    finalBackendId = backend.id;
  } else {
    if (!backendId) throw new AppError('Missing backendId', 400);
    finalBackendId = parseInt(backendId, 10);
  }

  const mapping = await domainModel.createDomainMapping({
    hostname,
    proxyId: parseInt(proxyId, 10),
    backendId: finalBackendId
  });

  logger.info('Domain mapping created', { id: mapping.id, hostname });

  // Reload proxies in background
  setImmediate(() => {
    proxyManager.reloadAllProxies().catch(err => {
      logger.error('Failed to reload proxies', { error: err.message });
    });
  });

  res.status(201).json(mapping);
});

// Update domain mapping
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  const { hostname, proxyId, backendId, useProxyTarget, botProtection } = req.body;

  logger.debug('Updating domain mapping', { id, hostname, botProtection });

  if (!hostname || !proxyId) {
    throw new AppError('Missing required fields: hostname, proxyId', 400);
  }

  let finalBackendId = null;

  if (useProxyTarget) {
    // Auto-create backend from proxy target
    const proxy = await proxyModel.getProxyById(parseInt(proxyId, 10));
    if (!proxy) throw new AppError('Proxy not found', 404);

    const targetHost = proxy.target_host;
    const targetPort = proxy.target_port;

    let backend = await backendModel.findBackendByHostPort(targetHost, targetPort);
    if (!backend) {
      backend = await backendModel.createBackend({
        name: `from-proxy-${proxy.id}`,
        targetHost,
        targetPort,
        targetProtocol: proxy.target_protocol || proxy.protocol || 'tcp'
      });
      logger.info('Created backend for proxy target', { backendId: backend.id });
    }
    finalBackendId = backend.id;
  } else {
    if (!backendId) throw new AppError('Missing backendId', 400);
    finalBackendId = parseInt(backendId, 10);
  }

  const mapping = await domainModel.updateDomainMapping(id, {
    hostname,
    proxyId: parseInt(proxyId, 10),
    backendId: finalBackendId,
    botProtection
  });

  if (!mapping) throw new AppError('Domain mapping not found', 404);

  logger.info('Domain mapping updated', { id, hostname });

  // Reload proxies in background
  setImmediate(() => {
    proxyManager.reloadAllProxies().catch(err => {
      logger.error('Failed to reload proxies', { error: err.message });
    });
  });

  res.json(mapping);
});

// Delete domain mapping
const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  logger.debug('Deleting domain mapping', { id });

  await domainModel.deleteDomainMapping(id);
  logger.info('Domain mapping deleted', { id });

  // Reload proxies in background
  setImmediate(() => {
    proxyManager.reloadAllProxies().catch(err => {
      logger.error('Failed to reload proxies', { error: err.message });
    });
  });

  res.sendStatus(204);
});

/**
 * Get screenshot for a domain
 */
const getScreenshot = asyncHandler(async (req, res) => {
  const screenshotService = require('../services/screenshotService');
  const domainModel = require('../models/domainModel');

  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  // Get domain info
  const domains = await domainModel.listDomainMappings();
  const domain = domains.find(d => d.id === id);

  if (!domain) {
    throw new AppError('Domain not found', 404);
  }

  // Check if screenshot exists
  let screenshotPath = screenshotService.getScreenshotPath(id);

  if (!screenshotPath) {
    // Screenshot doesn't exist, capture it
    screenshotPath = await screenshotService.captureScreenshot(domain.hostname, id);
  }

  if (screenshotPath) {
    res.json({ path: screenshotPath });
  } else {
    res.status(503).json({ error: 'Screenshot service unavailable' });
  }
});

/**
 * Refresh screenshot for a domain
 */
const refreshScreenshot = asyncHandler(async (req, res) => {
  const screenshotService = require('../services/screenshotService');
  const domainModel = require('../models/domainModel');

  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  // Get domain info
  const domains = await domainModel.listDomainMappings();
  const domain = domains.find(d => d.id === id);

  if (!domain) {
    throw new AppError('Domain not found', 404);
  }

  // Force refresh screenshot
  const screenshotPath = await screenshotService.refreshScreenshot(domain.hostname, id);

  if (screenshotPath) {
    res.json({ path: screenshotPath });
  } else {
    res.status(503).json({ error: 'Screenshot service unavailable' });
  }
});

module.exports = { list, create, update, remove, listForProxy, getScreenshot, refreshScreenshot };
