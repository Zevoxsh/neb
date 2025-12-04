#!/usr/bin/env node
/**
 * Script to refresh all domain screenshots
 * Usage: node backend/scripts/refresh-screenshots.js
 */

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function refreshAllScreenshots() {
  console.log('[RefreshScreenshots] Starting screenshot refresh...');

  // Remove all existing screenshots to force regeneration with new local method
  const screenshotsDir = path.join(__dirname, '../../frontend/public/screenshots');

  if (fs.existsSync(screenshotsDir)) {
    console.log('[RefreshScreenshots] Removing old screenshots from:', screenshotsDir);
    const files = fs.readdirSync(screenshotsDir);
    let deletedCount = 0;

    for (const file of files) {
      if (file.endsWith('.png')) {
        try {
          fs.unlinkSync(path.join(screenshotsDir, file));
          deletedCount++;
        } catch (err) {
          console.error(`[RefreshScreenshots] Failed to delete ${file}:`, err.message);
        }
      }
    }

    console.log(`[RefreshScreenshots] Deleted ${deletedCount} old screenshot(s)`);
  } else {
    console.log('[RefreshScreenshots] Screenshots directory does not exist yet');
  }

  // Import screenshotService to trigger refresh
  const screenshotService = require('../src/services/screenshotService');

  try {
    console.log('[RefreshScreenshots] Triggering screenshot refresh for all domains...');
    const results = await screenshotService.refreshAll(3); // 3 concurrent captures

    console.log('\n[RefreshScreenshots] Refresh complete!');
    console.log('Total domains:', results.length);
    console.log('Successful:', results.filter(r => r.path && !r.error).length);
    console.log('Failed:', results.filter(r => r.error).length);

    if (results.filter(r => r.error).length > 0) {
      console.log('\nFailed domains:');
      results.filter(r => r.error).forEach(r => {
        console.log(`  - ${r.hostname}: ${r.error}`);
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('[RefreshScreenshots] Error:', err.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  refreshAllScreenshots();
}

module.exports = refreshAllScreenshots;
