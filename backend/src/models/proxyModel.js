const pool = require('../config/db');

async function createProxy(data) {
  const res = await pool.query(
    `INSERT INTO proxies (name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, enabled, error_page_html)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
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
      data.error_page_html || null
    ]
  );
  return res.rows[0];
}

async function listProxies() {
  const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, enabled, created_at, error_page_html FROM proxies ORDER BY id');
  return res.rows;
}

async function listEnabledProxies() {
  const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, enabled, error_page_html FROM proxies WHERE enabled = true');
  return res.rows;
}

async function deleteProxy(id) {
  await pool.query('DELETE FROM proxies WHERE id = $1', [id]);
}

async function updateProxy(id, data) {
  const res = await pool.query(
    `UPDATE proxies SET name = $1, protocol = $2, listen_protocol = $3, target_protocol = $4,
      listen_host = $5, listen_port = $6, target_host = $7, target_port = $8, vhosts = $9,
      enabled = $10, error_page_html = COALESCE($11, error_page_html)
     WHERE id = $12
     RETURNING id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, enabled, error_page_html`,
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
      data.error_page_html || null,
      id
    ]
  );
  return res.rows[0];
}

async function getProxyById(id) {
  const res = await pool.query('SELECT id, name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, vhosts, enabled, error_page_html FROM proxies WHERE id = $1', [id]);
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
