const pool = require('../config/db');
const dbState = require('../utils/dbState');

async function listBlockedIps() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT id, ip, reason, created_at FROM blocked_ips ORDER BY created_at DESC');
    return res.rows;
  } catch (error) {
    console.error('[blockedIpModel] listBlockedIps failed:', error.message);
    return [];
  }
}

async function listIpsOnly() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT ip FROM blocked_ips');
    return res.rows.map(r => r.ip);
  } catch (error) {
    console.error('[blockedIpModel] listIpsOnly failed:', error.message);
    return [];
  }
}

async function blockIp(ip, reason) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  if (!ip) throw new Error('IP required');
  const res = await pool.query(
    `INSERT INTO blocked_ips (ip, reason)
     VALUES ($1, $2)
     ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id, ip, reason, created_at`,
    [ip.trim(), reason || null]
  );
  return res.rows[0];
}

async function unblockIp(id) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  await pool.query('DELETE FROM blocked_ips WHERE id = $1 OR ip = $2', [parseInt(id, 10) || 0, id]);
}

module.exports = { listBlockedIps, listIpsOnly, blockIp, unblockIp };
