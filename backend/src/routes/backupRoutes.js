const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backupController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/backup/export', authenticateToken, backupController.exportConfig);
router.post('/api/backup/import', authenticateToken, backupController.importConfig);

module.exports = router;
