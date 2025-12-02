const pool = require('../config/db');

async function createBackend(data) {
  console.log('backendModel.createBackend called with', data);
  const res = await pool.query(
    'INSERT INTO backends (name, target_host, target_port, target_protocol) VALUES ($1,$2,$3,$4) RETURNING id, name, target_host, target_port, target_protocol',
    [data.name, data.targetHost, data.targetPort, data.targetProtocol || 'http']
  );
  console.log('backendModel.createBackend result rows:', res.rows);
  return res.rows[0];
}

async function listBackends() {
  try {
    // Try with new columns (after migration)
    const res = await pool.query(`
      SELECT
        id, name, target_host, target_port, target_protocol, created_at,
        weight, health_status, last_health_check, consecutive_failures,
        active_connections, total_requests, avg_response_time_ms
      FROM backends ORDER BY id
    `);
    return res.rows;
  } catch (error) {
    // Fallback to old schema if new columns don't exist yet
    if (error.code === '42703') {
      console.warn('[backendModel] Using legacy schema (migration pending)');
      const res = await pool.query(`
        SELECT id, name, target_host, target_port, target_protocol, created_at
        FROM backends ORDER BY id
      `);
      return res.rows;
    }
    throw error;
  }
}

async function getBackend(id) {
  try {
    // Try with new columns (after migration)
    const res = await pool.query(`
      SELECT
        id, name, target_host, target_port, target_protocol,
        weight, health_status, last_health_check, consecutive_failures,
        active_connections, total_requests, avg_response_time_ms
      FROM backends WHERE id = $1
    `, [id]);
    return res.rows[0];
  } catch (error) {
    // Fallback to old schema if new columns don't exist yet
    if (error.code === '42703') {
      const res = await pool.query(`
        SELECT id, name, target_host, target_port, target_protocol
        FROM backends WHERE id = $1
      `, [id]);
      return res.rows[0];
    }
    throw error;
  }
}

async function deleteBackend(id) {
  await pool.query('DELETE FROM backends WHERE id = $1', [id]);
}

async function updateBackend(id, data) {
  try {
    const res = await pool.query(
      `UPDATE backends SET
        name = $1,
        target_host = $2,
        target_port = $3,
        target_protocol = $4,
        weight = COALESCE($5, weight)
       WHERE id = $6
       RETURNING id, name, target_host, target_port, target_protocol, weight, health_status`,
      [data.name, data.targetHost, data.targetPort, data.targetProtocol || 'http', data.weight, id]
    );
    return res.rows[0];
  } catch (error) {
    // Fallback if weight column doesn't exist yet
    if (error.code === '42703') {
      const res = await pool.query(
        `UPDATE backends SET
          name = $1,
          target_host = $2,
          target_port = $3,
          target_protocol = $4
         WHERE id = $5
         RETURNING id, name, target_host, target_port, target_protocol`,
        [data.name, data.targetHost, data.targetPort, data.targetProtocol || 'http', id]
      );
      return res.rows[0];
    }
    throw error;
  }
}

async function findBackendByHostPort(host, port) {
  const res = await pool.query('SELECT id, name, target_host, target_port, target_protocol FROM backends WHERE target_host = $1 AND target_port = $2 LIMIT 1', [host, port]);
  return res.rows[0];
}

// Health management functions
async function updateBackendHealth(id, healthStatus, consecutiveFailures = 0) {
  try {
    await pool.query(
      `UPDATE backends SET
        health_status = $2,
        last_health_check = now(),
        consecutive_failures = $3
       WHERE id = $1`,
      [id, healthStatus, consecutiveFailures]
    );
  } catch (error) {
    // Silently ignore if columns don't exist yet (migration pending)
    if (error.code !== '42703') {
      throw error;
    }
  }
}

async function incrementBackendConnections(id) {
  try {
    await pool.query('UPDATE backends SET active_connections = active_connections + 1 WHERE id = $1', [id]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

async function decrementBackendConnections(id) {
  try {
    await pool.query('UPDATE backends SET active_connections = GREATEST(active_connections - 1, 0) WHERE id = $1', [id]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

async function updateBackendStats(id, requestCount, avgResponseTimeMs) {
  try {
    await pool.query(
      `UPDATE backends SET
        total_requests = total_requests + $2,
        avg_response_time_ms = $3
       WHERE id = $1`,
      [id, requestCount, avgResponseTimeMs]
    );
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

module.exports = {
  createBackend,
  listBackends,
  getBackend,
  deleteBackend,
  findBackendByHostPort,
  updateBackend,
  updateBackendHealth,
  incrementBackendConnections,
  decrementBackendConnections,
  updateBackendStats
};
