/**
 * Domain Controller (Refactored with factory + custom methods)
 */

const domainModel = require('../models/domainModel');
const proxyModel = require('../models/proxyModel');
const backendModel = require('../models/backendModel');
const proxyManager = require('../services/proxyManager');
const acmeManager = require('../services/acmeManager');
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
  const { hostname, proxyId, backendId, useProxyTarget, maintenanceEnabled, maintenancePagePath } = req.body;

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

  const acmeEnabled = req.body && (req.body.generateCert === true || req.body.generateCert === 'true' || req.body.generateCert === 'on' || req.body.acmeEnabled === true);

  const mapping = await domainModel.createDomainMapping({
    hostname,
    proxyId: parseInt(proxyId, 10),
    backendId: finalBackendId,
    maintenanceEnabled: !!maintenanceEnabled,
    maintenancePagePath: maintenancePagePath || null,
    acmeEnabled: !!acmeEnabled
  });

  logger.info('Domain mapping created', { id: mapping.id, hostname });

  // Reload proxies in background
  setImmediate(() => {
    proxyManager.reloadAllProxies().catch(err => {
      logger.error('Failed to reload proxies', { error: err.message });
    });
  });

  // Note: certificate generation is controlled by the domain's acme_enabled flag.
  // ProxyManager will trigger ACME issuance only for domains with acme_enabled = true.

  res.status(201).json(mapping);
});

