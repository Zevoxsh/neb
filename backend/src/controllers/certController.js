/**
 * Certificate Controller (Refactored)
 */

const domainModel = require('../models/domainModel');
const acmeManager = require('../services/acmeManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('CertController');

// List all certificates
const list = asyncHandler(async (req, res) => {
    logger.debug('Listing certificates');

    // Get all domains from mappings
    const mappings = await domainModel.listDomainMappings();

    const results = mappings.map(m => {
        const s = acmeManager.getCertStatus(m.hostname);

        // Calculate status with better logic
        let status = 'missing';
        let expiresInDays = null;

        if (s && s.exists) {
            if (s.validTo) {
                const now = new Date();
                expiresInDays = Math.floor((s.validTo - now) / (1000 * 60 * 60 * 24));

                if (expiresInDays < 0) {
                    status = 'expired';
                } else if (expiresInDays < 7) {
                    status = 'critical';
                } else if (expiresInDays < 30) {
                    status = 'warning';
                } else {
                    status = 'valid';
                }
            } else {
                status = 'valid'; // Certificate exists but no expiry info
            }
        }

        return {
            hostname: m.hostname,
            status,
            valid_until: s && s.validTo ? (s.validTo instanceof Date ? s.validTo.toISOString() : new Date(s.validTo).toISOString()) : null,
            expires_in_days: expiresInDays,
            certificate_exists: s && s.exists || false
        };
    });

    res.json(results);
});

// Generate/request certificate for domain
const generate = asyncHandler(async (req, res) => {
    const { domain } = req.body;

    if (!domain) throw new AppError('Domain required', 400);

    logger.debug('Generating certificate', { domain });

    // Check if domain exists in our system
    const exists = await domainModel.domainExists(domain);
    if (!exists) throw new AppError('Domain not managed by Nebula', 404);

    // Trigger certificate generation
    await acmeManager.ensureCert(domain);

    logger.info('Certificate generated', { domain });

    // Return new status with improved information
    const s = acmeManager.getCertStatus(domain);
    let status = 'missing';
    let expiresInDays = null;

    if (s && s.exists && s.validTo) {
        const now = new Date();
        expiresInDays = Math.floor((s.validTo - now) / (1000 * 60 * 60 * 24));

        if (expiresInDays < 0) {
            status = 'expired';
        } else if (expiresInDays < 7) {
            status = 'critical';
        } else if (expiresInDays < 30) {
            status = 'warning';
        } else {
            status = 'valid';
        }
    }

    res.json({
        hostname: domain,
        status,
        valid_until: s && s.validTo ? (s.validTo instanceof Date ? s.validTo.toISOString() : new Date(s.validTo).toISOString()) : null,
        expires_in_days: expiresInDays,
        certificate_exists: s && s.exists || false
    });
});

// Get certificate content
const get = asyncHandler(async (req, res) => {
    const { domain } = req.params;

    if (!domain) throw new AppError('Domain required', 400);

    logger.debug('Getting certificate', { domain });

    const content = acmeManager.getCertContent(domain);
    if (!content) {
        // Return status instead of error
        const s = acmeManager.getCertStatus(domain);
        return res.json({
            exists: false,
            status: 'missing',
            message: 'Certificate not found for this domain'
        });
    }

    res.json(content);
});

// Upload manual certificate
const uploadManual = asyncHandler(async (req, res) => {
    const { domain, certificate, privateKey } = req.body || {};

    if (!domain || !certificate || !privateKey) {
        throw new AppError('Domain, certificate and privateKey required', 400);
    }

    logger.debug('Uploading manual certificate', { domain });

    await acmeManager.saveManualCert(domain.trim(), certificate, privateKey);

    logger.info('Manual certificate uploaded', { domain });

    // Return new status with improved information
    const s = acmeManager.getCertStatus(domain.trim());
    let status = 'missing';
    let expiresInDays = null;

    if (s && s.exists && s.validTo) {
        const now = new Date();
        expiresInDays = Math.floor((s.validTo - now) / (1000 * 60 * 60 * 24));

        if (expiresInDays < 0) {
            status = 'expired';
        } else if (expiresInDays < 7) {
            status = 'critical';
        } else if (expiresInDays < 30) {
            status = 'warning';
        } else {
            status = 'valid';
        }
    }

    res.json({
        hostname: domain.trim(),
        status,
        valid_until: s && s.validTo ? (s.validTo instanceof Date ? s.validTo.toISOString() : new Date(s.validTo).toISOString()) : null,
        expires_in_days: expiresInDays,
        certificate_exists: s && s.exists || false
    });
});

module.exports = { list, generate, get, uploadManual };
