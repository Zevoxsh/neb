const pool = require('../config/db');

async function getRecentAlerts({ limit = 50, offset = 0 } = {}) {
  const query = `
    SELECT 
      id,
      alert_type,
      severity,
      ip_address,
      hostname,
      message,
      details,
      created_at
    FROM security_alerts
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;
  
  const result = await pool.query(query, [limit, offset]);
  return result.rows;
}

async function getTotalAlerts() {
  const result = await pool.query('SELECT COUNT(*) as total FROM security_alerts');
  return result.rows[0]?.total || 0;
}

async function createAlert({ type, severity, ipAddress, hostname, message, details }) {
  const query = `
    INSERT INTO security_alerts (alert_type, severity, ip_address, hostname, message, details)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  
  const result = await pool.query(query, [
    type,
    severity,
    ipAddress,
    hostname,
    message,
    JSON.stringify(details)
  ]);
  
  return result.rows[0];
}

async function deleteOldAlerts(daysToKeep = 30) {
  const query = `
    DELETE FROM security_alerts 
    WHERE created_at < NOW() - INTERVAL '1 day' * $1
  `;
  
  const result = await pool.query(query, [daysToKeep]);
  return result.rowCount;
}

module.exports = {
  getRecentAlerts,
  getTotalAlerts,
  createAlert,
  deleteOldAlerts
};
