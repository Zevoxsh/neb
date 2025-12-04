const express = require('express');
const router = express.Router();
const domainController = require('../controllers/domainController');
const { authenticateToken } = require('../middleware/auth');

router.get('/api/domains', authenticateToken, domainController.list);
router.post('/api/domains', authenticateToken, domainController.create);
router.put('/api/domains/:id', authenticateToken, domainController.update);
router.delete('/api/domains/:id', authenticateToken, domainController.remove);
router.get('/api/proxies/:id/mappings', authenticateToken, domainController.listForProxy);

// Screenshot routes
router.get('/api/domains/:id/screenshot', authenticateToken, domainController.getScreenshot);
router.post('/api/domains/:id/screenshot/refresh', authenticateToken, domainController.refreshScreenshot);

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
