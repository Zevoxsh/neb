const express = require('express');
const router = express.Router();
const certController = require('../controllers/certController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/certificates', authenticateToken, certController.list);
router.get('/api/certificates/:domain', authenticateToken, certController.get);
router.post('/api/certificates/generate', authenticateToken, certController.generate);
router.post('/api/certificates/manual', authenticateToken, certController.uploadManual);

module.exports = router;
