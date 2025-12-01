const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const botProtection = require('../services/botProtection');
const { getClientIp } = require('../middleware/botChallenge');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('BotChallenge');

// Serve challenge page with code injection
router.get('/challenge.html', asyncHandler(async (req, res) => {
    const ip = getClientIp(req);
    
    // Get or generate challenge for this IP
    let challengeData = botProtection.getActiveChallenge(ip);
    if (!challengeData) {
        challengeData = botProtection.generateChallenge(ip);
        logger.info('New challenge generated', { ip, code: challengeData.code });
    } else {
        logger.info('Reusing existing challenge', { ip, code: challengeData.code });
    }
    
    // Read and inject challenge code into HTML
    const challengePath = path.join(__dirname, '..', '..', 'public', 'challenge.html');
    
    if (!fs.existsSync(challengePath)) {
        logger.error('Challenge file not found', { path: challengePath });
        return res.status(404).send('Challenge page not found');
    }
    
    let html = fs.readFileSync(challengePath, 'utf8');
    html = html.replace('{{CHALLENGE_CODE}}', challengeData.code);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
}));

// Rate limiting pour vérification challenge
const verifyAttempts = new Map();

// Nettoyage périodique
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of verifyAttempts.entries()) {
        if (data.resetAt < now) {
            verifyAttempts.delete(ip);
        }
    }
}, 60000);

// Verify challenge
router.post('/verify-challenge', asyncHandler(async (req, res) => {
    const { solution, userInput } = req.body;
    const ip = getClientIp(req);
    const now = Date.now();
    
    // Rate limiting: max 5 tentatives par minute
    let attempts = verifyAttempts.get(ip);
    if (!attempts || attempts.resetAt < now) {
        attempts = { count: 0, resetAt: now + 60000 };
        verifyAttempts.set(ip, attempts);
    }
    
    if (attempts.count >= 5) {
        logger.warn('Too many verification attempts', { ip, count: attempts.count });
        return res.status(429).json({ 
            error: 'Trop de tentatives. Réessayez dans 1 minute.',
            retryAfter: Math.ceil((attempts.resetAt - now) / 1000)
        });
    }
    
    attempts.count++;

    logger.info('Challenge verification request', { 
        ip, 
        userInput, 
        solution,
        attempts: attempts.count
    });

    // Verify the CAPTCHA answer
    const result = botProtection.verifyChallengeAnswer(ip, userInput || solution);

    if (!result.success) {
        if (result.banned) {
            logger.warn('IP banned for too many failed attempts', { ip });
            return res.status(403).json({ 
                error: 'Trop de tentatives échouées. Vous avez été temporairement banni.',
                banned: true
            });
        }
        
        if (result.reason === 'expired') {
            return res.status(400).json({ 
                error: 'Challenge expiré. Veuillez rafraîchir la page.',
                expired: true
            });
        }
        
        if (result.reason === 'wrong_answer') {
            return res.status(400).json({ 
                error: 'Code incorrect',
                attemptsLeft: result.attemptsLeft
            });
        }
        
        return res.status(400).json({ error: 'Vérification échouée' });
    }

    logger.info('IP verified successfully', { ip });
    res.json({ success: true });
}));

// Get bot protection stats
router.get('/api/bot-protection/stats', asyncHandler(async (req, res) => {
    const stats = botProtection.getStats();
    res.json(stats);
}));

// Toggle Under Attack mode
router.post('/api/bot-protection/toggle', asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    botProtection.setEnabled(enabled);
    logger.info('Under Attack mode toggled', { enabled });
    res.json({ enabled });
}));

// Set threshold
router.post('/api/bot-protection/threshold', asyncHandler(async (req, res) => {
    const { threshold } = req.body;
    botProtection.setThreshold(threshold);
    logger.info('Threshold updated', { threshold });
    res.json({ threshold });
}));

// Set per-IP limit
router.post('/api/bot-protection/ip-limit', asyncHandler(async (req, res) => {
    const { limit } = req.body;
    botProtection.setPerIpLimit(limit);
    logger.info('Per-IP limit updated', { limit });
    res.json({ limit });
}));

// Toggle challenge on first visit
router.post('/api/bot-protection/challenge-first-visit', asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    botProtection.setChallengeFirstVisit(enabled);
    logger.info('Challenge first visit toggled', { enabled });
    res.json({ enabled });
}));

// Set verification duration
router.post('/api/bot-protection/verification-duration', asyncHandler(async (req, res) => {
    const { hours } = req.body;
    botProtection.setVerificationDuration(hours);
    logger.info('Verification duration updated', { hours });
    res.json({ hours });
}));

// Add protected domain
router.post('/api/bot-protection/protected-domains/add', asyncHandler(async (req, res) => {
    const rawDomain = req.body.domain;
    
    // Validation stricte du domaine
    if (!rawDomain || typeof rawDomain !== 'string') {
        return res.status(400).json({ error: 'Domain required' });
    }
    
    const domain = rawDomain.trim().toLowerCase();
    
    // Validation format de domaine (RFC 1035)
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(domain)) {
        return res.status(400).json({ error: 'Invalid domain format' });
    }
    
    // Limite de longueur
    if (domain.length > 253) {
        return res.status(400).json({ error: 'Domain too long (max 253 characters)' });
    }
    
    // First, generate SSL certificate for the domain
    try {
        const acmeManager = require('../services/acmeManager');
        logger.info('Generating SSL certificate for protected domain', { domain });
        
        // Check if certificate already exists
        const db = require('../config/db');
        const certResult = await db.query(
            'SELECT * FROM certificates WHERE domain = $1',
            [domain]
        );
        
        if (certResult.rows.length === 0) {
            // Certificate doesn't exist, generate it
            logger.info('Certificate not found, requesting new certificate', { domain });
            await acmeManager.ensureCert(domain);
            logger.info('SSL certificate generated successfully', { domain });
        } else {
            logger.info('SSL certificate already exists', { domain });
        }
    } catch (certError) {
        logger.error('Failed to generate SSL certificate', { domain, error: certError.message });
        return res.status(500).json({ 
            success: false, 
            error: 'Échec de la génération du certificat SSL',
            details: certError.message 
        });
    }
    
    // Then add to bot protection
    botProtection.addProtectedDomain(domain);
    logger.info('Protected domain added with SSL certificate', { domain });
    res.json({ success: true, domain });
}));

// Remove protected domain
router.post('/api/bot-protection/protected-domains/remove', asyncHandler(async (req, res) => {
    const { domain } = req.body;
    botProtection.removeProtectedDomain(domain);
    logger.info('Protected domain removed', { domain });
    res.json({ success: true, domain });
}));

// Add unprotected domain
router.post('/api/bot-protection/unprotected-domains/add', asyncHandler(async (req, res) => {
    const { domain } = req.body;
    botProtection.addUnprotectedDomain(domain);
    logger.info('Unprotected domain added', { domain });
    res.json({ success: true, domain });
}));

// Remove unprotected domain
router.post('/api/bot-protection/unprotected-domains/remove', asyncHandler(async (req, res) => {
    const { domain } = req.body;
    botProtection.removeUnprotectedDomain(domain);
    logger.info('Unprotected domain removed', { domain });
    res.json({ success: true, domain });
}));

// Clear domain lists
router.post('/api/bot-protection/domains/clear', asyncHandler(async (req, res) => {
    botProtection.clearDomainLists();
    logger.info('Domain lists cleared');
    res.json({ success: true });
}));

module.exports = router;
