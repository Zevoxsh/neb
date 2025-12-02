const cacheManager = require('../services/cacheManager');

/**
 * HTTP Cache Middleware
 * Caches GET responses based on URL and headers
 */

function cacheMiddleware(options = {}) {
  const defaultTTL = options.defaultTTL || 300; // 5 minutes
  const enabled = options.enabled !== false;

  return async (req, res, next) => {
    // Skip if caching disabled
    if (!enabled || req.method !== 'GET') {
      return next();
    }

    // Generate cache key
    const cacheKey = cacheManager.generateCacheKey(req);

    try {
      // Try to get from cache
      const cached = await cacheManager.get(cacheKey);

      if (cached) {
        // Cache hit - send cached response
        res.set(cached.headers);
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        res.set('X-Cached-At', new Date(cached.cachedAt).toISOString());
        return res.status(cached.statusCode).send(cached.body);
      }

      // Cache miss - continue to handler
      res.set('X-Cache', 'MISS');

      // Intercept response
      const originalSend = res.send;
      const originalJson = res.json;

      // Store original response for caching
      res.send = function(body) {
        // Cache the response if eligible
        if (cacheManager.isCacheable(req, res)) {
          const ttl = cacheManager.getTTLFromHeaders(res, defaultTTL);

          cacheManager.set(cacheKey, {
            statusCode: res.statusCode,
            headers: res.getHeaders(),
            body: body
          }, ttl).catch(err => {
            console.error('[CacheMiddleware] Failed to cache response:', err);
          });
        }

        return originalSend.call(this, body);
      };

      res.json = function(obj) {
        // Cache the response if eligible
        if (cacheManager.isCacheable(req, res)) {
          const ttl = cacheManager.getTTLFromHeaders(res, defaultTTL);

          cacheManager.set(cacheKey, {
            statusCode: res.statusCode,
            headers: res.getHeaders(),
            body: obj
          }, ttl).catch(err => {
            console.error('[CacheMiddleware] Failed to cache response:', err);
          });
        }

        return originalJson.call(this, obj);
      };

      next();
    } catch (error) {
      console.error('[CacheMiddleware] Error:', error);
      next();
    }
  };
}

/**
 * Cache invalidation endpoint
 */
function createCacheRoutes(router) {
  const express = require('express');
  const { authenticateToken } = require('./auth');
  const { asyncHandler } = require('./errorHandler');

  if (!router) {
    router = express.Router();
  }

  // Get cache stats
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
    res.json({ message: `Invalidated ${count} cache entries`, pattern, count });
  }));

  // Clear all cache
  router.post('/api/cache/clear', authenticateToken, asyncHandler(async (req, res) => {
    const count = await cacheManager.clear();
    res.json({ message: `Cleared ${count} cache entries`, count });
  }));

  return router;
}

module.exports = { cacheMiddleware, createCacheRoutes };
