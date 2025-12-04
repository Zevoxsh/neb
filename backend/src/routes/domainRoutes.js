const express = require('express');
const router = express.Router();
const domainController = require('../controllers/domainController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/domains', authenticateToken, domainController.list);
router.post('/api/domains', authenticateToken, domainController.create);
router.put('/api/domains/:id', authenticateToken, domainController.update);
router.delete('/api/domains/:id', authenticateToken, domainController.remove);
router.get('/api/proxies/:id/mappings', authenticateToken, domainController.listForProxy);

// Screenshot routes
router.get('/api/domains/:id/screenshot', authenticateToken, domainController.getScreenshot);
router.post('/api/domains/:id/screenshot/refresh', authenticateToken, domainController.refreshScreenshot);

module.exports = router;
