const express = require('express');
const router = express.Router();
const securityController = require('../controllers/securityController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/security/blocked-ips', authenticateToken, securityController.listBlocked);
router.post('/api/security/blocked-ips', authenticateToken, securityController.createBlocked);
router.delete('/api/security/blocked-ips/:id', authenticateToken, securityController.removeBlocked);

router.get('/api/security/trusted-ips', authenticateToken, securityController.listTrusted);
router.post('/api/security/trusted-ips', authenticateToken, securityController.createTrusted);
router.delete('/api/security/trusted-ips/:id', authenticateToken, securityController.removeTrusted);

router.get('/api/security/config', authenticateToken, securityController.getSecurityConfig);
router.put('/api/security/config', authenticateToken, securityController.updateSecurityConfig);

module.exports = router;
