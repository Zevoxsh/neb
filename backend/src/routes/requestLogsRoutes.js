const express = require('express');
const router = express.Router();
const { getRequestLogs, getRecentRequestLogs, dismissRequestLogs } = require('../controllers/requestLogsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/request-logs', authenticateToken, getRequestLogs);
router.get('/api/request-logs/recent', authenticateToken, getRecentRequestLogs);
router.post('/api/request-logs/dismiss', authenticateToken, dismissRequestLogs);

module.exports = router;

