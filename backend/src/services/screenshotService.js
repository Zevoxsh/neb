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
      return `/public/screenshots/${filename}`;
    } catch (error) {
      console.error(`[ScreenshotService] Error capturing ${hostname}:`, error.message);
      return null;
    }
  }

  downloadScreenshot(url, filepath) {
    return new Promise((resolve, reject) => {
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
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(filepath, () => {}); // Delete partial file
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Screenshot download timeout'));
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
