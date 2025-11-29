const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ACME manager that calls certbot in webroot mode to obtain certificates.
// Uses the webroot at /var/www/letsencrypt so the Node proxy can serve HTTP-01
// challenges without stopping the Node process. This performs production
// issuance by default (no --staging flag).

const ACME_EMAIL = process.env.ACME_EMAIL || '';
const CERT_DIR = '/etc/letsencrypt/live';

const running = new Set();

function isIpAddress(host) {
  if (!host || typeof host !== 'string') return false;
  // IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (simple heuristic: contains ':' and not a hostname)
  if (host.includes(':')) return true;
  return false;
}

function certFilesExist(domain) {
  const dir = path.join(CERT_DIR, domain);
  return fs.existsSync(path.join(dir, 'fullchain.pem')) && fs.existsSync(path.join(dir, 'privkey.pem'));
}

function getCertExpiry(domain) {
  try {
    const out = execSync(`openssl x509 -in ${path.join(CERT_DIR, domain, 'fullchain.pem')} -noout -enddate`).toString();
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
  if (isIpAddress(domain)) {
    console.log(`acmeManager: skipping certificate request for IP address ${domain}`);
    return;
  }
  if (running.has(domain)) return;
  running.add(domain);
  try {
    if (certFilesExist(domain) && !certExpiresSoon(domain)) {
      console.log(`acmeManager: cert for ${domain} already exists and is valid`);
      running.delete(domain);
      return;
    }

    if (!ACME_EMAIL) {
      throw new Error('ACME_EMAIL not set in environment');
    }

    console.log(`acmeManager: requesting certificate for ${domain} via certbot (webroot)`);

    // Ensure webroot exists and is writable
    // Use a local directory for webroot on Windows/Dev, or /var/www/letsencrypt on Linux
    const isWindows = process.platform === 'win32';
    const webroot = isWindows ? path.join(__dirname, '..', '..', 'letsencrypt') : '/var/www/letsencrypt';

    try { if (!fs.existsSync(webroot)) fs.mkdirSync(webroot, { recursive: true, mode: 0o755 }); } catch (e) { console.error('acmeManager: failed to create webroot', e); }

    // run certbot in webroot mode (no need to stop node)
    const os = require('os');
    const logFile = path.join(os.tmpdir(), `acme-${domain}.log`);

    // Construct command carefully for cross-platform compatibility
    // Note: certbot must be in PATH. On Windows, redirection >> might need shell: true option in exec.
    const cmd = `certbot certonly --webroot -w "${webroot}" -d ${domain} --agree-tos --non-interactive -m ${ACME_EMAIL} > "${logFile}" 2>&1`;

    try {
      const res = await runCmd(cmd, { shell: true }); // shell: true is important for redirection
      console.log('acmeManager: certbot output logged to', logFile);
    } catch (err) {
      // If certbot failed, include the log file contents to aid debugging
      console.error('acmeManager: certbot failed; see log:', logFile);
      try {
        if (fs.existsSync(logFile)) {
          const logContent = fs.readFileSync(logFile, 'utf8');
          // Show last 1000 chars
          console.error('acmeManager: certbot log (tail):\n', logContent.slice(-1000));
        }
      } catch (e) { }
      throw err;
    }

    // Wait a bit for files to appear
    const dir = path.join(CERT_DIR, domain);
    let found = false;
    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(path.join(dir, 'fullchain.pem')) && fs.existsSync(path.join(dir, 'privkey.pem'))) { found = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!found) {
      console.error(`acmeManager: certificate for ${domain} not found after certbot run; check ${logFile}`);
    } else {
      console.log(`acmeManager: certificate for ${domain} obtained`);
    }
  } catch (e) {
    console.error('acmeManager.ensureCert error', e && e.err ? e.err : e);
  } finally {
    running.delete(domain);
    // Do NOT restart Node automatically here. The proxy loads new certificates
    // dynamically via SNI callback; restarting the whole process caused SSH/VSCode
    // disruptions in this environment. If you prefer an automatic restart, add
    // a controlled deploy/renew hook that safely restarts the service.
  }
}

function getCertContent(domain) {
  try {
    const dir = path.join(CERT_DIR, domain);
    const fullchainPath = path.join(dir, 'fullchain.pem');
    const privkeyPath = path.join(dir, 'privkey.pem');

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

module.exports = { ensureCert, certFilesExist, getCertStatus, getCertContent };
