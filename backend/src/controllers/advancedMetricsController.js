/**
 * Advanced Metrics Controller
 * Provides latency percentiles and error analytics
 */

const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AdvancedMetrics');

// Get latency percentiles (p50, p95, p99)
const getLatencyPercentiles = asyncHandler(async (req, res) => {
    const { proxyId, hours = 24 } = req.query;

    const since = new Date(Date.now() - hours * 3600 * 1000);

    const sql = `
    SELECT 
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99,
      AVG(latency_ms) AS avg,
      MIN(latency_ms) AS min,
      MAX(latency_ms) AS max
    FROM metrics
    WHERE ts >= $1
      AND latency_ms > 0
      ${proxyId ? 'AND proxy_id = $2' : ''}
  `;

    const params = proxyId ? [since, proxyId] : [since];
    const result = await pool.query(sql, params);

    res.json({
        percentiles: result.rows[0] || { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
    });
});

// Get HTTP status code distribution
const getStatusCodeDistribution = asyncHandler(async (req, res) => {
    const { hours = 24 } = req.query;

    const since = new Date(Date.now() - hours * 3600 * 1000);

    const sql = `
    SELECT 
      CASE 
        WHEN status_code BETWEEN 200 AND 299 THEN '2xx'
        WHEN status_code BETWEEN 300 AND 399 THEN '3xx'
        WHEN status_code BETWEEN 400 AND 499 THEN '4xx'
        WHEN status_code BETWEEN 500 AND 599 THEN '5xx'
        ELSE 'other'
      END AS category,
      COUNT(*)::int AS count
    FROM metrics
    WHERE ts >= $1 AND requests > 0
    GROUP BY category
    ORDER BY category
  `;

    const result = await pool.query(sql, [since]);

    res.json({
        distribution: result.rows
    });
});

// Get latency over time (for charts)
const getLatencyTimeseries = asyncHandler(async (req, res) => {
    const { hours = 24, interval = 300 } = req.query; // 5 min intervals

    const since = new Date(Date.now() - hours * 3600 * 1000);

    const sql = `
    SELECT 
      to_timestamp(floor(extract(epoch from ts)/$2)*$2) AS bucket,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99
    FROM metrics
    WHERE ts >= $1 AND latency_ms > 0
    GROUP BY bucket
    ORDER BY bucket
  `;

    const result = await pool.query(sql, [since, interval]);

    res.json({
        timeseries: result.rows
    });
});

module.exports = {
    getLatencyPercentiles,
    getStatusCodeDistribution,
    getLatencyTimeseries
};
