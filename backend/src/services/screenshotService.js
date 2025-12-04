/**
 * Screenshot Service
 * Takes screenshots of domains for preview cards using Puppeteer
 */

const fs = require('fs');
const path = require('path');

class ScreenshotService {
  constructor() {
    this.screenshotsDir = path.join(__dirname, '../../public/screenshots');
    this.browser = null;
    this.isInitialized = false;
    this.puppeteer = null;

    // Create screenshots directory if it doesn't exist
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Try to load puppeteer
      this.puppeteer = require('puppeteer');

      // Launch browser with optimized settings
      this.browser = await this.puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });

      this.isInitialized = true;
      console.log('[ScreenshotService] Puppeteer initialized successfully');
    } catch (error) {
      console.warn('[ScreenshotService] Puppeteer not available:', error.message);
      console.warn('[ScreenshotService] Screenshots will not be available. Install with: npm install puppeteer');
      this.isInitialized = false;
    }
  }

  async captureScreenshot(hostname, domainId) {
    if (!this.isInitialized || !this.browser) {
      console.log(`[ScreenshotService] Service not initialized for ${hostname}`);
      return null;
    }

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

    let page = null;
    try {
      console.log(`[ScreenshotService] Capturing screenshot for ${hostname}`);

      page = await this.browser.newPage();

      // Set viewport for consistent screenshots
      await page.setViewport({
        width: 1280,
        height: 800,
        deviceScaleFactor: 1
      });

      // Set timeout and navigate
      await page.goto(`https://${hostname}`, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });

      // Wait a bit for dynamic content
      await page.waitForTimeout(1000);

      // Take screenshot
      await page.screenshot({
        path: filepath,
        type: 'png',
        fullPage: false
      });

      console.log(`[ScreenshotService] Screenshot saved for ${hostname}`);
      return `/public/screenshots/${filename}`;
    } catch (error) {
      console.error(`[ScreenshotService] Error capturing ${hostname}:`, error.message);

      // If screenshot failed, try to create a placeholder
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      return null;
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
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
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('[ScreenshotService] Browser closed');
      } catch (error) {
        console.error('[ScreenshotService] Error closing browser:', error.message);
      }
    }
  }
}

// Create singleton instance
const screenshotService = new ScreenshotService();

// Initialize on startup
screenshotService.initialize().catch(err => {
  console.error('[ScreenshotService] Initialization error:', err);
});

// Cleanup on process exit
process.on('SIGINT', async () => {
  await screenshotService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await screenshotService.cleanup();
  process.exit(0);
});

module.exports = screenshotService;
