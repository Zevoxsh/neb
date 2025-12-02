const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ACME manager that calls certbot in webroot mode to obtain certificates.
// Uses the webroot at /var/www/letsencrypt so the Node proxy can serve HTTP-01
// challenges without stopping the Node process. This performs production
// issuance by default (no --staging flag).

const ACME_EMAIL = process.env.ACME_EMAIL || '';
const CERT_DIR = '/etc/letsencrypt/live';
const CUSTOM_CERT_DIR = process.env.CUSTOM_CERT_DIR || path.join(__dirname, '..', '..', 'certs', 'manual');

const running = new Set();

function isIpAddress(host) {
  if (!host || typeof host !== 'string') return false;
  // IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (simple heuristic: contains ':' and not a hostname)
  if (host.includes(':')) return true;
  return false;
}

// Build default local TLDs (can be overridden by LOCAL_TLDS env var, comma-separated)
const DEFAULT_LOCAL_TLDS = [
  'local', 'localhost', 'lan', 'localdomain', 'home', 'home.arpa', 'intranet', 'internal', 'private', 'localnet', 'office', 'corp', 'test', 'example', 'invalid', 'localbox', 'box'
];

// Parse env var once at module load (can be overridden at runtime via setter)
const rawLocalTlds = (process.env.LOCAL_TLDS || '').split(',').map(s => s.trim()).filter(Boolean);
let LOCAL_TLDS = (rawLocalTlds.length ? rawLocalTlds : DEFAULT_LOCAL_TLDS).map(t => t.toLowerCase());

function setLocalTlds(list) {
  if (!list) return;
  if (typeof list === 'string') {
    LOCAL_TLDS = list.split(',').map(s => s.trim()).filter(Boolean).map(t => t.toLowerCase());
  } else if (Array.isArray(list)) {
    LOCAL_TLDS = list.map(s => String(s).trim()).filter(Boolean).map(t => t.toLowerCase());
  }
}

function getLocalTlds() {
  return Array.from(LOCAL_TLDS);
}

function isLocalDomain(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.toLowerCase().trim();
  // Single-label hostnames (no dot) are typically local (e.g., 'mybox')
  if (!h.includes('.')) return true;

  // Check against configured local TLDs. Accept entries with or without leading dot.
  for (const t of LOCAL_TLDS) {
    if (!t) continue;
    // If t contains a dot (like 'home.arpa' or 'co.uk'), treat as suffix without forcing a leading dot
    if (h === t) return true;
    if (h.endsWith('.' + t)) return true;
    // Also allow entries that were provided with a leading dot (defensive)
    if (t.startsWith('.') && h.endsWith(t)) return true;
  }

  return false;
}

function certFilesExist(domain) {
  const dir = path.join(CERT_DIR, domain);
  if (fs.existsSync(path.join(dir, 'fullchain.pem')) && fs.existsSync(path.join(dir, 'privkey.pem'))) return true;
  const manualDir = path.join(CUSTOM_CERT_DIR, domain);
  return fs.existsSync(path.join(manualDir, 'fullchain.pem')) && fs.existsSync(path.join(manualDir, 'privkey.pem'));
}

function getCertExpiry(domain) {
  try {
    let certPath = path.join(CERT_DIR, domain, 'fullchain.pem');
    if (!fs.existsSync(certPath)) certPath = path.join(CUSTOM_CERT_DIR, domain, 'fullchain.pem');
    const out = execSync(`openssl x509 -in ${certPath} -noout -enddate`).toString();
    const m = out.match(/notAfter=(.*)/);
    if (!m) return null;
    return new Date(m[1]);
  } catch (e) {
    return null;
  }
}

function certExpiresSoon(domain, days = 30) {
  const exp = getCertExpiry(domain);
  if (!exp) return true;
  const now = new Date();
  const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
  return diffDays < days;
}

function getCertStatus(domain) {
  const exists = certFilesExist(domain);
  if (!exists) return { exists: false, validTo: null, expiresSoon: false };

  const validTo = getCertExpiry(domain);
  const expiresSoon = validTo ? ((validTo - new Date()) / (1000 * 60 * 60 * 24) < 30) : true;

  return { exists: true, validTo, expiresSoon };
}

function runCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, Object.assign({ maxBuffer: 1024 * 1024 * 10 }, opts), (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

async function ensureCert(domain) {
  if (!domain || typeof domain !== 'string') return;
  
  // Strict domain validation to prevent command injection
  const cleanDomain = String(domain).trim().toLowerCase();
  
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(cleanDomain)) {
    console.error(`acmeManager: invalid domain format: ${domain}`);
    return;
  }
  
  if (cleanDomain.length > 253) {
    console.error(`acmeManager: domain too long: ${domain}`);
    return;
  }
  
  if (isIpAddress(cleanDomain)) {
    console.log(`acmeManager: skipping certificate request for IP address ${cleanDomain}`);
    return;
  }
  if (isLocalDomain(cleanDomain)) {
    console.log(`acmeManager: skipping certificate request for local domain ${cleanDomain}`);
    return;
  }
  if (running.has(cleanDomain)) return;
  running.add(cleanDomain);
  try {
    if (certFilesExist(cleanDomain) && !certExpiresSoon(cleanDomain)) {
      console.log(`acmeManager: cert for ${cleanDomain} already exists and is valid`);
      running.delete(cleanDomain);
      return;
    }

    if (!ACME_EMAIL) {
      throw new Error('ACME_EMAIL not set in environment');
    }

    console.log(`acmeManager: requesting certificate for ${cleanDomain} via certbot (webroot)`);

    // Ensure webroot exists and is writable
    const isWindows = process.platform === 'win32';
    const webroot = isWindows ? path.join(__dirname, '..', '..', 'letsencrypt') : '/var/www/letsencrypt';

    try { if (!fs.existsSync(webroot)) fs.mkdirSync(webroot, { recursive: true, mode: 0o755 }); } catch (e) { console.error('acmeManager: failed to create webroot', e); }

    const os = require('os');
    const logFile = path.join(os.tmpdir(), `acme-${cleanDomain}.log`);

    // Use spawn instead of exec to avoid shell injection
    await new Promise((resolve, reject) => {
      const args = [
        'certonly',
        '--webroot',
        '-w', webroot,
        '-d', cleanDomain,
        '--agree-tos',
        '--non-interactive',
        '-m', ACME_EMAIL
      ];
      
      const proc = spawn('certbot', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      const logStream = fs.createWriteStream(logFile);
      proc.stdout.pipe(logStream);
      proc.stderr.pipe(logStream);
      
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      
      proc.on('close', code => {
        logStream.end();
        if (code === 0) {
          console.log('acmeManager: certbot output logged to', logFile);
          resolve();
        } else {
          console.error('acmeManager: certbot failed; see log:', logFile);
          try {
            if (fs.existsSync(logFile)) {
              const logContent = fs.readFileSync(logFile, 'utf8');
              console.error('acmeManager: certbot log (tail):\n', logContent.slice(-1000));
            }
          } catch (e) { }
          reject(new Error(`certbot failed with code ${code}: ${stderr}`));
        }
      });
      
      proc.on('error', (err) => {
        console.error('acmeManager: failed to spawn certbot:', err);
        reject(err);
      });
      
      // Security timeout (2 minutes max)
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('certbot timeout after 2 minutes'));
      }, 120000);
    });

    // Wait a bit for files to appear
    const dir = path.join(CERT_DIR, cleanDomain);
    let found = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(path.join(dir, 'fullchain.pem')) && fs.existsSync(path.join(dir, 'privkey.pem'))) { found = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!found) {
      console.error(`acmeManager: certificate for ${cleanDomain} not found after certbot run; check ${logFile}`);
    } else {
      console.log(`acmeManager: certificate for ${cleanDomain} obtained`);
    }
  } catch (e) {
    console.error('acmeManager.ensureCert error', e && e.message ? e.message : e);
  } finally {
    running.delete(cleanDomain);
  }
}

function getCertContent(domain) {
  try {
    let dir = path.join(CERT_DIR, domain);
    let fullchainPath = path.join(dir, 'fullchain.pem');
    let privkeyPath = path.join(dir, 'privkey.pem');
    if (!fs.existsSync(fullchainPath) || !fs.existsSync(privkeyPath)) {
      dir = path.join(CUSTOM_CERT_DIR, domain);
      fullchainPath = path.join(dir, 'fullchain.pem');
      privkeyPath = path.join(dir, 'privkey.pem');
    }

    if (fs.existsSync(fullchainPath) && fs.existsSync(privkeyPath)) {
      const cert = fs.readFileSync(fullchainPath, 'utf8');
      const key = fs.readFileSync(privkeyPath, 'utf8');
      return { cert, key };
    }
    return null;
  } catch (e) {
    console.error('getCertContent error', e);
    return null;
  }
}

async function saveManualCert(domain, cert, key) {
  if (!domain || !cert || !key) throw new Error('domain/cert/key required');
  // Prefer writing into the system cert directory used by certbot so other tools
  // that expect certificates under /etc/letsencrypt/live/<domain>/ will find them.
  // This typically requires root permissions. If writing to CERT_DIR fails we
  // fall back to the repository-local CUSTOM_CERT_DIR.
  const preferredDir = path.join(CERT_DIR, domain);
  try {
    // Ensure parent exists
    fs.mkdirSync(preferredDir, { recursive: true, mode: 0o755 });
    // Write files with conservative permissions: cert 0644, key 0600
    fs.writeFileSync(path.join(preferredDir, 'fullchain.pem'), cert, { encoding: 'utf8', mode: 0o644 });
    fs.writeFileSync(path.join(preferredDir, 'privkey.pem'), key, { encoding: 'utf8', mode: 0o600 });
    console.log(`acmeManager: saved manual cert to ${preferredDir}`);
    return true;
  } catch (e) {
    console.warn(`acmeManager: unable to write to ${preferredDir}, falling back to ${CUSTOM_CERT_DIR}:`, e && e.message ? e.message : e);
    const dir = path.join(CUSTOM_CERT_DIR, domain);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fullchain.pem'), cert, 'utf8');
    fs.writeFileSync(path.join(dir, 'privkey.pem'), key, 'utf8');
    console.log(`acmeManager: saved manual cert to ${dir}`);
    return true;
  }
}

module.exports = { ensureCert, certFilesExist, getCertStatus, getCertContent, saveManualCert };
// Export helpers to allow runtime update of local TLDs from settings API
module.exports.setLocalTlds = setLocalTlds;
module.exports.getLocalTlds = getLocalTlds;
