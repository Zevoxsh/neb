const express = require('express');
const router = express.Router();
const { getRequestLogs } = require('../controllers/requestLogsController');
const { authenticate } = require('../middleware/auth');

router.get('/api/request-logs', authenticate, getRequestLogs);

module.exports = router;
