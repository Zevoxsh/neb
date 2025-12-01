const alertModel = require('../models/alertModel');

async function getAlerts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const [alerts, total] = await Promise.all([
      alertModel.getRecentAlerts({ limit, offset }),
      alertModel.getTotalAlerts()
    ]);

    res.json({
      alerts,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
}

module.exports = {
  getAlerts
};
