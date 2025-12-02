const express = require('express');
const router = express.Router();
const websocketProxy = require('../services/websocketProxy');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * WebSocket Management Routes
 */

// Get WebSocket connection statistics
router.get('/api/websocket/stats', authenticateToken, asyncHandler(async (req, res) => {
  const stats = websocketProxy.getStats();
  res.json(stats);
}));

// Close all WebSocket connections (emergency use)
router.post('/api/websocket/close-all', authenticateToken, asyncHandler(async (req, res) => {
  const countBefore = websocketProxy.getStats().activeConnections;
  websocketProxy.closeAll();
  res.json({
    message: 'All WebSocket connections closed',
    connectionsClosed: countBefore
  });
}));

module.exports = router;
