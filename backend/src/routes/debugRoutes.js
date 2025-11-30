const express = require('express');
const router = express.Router();
const proxyManager = require('../services/proxyManager');

// Returns current backend failure states (for debugging)
router.get('/api/debug/backends', (req, res) => {
  try {
    const out = [];
    try {
      const map = proxyManager && proxyManager.backendFailures ? proxyManager.backendFailures : null;
      if (map && typeof map.entries === 'function') {
        for (const [target, info] of map.entries()) {
          out.push({ target, downUntil: info.downUntil ? new Date(info.downUntil).toISOString() : null, count: info.count || 0 });
        }
      }
    } catch (e) { }
    return res.json({ ok: true, backends: out });
  } catch (e) {
    return res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
