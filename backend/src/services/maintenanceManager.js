const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const logger = createLogger('MaintenanceManager');

// Directory where custom maintenance pages are stored
const MAINTENANCE_DIR = process.env.MAINTENANCE_DIR || path.join(__dirname, '..', '..', 'public', 'maintenance');
const DEFAULT_MAINTENANCE_PAGE = path.join(__dirname, '..', '..', 'public', 'maintenance', 'default.html');

// Ensure maintenance directory exists
function ensureMaintenanceDir() {
  if (!fs.existsSync(MAINTENANCE_DIR)) {
    try {
      fs.mkdirSync(MAINTENANCE_DIR, { recursive: true });
      logger.info('Created maintenance directory', { path: MAINTENANCE_DIR });
    } catch (error) {
      logger.error('Failed to create maintenance directory', { error: error.message });
    }
  }
}

/**
 * Save a custom maintenance page for a domain
 * @param {string} domain - Domain name
 * @param {string} htmlContent - HTML content of the maintenance page
 * @returns {string} - Path to the saved file
 */
function saveMaintenancePage(domain, htmlContent) {
  ensureMaintenanceDir();

  const sanitizedDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
  const filePath = path.join(MAINTENANCE_DIR, `${sanitizedDomain}.html`);

  try {
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    logger.info('Saved maintenance page', { domain, path: filePath });
    return filePath;
  } catch (error) {
    logger.error('Failed to save maintenance page', { domain, error: error.message });
    throw new Error(`Failed to save maintenance page: ${error.message}`);
  }
}

/**
 * Get the maintenance page content for a domain
 * @param {string} domain - Domain name
 * @param {string} customPath - Optional custom path to maintenance page
 * @returns {string|null} - HTML content or null if not found
 */
function getMaintenancePage(domain, customPath = null) {
  let filePath;

  // If custom path is provided, use it (relative to MAINTENANCE_DIR)
  if (customPath) {
    filePath = path.join(MAINTENANCE_DIR, customPath);
  } else {
    // Otherwise, look for domain-specific file
    const sanitizedDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
    filePath = path.join(MAINTENANCE_DIR, `${sanitizedDomain}.html`);
  }

  // Check if custom page exists
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      logger.debug('Loaded custom maintenance page', { domain, path: filePath });
      return content;
    } catch (error) {
      logger.error('Failed to read custom maintenance page', { domain, error: error.message });
    }
  }

  // Fall back to default maintenance page
  if (fs.existsSync(DEFAULT_MAINTENANCE_PAGE)) {
    try {
      const content = fs.readFileSync(DEFAULT_MAINTENANCE_PAGE, 'utf8');
      logger.debug('Loaded default maintenance page', { domain });
      return content;
    } catch (error) {
      logger.error('Failed to read default maintenance page', { error: error.message });
    }
  }

  // If no page is found, return a basic HTML
  logger.warn('No maintenance page found, returning basic HTML', { domain });
  return getBasicMaintenancePage();
}

/**
 * Delete a custom maintenance page for a domain
 * @param {string} domain - Domain name
 * @returns {boolean} - Success status
 */
function deleteMaintenancePage(domain) {
  const sanitizedDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
  const filePath = path.join(MAINTENANCE_DIR, `${sanitizedDomain}.html`);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.info('Deleted maintenance page', { domain });
      return true;
    } catch (error) {
      logger.error('Failed to delete maintenance page', { domain, error: error.message });
      return false;
    }
  }

  return false;
}

/**
 * Check if a custom maintenance page exists for a domain
 * @param {string} domain - Domain name
 * @returns {boolean} - True if exists
 */
function hasCustomMaintenancePage(domain) {
  const sanitizedDomain = domain.replace(/[^a-z0-9.-]/gi, '_');
  const filePath = path.join(MAINTENANCE_DIR, `${sanitizedDomain}.html`);
  return fs.existsSync(filePath);
}

/**
 * List all custom maintenance pages
 * @returns {Array} - List of domains with custom pages
 */
function listCustomMaintenancePages() {
  ensureMaintenanceDir();

  try {
    const files = fs.readdirSync(MAINTENANCE_DIR);
    return files
      .filter(f => f.endsWith('.html') && f !== 'default.html')
      .map(f => f.replace('.html', ''));
  } catch (error) {
    logger.error('Failed to list maintenance pages', { error: error.message });
    return [];
  }
}

/**
 * Get a basic maintenance page HTML
 * @returns {string} - Basic HTML content
 */
function getBasicMaintenancePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Site Under Maintenance</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            text-align: center;
            max-width: 600px;
        }
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        p {
            font-size: 1.2rem;
            line-height: 1.6;
            margin-bottom: 2rem;
            opacity: 0.9;
        }
        .icon {
            font-size: 5rem;
            margin-bottom: 2rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔧</div>
        <h1>Under Maintenance</h1>
        <p>We're currently performing scheduled maintenance to improve your experience. We'll be back shortly!</p>
        <p>Thank you for your patience.</p>
    </div>
</body>
</html>`;
}

// Initialize on module load
ensureMaintenanceDir();

module.exports = {
  saveMaintenancePage,
  getMaintenancePage,
  deleteMaintenancePage,
  hasCustomMaintenancePage,
  listCustomMaintenancePages,
  getBasicMaintenancePage,
  MAINTENANCE_DIR
};
