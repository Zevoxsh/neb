/**
 * Maintenance Controller
 * Manages maintenance mode for domains and custom maintenance pages
 */

const domainModel = require('../models/domainModel');
const maintenanceManager = require('../services/maintenanceManager');
const proxyManager = require('../services/proxyManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('MaintenanceController');

// List all domains and their maintenance status
const listStatus = asyncHandler(async (req, res) => {
  logger.debug('Listing maintenance status for all domains');
  const domains = await domainModel.listDomainMappings();

  const result = domains.map(d => ({
    id: d.id,
    hostname: d.hostname,
    maintenance_enabled: d.maintenance_enabled || false,
    maintenance_page_path: d.maintenance_page_path || null,
    has_custom_page: maintenanceManager.hasCustomMaintenancePage(d.hostname)
  }));

  res.json(result);
});

// Get maintenance status for a specific domain
const getStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid domain ID', 400);

  logger.debug('Getting maintenance status', { id });

  const status = await domainModel.getMaintenanceStatus(id);
  if (!status) throw new AppError('Domain not found', 404);

  res.json({
    ...status,
    has_custom_page: maintenanceManager.hasCustomMaintenancePage(status.hostname)
  });
});

// Enable/disable maintenance mode for a domain
const setMaintenanceMode = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid domain ID', 400);

  const { enabled, maintenancePagePath } = req.body;

  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled field must be a boolean', 400);
  }

  logger.debug('Setting maintenance mode', { id, enabled, maintenancePagePath });

  const result = await domainModel.setMaintenanceMode(id, enabled, maintenancePagePath);
  if (!result) throw new AppError('Domain not found', 404);

  logger.info('Maintenance mode updated', { id, hostname: result.hostname, enabled });

  // Reload proxies to apply changes
  setImmediate(() => {
    proxyManager.reloadAllProxies().catch(err => {
      logger.error('Failed to reload proxies', { error: err.message });
    });
  });

  res.json({
    ...result,
    has_custom_page: maintenanceManager.hasCustomMaintenancePage(result.hostname)
  });
});

// Upload custom maintenance page for a domain
const uploadMaintenancePage = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid domain ID', 400);

  const { htmlContent } = req.body;
  if (!htmlContent) throw new AppError('htmlContent is required', 400);

  logger.debug('Uploading maintenance page', { id });

  // Get domain info
  const domain = await domainModel.getMaintenanceStatus(id);
  if (!domain) throw new AppError('Domain not found', 404);

  // Save the maintenance page
  const filePath = maintenanceManager.saveMaintenancePage(domain.hostname, htmlContent);

  // Update domain with custom page path
  const fileName = `${domain.hostname.replace(/[^a-z0-9.-]/gi, '_')}.html`;
  await domainModel.setMaintenanceMode(id, domain.maintenance_enabled, fileName);

  logger.info('Maintenance page uploaded', { id, hostname: domain.hostname });

  res.json({
    success: true,
    domain: domain.hostname,
    path: fileName,
    message: 'Maintenance page uploaded successfully'
  });
});

// Get maintenance page content for a domain
const getMaintenancePage = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid domain ID', 400);

  logger.debug('Getting maintenance page', { id });

  const domain = await domainModel.getMaintenanceStatus(id);
  if (!domain) throw new AppError('Domain not found', 404);

  const content = maintenanceManager.getMaintenancePage(domain.hostname, domain.maintenance_page_path);

  res.json({
    domain: domain.hostname,
    content,
    is_custom: maintenanceManager.hasCustomMaintenancePage(domain.hostname)
  });
});

// Delete custom maintenance page for a domain
const deleteMaintenancePage = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) throw new AppError('Invalid domain ID', 400);

  logger.debug('Deleting maintenance page', { id });

  const domain = await domainModel.getMaintenanceStatus(id);
  if (!domain) throw new AppError('Domain not found', 404);

  // Delete the maintenance page file
  const deleted = maintenanceManager.deleteMaintenancePage(domain.hostname);

  // Update domain to remove custom page path
  if (deleted) {
    await domainModel.setMaintenanceMode(id, domain.maintenance_enabled, null);
  }

  logger.info('Maintenance page deleted', { id, hostname: domain.hostname });

  res.json({
    success: deleted,
    message: deleted ? 'Maintenance page deleted successfully' : 'No custom maintenance page found'
  });
});

// List all domains in maintenance mode
const listInMaintenance = asyncHandler(async (req, res) => {
  logger.debug('Listing domains in maintenance mode');

  const domains = await domainModel.listDomainsInMaintenance();

  const result = domains.map(d => ({
    ...d,
    has_custom_page: maintenanceManager.hasCustomMaintenancePage(d.hostname)
  }));

  res.json(result);
});

module.exports = {
  listStatus,
  getStatus,
  setMaintenanceMode,
  uploadMaintenancePage,
  getMaintenancePage,
  deleteMaintenancePage,
  listInMaintenance
};
