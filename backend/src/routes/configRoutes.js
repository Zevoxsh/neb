const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { authenticateToken } = require('../middleware/auth');

// Récupérer toute la configuration
router.get('/api/config', authenticateToken, configController.getAllConfig);

// Tester la connexion à la base de données
router.get('/api/config/test-db', authenticateToken, configController.testDatabaseConnection);

// Mettre à jour le fichier .env
router.post('/api/config/update-env', authenticateToken, configController.updateEnvFile);

// Mettre à jour un paramètre
router.put('/api/config', authenticateToken, configController.updateConfig);

// Mettre à jour plusieurs paramètres
router.post('/api/config/bulk', authenticateToken, configController.updateBulkConfig);

// Réinitialiser une catégorie
router.post('/api/config/reset', authenticateToken, configController.resetToDefaults);

// Exporter en .env
router.get('/api/config/export', authenticateToken, configController.exportEnv);

module.exports = router;
