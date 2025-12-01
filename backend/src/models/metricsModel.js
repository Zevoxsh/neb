const pool = require('../config/db');

async function insertSample(proxyId, ts, bytesIn, bytesOut, requests, latencyMs, statusCode) {
  await pool.query(
    'INSERT INTO metrics (proxy_id, ts, bytes_in, bytes_out, requests, latency_ms, status_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [proxyId || null, ts || new Date(), bytesIn || 0, bytesOut || 0, requests || 0, latencyMs || 0, statusCode || 0]
  );
}

// Query aggregated samples grouped by interval seconds
async function queryAggregated(proxyId, fromTs, toTs, intervalSec) {
  const sql = `
    SELECT to_timestamp(floor(extract(epoch from ts)/$4)*$4) AS bucket,
           sum(bytes_in)::bigint AS bytes_in,
           sum(bytes_out)::bigint AS bytes_out,
           sum(requests)::bigint AS requests,
           avg(latency_ms)::int AS avg_latency,
           max(latency_ms)::int AS max_latency
    FROM metrics
    WHERE ($1::int IS NULL OR proxy_id = $1)
      AND ts >= $2
      AND ts <= $3
    GROUP BY bucket
    ORDER BY bucket;
  `;
  const res = await pool.query(sql, [proxyId || null, fromTs, toTs, intervalSec]);
  return res.rows;
}

// Aggregated rows grouped by proxy_id and bucket. Returns rows with proxy_id included.
async function queryAggregatedPerProxy(fromTs, toTs, intervalSec) {
  const sql = `
    SELECT proxy_id,
           to_timestamp(floor(extract(epoch from ts)/$3)*$3) AS bucket,
           sum(bytes_in)::bigint AS bytes_in,
           sum(bytes_out)::bigint AS bytes_out,
           sum(requests)::bigint AS requests
    FROM metrics
    WHERE ts >= $1
      AND ts <= $2
    GROUP BY proxy_id, bucket
    ORDER BY proxy_id, bucket;
  `;
  const res = await pool.query(sql, [fromTs, toTs, intervalSec]);
  return res.rows;
}

async function queryAggregatedPerDomain(fromTs, toTs, intervalSec) {
  const sql = `
    SELECT dm.id AS domain_id,
           dm.hostname,
           dm.proxy_id,
           to_timestamp(floor(extract(epoch from m.ts)/$3)*$3) AS bucket,
           sum(m.bytes_in)::bigint AS bytes_in,
           sum(m.bytes_out)::bigint AS bytes_out,
           sum(m.requests)::bigint AS requests
    FROM domain_mappings dm
    JOIN metrics m ON m.proxy_id = dm.proxy_id
    WHERE m.ts >= $1
      AND m.ts <= $2
    GROUP BY dm.id, dm.hostname, dm.proxy_id, bucket
    ORDER BY dm.id, bucket;
  `;
  const res = await pool.query(sql, [fromTs, toTs, intervalSec]);
  return res.rows;
}

// Insert multiple samples in a single batch insert. samples: [{ proxy_id, ts, bytes_in, bytes_out, requests, latency_ms, status_code }, ...]
async function insertSamplesBatch(samples) {
  if (!samples || !samples.length) return;
  const values = [];
  const params = [];
  let idx = 1;
  for (const s of samples) {
    params.push(
      s.proxy_id || null,
      s.ts || new Date(),
      s.bytes_in || 0,
      s.bytes_out || 0,
      s.requests || 0,
      s.latency_ms || 0,
      s.status_code || 0
    );
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
  }
  const sql = `INSERT INTO metrics (proxy_id, ts, bytes_in, bytes_out, requests, latency_ms, status_code) VALUES ${values.join(',')}`;
  await pool.query(sql, params);
}

async function queryStatusCodeStats(fromTs, toTs) {
  const sql = `
    SELECT status_code, count(*)::int as count
    FROM metrics
    WHERE ts >= $1 AND ts <= $2 AND status_code > 0
    GROUP BY status_code
    ORDER BY count DESC;
  `;
  const res = await pool.query(sql, [fromTs, toTs]);
  return res.rows;
}

async function queryLatencyPercentiles(fromTs, toTs) {
  const sql = `
    SELECT 
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99
    FROM metrics
    WHERE ts >= $1 AND ts <= $2 AND latency_ms > 0;
  `;
  const res = await pool.query(sql, [fromTs, toTs]);
  return res.rows[0];
}

module.exports = {
  insertSample,
  queryAggregated,
  queryAggregatedPerProxy,
  queryAggregatedPerDomain,
  insertSamplesBatch,
  queryStatusCodeStats,
  queryLatencyPercentiles
};
