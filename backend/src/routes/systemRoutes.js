const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const logger = createLogger('SystemRoutes');

// Recharger les variables d'environnement depuis le fichier .env
function reloadEnv() {
    const envPath = path.join(__dirname, '../../../.env');
    
    if (!fs.existsSync(envPath)) {
        logger.warn('.env file not found');
        return false;
    }
    
    try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        
        lines.forEach(line => {
            line = line.trim();
            if (!line || line.startsWith('#')) return;
            
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();
                
                // Retirer les guillemets si présents
                if ((value.startsWith('"') && value.endsWith('"')) || 
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                
                process.env[key] = value;
                logger.debug(`Reloaded env var: ${key}`);
            }
        });
        
        logger.info('Environment variables reloaded from .env file');
        return true;
    } catch (error) {
        logger.error('Failed to reload .env file', { error: error.message });
        return false;
    }
}

// Redémarrer l'application ou recharger la configuration
router.post('/api/system/restart', authenticateToken, asyncHandler(async (req, res) => {
    logger.warn('Application reload requested', { user: req.user?.username });
    
    // Recharger les variables d'environnement
    const reloaded = reloadEnv();
    
    if (reloaded) {
        // Réinitialiser la connexion à la base de données
        const dbState = require('../utils/dbState');
        const pool = require('../config/db');
        
        try {
            // Recréer le pool avec les nouvelles variables d'environnement
            logger.info('Recreating database pool with new configuration');
            await pool.recreatePool();
            
            // Tester la nouvelle connexion avec le pool mis à jour
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            
            dbState.setConnected(true);
            logger.info('Database reconnected successfully after config reload');
            
            res.json({ 
                success: true, 
                message: 'Configuration rechargée avec succès. Base de données reconnectée.',
                dbConnected: true
            });
        } catch (error) {
            dbState.setConnected(false);
            logger.error('Database connection failed after config reload', { error: error.message });
            
            res.json({ 
                success: true, 
                message: 'Configuration rechargée mais la connexion à la base de données a échoué. Vérifiez les paramètres.',
                dbConnected: false,
                error: error.message
            });
        }
    } else {
        res.status(500).json({ 
            success: false, 
            message: 'Échec du rechargement de la configuration'
        });
    }
}));

module.exports = router;
