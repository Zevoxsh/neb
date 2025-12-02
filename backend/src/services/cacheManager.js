const { getRedisClient, isRedisConnected } = require('../config/redis');
const crypto = require('crypto');

/**
 * Cache Manager Service
 * Provides distributed caching with Redis
 * Falls back to in-memory cache if Redis is unavailable
 */

class CacheManager {
  constructor() {
    // Fallback in-memory cache (used when Redis is unavailable)
    this.memoryCache = new Map();
    this.memoryTTL = new Map();

    // Start cleanup interval for in-memory cache
    this.cleanupInterval = setInterval(() => {
      this.cleanupMemoryCache();
    }, 60000); // Every minute
  }

  /**
   * Generate cache key from URL and headers
   */
  generateCacheKey(req) {
    const url = req.originalUrl || req.url;
    const method = req.method;

    // Include Vary headers in cache key
    const varyHeaders = {};
    const vary = req.get('Vary');
    if (vary) {
      vary.split(',').forEach(header => {
        const headerName = header.trim().toLowerCase();
        varyHeaders[headerName] = req.get(headerName);
      });
    }

    const keyData = {
      method,
      url,
      vary: varyHeaders
    };

    const keyString = JSON.stringify(keyData);
    return crypto.createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * Get cached response
   */
  async get(key) {
    // Try Redis first
    if (isRedisConnected()) {
      try {
        const client = getRedisClient();
        const cached = await client.get(`cache:${key}`);
        if (cached) {
          console.log(`[Cache] HIT (Redis): ${key}`);
          return JSON.parse(cached);
        }
      } catch (error) {
        console.error('[Cache] Redis GET error:', error.message);
      }
    }

    // Fallback to memory cache
    if (this.memoryCache.has(key)) {
      const ttl = this.memoryTTL.get(key);
      if (!ttl || ttl > Date.now()) {
        console.log(`[Cache] HIT (Memory): ${key}`);
        return this.memoryCache.get(key);
      } else {
        // Expired
        this.memoryCache.delete(key);
        this.memoryTTL.delete(key);
      }
    }

    console.log(`[Cache] MISS: ${key}`);
    return null;
  }

  /**
   * Set cached response
   */
  async set(key, value, ttlSeconds = 300) {
    const data = {
      statusCode: value.statusCode,
      headers: value.headers,
      body: value.body,
      cachedAt: Date.now()
    };

    // Store in Redis
    if (isRedisConnected()) {
      try {
        const client = getRedisClient();
        await client.setEx(`cache:${key}`, ttlSeconds, JSON.stringify(data));
        console.log(`[Cache] SET (Redis): ${key} (TTL: ${ttlSeconds}s)`);
        return true;
      } catch (error) {
        console.error('[Cache] Redis SET error:', error.message);
      }
    }

    // Fallback to memory cache
    this.memoryCache.set(key, data);
    this.memoryTTL.set(key, Date.now() + (ttlSeconds * 1000));
    console.log(`[Cache] SET (Memory): ${key} (TTL: ${ttlSeconds}s)`);
    return true;
  }

  /**
   * Invalidate cache by key or pattern
   */
  async invalidate(pattern) {
    let count = 0;

    // Invalidate in Redis
    if (isRedisConnected()) {
      try {
        const client = getRedisClient();

        if (pattern.includes('*')) {
          // Pattern matching
          const keys = await client.keys(`cache:${pattern}`);
          if (keys.length > 0) {
            await client.del(keys);
            count += keys.length;
          }
        } else {
          // Single key
          const deleted = await client.del(`cache:${pattern}`);
          count += deleted;
        }
      } catch (error) {
        console.error('[Cache] Redis invalidation error:', error.message);
      }
    }

    // Invalidate in memory cache
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      for (const key of this.memoryCache.keys()) {
        if (regex.test(key)) {
          this.memoryCache.delete(key);
          this.memoryTTL.delete(key);
          count++;
        }
      }
    } else {
      if (this.memoryCache.has(pattern)) {
        this.memoryCache.delete(pattern);
        this.memoryTTL.delete(pattern);
        count++;
      }
    }

    console.log(`[Cache] Invalidated ${count} entries for pattern: ${pattern}`);
    return count;
  }

  /**
   * Clear all cache
   */
  async clear() {
    let count = 0;

    // Clear Redis cache
    if (isRedisConnected()) {
      try {
        const client = getRedisClient();
        const keys = await client.keys('cache:*');
        if (keys.length > 0) {
          await client.del(keys);
          count += keys.length;
        }
      } catch (error) {
        console.error('[Cache] Redis clear error:', error.message);
      }
    }

    // Clear memory cache
    count += this.memoryCache.size;
    this.memoryCache.clear();
    this.memoryTTL.clear();

    console.log(`[Cache] Cleared ${count} entries`);
    return count;
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    const stats = {
      memoryCache: {
        size: this.memoryCache.size,
        keys: Array.from(this.memoryCache.keys()).slice(0, 10) // First 10 keys
      },
      redisCache: {
        connected: isRedisConnected(),
        size: 0,
        keys: []
      }
    };

    if (isRedisConnected()) {
      try {
        const client = getRedisClient();
        const keys = await client.keys('cache:*');
        stats.redisCache.size = keys.length;
        stats.redisCache.keys = keys.slice(0, 10).map(k => k.replace('cache:', ''));
      } catch (error) {
        console.error('[Cache] Stats error:', error.message);
      }
    }

    return stats;
  }

  /**
   * Cleanup expired entries from memory cache
   */
  cleanupMemoryCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, ttl] of this.memoryTTL.entries()) {
      if (ttl && ttl <= now) {
        this.memoryCache.delete(key);
        this.memoryTTL.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired memory cache entries`);
    }
  }

  /**
   * Check if response is cacheable
   */
  isCacheable(req, res) {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return false;
    }

    // Don't cache if explicitly disabled
    if (req.headers['x-no-cache'] || req.query.nocache) {
      return false;
    }

    // Check response status code (only 200)
    if (res.statusCode !== 200) {
      return false;
    }

    // Check Cache-Control header
    const cacheControl = res.getHeader('Cache-Control');
    if (cacheControl) {
      if (cacheControl.includes('no-cache') || cacheControl.includes('no-store') || cacheControl.includes('private')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse TTL from Cache-Control header
   */
  getTTLFromHeaders(res, defaultTTL = 300) {
    const cacheControl = res.getHeader('Cache-Control');
    if (cacheControl) {
      const match = /max-age=(\d+)/.exec(cacheControl);
      if (match) {
        return parseInt(match[1]);
      }
    }
    return defaultTTL;
  }

  /**
   * Shutdown cache manager
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.memoryCache.clear();
    this.memoryTTL.clear();
  }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;
