const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const installRoutes = require('./routes/installRoutes');
const authRoutes = require('./routes/authRoutes');
const proxyRoutes = require('./routes/proxyRoutes');
const backendRoutes = require('./routes/backendRoutes');
const backendPoolRoutes = require('./routes/backendPoolRoutes');
const domainRoutes = require('./routes/domainRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const certRoutes = require('./routes/certRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const configRoutes = require('./routes/configRoutes');
const systemRoutes = require('./routes/systemRoutes');
const securityRoutes = require('./routes/securityRoutes');
const backupRoutes = require('./routes/backupRoutes');
const botChallengeRoutes = require('./routes/botChallengeRoutes');
const requestLogsRoutes = require('./routes/requestLogsRoutes');
const alertRoutes = require('./routes/alertRoutes');
const cacheRoutes = require('./routes/cacheRoutes');
const websocketRoutes = require('./routes/websocketRoutes');
const twoFactorRoutes = require('./routes/twoFactorRoutes');
const ddosRoutes = require('./routes/ddosRoutes');
const { botChallengeMiddleware } = require('./middleware/botChallenge');
const { cacheMiddleware } = require('./middleware/cacheMiddleware');
const { ddosProtectionMiddleware } = require('./middleware/ddosMiddleware');
const debugRoutes = require('./routes/debugRoutes');

function createApp() {
  const app = express();

  // Security Headers (must be first)
  app.use((req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https://flagsapi.com; " +
      "connect-src 'self' https://ipapi.co; " +
      "font-src 'self' https://fonts.gstatic.com;"
    );

    // Additional security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Remove X-Powered-By header
    res.removeHeader('X-Powered-By');

    next();
  });

  // CORS Configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  if (allowedOrigins.length > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }

      // Handle preflight
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }

      next();
    });
  }

  // HTTP Compression (reduces response sizes by 60-80%)
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,  // Compression level (0-9, 6 is good balance)
    threshold: 1024  // Only compress responses > 1KB
  }));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  // DDoS protection middleware (must be early in chain)
  app.use(ddosProtectionMiddleware);

  // Bot protection middleware (must be before routes)
  app.use(botChallengeMiddleware);

  // HTTP Cache middleware (optional - can be selective per route)
  // Uncomment to enable global caching:
  // app.use(cacheMiddleware({ defaultTTL: 300, enabled: process.env.HTTP_CACHE_ENABLED !== 'false' }));

  // Static files middleware - CRITICAL for serving app.js and styles.css
  app.use('/public', express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

  // Serve favicon if browser requests it (serve the public image if present)
  const faviconPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'image.png');
  app.get('/favicon.ico', (req, res) => {
    if (fs.existsSync(faviconPath)) return res.sendFile(faviconPath);
    return res.sendStatus(204);
  });

  // API Routes
  app.use('/api/install', installRoutes);
  app.use(authRoutes);
  app.use(proxyRoutes);
  app.use(backendRoutes);
  app.use('/api/backend-pools', backendPoolRoutes);
  app.use(domainRoutes);
  app.use(metricsRoutes);
  app.use(certRoutes);
  app.use(settingsRoutes);
  app.use(configRoutes);
  app.use(systemRoutes);
  app.use(securityRoutes);
  app.use(backupRoutes);
  app.use(botChallengeRoutes);
  app.use(requestLogsRoutes);
  app.use(alertRoutes);
  app.use(cacheRoutes);
  app.use(websocketRoutes);
  app.use(twoFactorRoutes);
  app.use(ddosRoutes);
  app.use(debugRoutes);

  // Simple profile route
  app.get('/profile', (req, res) => {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ ok: true });
  });

  // Define all HTML pages mapping (clean URLs without .html)
  const pages = {
    '/': 'dashboard.html',
    '/dashboard': 'dashboard.html',
    '/proxies': 'proxies.html',
    '/backends': 'backends.html',
    '/domains': 'domains.html',
    '/security': 'security.html',
    '/analytics': 'analytics.html',
    '/certificates': 'certificates.html',
    '/settings': 'settings.html',
    '/config': 'config.html',
    '/login': 'login.html',
    '/domain': 'domain.html',
    '/backend': 'backend.html',
    '/requests': 'requests.html',
    '/alerts': 'alerts.html'
  };

  // Middleware to block access to /install if already installed
  const blockInstallIfCompleted = (req, res, next) => {
    const fs = require('fs');
    const envPath = path.join(__dirname, '../../.env');
    
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const isInstalled = envContent.includes('DB_HOST') && 
                         envContent.includes('DB_NAME') &&
                         envContent.includes('JWT_SECRET');
      
      if (isInstalled) {
        // Installation already completed, redirect to dashboard
        return res.redirect('/dashboard');
      }
    } catch (error) {
      // .env doesn't exist, installation not completed
    }
    
    next();
  };

  // Serve pages with and without .html extension
  Object.entries(pages).forEach(([route, file]) => {
    const filePath = path.join(__dirname, '..', '..', 'frontend', 'public', file);
    
    // Clean URL (without .html)
    app.get(route, (req, res) => res.sendFile(filePath));
    
    // Legacy URL (with .html) - redirect to clean URL
    if (route !== '/') {
      app.get(route + '.html', (req, res) => res.redirect(301, route));
    }
  });

  // Special route for /install with protection
  const installPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'install.html');
  app.get('/install', blockInstallIfCompleted, (req, res) => res.sendFile(installPath));
  app.get('/install.html', blockInstallIfCompleted, (req, res) => res.redirect(301, '/install'));

  // SPA Fallback: serve the correct top-level page for known client routes so
  // direct links / refresh on deep routes work (e.g. /proxies/3 -> proxies.html)
  app.get('*', (req, res) => {
    // Don't serve dashboard for API requests that 404
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }

    // If the request targets a specific proxy detail (e.g. /proxies/3), serve the dedicated proxy page
    if (/^\/proxies\/\d+$/.test(req.path)) {
      return res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'proxy.html'));
    }

    // Map URL prefixes to page files
    const prefixMap = [
      { prefix: '/proxies', file: 'proxies.html' },
      { prefix: '/backends', file: 'backends.html' },
      { prefix: '/domains', file: 'domains.html' },
      { prefix: '/security', file: 'security.html' },
      { prefix: '/analytics', file: 'analytics.html' },
      { prefix: '/certificates', file: 'certificates.html' },
      { prefix: '/settings', file: 'settings.html' },
      { prefix: '/login', file: 'login.html' }
    ];

    for (const m of prefixMap) {
      if (req.path === m.prefix || req.path.startsWith(m.prefix + '/')) {
        return res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', m.file));
      }
    }

    // Default to dashboard
    res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html'));
  });

  return app;
}

module.exports = createApp;
