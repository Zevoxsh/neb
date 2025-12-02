const express = require('express');
const router = express.Router();
const backendPoolModel = require('../models/backendPoolModel');
const healthChecker = require('../services/healthChecker');
const loadBalancer = require('../services/loadBalancer');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/backend-pools
 * List all backend pools with member count
 */
router.get('/', asyncHandler(async (req, res) => {
  const pools = await backendPoolModel.listBackendPools();
  res.json(pools);
}));

/**
 * GET /api/backend-pools/:id
 * Get a specific backend pool with all members
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const pool = await backendPoolModel.getBackendPoolWithMembers(parseInt(req.params.id));
  if (!pool) {
    return res.status(404).json({ error: 'Backend pool not found' });
  }
  res.json(pool);
}));

/**
 * POST /api/backend-pools
 * Create a new backend pool
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name, lbAlgorithm, healthCheckEnabled, healthCheckIntervalMs,
          healthCheckPath, healthCheckTimeoutMs, maxFailures, failureTimeoutMs, stickySessions } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Pool name is required' });
  }

  // Validate lb_algorithm
  const validAlgorithms = ['round-robin', 'least-connections', 'weighted', 'ip-hash'];
  if (lbAlgorithm && !validAlgorithms.includes(lbAlgorithm)) {
    return res.status(400).json({
      error: `Invalid load balancing algorithm. Must be one of: ${validAlgorithms.join(', ')}`
    });
  }

  const pool = await backendPoolModel.createBackendPool({
    name,
    lbAlgorithm: lbAlgorithm || 'round-robin',
    healthCheckEnabled: healthCheckEnabled !== false,
    healthCheckIntervalMs: healthCheckIntervalMs || 30000,
    healthCheckPath: healthCheckPath || '/',
    healthCheckTimeoutMs: healthCheckTimeoutMs || 2000,
    maxFailures: maxFailures || 3,
    failureTimeoutMs: failureTimeoutMs || 60000,
    stickySessions: stickySessions || false
  });

  // Start health checks if enabled
  if (pool.health_check_enabled) {
    await healthChecker.startHealthCheck(pool.id);
  }

  res.status(201).json(pool);
}));

/**
 * PUT /api/backend-pools/:id
 * Update a backend pool
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);
  const { name, lbAlgorithm, healthCheckEnabled, healthCheckIntervalMs,
          healthCheckPath, healthCheckTimeoutMs, maxFailures, failureTimeoutMs, stickySessions } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Pool name is required' });
  }

  // Validate lb_algorithm
  const validAlgorithms = ['round-robin', 'least-connections', 'weighted', 'ip-hash'];
  if (lbAlgorithm && !validAlgorithms.includes(lbAlgorithm)) {
    return res.status(400).json({
      error: `Invalid load balancing algorithm. Must be one of: ${validAlgorithms.join(', ')}`
    });
  }

  const pool = await backendPoolModel.updateBackendPool(poolId, {
    name,
    lbAlgorithm: lbAlgorithm || 'round-robin',
    healthCheckEnabled: healthCheckEnabled !== false,
    healthCheckIntervalMs: healthCheckIntervalMs || 30000,
    healthCheckPath: healthCheckPath || '/',
    healthCheckTimeoutMs: healthCheckTimeoutMs || 2000,
    maxFailures: maxFailures || 3,
    failureTimeoutMs: failureTimeoutMs || 60000,
    stickySessions: stickySessions || false
  });

  if (!pool) {
    return res.status(404).json({ error: 'Backend pool not found' });
  }

  // Reset load balancer state for this pool
  loadBalancer.resetPoolState(poolId);

  // Restart health checks
  healthChecker.stopHealthCheck(poolId);
  if (pool.health_check_enabled) {
    await healthChecker.startHealthCheck(poolId);
  }

  res.json(pool);
}));

/**
 * DELETE /api/backend-pools/:id
 * Delete a backend pool
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);

  // Stop health checks
  healthChecker.stopHealthCheck(poolId);

  // Reset load balancer state
  loadBalancer.resetPoolState(poolId);

  // Delete pool
  await backendPoolModel.deleteBackendPool(poolId);

  res.json({ message: 'Backend pool deleted successfully' });
}));

/**
 * POST /api/backend-pools/:id/members
 * Add a backend to a pool
 */
router.post('/:id/members', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);
  const { backendId, enabled, priority } = req.body;

  if (!backendId) {
    return res.status(400).json({ error: 'Backend ID is required' });
  }

  const member = await backendPoolModel.addBackendToPool(poolId, backendId, {
    enabled: enabled !== false,
    priority: priority || 100
  });

  // Reset load balancer state
  loadBalancer.resetPoolState(poolId);

  res.status(201).json(member);
}));

/**
 * DELETE /api/backend-pools/:id/members/:backendId
 * Remove a backend from a pool
 */
router.delete('/:id/members/:backendId', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);
  const backendId = parseInt(req.params.backendId);

  await backendPoolModel.removeBackendFromPool(poolId, backendId);

  // Reset load balancer state
  loadBalancer.resetPoolState(poolId);

  res.json({ message: 'Backend removed from pool successfully' });
}));

/**
 * PUT /api/backend-pools/:id/members/:backendId
 * Update backend pool membership settings
 */
router.put('/:id/members/:backendId', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);
  const backendId = parseInt(req.params.backendId);
  const { enabled, priority } = req.body;

  const member = await backendPoolModel.updateBackendPoolMember(poolId, backendId, {
    enabled: enabled !== false,
    priority: priority || 100
  });

  if (!member) {
    return res.status(404).json({ error: 'Pool member not found' });
  }

  // Reset load balancer state
  loadBalancer.resetPoolState(poolId);

  res.json(member);
}));

/**
 * POST /api/backend-pools/:id/health-check
 * Manually trigger a health check for a pool
 */
router.post('/:id/health-check', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);

  await healthChecker.checkPoolHealth(poolId);

  res.json({ message: 'Health check triggered' });
}));

/**
 * GET /api/backend-pools/:id/select
 * Test backend selection (debugging endpoint)
 */
router.get('/:id/select', asyncHandler(async (req, res) => {
  const poolId = parseInt(req.params.id);
  const clientIp = req.query.clientIp || req.ip;

  const backend = await loadBalancer.selectBackend(poolId, clientIp);

  if (!backend) {
    return res.status(503).json({ error: 'No healthy backends available' });
  }

  res.json({
    message: 'Backend selected successfully',
    backend: {
      id: backend.id,
      name: backend.name,
      host: backend.target_host,
      port: backend.target_port,
      protocol: backend.target_protocol,
      activeConnections: backend.active_connections,
      healthStatus: backend.health_status
    }
  });
}));

module.exports = router;
