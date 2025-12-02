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
    console.log('[Redis] Désactivé via REDIS_ENABLED=false');
    return null;
  }

  try {
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => {
          // Arrêter après 3 tentatives pour éviter le spam
          if (retries > 3) {
            console.warn('[Redis] ⚠️  Redis non disponible - fonctionnement sans cache');
            return false; // Stop reconnecting
          }
          return Math.min(retries * 100, 500);
        }
      }
    });

    // Réduire les logs d'erreur
    redisClient.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        // Ne logger qu'une fois
        if (retries === 0) {
          console.warn('[Redis] ⚠️  Non disponible - l\'application continuera sans Redis');
        }
      } else {
        console.error('[Redis] Erreur:', err.message);
      }
      isConnected = false;
    });

    let retries = 0;
    redisClient.on('reconnecting', () => {
      retries++;
      isConnected = false;
    });

    redisClient.on('ready', () => {
      console.log('[Redis] ✅ Connecté');
      isConnected = true;
      retries = 0;
    });

    redisClient.on('end', () => {
      isConnected = false;
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.warn('[Redis] ⚠️  Non disponible - l\'application continuera sans cache Redis');
    } else {
      console.error('[Redis] Erreur de connexion:', error.message);
    }
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
