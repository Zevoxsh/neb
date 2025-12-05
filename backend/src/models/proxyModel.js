const pool = require('../config/db');
const dbState = require('../utils/dbState');

async function createProxy(data) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  const res = await pool.query(
    `INSERT INTO proxies (name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, passthrough_tls, enabled, error_page_html)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      data.name,
      data.protocol || 'tcp',
      data.listen_protocol || data.protocol || 'tcp',
      data.target_protocol || data.protocol || 'tcp',
      data.listen_host,
      data.listen_port,
      data.target_host,
      data.target_port,
      data.vhosts ? JSON.stringify(data.vhosts) : null,
      data.passthrough_tls === true,
      data.enabled === true,
      data.error_page_html || null
    ]
  );
  return res.rows[0];
}

async function listProxies() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, passthrough_tls, enabled, created_at, error_page_html FROM proxies ORDER BY id');
    return res.rows;
  } catch (error) {
    console.error('[proxyModel] listProxies failed:', error.message);
    return [];
  }
}

async function listEnabledProxies() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, passthrough_tls, enabled, error_page_html FROM proxies WHERE enabled = true');
    return res.rows;
  } catch (error) {
    console.error('[proxyModel] listEnabledProxies failed:', error.message);
    return [];
  }
}

async function deleteProxy(id) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  await pool.query('DELETE FROM proxies WHERE id = $1', [id]);
}

async function updateProxy(id, data) {
  const res = await pool.query(
    `UPDATE proxies SET name = $1, protocol = $2, listen_protocol = $3, target_protocol = $4,
      listen_host = $5, listen_port = $6, target_host = $7, target_port = $8, vhosts = $9,
      enabled = $10, passthrough_tls = COALESCE($11, passthrough_tls), error_page_html = COALESCE($12, error_page_html)
     WHERE id = $13
     RETURNING id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, passthrough_tls, enabled, error_page_html`,
    [
      data.name,
      data.protocol || 'tcp',
      data.listen_protocol || data.protocol || 'tcp',
      data.target_protocol || data.protocol || 'tcp',
      data.listen_host,
      data.listen_port,
      data.target_host,
      data.target_port,
      data.vhosts ? JSON.stringify(data.vhosts) : null,
      data.enabled === true,
      data.passthrough_tls === true,
      data.error_page_html || null,
      id
    ]
  );
  return res.rows[0];
}

async function getProxyById(id) {
  const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, passthrough_tls, enabled, error_page_html FROM proxies WHERE id = $1', [id]);
  return res.rows[0];
}

async function getErrorPage(id) {
  const res = await pool.query('SELECT error_page_html FROM proxies WHERE id = $1', [id]);
  return res.rows[0] ? res.rows[0].error_page_html : null;
}

async function updateErrorPage(id, html) {
  const res = await pool.query('UPDATE proxies SET error_page_html = $2 WHERE id = $1 RETURNING error_page_html', [id, html || null]);
  return res.rows[0] ? res.rows[0].error_page_html : null;
}

module.exports = {
  createProxy,
  listProxies,
  listEnabledProxies,
  deleteProxy,
  updateProxy,
  getProxyById,
  getErrorPage,
  updateErrorPage
};
