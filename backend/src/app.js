const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const proxyRoutes = require('./routes/proxyRoutes');
const backendRoutes = require('./routes/backendRoutes');
const domainRoutes = require('./routes/domainRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const certRoutes = require('./routes/certRoutes');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());



  // Static files middleware - CRITICAL for serving app.js and styles.css
  app.use('/public', express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

  // Serve favicon if browser requests it (avoid 404 noise)
  app.get('/favicon.ico', (req, res) => res.sendStatus(204));

  // API Routes
  app.use(authRoutes);
  app.use(proxyRoutes);
  app.use(backendRoutes);
  app.use(domainRoutes);
  app.use(metricsRoutes);
  app.use(certRoutes);

  // Simple profile route
  app.get('/profile', (req, res) => {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ ok: true });
  });

  // Serve specific HTML pages
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'index.html')));
  app.get('/add.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'add.html')));
  app.get('/backends.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'backends.html')));
  app.get('/domains.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'domains.html')));
  app.get('/metrics.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'metrics.html')));
  app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'login.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'login.html')));

  // SPA Fallback: Serve index.html for any other route
  app.get('*', (req, res) => {
    // Don't serve index.html for API requests that 404
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'index.html'));
  });

  return app;
}

module.exports = createApp;
