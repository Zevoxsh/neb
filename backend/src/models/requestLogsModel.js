const pool = require('../config/db');

async function getRequestLogs({ limit = 1000, offset = 0, days = 30 } = {}) {
  const query = `
    SELECT 
      client_ip,
      hostname,
      COUNT(*) as request_count,
      MIN(timestamp) as first_seen,
      MAX(timestamp) as last_seen
    FROM request_logs
    WHERE timestamp >= NOW() - INTERVAL '1 day' * $3
    GROUP BY client_ip, hostname
    ORDER BY request_count DESC, last_seen DESC
    LIMIT $1 OFFSET $2
  `;
  
  const result = await pool.query(query, [limit, offset, days]);
  return result.rows;
}

async function getRecentRequestLogs({ limit = 500, minutes = 5 } = {}) {
  const query = `
    SELECT 
      client_ip,
      hostname,
      status_code,
      bytes_sent,
      bytes_received,
      timestamp
    FROM request_logs
    WHERE timestamp >= NOW() - INTERVAL '1 minute' * $2
    ORDER BY timestamp DESC
    LIMIT $1
  `;
  
  const result = await pool.query(query, [limit, minutes]);
  return result.rows;
}

async function getTotalRequestCount(days = 30) {
  const query = `
    SELECT COUNT(*) as total
    FROM (
      SELECT DISTINCT client_ip, hostname
      FROM request_logs
      WHERE timestamp >= NOW() - INTERVAL '1 day' * $1
    ) AS distinct_combinations
  `;
  
  const result = await pool.query(query, [days]);
  return result.rows[0]?.total || 0;
}

module.exports = {
  getRequestLogs,
  getRecentRequestLogs,
  getTotalRequestCount
};

