const express = require('express');
const router = express.Router();
const domainController = require('../controllers/domainController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/domains', authenticateToken, domainController.list);
router.post('/api/domains', authenticateToken, domainController.create);
router.post('/api/domains/create-complete', authenticateToken, domainController.createComplete);
router.put('/api/domains/:id', authenticateToken, domainController.update);
router.delete('/api/domains/:id', authenticateToken, domainController.remove);
router.get('/api/proxies/:id/mappings', authenticateToken, domainController.listForProxy);

// Screenshot routes
router.get('/api/domains/:id/screenshot', authenticateToken, domainController.getScreenshot);
router.post('/api/domains/:id/screenshot/refresh', authenticateToken, domainController.refreshScreenshot);

// Manual refresh for all screenshots
router.post('/api/screenshots/refresh-all', authenticateToken, domainController.refreshAllScreenshots);

// Internal (localhost only) endpoint to refresh a domain screenshot without auth
router.post('/internal/domains/:id/screenshot/refresh', async (req, res) => {
  // Allow only requests from localhost (accept various address formats)
  const remote = req.ip || req.connection && req.connection.remoteAddress || req.socket && req.socket.remoteAddress || '';
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const addr = forwarded || remote || '';
  const isLocal = addr === '127.0.0.1' || addr === '::1' || addr.startsWith('::ffff:127.0.0.1') || addr === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const screenshotService = require('../services/screenshotService');
    const domainModel = require('../models/domainModel');

    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const domains = await domainModel.listDomainMappings();
    const domain = domains.find(d => d.id === id);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });

    const method = req.body && req.body.method ? String(req.body.method) : 'local';
    const pathResult = await screenshotService.refreshScreenshot(domain.hostname, id, { method });
    if (pathResult) return res.json({ path: pathResult });
    return res.status(503).json({ error: 'Screenshot service unavailable' });
  } catch (err) {
    console.error('[internal refresh route] error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Debug route to test screenshot access
router.get('/api/domains/test-screenshot/:id', authenticateToken, (req, res) => {
  const screenshotService = require('../services/screenshotService');
  const path = require('path');
  const fs = require('fs');

  const id = parseInt(req.params.id, 10);
  const filename = `domain-${id}.png`;
  const filepath = path.join(screenshotService.screenshotsDir, filename);

  res.json({
    filename,
    filepath,
    exists: fs.existsSync(filepath),
    accessibleAt: `/public/screenshots/${filename}`,
    screenshotsDir: screenshotService.screenshotsDir
  });
});

module.exports = router;
