const express = require('express');
const router = express.Router();
const installController = require('../controllers/installController');
const fs = require('fs');
const path = require('path');

// Middleware pour vérifier si l'installation est déjà terminée
function blockIfInstalled(req, res, next) {
  const envPath = path.join(__dirname, '../../../.env');
  
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const isInstalled = envContent.includes('DB_HOST') && 
                       envContent.includes('DB_NAME') &&
                       envContent.includes('JWT_SECRET');
    
    if (isInstalled) {
      return res.status(403).json({ 
        error: 'Installation already completed',
        message: 'Installation already completed. Access denied.'
      });
    }
  } catch (error) {
    // Fichier .env n'existe pas, installation pas terminée
  }
  
  next();
}

// Route pour vérifier le statut de l'installation (toujours accessible)
router.get('/status', installController.checkInstallationStatus.bind(installController));

// Routes d'installation protégées (bloquées si déjà installé)
router.post('/test-db', blockIfInstalled, installController.testDatabaseConnection.bind(installController));
router.post('/complete', blockIfInstalled, installController.completeInstallation.bind(installController));

module.exports = router;
