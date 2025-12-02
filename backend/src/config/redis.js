const { createClient } = require('redis');

/**
 * Redis Client Configuration
 * Used for distributed caching, rate limiting, and session storage
 */

let redisClient = null;
let isConnected = false;

async function connectRedis() {
  if (redisClient && isConnected) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisEnabled = process.env.REDIS_ENABLED !== 'false';

  if (!redisEnabled) {
    console.log('[Redis] Redis is disabled via REDIS_ENABLED=false');
    return null;
  }

  try {
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('[Redis] Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          const delay = Math.min(retries * 100, 3000);
          console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`);
          return delay;
        }
      }
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Client error:', err);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Client connecting...');
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Client ready');
      isConnected = true;
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Client reconnecting...');
      isConnected = false;
    });

    redisClient.on('end', () => {
      console.log('[Redis] Client connection closed');
      isConnected = false;
    });

    await redisClient.connect();
    console.log('[Redis] Connected successfully to', redisUrl);
    return redisClient;
  } catch (error) {
    console.error('[Redis] Failed to connect:', error.message);
    console.warn('[Redis] Application will continue without Redis caching');
    redisClient = null;
    isConnected = false;
    return null;
  }
}

function getRedisClient() {
  return isConnected ? redisClient : null;
}

function isRedisConnected() {
  return isConnected;
}

async function disconnectRedis() {
  if (redisClient && isConnected) {
    await redisClient.quit();
    console.log('[Redis] Disconnected');
    isConnected = false;
  }
}

module.exports = {
  connectRedis,
  getRedisClient,
  isRedisConnected,
  disconnectRedis
};
