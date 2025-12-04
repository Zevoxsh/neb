const pool = require('../config/db');
const dbState = require('../utils/dbState');

async function createDomainMapping(data) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  const botProtection = data.botProtection || 'default';
  const hostname = data.hostname ? data.hostname.trim() : data.hostname;
  const maintenanceEnabled = !!data.maintenanceEnabled;
  const maintenancePagePath = data.maintenancePagePath || null;

  const res = await pool.query(
    'INSERT INTO domain_mappings (hostname, proxy_id, backend_id, bot_protection, maintenance_enabled, maintenance_page_path) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, hostname, proxy_id, backend_id, bot_protection, maintenance_enabled, maintenance_page_path',
    [hostname, data.proxyId, data.backendId, botProtection, maintenanceEnabled, maintenancePagePath]
  );
  return res.rows[0];
}

async function listDomainMappings() {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query(`SELECT dm.id, dm.hostname, dm.proxy_id, dm.backend_id, dm.bot_protection, dm.maintenance_enabled, dm.maintenance_page_path, b.target_host, b.target_port, b.target_protocol
      FROM domain_mappings dm JOIN backends b ON dm.backend_id = b.id ORDER BY dm.id`);
    return res.rows.map(r => ({
      id: r.id,
      hostname: r.hostname,
      proxy_id: r.proxy_id,
      backend_id: r.backend_id,
      bot_protection: r.bot_protection || 'default',
      maintenance_enabled: r.maintenance_enabled || false,
      maintenance_page_path: r.maintenance_page_path || null,
      target_host: r.target_host,
      target_port: r.target_port,
      target_protocol: r.target_protocol
    }));
  } catch (error) {
    console.error('[domainModel] listDomainMappings failed:', error.message);
    return [];
  }
}

async function listMappingsForProxy(proxyId) {
  if (!dbState.isConnected()) {
    return [];
  }
  try {
    const res = await pool.query(`SELECT dm.id, dm.hostname, dm.proxy_id, dm.backend_id, b.target_host, b.target_port, b.target_protocol
      FROM domain_mappings dm JOIN backends b ON dm.backend_id = b.id WHERE dm.proxy_id = $1 ORDER BY dm.id`, [proxyId]);
    return res.rows;
  } catch (error) {
    console.error('[domainModel] listMappingsForProxy failed:', error.message);
    return [];
  }
}

async function updateDomainMapping(id, data) {
  const botProtection = data.botProtection || 'default';
  const hostname = data.hostname ? data.hostname.trim() : data.hostname;
  const maintenanceEnabled = !!data.maintenanceEnabled;
  const maintenancePagePath = data.maintenancePagePath || null;

  const res = await pool.query(
    'UPDATE domain_mappings SET hostname = $1, proxy_id = $2, backend_id = $3, bot_protection = $4, maintenance_enabled = $5, maintenance_page_path = $6 WHERE id = $7 RETURNING id, hostname, proxy_id, backend_id, bot_protection, maintenance_enabled, maintenance_page_path',
    [hostname, data.proxyId, data.backendId, botProtection, maintenanceEnabled, maintenancePagePath, id]
  );
  return res.rows[0];
}

async function deleteDomainMapping(id) {
  await pool.query('DELETE FROM domain_mappings WHERE id = $1', [id]);
}

async function domainExists(hostname) {
  if (!hostname) return false;
  const cleanHostname = hostname.trim();
  const res = await pool.query('SELECT 1 FROM domain_mappings WHERE hostname = $1 LIMIT 1', [cleanHostname]);
  return res && res.rowCount > 0;
}

async function setMaintenanceMode(id, enabled, maintenancePagePath = null) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  const res = await pool.query(
    'UPDATE domain_mappings SET maintenance_enabled = $1, maintenance_page_path = $2 WHERE id = $3 RETURNING id, hostname, maintenance_enabled, maintenance_page_path',
    [enabled, maintenancePagePath, id]
  );
  return res.rows[0];
}

async function getMaintenanceStatus(id) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  const res = await pool.query(
    'SELECT id, hostname, maintenance_enabled, maintenance_page_path FROM domain_mappings WHERE id = $1',
    [id]
  );
  return res.rows[0];
}

async function getMaintenanceStatusByHostname(hostname) {
  if (!dbState.isConnected()) {
    return null;
  }
  const cleanHostname = hostname.trim();
  const res = await pool.query(
    'SELECT id, hostname, maintenance_enabled, maintenance_page_path FROM domain_mappings WHERE hostname = $1',
    [cleanHostname]
  );
  return res.rows[0] || null;
}

async function listDomainsInMaintenance() {
  if (!dbState.isConnected()) {
    return [];
  }
  const res = await pool.query(
    'SELECT id, hostname, maintenance_enabled, maintenance_page_path FROM domain_mappings WHERE maintenance_enabled = true ORDER BY hostname'
  );
  return res.rows;
}

module.exports = {
  createDomainMapping,
  listDomainMappings,
  listMappingsForProxy,
  updateDomainMapping,
  deleteDomainMapping,
  domainExists,
  setMaintenanceMode,
  getMaintenanceStatus,
  getMaintenanceStatusByHostname,
  listDomainsInMaintenance
};
