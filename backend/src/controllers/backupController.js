/**
 * Backup Controller
 * Handles configuration export/import for backup and restore
 */

const proxyModel = require('../models/proxyModel');
const backendModel = require('../models/backendModel');
const domainModel = require('../models/domainModel');
const settingsModel = require('../models/settingsModel');
const blockedIpModel = require('../models/blockedIpModel');
const trustedIpModel = require('../models/trustedIpModel');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('BackupController');

const BACKUP_VERSION = '1.0';

// Export full configuration as JSON
const exportConfig = asyncHandler(async (req, res) => {
    logger.info('Exporting configuration backup');

    const [proxies, backends, domains, blockedIps, trustedIps] = await Promise.all([
        proxyModel.listProxies(),
        backendModel.listBackends(),
        domainModel.listDomainMappings(),
        blockedIpModel.listBlockedIps(),
        trustedIpModel.listTrustedIps()
    ]);

    // Get settings
    const localTlds = await settingsModel.getSetting('local_tlds');
    const securityConfig = await settingsModel.getSetting('security_config');

    const backup = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        data: {
            proxies: proxies || [],
            backends: backends || [],
            domains: domains || [],
            blockedIps: blockedIps || [],
            trustedIps: trustedIps || [],
            settings: {
                localTlds: localTlds || '',
                securityConfig: securityConfig || '{}'
            }
        }
    };

    logger.info('Configuration exported', {
        proxies: backup.data.proxies.length,
        backends: backup.data.backends.length,
        domains: backup.data.domains.length
    });

    // Set download headers
    const filename = `neb-backup-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
});

// Import configuration from JSON
const importConfig = asyncHandler(async (req, res) => {
    const backup = req.body;

    logger.info('Importing configuration backup');

    // Validate backup format
    if (!backup || !backup.version || !backup.data) {
        throw new AppError('Invalid backup format', 400);
    }

    if (backup.version !== BACKUP_VERSION) {
        throw new AppError(`Unsupported backup version: ${backup.version}`, 400);
    }

    const { proxies, backends, domains, blockedIps, trustedIps, settings } = backup.data;

    // Validate required fields
    if (!Array.isArray(proxies) || !Array.isArray(backends) || !Array.isArray(domains)) {
        throw new AppError('Invalid backup data structure', 400);
    }

    logger.warn('Starting configuration import - this will replace existing data');

    // Import in order: backends first, then proxies, then domains
    let stats = {
        backendsCreated: 0,
        proxiesCreated: 0,
        domainsCreated: 0,
        blockedIpsCreated: 0,
        trustedIpsCreated: 0
    };

    // Import backends
    for (const backend of backends) {
        try {
            await backendModel.createBackend(backend.name, backend.host, backend.port);
            stats.backendsCreated++;
        } catch (e) {
            logger.warn('Failed to import backend', { backend: backend.name, error: e.message });
        }
    }

    // Import proxies
    for (const proxy of proxies) {
        try {
            await proxyModel.createProxy(
                proxy.type,
                proxy.external_port,
                proxy.backend_id,
                proxy.is_public || false
            );
            stats.proxiesCreated++;
        } catch (e) {
            logger.warn('Failed to import proxy', { port: proxy.external_port, error: e.message });
        }
    }

    // Import domain mappings
    for (const domain of domains) {
        try {
            await domainModel.createDomainMapping(domain.proxy_id, domain.hostname);
            stats.domainsCreated++;
        } catch (e) {
            logger.warn('Failed to import domain', { hostname: domain.hostname, error: e.message });
        }
    }

    // Import blocked IPs
    if (Array.isArray(blockedIps)) {
        for (const ip of blockedIps) {
            try {
                await blockedIpModel.blockIp(ip.ip, ip.reason || 'Imported from backup');
                stats.blockedIpsCreated++;
            } catch (e) {
                logger.warn('Failed to import blocked IP', { ip: ip.ip, error: e.message });
            }
        }
    }

    // Import trusted IPs
    if (Array.isArray(trustedIps)) {
        for (const ip of trustedIps) {
            try {
                await trustedIpModel.addTrustedIp(ip.ip, ip.label || 'Imported from backup');
                stats.trustedIpsCreated++;
            } catch (e) {
                logger.warn('Failed to import trusted IP', { ip: ip.ip, error: e.message });
            }
        }
    }

    // Import settings
    if (settings) {
        if (settings.localTlds) {
            await settingsModel.setSetting('local_tlds', settings.localTlds);
        }
        if (settings.securityConfig) {
            await settingsModel.setSetting('security_config', settings.securityConfig);
        }
    }

    logger.info('Configuration import completed', stats);

    res.json({
        message: 'Import completed',
        stats
    });
});

module.exports = { exportConfig, importConfig };