// Update domain mapping
const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid ID', 400);

  const { hostname, proxyId, backendId, useProxyTarget, botProtection, maintenanceEnabled, maintenancePagePath } = req.body;

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

  const acmeEnabled = req.body && (req.body.generateCert === true || req.body.generateCert === 'true' || req.body.generateCert === 'on' || req.body.acmeEnabled === true);

  const mapping = await domainModel.updateDomainMapping(id, {
    hostname,
    proxyId: parseInt(proxyId, 10),
    backendId: finalBackendId,
    botProtection,
    maintenanceEnabled: !!maintenanceEnabled,
    maintenancePagePath: maintenancePagePath || null,
    acmeEnabled: !!acmeEnabled
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

  // Check if screenshot exists (prefer hostname-based filename)
  let screenshotPath = screenshotService.getScreenshotPathWithHostname(id, domain.hostname);

  if (!screenshotPath) {
    // Screenshot doesn't exist yet. If client asked for inline, try fetching inline
    const inline = req.query && (req.query.inline === '1' || req.query.inline === 'true');
    if (inline) {
      try {
        const dataUrl = await screenshotService.fetchScreenshotInline(domain.hostname, id);
        if (dataUrl) return res.json({ path: null, inline: dataUrl });
      } catch (err) {
        // Log and fall back to capture/save behavior
        logger.warn('Inline fetch failed, falling back to capture:', { host: domain.hostname, err: err.message });
      }
    }

    // Screenshot doesn't exist, capture it (will be cached on disk)
    screenshotPath = await screenshotService.captureScreenshot(domain.hostname, id);
  }

  if (screenshotPath) {
    // If client requests inline image (embed base64), return data URL
    const inline = req.query && (req.query.inline === '1' || req.query.inline === 'true');

    if (inline) {
      // Prefer reading cached file
      const dataUrl = screenshotService.getScreenshotData(id, domain.hostname);
      if (dataUrl) {
        return res.json({ path: screenshotPath, inline: dataUrl });
      }

      // If cached file can't be read, attempt an inline fetch as a fallback
      try {
        const fetched = await screenshotService.fetchScreenshotInline(domain.hostname, id);
        if (fetched) return res.json({ path: screenshotPath, inline: fetched });
      } catch (err) {
        logger.warn('Fallback inline fetch failed:', { host: domain.hostname, err: err.message });
      }
    }

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
  // Accept optional method in body (e.g., { method: 'local' })
  const method = req.body && req.body.method ? String(req.body.method) : null;
  const opts = {};
  if (method) opts.method = method;

  const screenshotPathRaw = await screenshotService.refreshScreenshot(domain.hostname, id, opts);
  // prefer hostname-based filename if present
  const screenshotPath = screenshotService.getScreenshotPathWithHostname(id, domain.hostname) || screenshotPathRaw;

  if (screenshotPath) {
    res.json({ path: screenshotPath });
  } else {
    res.status(503).json({ error: 'Screenshot service unavailable' });
  }
});

/**
 * Refresh all screenshots (manual trigger)
 */
const refreshAllScreenshots = asyncHandler(async (req, res) => {
  const screenshotService = require('../services/screenshotService');

  try {
    // Optional: accept concurrency from body (number) and method (e.g., 'local')
    const concurrency = req.body && Number(req.body.concurrency) > 0 ? Number(req.body.concurrency) : 5;
    const method = req.body && req.body.method ? String(req.body.method) : null;
    const results = await screenshotService.refreshAll(concurrency, method ? { method } : undefined);

    const successCount = results.filter(r => r.path && !r.error).length;
    const failed = results.filter(r => r.error);

    res.json({ success: true, total: results.length, refreshed: successCount, failures: failed });
  } catch (err) {
    res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
  }
});

/**
 * Create complete domain configuration (proxy + backend + domain mapping)
 */
const createComplete = asyncHandler(async (req, res) => {
  const {
    proxyType,
    domainName,
    backendHost,
    backendPort,
    backendProtocol,
    description,
    sslEnabled,
    antiBotEnabled
  } = req.body;

  logger.debug('Creating complete domain configuration', {
    proxyType,
    domainName,
    sslEnabled,
    antiBotEnabled
  });

  // Validate required fields
  if (!proxyType || !domainName || !backendHost || !backendPort) {
    throw new AppError('Missing required fields: proxyType, domainName, backendHost, backendPort', 400);
  }

  // Validate proxy type
  if (!['http', 'tcp'].includes(proxyType)) {
    throw new AppError('Invalid proxy type. Must be "http" or "tcp"', 400);
  }

  // Validate backend protocol
  const validBackendProtocol = backendProtocol || 'http';
  if (!['http', 'https', 'tcp'].includes(validBackendProtocol)) {
    throw new AppError('Invalid backend protocol. Must be "http", "https", or "tcp"', 400);
  }

  try {
    // Check if domain already exists
    const domainAlreadyExists = await domainModel.domainExists(domainName);
    if (domainAlreadyExists) {
      throw new AppError(`Domain "${domainName}" already exists`, 400);
    }

    // Step 1: Create backend (always create a new one, even if same host:port exists)
    // This allows flexibility - each domain can have its own backend configuration
    logger.info('Creating backend', { backendHost, backendPort, backendProtocol: validBackendProtocol });

    const backendName = description
      ? `${description}-backend`
      : `${domainName}-backend-${Date.now()}`;

    const backend = await backendModel.createBackend({
      name: backendName,
      targetHost: backendHost,
      targetPort: parseInt(backendPort, 10),
      targetProtocol: validBackendProtocol
    });

    logger.info('Backend created', { backendId: backend.id, name: backendName });

    // Step 2: Find or create proxy
    // Determine listen port based on proxy type and SSL
    let listenPort;
    let listenProtocol;
    let targetProtocol;
    let protocol;

    if (proxyType === 'http') {
      // HTTP/HTTPS proxy
      listenPort = sslEnabled ? 443 : 80;
      listenProtocol = sslEnabled ? 'https' : 'http';
      targetProtocol = validBackendProtocol;
      protocol = 'http';
    } else {
      // TCP proxy
      listenPort = parseInt(backendPort, 10); // Use backend port for TCP
      listenProtocol = 'tcp';
      targetProtocol = 'tcp';
      protocol = 'tcp';
    }

    // For HTTP/HTTPS, try to reuse existing proxy on the same port
    let proxy;
    if (proxyType === 'http') {
      proxy = await proxyModel.findProxyByPort(listenPort, protocol);
      if (proxy) {
        logger.info('Reusing existing HTTP/HTTPS proxy', { proxyId: proxy.id, listenPort });
      }
    }

    // If no existing proxy found, create a new one
    if (!proxy) {
      logger.info('Creating new proxy', {
        protocol,
        listenProtocol,
        listenPort,
        targetProtocol
      });

      proxy = await proxyModel.createProxy({
        name: proxyType === 'http' ? `HTTP Proxy :${listenPort}` : `TCP Proxy for ${domainName}`,
        protocol,
        listen_protocol: listenProtocol,
        target_protocol: targetProtocol,
        listen_host: '0.0.0.0',
        listen_port: listenPort,
        target_host: backendHost,
        target_port: parseInt(backendPort, 10),
        enabled: true
      });
      logger.info('Proxy created', { proxyId: proxy.id });
    }

    // Step 3: Create domain mapping
    logger.info('Creating domain mapping', { domainName, proxyId: proxy.id, backendId: backend.id });
    const mapping = await domainModel.createDomainMapping({
      hostname: domainName,
      proxyId: proxy.id,
      backendId: backend.id,
      botProtection: antiBotEnabled ? 'protected' : 'unprotected',
      maintenanceEnabled: false,
      maintenancePagePath: null,
      acmeEnabled: sslEnabled && proxyType === 'http' // Only enable ACME for HTTP/HTTPS with SSL
    });
    logger.info('Domain mapping created', { mappingId: mapping.id });

    // Step 4: Reload proxies in background
    setImmediate(() => {
      proxyManager.reloadAllProxies().catch(err => {
        logger.error('Failed to reload proxies', { error: err.message });
      });
    });

    // Step 5: If SSL enabled and HTTP proxy, trigger certificate generation
    if (sslEnabled && proxyType === 'http') {
      logger.info('SSL enabled, certificate will be generated automatically by ProxyManager');
      // Note: The ProxyManager will automatically generate the certificate
      // when it detects a domain with acme_enabled = true
    }

    res.status(201).json({
      success: true,
      backend: backend,
      proxy: proxy,
      domain: mapping,
      message: 'Domain configuration created successfully'
    });

  } catch (error) {
    logger.error('Failed to create complete domain configuration', {
      error: error.message,
      stack: error.stack
    });
    throw new AppError('Failed to create domain: ' + error.message, 500);
  }
});

module.exports = { list, create, update, remove, listForProxy, getScreenshot, refreshScreenshot, refreshAllScreenshots, createComplete };
