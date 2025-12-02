/**
 * Configuration Controller
 * Gestion centralisée de TOUS les paramètres du système
 */

const settingsModel = require('../models/settingsModel');
const botProtection = require('../services/botProtection');
const proxyManager = require('../services/proxyManager');
const acmeManager = require('../services/acmeManager');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ConfigController');

// Definition of all configurable parameters
const CONFIG_SCHEMA = {
    // Database (modifiable via .env)
    database: {
        host: { type: 'string', default: 'localhost', env: 'DB_HOST', category: 'Database', requiresRestart: true },
        port: { type: 'number', default: 5432, env: 'DB_PORT', category: 'Database', requiresRestart: true },
        user: { type: 'string', default: 'postgres', env: 'DB_USER', category: 'Database', requiresRestart: true },
        password: { type: 'password', default: '', env: 'DB_PASSWORD', category: 'Database', requiresRestart: true },
        name: { type: 'string', default: 'nebuladb', env: 'DB_NAME', category: 'Database', requiresRestart: true }
    },
    
    // Security & JWT
    security: {
        jwtSecret: { type: 'password', default: '', env: 'JWT_SECRET', category: 'Security', required: true, requiresRestart: true },
        cookieSecure: { type: 'boolean', default: true, env: 'COOKIE_SECURE', category: 'Security', requiresRestart: true },
        botSecret: { type: 'password', default: '', env: 'BOT_SECRET', category: 'Security', requiresRestart: true }
    },
    
    // ACME / Let's Encrypt
    acme: {
        email: { type: 'string', default: '', env: 'ACME_EMAIL', category: 'SSL', required: true, requiresRestart: true },
        localTlds: { type: 'array', default: ['local', 'localhost', 'lan'], category: 'SSL' }
    },
    
    // Bot Protection / DDoS
    botProtection: {
        enabled: { type: 'boolean', default: false, category: 'Bot Protection' },
        threshold: { type: 'number', default: 100, category: 'Bot Protection', min: 10, max: 1000 },
        perIpLimit: { type: 'number', default: 60, category: 'Bot Protection', min: 10, max: 1000 },
        perIpLimitProtected: { type: 'number', default: 30, category: 'Bot Protection', min: 5, max: 500 },
        verifiedIpLimit: { type: 'number', default: 600, category: 'Bot Protection', min: 60, max: 10000 },
        burstLimit: { type: 'number', default: 10, category: 'Bot Protection', min: 5, max: 100 },
        maxConnectionsPerIP: { type: 'number', default: 100, category: 'Bot Protection', min: 10, max: 1000 },
        maxAttempts: { type: 'number', default: 3, category: 'Bot Protection', min: 1, max: 10 },
        verificationDuration: { type: 'number', default: 6, category: 'Bot Protection', unit: 'hours', min: 1, max: 48 },
        challengeFirstVisit: { type: 'boolean', default: false, category: 'Bot Protection' }
    },
    
    // Backends Health Check
    backends: {
        healthCheckInterval: { type: 'number', default: 30000, category: 'Backends', unit: 'ms', min: 5000, max: 300000 },
        failureThreshold: { type: 'number', default: 3, category: 'Backends', min: 1, max: 10 },
        healthCheckTimeout: { type: 'number', default: 5000, category: 'Backends', unit: 'ms', min: 1000, max: 30000 }
    },
    
    // Alertes
    alerts: {
        enabled: { type: 'boolean', default: true, category: 'Alerts' },
        cooldown: { type: 'number', default: 900000, category: 'Alerts', unit: 'ms', min: 60000, max: 3600000 }
    },
    
    // IP Security
    ipSecurity: {
        autoBlockIps: { type: 'boolean', default: true, category: 'IP Security' },
        ipBytesThreshold: { type: 'number', default: 52428800, category: 'IP Security', unit: 'bytes', min: 1048576, max: 1073741824 },
        ipRequestsThreshold: { type: 'number', default: 1000, category: 'IP Security', min: 100, max: 100000 }
    },
    
    // Metrics
    metrics: {
        flushInterval: { type: 'number', default: 5, category: 'Metrics', unit: 'seconds', min: 1, max: 60 },
        maxBufferSize: { type: 'number', default: 100000, category: 'Metrics', min: 1000, max: 1000000 }
    }
};

