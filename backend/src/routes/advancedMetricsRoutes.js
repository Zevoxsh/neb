const express = require('express');
const router = express.Router();
const advancedMetricsController = require('../controllers/advancedMetricsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/metrics/latency-percentiles', authenticateToken, advancedMetricsController.getLatencyPercentiles);
router.get('/api/metrics/status-distribution', authenticateToken, advancedMetricsController.getStatusCodeDistribution);
router.get('/api/metrics/latency-timeseries', authenticateToken, advancedMetricsController.getLatencyTimeseries);

module.exports = router;
