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
    WHERE timestamp >= NOW() - INTERVAL '${days} days'
    GROUP BY client_ip, hostname
    ORDER BY request_count DESC, last_seen DESC
    LIMIT $1 OFFSET $2
  `;
  
  const result = await pool.query(query, [limit, offset]);
  return result.rows;
}

async function getTotalRequestCount(days = 30) {
  const query = `
    SELECT COUNT(DISTINCT (client_ip, hostname)) as total
    FROM request_logs
    WHERE timestamp >= NOW() - INTERVAL '${days} days'
  `;
  
  const result = await pool.query(query);
  return result.rows[0]?.total || 0;
}

module.exports = {
  getRequestLogs,
  getTotalRequestCount
};