// Test database connection
const testDatabaseConnection = asyncHandler(async (req, res) => {
    const { Pool } = require('pg');
    
    try {
        // Toujours utiliser les variables d'environnement actuelles pour le test
        // car si la DB est inaccessible, on ne peut pas récupérer les settings
        const dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'nebuladb',
            connectionTimeoutMillis: 5000,
        };
        
        const testPool = new Pool(dbConfig);
        
        // Tester la connexion
        const client = await testPool.connect();
        await client.query('SELECT 1');
        client.release();
        await testPool.end();
        
        logger.info('Database connection test successful');
        res.json({ 
            success: true, 
            message: 'Database connection successful',
            config: {
                host: dbConfig.host,
                port: dbConfig.port,
                database: dbConfig.database
            }
        });
    } catch (error) {
        logger.error('Database connection test failed', { error: error.message });
        res.json({ 
            success: false, 
            error: error.message,
            details: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// Mettre à jour le fichier .env
const updateEnvFile = asyncHandler(async (req, res) => {
    const fs = require('fs').promises;
    const path = require('path');
    const { category, updates } = req.body; // updates = { key: value, ... }
    
    if (!updates || typeof updates !== 'object') {
        throw new AppError('Updates object required', 400);
    }
    
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';
        
        // Lire le fichier .env actuel
        try {
            envContent = await fs.readFile(envPath, 'utf8');
        } catch (error) {
            // Si le fichier n'existe pas, on part d'un fichier vide
            envContent = '';
        }
        
        // Parser le fichier .env en lignes
        const lines = envContent.split('\n');
        const envMap = new Map();
        const comments = [];
        
        // Construire une map des variables existantes
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || trimmed === '') {
                comments.push({ index, line });
            } else {
                const match = line.match(/^([^=]+)=(.*)$/);
                if (match) {
                    const [, key, value] = match;
                    envMap.set(key.trim(), value);
                }
            }
        });
        
        // Appliquer les mises à jour
        for (const [key, value] of Object.entries(updates)) {
            const schema = CONFIG_SCHEMA[category]?.[key];
            if (!schema || !schema.env) continue;
            
            const envKey = schema.env;
            envMap.set(envKey, String(value));
        }
        
        // Reconstruire le fichier .env
        let newContent = `# Configuration Nebula Proxy\n`;
        newContent += `# Updated: ${new Date().toISOString()}\n\n`;
        
        // Grouper par catégorie
        const categoryKeys = {
            'Database': ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'],
            'Security': ['JWT_SECRET', 'COOKIE_SECURE', 'BOT_SECRET'],
            'ACME': ['ACME_EMAIL'],
            'Server': ['PORT', 'NODE_ENV']
        };
        
        for (const [cat, keys] of Object.entries(categoryKeys)) {
            newContent += `# ${cat}\n`;
            for (const key of keys) {
                if (envMap.has(key)) {
                    newContent += `${key}=${envMap.get(key)}\n`;
                    envMap.delete(key);
                }
            }
            newContent += '\n';
        }
        
        // Ajouter les clés restantes
        if (envMap.size > 0) {
            newContent += `# Other\n`;
            for (const [key, value] of envMap.entries()) {
                newContent += `${key}=${value}\n`;
            }
        }
        
        // Sauvegarder le fichier
        await fs.writeFile(envPath, newContent, 'utf8');
        
        logger.info('Environment file updated', { category, keys: Object.keys(updates) });
        
        res.json({ 
            success: true, 
            message: '.env file updated. Restart required to apply changes.',
            requiresRestart: true
        });
    } catch (error) {
        logger.error('Failed to update .env file', { error: error.message });
        throw new AppError('Error updating .env file: ' + error.message, 500);
    }
});

