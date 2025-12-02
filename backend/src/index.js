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

const http = require('http');
const path = require('path');
const fs = require('fs');

// Check if installation is needed BEFORE loading other modules
function checkInstallation() {
  const envPath = path.join(__dirname, '../../.env');
  
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const hasDbConfig = envContent.includes('DB_HOST') && 
                       envContent.includes('DB_NAME') &&
                       envContent.includes('JWT_SECRET');
    return hasDbConfig;
  } catch (error) {
    return false;
  }
}

// Set temporary JWT_SECRET if not installed
const isInstalled = checkInstallation();
if (!isInstalled) {
  console.log('🔧 Installation mode detected...');
  process.env.JWT_SECRET = 'temporary_installation_secret_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  process.env.INSTALLATION_MODE = 'true'; // Disable services that require DB
  process.env.BOT_PROTECTION_ENABLED = 'false'; // Disable bot protection in installation mode
  process.env.DDOS_PROTECTION_ENABLED = 'false'; // Disable DDoS protection in installation mode
}

// Start installation server (minimal setup without auth)
async function startInstallationServer() {
  console.log('🔧 Installation required - starting installation server...');
  console.log('');
  
  const createApp = require('./app');
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  
  // Redirect all requests to install page except install routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/install') || 
        req.path === '/install.html' || 
        req.path === '/install' ||
        req.path.startsWith('/public/')) {
      return next();
    }
    res.redirect('/install.html');
  });
  
  const server = http.createServer(app);
  
  server.listen(PORT, () => {
    console.log(`✅ Installation server started on http://localhost:${PORT}`);
    console.log(`📝 Ouvrez http://localhost:${PORT}/install pour configurer votre installation`);
    console.log('');
  });
  
  return server;
}

const PORT = process.env.PORT || 3000;

