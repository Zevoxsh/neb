const domainModel = require('../models/domainModel');
const acmeManager = require('../services/acmeManager');

async function list(req, res) {
    try {
        // Get all domains from mappings
        // Note: domainModel.listDomainMappings returns mappings, not just unique domains.
        // But we might have multiple mappings for same hostname? 
        // Actually domain_mappings has unique hostname constraint.
        const mappings = await domainModel.listDomainMappings();

        const results = mappings.map(m => {
            const status = acmeManager.getCertStatus(m.hostname);
            return {
                hostname: m.hostname,
                ...status
            };
        });

        res.json(results);
    } catch (e) {
        console.error('certController list error', e);
        res.status(500).send('Server error');
    }
}

async function generate(req, res) {
    const { domain } = req.body;
    if (!domain) return res.status(400).send('Domain required');

    try {
        // Check if domain exists in our system
        const exists = await domainModel.domainExists(domain);
        if (!exists) return res.status(404).send('Domain not managed by Nebula');

        // Trigger generation (async, but we await it here to give feedback? 
        // Or maybe just trigger? The user asked for "click to generate". 
        // ensureCert is async and waits for certbot. It might take a few seconds.
        // Let's await it so we can say "Success" or "Failed".
        await acmeManager.ensureCert(domain);

        // Return new status
        const status = acmeManager.getCertStatus(domain);
        res.json({
            hostname: domain,
            ...status
        });
    } catch (e) {
        console.error('certController generate error', e);
        res.status(500).send('Generation failed: ' + e.message);
    }
}

async function get(req, res) {
    const { domain } = req.params;
    if (!domain) return res.status(400).send('Domain required');

    try {
        const content = acmeManager.getCertContent(domain);
        if (!content) return res.status(404).send('Certificate not found');
        res.json(content);
    } catch (e) {
        console.error('certController get error', e);
        res.status(500).send('Server error');
    }
}

module.exports = { list, generate, get };
