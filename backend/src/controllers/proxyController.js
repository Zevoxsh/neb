/**
 * Proxy Controller (Partially refactored - complex business logic)
 */

const proxyModel = require('../models/proxyModel');
const proxyManager = require('../services/proxyManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ProxyController');

// List all proxies
const list = asyncHandler(async (req, res) => {
  logger.debug('Listing proxies');
  const rows = await proxyModel.listProxies();
  res.json(rows || []);
});

// Create new proxy with automatic start
const create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  // Normalize various client-side naming variants (listen_port, listen_Port, listenPort)
  const name = b.name || b.proxyName || b.proxy_name;
  const protocol = b.protocol || b.proto;
  const listen_protocol = b.listen_protocol || b.listenProtocol || b.listen_protocol;
  const target_protocol = b.target_protocol || b.targetProtocol || b.target_protocol;
  const listen_host = b.listen_host || b.listenHost || b.listen_host;
  const listen_port = (b.listen_port !== undefined && b.listen_port !== null) ? b.listen_port : (b.listen_Port !== undefined ? b.listen_Port : b.listenPort);
  const target_host = b.target_host || b.targetHost || b.target_host;
  const target_port = (b.target_port !== undefined && b.target_port !== null) ? b.target_port : (b.target_Port !== undefined ? b.target_Port : b.targetPort);
  const enabled = b.enabled === true || b.enabled === 'true' || b.enabled === 1 || b.enabled === 'on';
  const vhosts = b.vhosts || b.vhosts_json || null;

  logger.debug('Creating proxy', { name, listen_port, target_port });

  // Validation
  if (!name || !listen_host || !listen_port || !target_host || !target_port) {
    throw new AppError('Missing required fields: name, listen_host, listen_port, target_host, target_port', 400);
  }

  const proto = (protocol || 'tcp').toLowerCase();
  const listenProto = (listen_protocol || proto).toLowerCase();
  const targetProto = (target_protocol || proto).toLowerCase();

  // Create in database
  const result = await proxyModel.createProxy({
    name,
    protocol: proto,
    listen_protocol: listenProto,
    target_protocol: targetProto,
    listen_host,
    listen_port: parseInt(listen_port, 10),
    target_host,
    target_port: parseInt(target_port, 10),
    vhosts: vhosts || null,
    enabled: enabled === true || enabled === 'true' || enabled === 1
  });

  const id = result.id;
  logger.info('Proxy created', { id, name });

  // Start proxy if enabled
  if (enabled) {
    try {
      proxyManager.startProxy(
        id,
        listenProto,
        listen_host,
        parseInt(listen_port, 10),
        targetProto,
        target_host,
        parseInt(target_port, 10),
        vhosts || null,
        null
      );
      logger.info('Proxy started', { id });
    } catch (e) {
      logger.error('Failed to start proxy', { id, error: e.message });
      // Don't fail request - proxy is created, just not started
    }
  }

  res.status(201).json({ id });
});

// Delete proxy with automatic stop
const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  logger.debug('Deleting proxy', { id });

  // Stop proxy first
  try {
    proxyManager.stopProxy(id);
    logger.info('Proxy stopped', { id });
  } catch (e) {
    logger.warn('Failed to stop proxy (may not be running)', { id, error: e.message });
  }

  // Delete from database
  await proxyModel.deleteProxy(id);
  logger.info('Proxy deleted', { id });

  res.sendStatus(204);
});

// Update proxy with restart
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  const b = req.body || {};
  const name = b.name || b.proxyName || b.proxy_name;
  const protocol = b.protocol || b.proto;
  const listen_protocol = b.listen_protocol || b.listenProtocol || b.listen_protocol;
  const target_protocol = b.target_protocol || b.targetProtocol || b.target_protocol;
  const listen_host = b.listen_host || b.listenHost || b.listen_host;
  const listen_port = (b.listen_port !== undefined && b.listen_port !== null) ? b.listen_port : (b.listen_Port !== undefined ? b.listen_Port : b.listenPort);
  const target_host = b.target_host || b.targetHost || b.target_host;
  const target_port = (b.target_port !== undefined && b.target_port !== null) ? b.target_port : (b.target_Port !== undefined ? b.target_Port : b.targetPort);
  const enabled = b.enabled === true || b.enabled === 'true' || b.enabled === 1 || b.enabled === 'on';
  const vhosts = b.vhosts || b.vhosts_json || null;

  logger.debug('Updating proxy', { id });
  // Get existing proxy
  const existing = await proxyModel.getProxyById(id);
  if (!existing) throw new AppError('Proxy not found', 404);

  // Resolve values with fallbacks
  const resolvedName = name || existing.name;
  const resolvedListenHost = listen_host || existing.listen_host;
  const resolvedListenPort = (listen_port !== undefined && listen_port !== null && listen_port !== '') ? parseInt(listen_port, 10) : existing.listen_port;
  const resolvedTargetHost = target_host || existing.target_host;
  const resolvedTargetPort = (target_port !== undefined && target_port !== null && target_port !== '') ? parseInt(target_port, 10) : existing.target_port;

  // Validate resolved values
  if (!resolvedName || !resolvedListenHost || !resolvedListenPort || !resolvedTargetHost || !resolvedTargetPort) {
    throw new AppError('Missing required fields after merge', 400);
  }

  const proto = (protocol || existing.protocol || 'tcp').toLowerCase();
  const listenProto = (listen_protocol || existing.listen_protocol || proto).toLowerCase();
  const targetProto = (target_protocol || existing.target_protocol || proto).toLowerCase();

  // Stop existing proxy
  try {
    proxyManager.stopProxy(id);
  } catch (e) {
    logger.warn('Failed to stop proxy for update', { id, error: e.message });
  }

  // Update in database
  const updated = await proxyModel.updateProxy(id, {
    name: resolvedName,
    protocol: proto,
    listen_protocol: listenProto,
    target_protocol: targetProto,
    listen_host: resolvedListenHost,
    listen_port: resolvedListenPort,
    target_host: resolvedTargetHost,
    target_port: resolvedTargetPort,
    vhosts: vhosts || existing.vhosts || null,
    enabled: enabled === true
  });

  logger.info('Proxy updated', { id, enabled: updated.enabled });

  // Start proxy if enabled
  if (updated && updated.enabled) {
    try {
      proxyManager.startProxy(
        updated.id,
        updated.listen_protocol || updated.protocol || 'tcp',
        updated.listen_host,
        updated.listen_port,
        updated.target_protocol || updated.protocol || 'tcp',
        updated.target_host,
        updated.target_port,
        updated.vhosts || null,
        updated.error_page_html || null
      );
      logger.info('Proxy restarted', { id });
    } catch (e) {
      logger.error('Failed to restart proxy', { id, error: e.message });
    }
  }

  res.json(updated);
});

// Get error page HTML for proxy
const getErrorPage = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  const html = await proxyModel.getErrorPage(id);
  res.json({ html: html || '' });
});

// Update error page HTML for proxy
const updateErrorPage = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  const { html } = req.body || {};
  if (html !== undefined && typeof html !== 'string') {
    throw new AppError('Invalid html field - must be string', 400);
  }

  const normalized = typeof html === 'string' ? html : null;
  const stored = await proxyModel.updateErrorPage(id, normalized);

  logger.info('Error page updated', { id, hasHtml: !!stored });
  res.json({ html: stored || '' });
});

module.exports = { list, create, remove, update, getErrorPage, updateErrorPage };