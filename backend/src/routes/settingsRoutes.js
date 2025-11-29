const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/settings/local_tlds', authenticateToken, settingsController.getLocalTlds);
router.put('/api/settings/local_tlds', authenticateToken, settingsController.updateLocalTlds);

module.exports = router;
