const express = require('express');
const router = express.Router();
const botProtection = require('../services/botProtection');
const { getClientIp } = require('../middleware/botChallenge');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('BotChallenge');

// Verify challenge
router.post('/verify-challenge', asyncHandler(async (req, res) => {
    const { solution, timestamp } = req.body;
    const ip = getClientIp(req);

    // For now, just verify timestamp is recent
    const now = Date.now();
    const challengeTs = parseInt(timestamp);

    if (Math.abs(now - challengeTs) > 30000) {
        logger.warn('Challenge timeout', { ip });
        return res.status(403).json({ error: 'Challenge expired' });
    }

    // Mark IP as verified
    botProtection.verifyIP(ip);
    logger.info('IP verified', { ip });

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

module.exports = router;
