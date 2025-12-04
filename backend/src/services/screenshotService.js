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
    // Delete existing screenshot to force refresh
    await this.deleteScreenshot(domainId);
    // Capture new screenshot
    return await this.captureScreenshot(hostname, domainId);
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
