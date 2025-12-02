const express = require('express');
const router = express.Router();
const monthlyReportController = require('../controllers/monthlyReportController');

// Get all monthly reports (paginated)
router.get('/', monthlyReportController.getAllReports);

// Get latest report
router.get('/latest', monthlyReportController.getLatestReport);

// Get specific report by month
router.get('/:month', monthlyReportController.getReportByMonth);

// Generate new report (manual trigger)
router.post('/generate', monthlyReportController.generateReport);

module.exports = router;
