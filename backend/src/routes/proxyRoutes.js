const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxyController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/proxies', authenticateToken, proxyController.list);
router.post('/api/proxies', authenticateToken, proxyController.create);
router.put('/api/proxies/:id', authenticateToken, proxyController.update);
router.delete('/api/proxies/:id', authenticateToken, proxyController.remove);
router.get('/api/proxies/:id/error-page', authenticateToken, proxyController.getErrorPage);
router.put('/api/proxies/:id/error-page', authenticateToken, proxyController.updateErrorPage);

module.exports = router;