async function initDbAndStart() {
  // Check if installation is needed FIRST (already done at module load)
  if (!isInstalled) {
    await startInstallationServer();
    return;
  }
  
  // Only load these modules after we know installation is complete
  const bcrypt = require('bcrypt');
  const proxyModel = require('./models/proxyModel');
  const proxyManager = require('./services/proxyManager');
  const alertService = require('./services/alertService');
  const acmeManager = require('./services/acmeManager');
  const settingsModel = require('./models/settingsModel');
  const blockedIpModel = require('./models/blockedIpModel');
  const trustedIpModel = require('./models/trustedIpModel');
  const { normalizeSecurityConfig, DEFAULT_SECURITY_CONFIG } = require('./utils/securityConfig');
  const { connectRedis } = require('./config/redis');
  const dbState = require('./utils/dbState');
  
  // Continue with normal startup
  const pool = require('./config/db');
  const createApp = require('./app');
  const app = createApp();
  
  let dbConnected = false;
  
  try {
    // Test database connection first
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    dbConnected = true;
    dbState.setConnected(true);
    console.log('✓ Database connection successful');
  } catch (dbError) {
    dbState.setConnected(false);
    console.error('❌ Database connection failed:', dbError.message);
    console.log('🔧 Starting in CONFIGURATION MODE - Database unreachable');
    console.log('📝 You can access the admin panel to fix the database configuration');
  }
  
  if (dbConnected) {
    // Normal startup with database
    try {
    // create tables if not exists
    await pool.query(`CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);

    await pool.query(`CREATE TABLE IF NOT EXISTS proxies(
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
    ); `);

    await pool.query(`CREATE TABLE IF NOT EXISTS backends(
      id SERIAL PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      target_host VARCHAR(255) NOT NULL,
      target_port INT NOT NULL,
      target_protocol VARCHAR(10) NOT NULL DEFAULT 'http',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);

    await pool.query(`CREATE TABLE IF NOT EXISTS domain_mappings(
      id SERIAL PRIMARY KEY,
      hostname VARCHAR(255) NOT NULL UNIQUE,
      proxy_id INT NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
      backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);

    await pool.query(`CREATE TABLE IF NOT EXISTS metrics(
      id SERIAL PRIMARY KEY,
      proxy_id INT REFERENCES proxies(id) ON DELETE CASCADE,
      ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      bytes_in BIGINT DEFAULT 0,
      bytes_out BIGINT DEFAULT 0,
      requests INT DEFAULT 0,
      latency_ms INT DEFAULT 0,
      status_code INT DEFAULT 0
    ); `);

    // Ensure columns exist for existing installations
    try {
      await pool.query(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS latency_ms INT DEFAULT 0`);
      await pool.query(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS status_code INT DEFAULT 0`);
      await pool.query(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS hostname VARCHAR(255)`);
    } catch (e) {
      console.warn('Migration: failed to add metrics columns', e.message);
    }

    // Performance indexes for metrics queries
    try {
      console.log('Creating performance indexes...');
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_proxy_ts ON metrics(proxy_id, ts DESC);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_hostname_ts ON metrics(hostname, ts DESC) WHERE hostname IS NOT NULL;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts DESC);`);
      console.log('Performance indexes created');
    } catch (e) {
      console.warn('Failed to create performance indexes', e.message);
    }

    // Settings table for key/value config (e.g., local_tlds)
    await pool.query(`CREATE TABLE IF NOT EXISTS settings(
      key VARCHAR(191) PRIMARY KEY,
      value TEXT
    ); `);
    await pool.query(`CREATE TABLE IF NOT EXISTS blocked_ips(
      id SERIAL PRIMARY KEY,
      ip VARCHAR(191) NOT NULL UNIQUE,
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);
    await pool.query(`CREATE TABLE IF NOT EXISTS trusted_ips(
      id SERIAL PRIMARY KEY,
      ip VARCHAR(191) NOT NULL UNIQUE,
      label TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);

    // Ensure existing tables have the protocol/listen/target protocol columns (safe to run every start)
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS listen_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS target_protocol VARCHAR(10) NOT NULL DEFAULT 'tcp';");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS vhosts JSONB;");
    await pool.query("ALTER TABLE proxies ADD COLUMN IF NOT EXISTS error_page_html TEXT;");
    await pool.query("ALTER TABLE domain_mappings ADD COLUMN IF NOT EXISTS bot_protection VARCHAR(20) DEFAULT 'unprotected';");

    // Request logs table for tracking all requests
    await pool.query(`CREATE TABLE IF NOT EXISTS request_logs(
      id SERIAL PRIMARY KEY,
      client_ip VARCHAR(191) NOT NULL,
      hostname VARCHAR(255),
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);
    
    // Index for faster queries
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_request_logs_ip_hostname ON request_logs(client_ip, hostname);`);

    // Security alerts table
    await pool.query(`CREATE TABLE IF NOT EXISTS security_alerts(
      id SERIAL PRIMARY KEY,
      alert_type VARCHAR(50) NOT NULL,
      severity VARCHAR(20) NOT NULL,
      ip_address VARCHAR(191),
      hostname VARCHAR(255),
      message TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON security_alerts(created_at);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(alert_type);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);`);

    // Certificates table for SSL/TLS certificates
    await pool.query(`CREATE TABLE IF NOT EXISTS certificates(
      id SERIAL PRIMARY KEY,
      domain VARCHAR(255) NOT NULL UNIQUE,
      private_key TEXT NOT NULL,
      certificate TEXT NOT NULL,
      chain TEXT,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    ); `);
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_certificates_domain ON certificates(domain);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_certificates_expires_at ON certificates(expires_at);`);

    // Clean up whitespace in domain_mappings hostnames
    try {
      await pool.query(`UPDATE domain_mappings SET hostname = TRIM(hostname) WHERE hostname != TRIM(hostname);`);
      console.log('Cleaned whitespace from domain hostnames');
    } catch (e) {
      console.warn('Failed to clean domain hostnames:', e.message);
    }

    // Migration: Add load balancing support
    try {
      console.log('Running load balancing migration...');

      // Add columns to backends table
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS weight INT DEFAULT 1`);

      // Migration: Add 2FA support
      console.log('Running 2FA migration...');
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_backup_codes JSONB`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_verified_at TIMESTAMP`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown'`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMP WITH TIME ZONE`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS active_connections INT DEFAULT 0`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS total_requests BIGINT DEFAULT 0`);
      await pool.query(`ALTER TABLE backends ADD COLUMN IF NOT EXISTS avg_response_time_ms INT DEFAULT 0`);

      // Create backend_pools table
      await pool.query(`CREATE TABLE IF NOT EXISTS backend_pools(
        id SERIAL PRIMARY KEY,
        name VARCHAR(191) NOT NULL UNIQUE,
        lb_algorithm VARCHAR(50) NOT NULL DEFAULT 'round-robin',
        health_check_enabled BOOLEAN DEFAULT TRUE,
        health_check_interval_ms INT DEFAULT 30000,
        health_check_path VARCHAR(255) DEFAULT '/',
        health_check_timeout_ms INT DEFAULT 2000,
        max_failures INT DEFAULT 3,
        failure_timeout_ms INT DEFAULT 60000,
        sticky_sessions BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      )`);

      // Create junction table
      await pool.query(`CREATE TABLE IF NOT EXISTS backend_pool_members(
        id SERIAL PRIMARY KEY,
        pool_id INT NOT NULL REFERENCES backend_pools(id) ON DELETE CASCADE,
        backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
        enabled BOOLEAN DEFAULT TRUE,
        priority INT DEFAULT 100,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        UNIQUE(pool_id, backend_id)
      )`);

      // Add pool_id to domain_mappings
      await pool.query(`ALTER TABLE domain_mappings ADD COLUMN IF NOT EXISTS backend_pool_id INT REFERENCES backend_pools(id) ON DELETE SET NULL`);

      // Create indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_backend_pool_members_pool ON backend_pool_members(pool_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_backend_pool_members_backend ON backend_pool_members(backend_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_domain_mappings_pool ON domain_mappings(backend_pool_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_backends_health_status ON backends(health_status)`);

      console.log('Load balancing migration completed');
    } catch (e) {
      console.error('Failed to run load balancing migration:', e.message);
    }

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
        INSERT INTO proxies(name, listen_host, listen_port, listen_protocol, target_host, target_port, target_protocol, enabled)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8)
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

    // Load bot protection domain lists
    try {
      const botProtection = require('./services/botProtection');
      const domainModel = require('./models/domainModel');
      const domains = await domainModel.listDomainMappings();
      
      domains.forEach(d => {
        const protection = d.bot_protection || 'default';
        // Trim whitespace from hostname
        const hostname = d.hostname ? d.hostname.trim() : d.hostname;
        if (protection === 'protected') {
          botProtection.addProtectedDomain(hostname);
        } else if (protection === 'unprotected') {
          botProtection.addUnprotectedDomain(hostname);
        }
      });
      
      console.log('Loaded bot protection domain lists');
    } catch (e) {
      console.error('Failed to load bot protection domains', e);
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

    // Load all configuration from database
    try {
      const configController = require('./controllers/configController');
      const settings = await settingsModel.listSettings();
      const settingsMap = new Map(settings.map(s => [s.key, s.value]));
      
      // Apply bot protection settings
      const botProtection = require('./services/botProtection');
      const loadConfigValue = (key, defaultValue, type = 'string') => {
        const value = settingsMap.get(key);
        if (value === undefined || value === null) return defaultValue;
        if (type === 'number') return Number(value);
        if (type === 'boolean') return value === 'true' || value === true;
        return value;
      };
      
      botProtection.setEnabled(loadConfigValue('botProtection.enabled', false, 'boolean'));
      botProtection.setThreshold(loadConfigValue('botProtection.threshold', 100, 'number'));
      botProtection.setPerIpLimit(loadConfigValue('botProtection.perIpLimit', 60, 'number'));
      botProtection.perIpLimitProtected = loadConfigValue('botProtection.perIpLimitProtected', 30, 'number');
      botProtection.verifiedIpLimit = loadConfigValue('botProtection.verifiedIpLimit', 600, 'number');
      botProtection.burstLimit = loadConfigValue('botProtection.burstLimit', 10, 'number');
      botProtection.maxConnectionsPerIP = loadConfigValue('botProtection.maxConnectionsPerIP', 100, 'number');
      botProtection.maxAttempts = loadConfigValue('botProtection.maxAttempts', 3, 'number');
      botProtection.setChallengeFirstVisit(loadConfigValue('botProtection.challengeFirstVisit', false, 'boolean'));
      
      const verificationHours = loadConfigValue('botProtection.verificationDuration', 6, 'number');
      botProtection.setVerificationDuration(verificationHours);
      
      // Apply backend settings
      const healthCheckInterval = loadConfigValue('backends.healthCheckInterval', 30000, 'number');
      proxyManager.healthProbeIntervalMs = healthCheckInterval;
      proxyManager.failureThreshold = loadConfigValue('backends.failureThreshold', 3, 'number');
      
      // Apply metrics settings
      proxyManager.flushIntervalSec = loadConfigValue('metrics.flushInterval', 5, 'number');
      
      console.log('✓ Configuration loaded from database');
    } catch (e) { 
      console.error('Failed to load configuration from DB:', e);
      console.log('Using default configuration values');
    }

    // Connect to Redis (optional - graceful fallback to memory cache)
    try {
      await connectRedis();
    } catch (e) {
      console.error('Failed to connect to Redis:', e.message);
      console.log('Continuing without Redis (using in-memory fallback)');
    }

    // Start health checks for all backend pools
    try {
      const healthChecker = require('./services/healthChecker');
      await healthChecker.startAllHealthChecks();
      console.log('Health checker initialized');
    } catch (e) {
      console.error('Failed to start health checker', e);
    }
    
    } catch (err) {
      console.error('Failed to initialize with database:', err);
      console.log('Some features may be unavailable');
    }
  } else {
    // Database unavailable - degraded mode
    console.log('⚠️  Running in CONFIGURATION MODE');
    console.log('📝 Only configuration management is available');
    console.log('🔧 Please fix database connection and restart the application');
  }

  // Always start HTTP server (even in degraded mode)
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!dbConnected) {
      console.log('⚠️  WARNING: Database not connected - limited functionality');
    }
  });
}

initDbAndStart();
