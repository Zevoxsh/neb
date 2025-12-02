const requestLogsModel = require('../models/requestLogsModel');

async function getRequestLogs(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const days = parseInt(req.query.days) || 30;

    const [logs, total] = await Promise.all([
      requestLogsModel.getRequestLogs({ limit, offset, days }),
      requestLogsModel.getTotalRequestCount(days)
    ]);

    res.json({
      logs,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching request logs:', error);
    res.status(500).json({ error: 'Failed to fetch request logs' });
  }
}

async function getRecentRequestLogs(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const minutes = parseInt(req.query.minutes) || 5;

    const logs = await requestLogsModel.getRecentRequestLogs({ limit, minutes });

    res.json({
      logs,
      total: logs.length,
      limit,
      minutes
    });
  } catch (error) {
    console.error('Error fetching recent request logs:', error);
    res.status(500).json({ error: 'Failed to fetch recent request logs' });
  }
}

module.exports = {
  getRequestLogs,
  getRecentRequestLogs
};

