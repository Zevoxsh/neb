const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('SystemRoutes');

// Redémarrer l'application
router.post('/api/system/restart', authenticateToken, asyncHandler(async (req, res) => {
    logger.warn('Application restart requested', { user: req.user?.username });
    
    res.json({ 
        success: true, 
        message: 'Redémarrage en cours...' 
    });
    
    // Donner le temps de renvoyer la réponse avant de quitter
    setTimeout(() => {
        logger.info('Restarting application...');
        process.exit(0); // PM2/systemd/Docker redémarrera automatiquement
    }, 500);
}));

module.exports = router;
