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

    console.log('[ScreenshotService] Scheduled periodic screenshots every 5 minutes. Update', this.mappingFile, 'with {"<domainId>":"<hostname>"} to enable automatic captures.');

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

      // Use external API to get screenshot
      const screenshotUrl = `${this.screenshotAPI}https://${hostname}`;

      await this.downloadScreenshot(screenshotUrl, filepath);

      console.log(`[ScreenshotService] Screenshot saved for ${hostname}`);
      console.log(`[ScreenshotService] File saved to: ${filepath}`);
      console.log(`[ScreenshotService] Accessible at: /public/screenshots/${filename}`);

      // Verify file was actually created
      if (fs.existsSync(filepath)) {
        const stats = fs.statSync(filepath);
        console.log(`[ScreenshotService] File size: ${stats.size} bytes`);
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
      console.log(`[ScreenshotService] Downloading from: ${url}`);
      console.log(`[ScreenshotService] Saving to: ${filepath}`);

      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        console.log(`[ScreenshotService] Response status: ${response.statusCode}`);

        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          console.log(`[ScreenshotService] Redirecting to: ${response.headers.location}`);
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
          console.log(`[ScreenshotService] Download complete: ${downloadedBytes} bytes`);
          resolve();
        });

        fileStream.on('error', (err) => {
          console.error(`[ScreenshotService] File stream error:`, err);
          fs.unlink(filepath, () => {}); // Delete partial file
          reject(err);
        });
      });

      request.on('error', (err) => {
        console.error(`[ScreenshotService] Request error:`, err);
        reject(err);
      });

      request.setTimeout(30000, () => {
        console.error(`[ScreenshotService] Request timeout after 30s`);
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

  /**
   * Return screenshot as data URL (base64) so clients can embed it
   * and avoid performing an additional HTTP request that may trigger
   * bot protection on intermediate proxies.
   */
  getScreenshotData(domainId) {
    const filename = `domain-${domainId}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    if (!fs.existsSync(filepath)) return null;

    try {
      const buffer = fs.readFileSync(filepath);
      const base64 = buffer.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (err) {
      console.error(`[ScreenshotService] Error reading screenshot for ${domainId}:`, err.message);
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
          if (fs.existsSync(filepath)) return resolve(`/public/screenshots/${filename}`);
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
        if (stdout && stdout.trim()) console.log('[ScreenshotService] captureWithChromeCli stdout:', stdout.trim());
        if (stderr && stderr.trim()) console.warn('[ScreenshotService] captureWithChromeCli stderr:', stderr.trim());
        if (code !== 0) {
          return reject(new Error(`Chrome exited with code ${code}: ${stderr}`));
        }
        // Ensure file was created
        setTimeout(() => {
          if (fs.existsSync(filepath)) return resolve(`/public/screenshots/${filename}`);
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
