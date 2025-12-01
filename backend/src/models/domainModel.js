const pool = require('../config/db');

async function createDomainMapping(data) {
  const botProtection = data.botProtection || 'default';
  const res = await pool.query(
    'INSERT INTO domain_mappings (hostname, proxy_id, backend_id, bot_protection) VALUES ($1,$2,$3,$4) RETURNING id, hostname, proxy_id, backend_id, bot_protection',
    [data.hostname, data.proxyId, data.backendId, botProtection]
  );
  return res.rows[0];
}

async function listDomainMappings() {
  const res = await pool.query(`SELECT dm.id, dm.hostname, dm.proxy_id, dm.backend_id, dm.bot_protection, b.target_host, b.target_port, b.target_protocol
    FROM domain_mappings dm JOIN backends b ON dm.backend_id = b.id ORDER BY dm.id`);
  return res.rows.map(r => ({ id: r.id, hostname: r.hostname, proxy_id: r.proxy_id, backend_id: r.backend_id, bot_protection: r.bot_protection || 'default', target_host: r.target_host, target_port: r.target_port, target_protocol: r.target_protocol }));
}

async function listMappingsForProxy(proxyId) {
  const res = await pool.query(`SELECT dm.id, dm.hostname, dm.proxy_id, dm.backend_id, b.target_host, b.target_port, b.target_protocol
    FROM domain_mappings dm JOIN backends b ON dm.backend_id = b.id WHERE dm.proxy_id = $1 ORDER BY dm.id`, [proxyId]);
  return res.rows;
}

async function updateDomainMapping(id, data) {
  const botProtection = data.botProtection || 'default';
  const res = await pool.query(
    'UPDATE domain_mappings SET hostname = $1, proxy_id = $2, backend_id = $3, bot_protection = $4 WHERE id = $5 RETURNING id, hostname, proxy_id, backend_id, bot_protection',
    [data.hostname, data.proxyId, data.backendId, botProtection, id]
  );
  return res.rows[0];
}

async function deleteDomainMapping(id) {
  await pool.query('DELETE FROM domain_mappings WHERE id = $1', [id]);
}

async function domainExists(hostname) {
  if (!hostname) return false;
  const res = await pool.query('SELECT 1 FROM domain_mappings WHERE hostname = $1 LIMIT 1', [hostname]);
  return res && res.rowCount > 0;
}

module.exports = { createDomainMapping, listDomainMappings, listMappingsForProxy, updateDomainMapping, deleteDomainMapping, domainExists };
