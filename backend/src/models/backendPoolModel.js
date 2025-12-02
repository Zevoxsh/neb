const pool = require('../config/db');

/**
 * Backend Pool Model - Manages pools of backends for load balancing
 */

async function createBackendPool(data) {
  const res = await pool.query(
    `INSERT INTO backend_pools (
      name, lb_algorithm, health_check_enabled, health_check_interval_ms,
      health_check_path, health_check_timeout_ms, max_failures, failure_timeout_ms, sticky_sessions
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      data.name,
      data.lbAlgorithm || 'round-robin',
      data.healthCheckEnabled !== false,
      data.healthCheckIntervalMs || 30000,
      data.healthCheckPath || '/',
      data.healthCheckTimeoutMs || 2000,
      data.maxFailures || 3,
      data.failureTimeoutMs || 60000,
      data.stickySessions || false
    ]
  );
  return res.rows[0];
}

async function listBackendPools() {
  const res = await pool.query(`
    SELECT
      bp.*,
      COUNT(bpm.id) as backend_count,
      COUNT(CASE WHEN b.health_status = 'healthy' THEN 1 END) as healthy_backends
    FROM backend_pools bp
    LEFT JOIN backend_pool_members bpm ON bp.id = bpm.pool_id AND bpm.enabled = true
    LEFT JOIN backends b ON bpm.backend_id = b.id
    GROUP BY bp.id
    ORDER BY bp.id
  `);
  return res.rows;
}

async function getBackendPool(id) {
  const res = await pool.query('SELECT * FROM backend_pools WHERE id = $1', [id]);
  return res.rows[0];
}

async function getBackendPoolWithMembers(id) {
  const poolRes = await pool.query('SELECT * FROM backend_pools WHERE id = $1', [id]);
  if (!poolRes.rows[0]) return null;

  const membersRes = await pool.query(`
    SELECT
      bpm.id as membership_id,
      bpm.enabled,
      bpm.priority,
      b.id,
      b.name,
      b.target_host,
      b.target_port,
      b.target_protocol,
      b.weight,
      b.health_status,
      b.last_health_check,
      b.consecutive_failures,
      b.active_connections,
      b.total_requests,
      b.avg_response_time_ms
    FROM backend_pool_members bpm
    JOIN backends b ON bpm.backend_id = b.id
    WHERE bpm.pool_id = $1
    ORDER BY bpm.priority DESC, b.id
  `, [id]);

  return {
    ...poolRes.rows[0],
    backends: membersRes.rows
  };
}

async function updateBackendPool(id, data) {
  const res = await pool.query(
    `UPDATE backend_pools SET
      name = $1,
      lb_algorithm = $2,
      health_check_enabled = $3,
      health_check_interval_ms = $4,
      health_check_path = $5,
      health_check_timeout_ms = $6,
      max_failures = $7,
      failure_timeout_ms = $8,
      sticky_sessions = $9
    WHERE id = $10
    RETURNING *`,
    [
      data.name,
      data.lbAlgorithm || 'round-robin',
      data.healthCheckEnabled !== false,
      data.healthCheckIntervalMs || 30000,
      data.healthCheckPath || '/',
      data.healthCheckTimeoutMs || 2000,
      data.maxFailures || 3,
      data.failureTimeoutMs || 60000,
      data.stickySessions || false,
      id
    ]
  );
  return res.rows[0];
}

async function deleteBackendPool(id) {
  await pool.query('DELETE FROM backend_pools WHERE id = $1', [id]);
}

// Backend Pool Members

async function addBackendToPool(poolId, backendId, options = {}) {
  const res = await pool.query(
    `INSERT INTO backend_pool_members (pool_id, backend_id, enabled, priority)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pool_id, backend_id) DO UPDATE
     SET enabled = $3, priority = $4
     RETURNING *`,
    [poolId, backendId, options.enabled !== false, options.priority || 100]
  );
  return res.rows[0];
}

async function removeBackendFromPool(poolId, backendId) {
  await pool.query('DELETE FROM backend_pool_members WHERE pool_id = $1 AND backend_id = $2', [poolId, backendId]);
}

async function updateBackendPoolMember(poolId, backendId, options) {
  const res = await pool.query(
    `UPDATE backend_pool_members
     SET enabled = $3, priority = $4
     WHERE pool_id = $1 AND backend_id = $2
     RETURNING *`,
    [poolId, backendId, options.enabled !== false, options.priority || 100]
  );
  return res.rows[0];
}

async function getPoolMembers(poolId) {
  const res = await pool.query(`
    SELECT
      bpm.id as membership_id,
      bpm.enabled,
      bpm.priority,
      b.*
    FROM backend_pool_members bpm
    JOIN backends b ON bpm.backend_id = b.id
    WHERE bpm.pool_id = $1 AND bpm.enabled = true
    ORDER BY bpm.priority DESC, b.id
  `, [poolId]);
  return res.rows;
}

async function getHealthyPoolMembers(poolId) {
  const res = await pool.query(`
    SELECT
      bpm.id as membership_id,
      bpm.enabled,
      bpm.priority,
      b.*
    FROM backend_pool_members bpm
    JOIN backends b ON bpm.backend_id = b.id
    WHERE bpm.pool_id = $1
      AND bpm.enabled = true
      AND b.health_status = 'healthy'
    ORDER BY bpm.priority DESC, b.active_connections ASC, b.id
  `, [poolId]);
  return res.rows;
}

module.exports = {
  createBackendPool,
  listBackendPools,
  getBackendPool,
  getBackendPoolWithMembers,
  updateBackendPool,
  deleteBackendPool,
  addBackendToPool,
  removeBackendFromPool,
  updateBackendPoolMember,
  getPoolMembers,
  getHealthyPoolMembers
};
