const express = require('express');
const router = express.Router();
const { getAlerts } = require('../controllers/alertController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/security-alerts', authenticateToken, getAlerts);

module.exports = router;
