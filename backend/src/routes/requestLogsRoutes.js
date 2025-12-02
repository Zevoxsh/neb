const express = require('express');
const router = express.Router();
const { getRequestLogs, getRecentRequestLogs } = require('../controllers/requestLogsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/request-logs', authenticateToken, getRequestLogs);
router.get('/api/request-logs/recent', authenticateToken, getRecentRequestLogs);

module.exports = router;

