const monthlyReportModel = require('../models/monthlyReportModel');
const monthlyReportService = require('../services/monthlyReportService');
const { logger } = require('../utils/logger');

/**
 * Get all monthly reports
 */
async function getAllReports(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 12;
    const offset = parseInt(req.query.offset) || 0;

    const reports = await monthlyReportModel.getAllReports({ limit, offset });
    const total = await monthlyReportModel.getTotalReportCount();

    res.json({
      reports,
      total,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
}

/**
 * Get a specific monthly report
 */
async function getReportByMonth(req, res) {
  try {
    const { month } = req.params; // Format: YYYY-MM-01
    const report = await monthlyReportModel.getReportByMonth(month);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    logger.error('Error fetching report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
}

/**
 * Generate a new monthly report (manual trigger)
 */
async function generateReport(req, res) {
  try {
    const { targetMonth } = req.body; // Optional: YYYY-MM-01 format
    
    const report = await monthlyReportService.generateMonthlyReport(targetMonth);

    res.json({
      success: true,
      message: 'Monthly report generated successfully',
      report
    });
  } catch (error) {
    logger.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
}

/**
 * Get the latest monthly report
 */
async function getLatestReport(req, res) {
  try {
    const reports = await monthlyReportModel.getAllReports({ limit: 1, offset: 0 });
    
    if (reports.length === 0) {
      return res.status(404).json({ error: 'No reports found' });
    }

    res.json(reports[0]);
  } catch (error) {
    logger.error('Error fetching latest report:', error);
    res.status(500).json({ error: 'Failed to fetch latest report' });
  }
}

module.exports = {
  getAllReports,
  getReportByMonth,
  generateReport,
  getLatestReport
};
