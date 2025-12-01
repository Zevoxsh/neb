const express = require('express');
const router = express.Router();
const { getRequestLogs } = require('../controllers/requestLogsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/request-logs', authenticateToken, getRequestLogs);

module.exports = router;