// Récupérer toute la configuration
const getAllConfig = asyncHandler(async (req, res) => {
    logger.debug('Getting all configuration');
    
    const config = {};
    const settings = await settingsModel.listSettings();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    
    // Charger depuis DB ou valeurs par défaut
    for (const [category, params] of Object.entries(CONFIG_SCHEMA)) {
        config[category] = {};
        for (const [key, schema] of Object.entries(params)) {
            const dbKey = `${category}.${key}`;
            let value = settingsMap.get(dbKey);
            
            if (value === undefined || value === null) {
                value = schema.default;
            } else {
                // Convertir le type
                if (schema.type === 'number') value = Number(value);
                else if (schema.type === 'boolean') value = value === 'true' || value === true;
                else if (schema.type === 'array') value = JSON.parse(value);
            }
            
            config[category][key] = value;
        }
    }
    
    // Pour la base de données, toujours utiliser les valeurs du .env actuel
    // car ce sont celles réellement utilisées par l'application
    config.database = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'nebuladb'
    };
    
    // Pour la sécurité, toujours utiliser les valeurs du .env actuel
    config.security = {
        jwtSecret: process.env.JWT_SECRET || '',
        cookieSecure: process.env.COOKIE_SECURE === 'true',
        botSecret: process.env.BOT_SECRET || ''
    };
    
    // Pour ACME, toujours utiliser les valeurs du .env actuel
    if (process.env.ACME_EMAIL) {
        config.acme.email = process.env.ACME_EMAIL;
    }
    
    // Ajouter les valeurs actuelles du runtime
    config.botProtection.enabled = botProtection.enabled;
    config.botProtection.threshold = botProtection.threshold;
    config.botProtection.perIpLimit = botProtection.perIpLimit;
    config.botProtection.perIpLimitProtected = botProtection.perIpLimitProtected;
    config.botProtection.verifiedIpLimit = botProtection.verifiedIpLimit;
    config.botProtection.burstLimit = botProtection.burstLimit;
    config.botProtection.maxConnectionsPerIP = botProtection.maxConnectionsPerIP;
    
    res.json({ config, schema: CONFIG_SCHEMA });
});

// Mettre à jour la configuration
const updateConfig = asyncHandler(async (req, res) => {
    const { category, key, value } = req.body;
    
    if (!category || !key) {
        throw new AppError('Category and key required', 400);
    }
    
    if (!CONFIG_SCHEMA[category] || !CONFIG_SCHEMA[category][key]) {
        throw new AppError('Invalid configuration key', 400);
    }
    
    const schema = CONFIG_SCHEMA[category][key];
    
    // Validation
    if (schema.required && !value) {
        throw new AppError(`${key} is required`, 400);
    }
    
    if (schema.type === 'number') {
        const numValue = Number(value);
        if (isNaN(numValue)) throw new AppError('Invalid number', 400);
        if (schema.min !== undefined && numValue < schema.min) {
            throw new AppError(`Value must be >= ${schema.min}`, 400);
        }
        if (schema.max !== undefined && numValue > schema.max) {
            throw new AppError(`Value must be <= ${schema.max}`, 400);
        }
    }
    
    // Sauvegarder en DB
    const dbKey = `${category}.${key}`;
    let dbValue = value;
    if (schema.type === 'array') dbValue = JSON.stringify(value);
    else if (schema.type === 'boolean') dbValue = String(value);
    else dbValue = String(value);
    
    await settingsModel.setSetting(dbKey, dbValue);
    
    // Appliquer au runtime
    applyConfigToRuntime(category, key, value);
    
    logger.info('Configuration updated', { category, key });
    res.json({ success: true, category, key, value });
});

// Mettre à jour plusieurs paramètres d'un coup
const updateBulkConfig = asyncHandler(async (req, res) => {
    const { updates } = req.body; // Array de { category, key, value }
    
    if (!Array.isArray(updates)) {
        throw new AppError('updates must be an array', 400);
    }
    
    const results = [];
    
    for (const update of updates) {
        const { category, key, value } = update;
        
        if (!CONFIG_SCHEMA[category] || !CONFIG_SCHEMA[category][key]) {
            results.push({ category, key, success: false, error: 'Invalid key' });
            continue;
        }
        
        try {
            const dbKey = `${category}.${key}`;
            const schema = CONFIG_SCHEMA[category][key];
            
            let dbValue = value;
            if (schema.type === 'array') dbValue = JSON.stringify(value);
            else if (schema.type === 'boolean') dbValue = String(value);
            else dbValue = String(value);
            
            await settingsModel.setSetting(dbKey, dbValue);
            applyConfigToRuntime(category, key, value);
            
            results.push({ category, key, success: true });
        } catch (error) {
            results.push({ category, key, success: false, error: error.message });
        }
    }
    
    logger.info('Bulk configuration updated', { count: results.filter(r => r.success).length });
    res.json({ results });
});

