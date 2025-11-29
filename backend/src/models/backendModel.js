const pool = require('../config/db');

async function createBackend(data) {
  const res = await pool.query(
    'INSERT INTO backends (name, target_host, target_port, target_protocol) VALUES ($1,$2,$3,$4) RETURNING id, name, target_host, target_port, target_protocol',
    [data.name, data.targetHost, data.targetPort, data.targetProtocol || 'http']
  );
  return res.rows[0];
}

async function listBackends() {
  const res = await pool.query('SELECT id, name, target_host, target_port, target_protocol, created_at FROM backends ORDER BY id');
  return res.rows;
}

async function getBackend(id) {
  const res = await pool.query('SELECT id, name, target_host, target_port, target_protocol FROM backends WHERE id = $1', [id]);
  return res.rows[0];
}

async function deleteBackend(id) {
  await pool.query('DELETE FROM backends WHERE id = $1', [id]);
}

async function updateBackend(id, data) {
  const res = await pool.query(
    'UPDATE backends SET name = $1, target_host = $2, target_port = $3, target_protocol = $4 WHERE id = $5 RETURNING id, name, target_host, target_port, target_protocol',
    [data.name, data.targetHost, data.targetPort, data.targetProtocol || 'http', id]
  );
  return res.rows[0];
}

module.exports = { createBackend, listBackends, getBackend, deleteBackend };

async function findBackendByHostPort(host, port) {
  const res = await pool.query('SELECT id, name, target_host, target_port, target_protocol FROM backends WHERE target_host = $1 AND target_port = $2 LIMIT 1', [host, port]);
  return res.rows[0];
}

module.exports = { createBackend, listBackends, getBackend, deleteBackend, findBackendByHostPort, updateBackend };
