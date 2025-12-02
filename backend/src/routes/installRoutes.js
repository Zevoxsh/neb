const express = require('express');
const router = express.Router();
const installController = require('../controllers/installController');

// Route pour vérifier le statut de l'installation
router.get('/status', installController.checkInstallationStatus.bind(installController));

// Route pour tester la connexion à la base de données
router.post('/test-db', installController.testDatabaseConnection.bind(installController));

// Route pour finaliser l'installation
router.post('/complete', installController.completeInstallation.bind(installController));

module.exports = router;
