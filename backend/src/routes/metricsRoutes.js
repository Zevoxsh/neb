const express = require('express');
const router = express.Router();
const metricsController = require('../controllers/metricsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/metrics', authenticateToken, metricsController.aggregated);
router.get('/api/metrics/all', authenticateToken, metricsController.allAggregated);
router.get('/api/metrics/combined', authenticateToken, metricsController.combined);
router.get('/api/metrics/stream', authenticateToken, metricsController.streamMetrics);

module.exports = router;
