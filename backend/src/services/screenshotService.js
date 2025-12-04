/**
 * Screenshot Service
 * Takes screenshots of domains for preview cards
 * Uses https.get to download screenshots from external API
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class ScreenshotService {
  constructor() {
    // Store screenshots in frontend/public/screenshots so they're accessible via /public
    this.screenshotsDir = path.join(__dirname, '../../../frontend/public/screenshots');
    this.isInitialized = true; // Always available with external API
    this.screenshotAPI = 'https://image.thum.io/get/width/1280/crop/800/noanimate/';

    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
      console.log('[ScreenshotService] Created screenshots directory:', this.screenshotsDir);
    }

    // Optional mapping file: { "<domainId>": "<hostname>", ... }
    this.mappingFile = path.join(this.screenshotsDir, 'screenshots-map.json');
    if (!fs.existsSync(this.mappingFile)) {
      fs.writeFileSync(this.mappingFile, JSON.stringify({}, null, 2), 'utf8');
      console.log('[ScreenshotService] Created mapping file:', this.mappingFile);
    }

    // Schedule periodic refresh every 10 minutes
    const intervalMs = 10 * 60 * 1000; // 10 minutes
    this._screenshotInterval = setInterval(async () => {
      try {
      const raw = fs.readFileSync(this.mappingFile, 'utf8') || '{}';
      const map = JSON.parse(raw);
      const entries = Object.entries(map);
      if (entries.length === 0) {
        // nothing to do
        return;
      }

      console.log('[ScreenshotService] Running scheduled screenshot refresh for', entries.length, 'domains');

      // Refresh sequentially to avoid concurrent download storms
      for (const [domainId, hostname] of entries) {
        try {
        console.log(`[ScreenshotService] Scheduled refresh for ${hostname} (id=${domainId})`);
        await this.refreshScreenshot(hostname, domainId);
        } catch (err) {
        console.error(`[ScreenshotService] Scheduled refresh failed for ${hostname}:`, err.message);
        }
      }
      } catch (err) {
      console.error('[ScreenshotService] Error during scheduled screenshot refresh:', err.message);
      }
    }, intervalMs);

    console.log('[ScreenshotService] Scheduled periodic screenshots every 10 minutes. Update', this.mappingFile, 'with {"<domainId>":"<hostname>"} to enable automatic captures.');

    // If mapping file is empty, try to populate it from domain mappings (if DB available)
    try {
      const raw = fs.readFileSync(this.mappingFile, 'utf8') || '{}';
      const map = JSON.parse(raw);
      const entries = Object.entries(map);
      if (entries.length === 0) {
        try {
          const domainModel = require('../models/domainModel');
          if (domainModel && typeof domainModel.listDomainMappings === 'function') {
            domainModel.listDomainMappings().then((domains) => {
              if (Array.isArray(domains) && domains.length > 0) {
                const newMap = {};
                domains.forEach(d => {
                  if (d && d.id && d.hostname) newMap[String(d.id)] = d.hostname;
                });
                try {
                  fs.writeFileSync(this.mappingFile, JSON.stringify(newMap, null, 2), 'utf8');
                  console.log('[ScreenshotService] Populated mapping file from domainModel with', Object.keys(newMap).length, 'entries');
                } catch (e) {
                  console.error('[ScreenshotService] Failed to write mapping file:', e && e.message ? e.message : e);
                }
              }
            }).catch(() => {});
          }
        } catch (e) {
          // ignore if domainModel not available (startup before DB)
        }
      }
    } catch (e) {
      // ignore mapping read errors
    }

    console.log('[ScreenshotService] Service initialized (using external API)');
    console.log('[ScreenshotService] Screenshots directory:', this.screenshotsDir);

    // Ensure hostname-based copies exist for any pre-existing id-based screenshots
    try {
      // Populate hostname copies in background (don't block startup)
      setImmediate(() => {
        try {
          this.populateHostnameCopies().catch(e => {});
        } catch (e) { }
      });
    } catch (e) { }
  }

  // Create hostname-based copies for any existing id-based screenshot files where mapping exists in DB
  async populateHostnameCopies() {
    try {
      const domainModel = require('../models/domainModel');
      const mappings = await domainModel.listDomainMappings();
      if (!Array.isArray(mappings) || mappings.length === 0) return;
      for (const m of mappings) {
        try {
          const id = String(m.id);
          const hostname = m.hostname;
          const idFile = path.join(this.screenshotsDir, `domain-${id}.png`);
          const hostFile = path.join(this.screenshotsDir, `domain-${hostname}.png`);
          if (fs.existsSync(idFile) && !fs.existsSync(hostFile)) {
            try { fs.copyFileSync(idFile, hostFile); console.log('[ScreenshotService] populateHostnameCopies: created', hostFile); } catch (e) { console.warn('[ScreenshotService] populateHostnameCopies failed for', hostname, e && e.message ? e.message : e); }
          }
        } catch (e) { }
      }
    } catch (e) {
      console.warn('[ScreenshotService] populateHostnameCopies error:', e && e.message ? e.message : e);
    }
  }

  async initialize() {
    // No initialization needed for external API
    return Promise.resolve();
  }

  async captureScreenshot(hostname, domainId) {
    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    // Check if screenshot already exists and is recent (< 24 hours)
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      const age = Date.now() - stats.mtimeMs;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (age < maxAge) {
        console.log(`[ScreenshotService] Using cached screenshot for ${hostname}`);
        return `/public/screenshots/${filename}`;
      }
    }

    try {
      console.log(`[ScreenshotService] Capturing screenshot for ${hostname}`);

      // Try local capture first (wkhtmltoimage -> Chrome CLI -> Puppeteer)
      // This ensures we capture the actual site content by connecting to localhost with Host header
      // instead of going through the public proxy which may show bot protection or dashboard
      const opts = { waitMs: 3000 };

      try {
        console.log(`[ScreenshotService] Attempting local capture with wkhtmltoimage...`);
        const wk = await this.captureWithWkhtmltoimage(hostname, domainId, opts);
        if (wk) return wk;
      } catch (e) {
        console.warn('[ScreenshotService] wkhtmltoimage failed, trying Chrome CLI:', e.message);
      }

      try {
        console.log(`[ScreenshotService] Attempting local capture with Chrome CLI...`);
        const cli = await this.captureWithChromeCli(hostname, domainId, opts);
        if (cli) return cli;
      } catch (e) {
        console.warn('[ScreenshotService] Chrome CLI failed, trying Puppeteer:', e.message);
      }

      try {
        console.log(`[ScreenshotService] Attempting local capture with Puppeteer...`);
        const pup = await this.captureWithPuppeteer(hostname, domainId, opts);
        if (pup) return pup;
      } catch (e) {
        console.warn('[ScreenshotService] Puppeteer failed, falling back to external API:', e.message);
      }

      // Fallback to external API if all local methods fail
      console.log(`[ScreenshotService] All local capture methods failed, using external API as fallback`);
      const screenshotUrl = `${this.screenshotAPI}https://${hostname}`;

      await this.downloadScreenshot(screenshotUrl, filepath);

      console.log(`[ScreenshotService] Screenshot saved for ${hostname}`);
      console.log(`[ScreenshotService] File saved to: ${filepath}`);
      console.log(`[ScreenshotService] Accessible at: /public/screenshots/${filename}`);

      // Verify file was actually created
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        console.log(`[ScreenshotService] File size: ${stats.size} bytes`);
        // also save a hostname-based copy for convenience
        try { this.saveHostnameCopy(domainId, hostname); } catch (e) { }
      } else {
        console.error(`[ScreenshotService] WARNING: File does not exist after download!`);
      }

      return `/public/screenshots/${filename}`;
    } catch (error) {
      console.error(`[ScreenshotService] Error capturing ${hostname}:`, error.message);
      return null;
    }
  }

  downloadScreenshot(url, filepath) {
    return new Promise((resolve, reject) => {
      // Silent download - no logs
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          return this.downloadScreenshot(response.headers.location, filepath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download screenshot: ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(filepath);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          // Silent - no log
          resolve();
        });

        fileStream.on('error', (err) => {
          // Only log errors, not normal operation
          fs.unlink(filepath, () => {}); // Delete partial file
          reject(err);
        });
      });

      request.on('error', (err) => {
        // Only log errors, not normal operation
        reject(err);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Screenshot download timeout'));
      });
    });
  }

  /**
   * Fetch screenshot bytes from external API and return a data URL (base64).
   * Optionally save to disk (async) for caching.
   */
  fetchScreenshotInline(hostname, domainId) {
    return new Promise((resolve, reject) => {
      const screenshotUrl = `${this.screenshotAPI}https://${hostname}`;
      const protocol = screenshotUrl.startsWith('https') ? https : http;

      console.log(`[ScreenshotService] Fetching inline screenshot from: ${screenshotUrl}`);

      const request = protocol.get(screenshotUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          return this.fetchScreenshotInline(response.headers.location, domainId)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to fetch screenshot: ${response.statusCode}`));
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;

            // Save to disk asynchronously for caching
            try {
              const filename = `domain-${domainId}.png`;
              const filepath = path.join(this.screenshotsDir, filename);
              fs.writeFile(filepath, buffer, (err) => {
                if (err) console.error('[ScreenshotService] Failed to cache screenshot:', err.message);
                else console.log('[ScreenshotService] Cached screenshot to', filepath);
              });
            } catch (e) {
              console.error('[ScreenshotService] Error scheduling cache write:', e.message);
            }

            resolve(dataUrl);
          } catch (err) {
            reject(err);
          }
        });

        response.on('error', (err) => reject(err));
      });

      request.on('error', (err) => reject(err));
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Screenshot fetch timeout'));
      });
    });
  }

  getScreenshotPath(domainId) {
    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    if (fs.existsSync(filepath)) {
      return `/public/screenshots/${filename}`;
    }

    return null;
  }

  // Return screenshot path preferring hostname-based filename if provided
  getScreenshotPathWithHostname(domainId, hostname) {
    if (hostname) {
      const hostFile = `domain-${hostname}.png`;
      const hostPath = path.join(this.screenshotsDir, hostFile);
      if (fs.existsSync(hostPath)) return `/public/screenshots/${hostFile}`;
    }

    return this.getScreenshotPath(domainId);
  }

  // Ensure we save an additional copy using the hostname-based filename for front-end convenience
  saveHostnameCopy(domainId, hostname) {
    try {
      if (!hostname) return;
      const idFile = path.join(this.screenshotsDir, `domain-${domainId}.png`);
      const hostFile = path.join(this.screenshotsDir, `domain-${hostname}.png`);
      if (fs.existsSync(idFile)) {
        // Only overwrite if the hostFile doesn't exist or is older
        let copy = true;
        try {
          if (fs.existsSync(hostFile)) {
            const s1 = fs.statSync(idFile);
            const s2 = fs.statSync(hostFile);
            if (s2.mtimeMs >= s1.mtimeMs) copy = false;
          }
        } catch (e) { }
        if (copy) {
          try { fs.copyFileSync(idFile, hostFile); console.log('[ScreenshotService] saved hostname copy', hostFile); } catch (e) { console.warn('[ScreenshotService] failed to save hostname copy', e && e.message ? e.message : e); }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * Return screenshot as data URL (base64) so clients can embed it
   * and avoid performing an additional HTTP request that may trigger
   * bot protection on intermediate proxies.
   */
  // Read screenshot bytes and return a data URL (base64).
  // If `hostname` is provided, prefer the hostname-based file `domain-<hostname>.png`
  // so that inline responses match the path the frontend may receive.
  getScreenshotData(domainId, hostname) {
    // Try hostname-based file first
    if (hostname) {
      const hostFilename = `domain-${hostname}.png`;
      const hostFilepath = path.join(this.screenshotsDir, hostFilename);
      if (fs.existsSync(hostFilepath)) {
        try {
          const buffer = fs.readFileSync(hostFilepath);
          const base64 = buffer.toString('base64');
          return `data:image/png;base64,${base64}`;
        } catch (err) {
          console.error(`[ScreenshotService] Error reading hostname screenshot for ${hostname}:`, err && err.message ? err.message : err);
          // fall through to try id-based file
        }
      }
    }

    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    if (!fs.existsSync(filepath)) return null;

    try {
      const buffer = fs.readFileSync(filepath);
      const base64 = buffer.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (err) {
      console.error(`[ScreenshotService] Error reading screenshot for ${domainId}:`, err && err.message ? err.message : err);
      return null;
    }
  }

  async deleteScreenshot(domainId) {
    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
        console.log(`[ScreenshotService] Deleted screenshot for domain ${domainId}`);
      } catch (error) {
        console.error(`[ScreenshotService] Error deleting screenshot:`, error.message);
      }
    }
  }

  async refreshScreenshot(hostname, domainId) {
    // Accept optional options via third argument
    const opts = arguments[2] || {};

    // Delete existing screenshot to force refresh
    await this.deleteScreenshot(domainId);

    // If method is 'local', try wkhtmltoimage first (no Chromium dependency), then CLI Chrome, then Puppeteer fallback
    if (opts.method === 'local') {
      // default wait before capture to allow client-side JS to render (5s)
      if (typeof opts.waitMs === 'undefined' || opts.waitMs === null) opts.waitMs = 5000;
      try {
        const wk = await this.captureWithWkhtmltoimage(hostname, domainId, opts);
        if (wk) return wk;
      } catch (e) {
        console.warn('[ScreenshotService] captureWithWkhtmltoimage failed, trying Chrome CLI fallback:', e && e.message ? e.message : e);
      }

      try {
        const cli = await this.captureWithChromeCli(hostname, domainId, opts);
        if (cli) return cli;
      } catch (e) {
        console.warn('[ScreenshotService] captureWithChromeCli failed, trying Puppeteer fallback:', e && e.message ? e.message : e);
        try {
          const p = await this.captureWithPuppeteer(hostname, domainId, opts);
          if (p) return p;
        } catch (ee) {
          console.error('[ScreenshotService] captureWithPuppeteer also failed, falling back to external API:', ee && ee.message ? ee.message : ee);
        }
      }
    }

    // Capture new screenshot via external API
    return await this.captureScreenshot(hostname, domainId);
  }

  /**
   * Capture a screenshot locally using Puppeteer.
   * Attempts to connect to the local server (127.0.0.1:PORT) and sets Host header.
   * Returns the public path on success.
   */
  async captureWithPuppeteer(hostname, domainId, options = {}) {
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (e) {
      throw new Error('Puppeteer not installed. Run `npm install puppeteer --save` on the server.');
    }

    const PORT = process.env.PORT || 3000;
    const targetUrl = `http://127.0.0.1:${PORT}/`;
    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    const launchOptions = {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
    };

    if (options.puppeteer && typeof options.puppeteer === 'object') {
      Object.assign(launchOptions, options.puppeteer);
    }

    console.log(`[ScreenshotService] captureWithPuppeteer: launching browser for ${hostname} -> ${targetUrl}`);

    const browser = await puppeteer.launch(launchOptions);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      // Set Host header so the local server serves the requested domain
      await page.setExtraHTTPHeaders({ Host: hostname });

      // Navigate and wait until network is idle
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Small wait to allow client-side rendering if needed
      if (options.waitMs) await new Promise(r => setTimeout(r, options.waitMs));

      await page.screenshot({ path: filepath, fullPage: false });
      console.log(`[ScreenshotService] captureWithPuppeteer: saved ${filepath}`);

      try { this.saveHostnameCopy(domainId, hostname); } catch (e) { }
      return `/public/screenshots/${filename}`;
    } finally {
      try { await browser.close(); } catch (e) { }
    }
  }

  /**
   * Capture using wkhtmltoimage (no Chromium required). This relies on an external
   * `wkhtmltoimage` binary being installed on the system. It targets the local
   * server (127.0.0.1:port) and sets a Host header so the proxy serves the
   * correct domain while treating the request as local (trusted).
   */
  async captureWithWkhtmltoimage(hostname, domainId, options = {}) {
    const { spawn } = require('child_process');
    const possibleBins = [
      process.env.WKHTMLTOIMAGE_BIN,
      '/usr/bin/wkhtmltoimage',
      '/usr/local/bin/wkhtmltoimage',
      'C:\\Program Files\\wkhtmltopdf\\bin\\wkhtmltoimage.exe',
      'C:\\Program Files (x86)\\wkhtmltopdf\\bin\\wkhtmltoimage.exe'
    ].filter(Boolean);

    const fs = require('fs');
    let bin = null;
    for (const p of possibleBins) {
      try { if (fs.existsSync(p)) { bin = p; break; } } catch (e) { }
    }

    if (!bin) {
      throw new Error('wkhtmltoimage binary not found. Install wkhtmltoimage to use this capture method.');
    }

    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (e) { }

    // Determine local port to target (try to detect proxy listener for domain)
    let targetPort = process.env.PORT || 3000;
    try {
      const domainModel = require('../models/domainModel');
      const proxyModel = require('../models/proxyModel');
      const mappings = await domainModel.listDomainMappings();
      const mapping = mappings.find(m => String(m.id) === String(domainId) || m.hostname === hostname);
      if (mapping && mapping.proxy_id) {
        const proxy = await proxyModel.getProxyById(mapping.proxy_id);
        if (proxy && proxy.listen_port) targetPort = Number(proxy.listen_port);
      }
    } catch (e) { }

    const targetUrl = `http://127.0.0.1:${targetPort}/`;

    const args = [
      '--enable-javascript',
      '--javascript-delay', String(options.waitMs || 1000),
      '--width', '1280',
      '--height', '800',
      '--quality', '90',
      '--disable-smart-width',
      '--custom-header', 'Host', hostname,
      targetUrl,
      filepath
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let stdout = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      const timeoutMs = options.timeoutMs || 30000;
      const to = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) { }
        reject(new Error('wkhtmltoimage capture timeout'));
      }, timeoutMs + 2000);

      proc.on('close', (code) => {
        clearTimeout(to);
        if (stdout && stdout.trim()) console.log('[ScreenshotService] captureWithWkhtmltoimage stdout:', stdout.trim());
        if (stderr && stderr.trim()) console.warn('[ScreenshotService] captureWithWkhtmltoimage stderr:', stderr.trim());
        if (code !== 0) return reject(new Error(`wkhtmltoimage exited with code ${code}: ${stderr}`));
        setTimeout(() => {
          if (fs.existsSync(filepath)) {
            try { this.saveHostnameCopy(domainId, hostname); } catch (e) { }
            return resolve(`/public/screenshots/${filename}`);
          }
          return reject(new Error('wkhtmltoimage reported success but file missing; stderr: ' + stderr));
        }, 200);
      });
    });
  }

  /**
   * Capture using system Chrome/Chromium CLI. Does not depend on Puppeteer.
   * Returns public path on success.
   */
  async captureWithChromeCli(hostname, domainId, options = {}) {
    // If caller requested a wait before starting the capture, honor it (allow client JS to render)
    if (options && options.waitMs && Number(options.waitMs) > 0) {
      console.log('[ScreenshotService] captureWithChromeCli: waiting', options.waitMs, 'ms before spawning chrome');
      await new Promise(r => setTimeout(r, Number(options.waitMs)));
    }
    const { spawn } = require('child_process');

    const possibleBins = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      process.env.CHROME_PATH,
      process.env.CHROMIUM_PATH,
      // Common Linux locations
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      // Common Windows locations
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);

    // also check puppeteer cache location if present
    try {
      const pp = require('puppeteer');
      if (pp && typeof pp.executablePath === 'function') {
        const ppath = pp.executablePath();
        if (ppath) possibleBins.unshift(ppath);
      }
    } catch (e) {
      // ignore if puppeteer not installed
    }

    const fs = require('fs');
    let bin = null;
    for (const p of possibleBins) {
      if (!p) continue;
      try {
        if (fs.existsSync(p)) { bin = p; break; }
      } catch (e) { }
    }

    if (!bin) {
      console.error('[ScreenshotService] captureWithChromeCli: no chrome binary found in possible locations:', possibleBins);
      throw new Error('No Chrome/Chromium executable found for CLI capture');
    }

    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    // Remove any existing file
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (e) { }

    // Build args. Use host resolver to map hostname to 127.0.0.1
    // Attempt to detect which proxy listener handles this domain so we target the proxy (usually port 80/443)
    let targetPort = null;
    let targetProtocol = 'http';
    try {
      const domainModel = require('../models/domainModel');
      const proxyModel = require('../models/proxyModel');
      const mappings = await domainModel.listDomainMappings();
      const mapping = mappings.find(m => String(m.id) === String(domainId) || m.hostname === hostname);
      if (mapping && mapping.proxy_id) {
        const proxy = await proxyModel.getProxyById(mapping.proxy_id);
        if (proxy && proxy.listen_port) {
          targetPort = Number(proxy.listen_port);
          // listen_protocol may be 'http' or 'tcp' or 'https'
          targetProtocol = (proxy.listen_protocol || proxy.protocol || '').toLowerCase() || targetProtocol;
        }
      }
    } catch (e) {
      // ignore and fallback to default
    }

    // Allow caller to override the target port (options.targetPort)
    if (options && options.targetPort) {
      try { targetPort = Number(options.targetPort); } catch (e) { }
    }

    // Fallback to app PORT if nothing found
    const defaultAppPort = process.env.PORT || 3000;
    if (!targetPort) targetPort = defaultAppPort;
    const portSuffix = targetPort && (String(targetPort) !== '80' && String(targetPort) !== '443') ? (`:${targetPort}`) : '';
    const scheme = (String(targetProtocol).startsWith('https') || String(targetPort) === '443') ? 'https' : 'http';
    const targetUrl = `${scheme}://${hostname}${portSuffix}/`;
    const args = [];
    // New headless mode if supported
    args.push('--headless=new');
    args.push(`--window-size=1280,800`);
    args.push(`--screenshot=${filepath}`);
    args.push('--no-sandbox');
    args.push('--disable-setuid-sandbox');
    args.push('--disable-dev-shm-usage');
    // Map the target hostname to 127.0.0.1 so Chrome connects locally but sends Host header = hostname
    args.push(`--host-resolver-rules=MAP ${hostname} 127.0.0.1`);
    // Ensure DNS over HTTPS or other features don't interfere
    args.push('--disable-features=NetworkService');
    args.push(targetUrl);

    console.log('[ScreenshotService] captureWithChromeCli: using binary:', bin);
    console.log('[ScreenshotService] captureWithChromeCli: args:', args.join(' '));

    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let stdout = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', (err) => reject(new Error('Failed to spawn chrome: ' + err.message)));
      const timeoutMs = options.timeoutMs || 45000;
      const to = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) { }
        reject(new Error('Chrome CLI capture timeout'));
      }, timeoutMs + 2000);

      proc.on('close', (code) => {
        clearTimeout(to);
        console.log(`[ScreenshotService] captureWithChromeCli: process exited with code ${code}`);
        // Filter noisy Chromium stderr lines (DBus / GPU / UPower warnings)
        const noisyPatterns = [
          /dbus/i,
          /org\.freedesktop/i,
          /upower/i,
          /Failed to connect to the bus/i,
          /ERROR:dbus/i,
          /ERROR:gpu/i,
          /XDG_RUNTIME_DIR/i,
          /No such file or directory/i,
          /Cannot access the X display/i,
          /GLIBCXX/i
        ];

        const filterStderrLines = (text) => {
          if (!text) return '';
          return text.split(/\r?\n/).filter(line => {
            if (!line || !line.trim()) return false;
            for (const p of noisyPatterns) {
              try { if (p.test(line)) return false; } catch (e) { }
            }
            return true;
          }).join('\n');
        };

        const cleanedStderr = filterStderrLines(stderr);
        if (stdout && stdout.trim()) console.log('[ScreenshotService] captureWithChromeCli stdout:', stdout.trim());
        if (cleanedStderr && cleanedStderr.trim()) console.warn('[ScreenshotService] captureWithChromeCli stderr:', cleanedStderr.trim());
        if (code !== 0) {
          return reject(new Error(`Chrome exited with code ${code}: ${stderr}`));
        }
        // Ensure file was created
        setTimeout(() => {
          if (fs.existsSync(filepath)) {
            try { this.saveHostnameCopy(domainId, hostname); } catch (e) { }
            return resolve(`/public/screenshots/${filename}`);
          }
          return reject(new Error('Chrome CLI reported success but file missing; stdout: ' + stdout + '; stderr: ' + stderr));
        }, 200);
      });
    });
  }

  /**
   * Refresh all screenshots listed in the mapping file.
   * Returns an array of results for each domainId: { domainId, hostname, path, error }
   */
  async refreshAll(concurrency = 5) {
    try {
      const raw = fs.readFileSync(this.mappingFile, 'utf8') || '{}';
      const map = JSON.parse(raw);
      const entries = Object.entries(map);

      if (!entries || entries.length === 0) {
        console.log('[ScreenshotService] refreshAll: no mappings to refresh');
        return [];
      }

      console.log('[ScreenshotService] refreshAll: refreshing', entries.length, 'domains');

      const results = [];

      // Simple concurrency limiter
      let idx = 0;
      const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
        while (true) {
          const i = idx++;
          if (i >= entries.length) break;
          const [domainId, hostname] = entries[i];
          try {
            console.log(`[ScreenshotService] refreshAll: refreshing ${hostname} (id=${domainId})`);
            // allow options as second parameter (method)
            const opts = typeof arguments[1] === 'object' ? arguments[1] : {};
            const pathResult = await this.refreshScreenshot(hostname, domainId, opts);
            results.push({ domainId: String(domainId), hostname, path: pathResult, error: null });
          } catch (err) {
            console.error(`[ScreenshotService] refreshAll: failed for ${hostname}:`, err && err.message ? err.message : err);
            results.push({ domainId: String(domainId), hostname, path: null, error: err && err.message ? err.message : String(err) });
          }
        }
      });

      await Promise.all(workers);
      return results;
    } catch (err) {
      console.error('[ScreenshotService] refreshAll error:', err && err.message ? err.message : err);
      throw err;
    }
  }

  async cleanup() {
    // No cleanup needed for external API
    console.log('[ScreenshotService] Cleanup complete');
  }
}

// Create singleton instance
const screenshotService = new ScreenshotService();

// Initialize on startup
screenshotService.initialize().catch(err => {
  console.error('[ScreenshotService] Initialization error:', err);
});

module.exports = screenshotService;
