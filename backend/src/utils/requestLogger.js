const pool = require('../config/db');

async function logRequest(clientIp, hostname) {
  try {
    // Async insert without waiting (fire and forget for performance)
    pool.query(
      'INSERT INTO request_logs (client_ip, hostname, timestamp) VALUES ($1, $2, NOW())',
      [clientIp, hostname]
    ).catch(err => {
      // Silently fail to avoid breaking proxy functionality
      console.error('[RequestLogger] Failed to log request:', err.message);
    });
  } catch (err) {
    // Ignore errors
  }
}

module.exports = {
  logRequest
};
