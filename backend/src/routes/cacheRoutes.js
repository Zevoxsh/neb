const express = require('express');
const router = express.Router();
const cacheManager = require('../services/cacheManager');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Cache Management Routes
 */

// Get cache statistics
router.get('/api/cache/stats', authenticateToken, asyncHandler(async (req, res) => {
  const stats = await cacheManager.getStats();
  res.json(stats);
}));

// Invalidate cache by pattern
router.post('/api/cache/invalidate', authenticateToken, asyncHandler(async (req, res) => {
  const { pattern } = req.body;

  if (!pattern) {
    return res.status(400).json({ error: 'Pattern is required' });
  }

  const count = await cacheManager.invalidate(pattern);
  res.json({
    message: `Invalidated ${count} cache entries`,
    pattern,
    count
  });
}));

// Clear all cache
router.post('/api/cache/clear', authenticateToken, asyncHandler(async (req, res) => {
  const count = await cacheManager.clear();
  res.json({
    message: `Cleared ${count} cache entries`,
    count
  });
}));

module.exports = router;
