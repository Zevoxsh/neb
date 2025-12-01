const express = require('express');
const router = express.Router();
const requestLogsController = require('../controllers/requestLogsController');
const { authenticate } = require('../middleware/auth');

router.get('/api/request-logs', authenticate, requestLogsController.getRequestLogs);

module.exports = router;