// Appliquer les changements au runtime
function applyConfigToRuntime(category, key, value) {
    switch (category) {
        case 'botProtection':
            switch (key) {
                case 'enabled':
                    botProtection.setEnabled(value);
                    break;
                case 'threshold':
                    botProtection.setThreshold(value);
                    break;
                case 'perIpLimit':
                    botProtection.setPerIpLimit(value);
                    break;
                case 'verifiedIpLimit':
                    botProtection.verifiedIpLimit = value;
                    break;
                case 'perIpLimitProtected':
                    botProtection.perIpLimitProtected = value;
                    break;
                case 'burstLimit':
                    botProtection.burstLimit = value;
                    break;
                case 'maxConnectionsPerIP':
                    botProtection.maxConnectionsPerIP = value;
                    break;
                case 'maxAttempts':
                    botProtection.maxAttempts = value;
                    break;
                case 'verificationDuration':
                    botProtection.setVerificationDuration(value); // en heures
                    break;
                case 'challengeFirstVisit':
                    botProtection.setChallengeFirstVisit(value);
                    break;
            }
            break;
            
        case 'acme':
            if (key === 'localTlds') {
                acmeManager.setLocalTlds(value);
            }
            break;
            
        case 'backends':
            if (key === 'healthCheckInterval') {
                proxyManager.healthProbeIntervalMs = value;
            } else if (key === 'failureThreshold') {
                proxyManager.failureThreshold = value;
            }
            break;
            
        case 'ipSecurity':
            if (key === 'autoBlockIps' || key === 'ipBytesThreshold' || key === 'ipRequestsThreshold') {
                const config = {};
                config[key] = value;
                proxyManager.updateSecurityConfig(config);
            }
            break;
            
        case 'alerts':
            if (key === 'cooldown') {
                proxyManager.updateSecurityConfig({ cooldown: value });
            }
            break;
            
        case 'metrics':
            if (key === 'flushInterval') {
                proxyManager.flushIntervalSec = value;
            }
            break;
    }
}

// Réinitialiser aux valeurs par défaut
const resetToDefaults = asyncHandler(async (req, res) => {
    const { category } = req.body;
    
    if (!category || !CONFIG_SCHEMA[category]) {
        throw new AppError('Invalid category', 400);
    }
    
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA[category])) {
        const dbKey = `${category}.${key}`;
        let dbValue = schema.default;
        if (schema.type === 'array') dbValue = JSON.stringify(dbValue);
        else if (schema.type === 'boolean') dbValue = String(dbValue);
        else dbValue = String(dbValue);
        
        await settingsModel.setSetting(dbKey, dbValue);
        applyConfigToRuntime(category, key, schema.default);
    }
    
    logger.info('Configuration reset to defaults', { category });
    res.json({ success: true, category });
});

// Exporter la configuration en .env format
const exportEnv = asyncHandler(async (req, res) => {
    const settings = await settingsModel.listSettings();
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    
    let envContent = '# Configuration Nebula Proxy\n';
    envContent += `# Generated on ${new Date().toISOString()}\n\n`;
    
    for (const [category, params] of Object.entries(CONFIG_SCHEMA)) {
        envContent += `\n# ${category.toUpperCase()}\n`;
        for (const [key, schema] of Object.entries(params)) {
            if (schema.env) {
                const dbKey = `${category}.${key}`;
                let value = settingsMap.get(dbKey) || schema.default;
                
                if (schema.type === 'array') {
                    value = JSON.parse(value).join(',');
                }
                
                envContent += `${schema.env}=${value}\n`;
            }
        }
    }
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=".env"');
    res.send(envContent);
});

// Obtenir les valeurs runtime actuelles (debug)
const getRuntimeValues = asyncHandler(async (req, res) => {
    const runtime = {
        botProtection: {
            enabled: botProtection.enabled,
            threshold: botProtection.threshold,
            perIpLimit: botProtection.perIpLimit,
            perIpLimitProtected: botProtection.perIpLimitProtected,
            verifiedIpLimit: botProtection.verifiedIpLimit,
            burstLimit: botProtection.burstLimit,
            maxConnectionsPerIP: botProtection.maxConnectionsPerIP,
            maxAttempts: botProtection.maxAttempts,
            verificationDuration: botProtection.verificationDuration / (60 * 60 * 1000), // Convert back to hours
            challengeFirstVisit: botProtection.challengeFirstVisit
        },
        backends: {
            healthProbeIntervalMs: proxyManager.healthProbeIntervalMs,
            failureThreshold: proxyManager.failureThreshold
        },
        metrics: {
            flushIntervalSec: proxyManager.flushIntervalSec
        },
        acme: {
            localTlds: acmeManager.getLocalTlds ? acmeManager.getLocalTlds() : []
        },
        securityConfig: proxyManager.securityConfig
    };
    
    res.json({ runtime });
});

module.exports = {
    getAllConfig,
    testDatabaseConnection,
    updateEnvFile,
    updateConfig,
    updateBulkConfig,
    resetToDefaults,
    exportEnv,
    getRuntimeValues,
    CONFIG_SCHEMA
};
