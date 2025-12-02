const backendPoolModel = require('../models/backendPoolModel');
const backendModel = require('../models/backendModel');
const crypto = require('crypto');

/**
 * Load Balancer Service
 * Implements multiple load balancing algorithms:
 * - round-robin: Rotates through backends sequentially
 * - least-connections: Selects backend with fewest active connections
 * - weighted: Distributes based on backend weight
 * - ip-hash: Sticky sessions based on client IP
 */

class LoadBalancer {
  constructor() {
    // Track round-robin position per pool
    this.roundRobinIndex = new Map();
    // Track weighted round-robin state per pool
    this.weightedState = new Map();
  }

  /**
   * Select a backend from a pool using the configured algorithm
   * @param {number} poolId - Backend pool ID
   * @param {string} clientIp - Client IP address (for ip-hash)
   * @returns {Object|null} Selected backend or null if none available
   */
  async selectBackend(poolId, clientIp = null) {
    // Get pool configuration
    const pool = await backendPoolModel.getBackendPool(poolId);
    if (!pool) {
      console.error(`[LoadBalancer] Pool ${poolId} not found`);
      return null;
    }

    // Get healthy backends only
    const backends = await backendPoolModel.getHealthyPoolMembers(poolId);
    if (!backends || backends.length === 0) {
      console.warn(`[LoadBalancer] No healthy backends in pool ${poolId}`);
      return null;
    }

    // Select algorithm
    const algorithm = pool.lb_algorithm || 'round-robin';

    switch (algorithm) {
      case 'round-robin':
        return this.roundRobin(poolId, backends);

      case 'least-connections':
        return this.leastConnections(backends);

      case 'weighted':
        return this.weighted(poolId, backends);

      case 'ip-hash':
        if (!clientIp) {
          console.warn('[LoadBalancer] ip-hash requires clientIp, falling back to round-robin');
          return this.roundRobin(poolId, backends);
        }
        return this.ipHash(clientIp, backends);

      default:
        console.warn(`[LoadBalancer] Unknown algorithm ${algorithm}, using round-robin`);
        return this.roundRobin(poolId, backends);
    }
  }

  /**
   * Round-Robin: Simple rotation through backends
   */
  roundRobin(poolId, backends) {
    if (backends.length === 0) return null;
    if (backends.length === 1) return backends[0];

    // Get current index
    let index = this.roundRobinIndex.get(poolId) || 0;

    // Select backend
    const selected = backends[index];

    // Increment and wrap
    index = (index + 1) % backends.length;
    this.roundRobinIndex.set(poolId, index);

    console.log(`[LoadBalancer] Round-robin selected backend ${selected.id} (${selected.target_host}:${selected.target_port})`);
    return selected;
  }

  /**
   * Least Connections: Select backend with fewest active connections
   */
  leastConnections(backends) {
    if (backends.length === 0) return null;
    if (backends.length === 1) return backends[0];

    // Find backend with minimum connections
    const selected = backends.reduce((min, backend) => {
      const connections = parseInt(backend.active_connections || 0);
      const minConnections = parseInt(min.active_connections || 0);
      return connections < minConnections ? backend : min;
    });

    console.log(`[LoadBalancer] Least-connections selected backend ${selected.id} with ${selected.active_connections} connections`);
    return selected;
  }

  /**
   * Weighted: Distribute requests based on backend weight
   * Uses smooth weighted round-robin algorithm
   */
  weighted(poolId, backends) {
    if (backends.length === 0) return null;
    if (backends.length === 1) return backends[0];

    // Initialize state if not exists
    if (!this.weightedState.has(poolId)) {
      this.weightedState.set(poolId, {
        current: backends.map(b => ({
          backend: b,
          weight: parseInt(b.weight || 1),
          currentWeight: 0
        }))
      });
    }

    const state = this.weightedState.get(poolId);

    // Calculate total weight
    let totalWeight = 0;
    for (const item of state.current) {
      item.currentWeight += item.weight;
      totalWeight += item.weight;
    }

    // Select backend with highest current weight
    let selected = state.current[0];
    for (const item of state.current) {
      if (item.currentWeight > selected.currentWeight) {
        selected = item;
      }
    }

    // Reduce selected backend's current weight by total
    selected.currentWeight -= totalWeight;

    console.log(`[LoadBalancer] Weighted selected backend ${selected.backend.id} (weight: ${selected.weight})`);
    return selected.backend;
  }

  /**
   * IP Hash: Sticky sessions based on client IP
   * Uses consistent hashing for better distribution
   */
  ipHash(clientIp, backends) {
    if (backends.length === 0) return null;
    if (backends.length === 1) return backends[0];

    // Hash the IP
    const hash = crypto.createHash('md5').update(clientIp).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);

    // Select backend based on hash modulo
    const index = hashValue % backends.length;
    const selected = backends[index];

    console.log(`[LoadBalancer] IP-hash selected backend ${selected.id} for IP ${clientIp}`);
    return selected;
  }

  /**
   * Select backend from a single backend ID (backward compatibility)
   */
  async selectFromSingleBackend(backendId) {
    const backend = await backendModel.getBackend(backendId);
    if (!backend) return null;

    // Check health status
    if (backend.health_status === 'unhealthy') {
      console.warn(`[LoadBalancer] Backend ${backendId} is unhealthy`);
      return null;
    }

    return backend;
  }

  /**
   * Increment connection count for a backend
   */
  async incrementConnections(backendId) {
    if (!backendId) return;
    try {
      await backendModel.incrementBackendConnections(backendId);
    } catch (error) {
      console.error(`[LoadBalancer] Failed to increment connections for backend ${backendId}:`, error);
    }
  }

  /**
   * Decrement connection count for a backend
   */
  async decrementConnections(backendId) {
    if (!backendId) return;
    try {
      await backendModel.decrementBackendConnections(backendId);
    } catch (error) {
      console.error(`[LoadBalancer] Failed to decrement connections for backend ${backendId}:`, error);
    }
  }

  /**
   * Update backend statistics (total requests, avg response time)
   */
  async updateStats(backendId, responseTimeMs) {
    if (!backendId) return;
    try {
      await backendModel.updateBackendStats(backendId, 1, responseTimeMs);
    } catch (error) {
      console.error(`[LoadBalancer] Failed to update stats for backend ${backendId}:`, error);
    }
  }

  /**
   * Reset round-robin index for a pool (useful after pool configuration changes)
   */
  resetPoolState(poolId) {
    this.roundRobinIndex.delete(poolId);
    this.weightedState.delete(poolId);
  }
}

// Singleton instance
const loadBalancer = new LoadBalancer();

module.exports = loadBalancer;
