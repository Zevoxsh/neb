const express = require('express');
const router = express.Router();
const botProtection = require('../services/botProtection');
const { getClientIp } = require('../middleware/botChallenge');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('BotChallenge');

// Verify challenge
router.post('/verify-challenge', asyncHandler(async (req, res) => {
    const { solution, userInput } = req.body;
    const ip = getClientIp(req);

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

module.exports = router;
