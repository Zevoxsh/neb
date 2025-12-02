const express = require('express');
const router = express.Router();
const { getCountryCode } = require('../controllers/geoipController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/geoip/:ip', authenticateToken, getCountryCode);

module.exports = router;
