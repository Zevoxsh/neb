const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/authRoutes');
const proxyRoutes = require('./routes/proxyRoutes');
const backendRoutes = require('./routes/backendRoutes');
const domainRoutes = require('./routes/domainRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const certRoutes = require('./routes/certRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const securityRoutes = require('./routes/securityRoutes');
const backupRoutes = require('./routes/backupRoutes');
const botChallengeRoutes = require('./routes/botChallengeRoutes');
const { botChallengeMiddleware } = require('./middleware/botChallenge');
const debugRoutes = require('./routes/debugRoutes');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  // Bot protection middleware (must be before routes)
  app.use(botChallengeMiddleware);

  // Simple request logger middleware for debugging
  app.use((req, res, next) => {
    try {
      const info = {
        method: req.method,
        originalUrl: req.originalUrl,
        path: req.path,
        ip: req.ip,
        hasBody: !!(req.body && Object.keys(req.body).length),
        cookies: req.cookies && Object.keys(req.cookies).length ? Object.keys(req.cookies) : []
      };
      if (req.method === 'GET') console.log('[REQ]', info.method, info.originalUrl, 'ip=', info.ip);
      else console.log('[REQ]', info.method, info.originalUrl, 'ip=', info.ip, 'hasBody=', info.hasBody, 'cookies=', info.cookies);
    } catch (e) { /* ignore logging errors */ }
    next();
  });



  // Static files middleware - CRITICAL for serving app.js and styles.css
  app.use('/public', express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

  // Serve favicon if browser requests it (serve the public image if present)
  const faviconPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'image.png');
  app.get('/favicon.ico', (req, res) => {
    if (fs.existsSync(faviconPath)) return res.sendFile(faviconPath);
    return res.sendStatus(204);
  });

  // API Routes
  app.use(authRoutes);
  app.use(proxyRoutes);
  app.use(backendRoutes);
  app.use(domainRoutes);
  app.use(metricsRoutes);
  app.use(certRoutes);
  app.use(settingsRoutes);
  app.use(securityRoutes);
  app.use(backupRoutes);
  app.use(botChallengeRoutes);
  app.use(debugRoutes);

  // Simple profile route
  app.get('/profile', (req, res) => {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ ok: true });
  });

  // Serve specific HTML pages (multi-page frontend)
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html')));
  app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html')));
  app.get('/proxies.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'proxies.html')));
  app.get('/backends.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'backends.html')));
  app.get('/domains.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'domains.html')));
  app.get('/security.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'security.html')));
  app.get('/certificates.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'certificates.html')));
  app.get('/settings.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'settings.html')));
  app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'login.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'login.html')));
  app.get('/domain.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'domain.html')));
  app.get('/backend.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'backend.html')));

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
