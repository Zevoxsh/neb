const pool = require('../config/db');
const dbState = require('../utils/dbState');

async function listTrustedIps() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT id, ip, label, created_at FROM trusted_ips ORDER BY created_at DESC');
    return res.rows;
  } catch (error) {
    console.error('[trustedIpModel] listTrustedIps failed:', error.message);
    return [];
  }
}

async function listIpsOnly() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT ip FROM trusted_ips');
    return res.rows.map(r => r.ip);
  } catch (error) {
    console.error('[trustedIpModel] listIpsOnly failed:', error.message);
    return [];
  }
}

async function addTrustedIp(ip, label) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  if (!ip) throw new Error('IP required');
  const res = await pool.query(
    `INSERT INTO trusted_ips (ip, label)
     VALUES ($1, $2)
     ON CONFLICT (ip) DO UPDATE SET label = EXCLUDED.label
     RETURNING id, ip, label, created_at`,
    [ip.trim(), label || null]
  );
  return res.rows[0];
}

async function removeTrustedIp(id) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  await pool.query('DELETE FROM trusted_ips WHERE id = $1 OR ip = $2', [parseInt(id, 10) || 0, id]);
}

module.exports = { listTrustedIps, listIpsOnly, addTrustedIp, removeTrustedIp };
