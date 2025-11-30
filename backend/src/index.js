require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  // Keep running if possible, but log it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

if (process.env.PG_PASSWORD !== undefined && typeof process.env.PG_PASSWORD !== 'string') {
  process.env.PG_PASSWORD = String(process.env.PG_PASSWORD);
}
if (process.env.DATABASE_URL !== undefined && typeof process.env.DATABASE_URL !== 'string') {
  process.env.DATABASE_URL = String(process.env.DATABASE_URL);
}
const createApp = require('./app');
const pool = require('./config/db');
const bcrypt = require('bcrypt');
const proxyModel = require('./models/proxyModel');
const proxyManager = require('./services/proxyManager');
const alertService = require('./services/alertService');
const acmeManager = require('./services/acmeManager');
const settingsModel = require('./models/settingsModel');
const blockedIpModel = require('./models/blockedIpModel');
const trustedIpModel = require('./models/trustedIpModel');
const { normalizeSecurityConfig, DEFAULT_SECURITY_CONFIG } = require('./utils/securityConfig');

const app = createApp();
const PORT = process.env.PORT || 3000;

async function initDbAndStart() {
  try {
    // create tables if not exists
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS proxies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
      listen_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
      target_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp',
      listen_host VARCHAR(100) NOT NULL,
      listen_port INT NOT NULL,
      target_host VARCHAR(255) NOT NULL,
      target_port INT NOT NULL,
      vhosts JSONB,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS backends (
      id SERIAL PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      target_host VARCHAR(255) NOT NULL,
      target_port INT NOT NULL,
      target_protocol VARCHAR(10) NOT NULL DEFAULT 'http',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS domain_mappings (
      id SERIAL PRIMARY KEY,
      hostname VARCHAR(255) NOT NULL UNIQUE,
      proxy_id INT NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
      backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      proxy_id INT REFERENCES proxies(id) ON DELETE CASCADE,
      ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      bytes_in BIGINT DEFAULT 0,
      bytes_out BIGINT DEFAULT 0,
      requests INT DEFAULT 0
    );`);

    // Settings table for key/value config (e.g., local_tlds)
    await pool.query(`CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(191) PRIMARY KEY,
      value TEXT
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS blocked_ips (
      id SERIAL PRIMARY KEY,
      ip VARCHAR(191) NOT NULL UNIQUE,
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS trusted_ips (
      id SERIAL PRIMARY KEY,
      ip VARCHAR(191) NOT NULL UNIQUE,
      label TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );`);

    // Ensure existing tables have the protocol/listen/target protocol columns (safe to run every start)
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS listen_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS target_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS vhosts JSONB;");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS error_page_html TEXT;");

    const adminUser = process.env.DEFAULT_ADMIN_USER || 'admin';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const res = await pool.query('SELECT id FROM users WHERE username = $1', [adminUser]);
    if (!res.rows || res.rows.length === 0) {
      const hashed = await bcrypt.hash(adminPass, 10);
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [adminUser, hashed]);
      console.log('Created default admin user:', adminUser);
    }

    // Check for ACME/Redirect proxy (Port 80 HTTP -> HTTPS)
    const acmeProxyRes = await pool.query('SELECT id FROM proxies WHERE listen_port = 80');
    if (acmeProxyRes.rows.length === 0) {
      console.log('Creating default ACME & Redirect proxy on port 80...');
      await pool.query(`
        INSERT INTO proxies (name, listen_host, listen_port, listen_protocol, target_host, target_port, target_protocol, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['ACME & Redirect', '0.0.0.0', 80, 'http', '127.0.0.1', 443, 'https', true]);
    }

    // start enabled proxies
    const pRes = await proxyModel.listEnabledProxies();
    // load domain mappings (if any) and build per-proxy vhost maps
    const domainModel = require('./models/domainModel');
    const mappings = await domainModel.listDomainMappings();
    const vhostsByProxy = {};
    for (const m of mappings) {
      if (!vhostsByProxy[m.proxy_id]) vhostsByProxy[m.proxy_id] = {};
      vhostsByProxy[m.proxy_id][m.hostname] = {
        targetHost: m.target_host,
        targetPort: m.target_port,
        targetProtocol: m.target_protocol,
      };
    }

    for (const p of pRes) {
      try {
        // merge existing vhosts JSON from proxies table with domain_mappings
        let merged = null;
        if (p.vhosts) {
          try { merged = typeof p.vhosts === 'string' ? JSON.parse(p.vhosts) : p.vhosts; } catch (e) { merged = p.vhosts; }
        }
        const mapped = vhostsByProxy[p.id] || null;
        const finalVhosts = Object.assign({}, merged || {}, mapped || {});
        proxyManager.startProxy(
          p.id,
          p.listen_protocol || p.protocol || 'tcp',
          p.listen_host,
          p.listen_port,
          p.target_protocol || p.protocol || 'tcp',
          p.target_host,
          p.target_port,
          Object.keys(finalVhosts).length ? finalVhosts : null,
          p.error_page_html || null
        );
      } catch (e) { console.error('Start proxy failed', e.message); }
    }

    try {
      const blocked = await blockedIpModel.listIpsOnly();
      proxyManager.setBlockedIps(blocked);
      console.log('Loaded blocked IPs:', blocked.length);
    } catch (e) {
      console.error('Failed to load blocked IPs', e);
    }

    try {
      const trusted = await trustedIpModel.listIpsOnly();
      proxyManager.setTrustedIps(trusted);
      console.log('Loaded trusted IPs:', trusted.length);
    } catch (e) {
      console.error('Failed to load trusted IPs', e);
    }

    try {
      const rawConfig = await settingsModel.getSetting('security_config');
      const securityConfig = normalizeSecurityConfig(rawConfig || DEFAULT_SECURITY_CONFIG);
      proxyManager.updateSecurityConfig(securityConfig);
      alertService.configure(securityConfig.smtp);
      console.log('Loaded security config');
    } catch (e) {
      console.error('Failed to load security config', e);
    }

    // Load settings from DB (e.g., local_tlds) and apply to acmeManager
    try {
      const raw = await settingsModel.getSetting('local_tlds');
      if (raw) {
        const list = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length) {
          acmeManager.setLocalTlds(list);
          console.log('Loaded LOCAL_TLDS from DB:', list.join(','));
        }
      }
    } catch (e) { console.error('Failed to load settings', e); }

    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('Initialization failed', err);
    process.exit(1);
  }
}

initDbAndStart();
