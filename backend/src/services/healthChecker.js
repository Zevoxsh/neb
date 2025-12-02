const http = require('http');
const https = require('https');
const net = require('net');
const backendPoolModel = require('../models/backendPoolModel');
const backendModel = require('../models/backendModel');

/**
 * Health Checker Service
 * Periodically checks backend health and updates status
 */

class HealthChecker {
  constructor() {
    this.intervals = new Map(); // poolId -> setInterval ID
  }

  /**
   * Start health checking for a pool
   */
  async startHealthCheck(poolId) {
    // Stop existing health check if any
    this.stopHealthCheck(poolId);

    const pool = await backendPoolModel.getBackendPool(poolId);
    if (!pool || !pool.health_check_enabled) {
      console.log(`[HealthChecker] Health checks disabled for pool ${poolId}`);
      return;
    }

    const intervalMs = pool.health_check_interval_ms || 30000;
    console.log(`[HealthChecker] Starting health checks for pool ${poolId} every ${intervalMs}ms`);

    // Run immediately
    await this.checkPoolHealth(poolId);

    // Schedule periodic checks
    const intervalId = setInterval(async () => {
      await this.checkPoolHealth(poolId);
    }, intervalMs);

    this.intervals.set(poolId, intervalId);
  }

  /**
   * Stop health checking for a pool
   */
  stopHealthCheck(poolId) {
    const intervalId = this.intervals.get(poolId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(poolId);
      console.log(`[HealthChecker] Stopped health checks for pool ${poolId}`);
    }
  }

  /**
   * Check health of all backends in a pool
   */
  async checkPoolHealth(poolId) {
    try {
      const pool = await backendPoolModel.getBackendPoolWithMembers(poolId);
      if (!pool || !pool.backends) return;

      const checkPromises = pool.backends.map(backend =>
        this.checkBackendHealth(backend, pool)
      );

      await Promise.allSettled(checkPromises);
    } catch (error) {
      console.error(`[HealthChecker] Error checking pool ${poolId} health:`, error);
    }
  }

  /**
   * Check health of a single backend
   */
  async checkBackendHealth(backend, pool) {
    const startTime = Date.now();
    const protocol = backend.target_protocol || 'http';
    const timeout = pool.health_check_timeout_ms || 2000;
    const maxFailures = pool.max_failures || 3;
    const failureTimeoutMs = pool.failure_timeout_ms || 60000;

    try {
      let isHealthy = false;

      if (protocol === 'http' || protocol === 'https') {
        // HTTP/HTTPS health check
        isHealthy = await this.httpHealthCheck(
          backend.target_host,
          backend.target_port,
          pool.health_check_path || '/',
          protocol,
          timeout
        );
      } else {
        // TCP health check (connect only)
        isHealthy = await this.tcpHealthCheck(
          backend.target_host,
          backend.target_port,
          timeout
        );
      }

      const latency = Date.now() - startTime;

      if (isHealthy) {
        // Backend is healthy - reset failure count
        await backendModel.updateBackendHealth(backend.id, 'healthy', 0);
        console.log(`[HealthChecker] Backend ${backend.id} (${backend.target_host}:${backend.target_port}) is healthy (${latency}ms)`);
      } else {
        // Backend failed - increment failure count
        const failures = (backend.consecutive_failures || 0) + 1;
        const newStatus = failures >= maxFailures ? 'unhealthy' : 'degraded';
        await backendModel.updateBackendHealth(backend.id, newStatus, failures);

        console.warn(`[HealthChecker] Backend ${backend.id} (${backend.target_host}:${backend.target_port}) check failed (${failures}/${maxFailures}) - Status: ${newStatus}`);

        // If just became unhealthy, schedule recovery check
        if (newStatus === 'unhealthy') {
          setTimeout(async () => {
            console.log(`[HealthChecker] Recovery check for backend ${backend.id}`);
            await this.checkBackendHealth(backend, pool);
          }, failureTimeoutMs);
        }
      }
    } catch (error) {
      console.error(`[HealthChecker] Error checking backend ${backend.id}:`, error.message);
      const failures = (backend.consecutive_failures || 0) + 1;
      const newStatus = failures >= maxFailures ? 'unhealthy' : 'degraded';
      await backendModel.updateBackendHealth(backend.id, newStatus, failures);
    }
  }

  /**
   * Perform HTTP/HTTPS health check
   */
  httpHealthCheck(host, port, path, protocol, timeout) {
    return new Promise((resolve) => {
      const client = protocol === 'https' ? https : http;

      const options = {
        hostname: host,
        port: port,
        path: path,
        method: 'GET',
        timeout: timeout,
        headers: {
          'User-Agent': 'Nebula-HealthChecker/1.0'
        }
      };

      const req = client.request(options, (res) => {
        // Consider 2xx and 3xx as healthy
        const healthy = res.statusCode >= 200 && res.statusCode < 400;
        res.resume(); // Consume response
        resolve(healthy);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', (error) => {
        console.debug(`[HealthChecker] HTTP check error for ${host}:${port}: ${error.message}`);
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Perform TCP health check (connection test)
   */
  tcpHealthCheck(host, port, timeout) {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', (error) => {
        console.debug(`[HealthChecker] TCP check error for ${host}:${port}: ${error.message}`);
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Start health checks for all pools
   */
  async startAllHealthChecks() {
    try {
      const pools = await backendPoolModel.listBackendPools();
      for (const pool of pools) {
        if (pool.health_check_enabled) {
          await this.startHealthCheck(pool.id);
        }
      }
      console.log(`[HealthChecker] Started health checks for ${pools.length} pools`);
    } catch (error) {
      console.error('[HealthChecker] Error starting all health checks:', error);
    }
  }

  /**
   * Stop all health checks
   */
  stopAllHealthChecks() {
    for (const poolId of this.intervals.keys()) {
      this.stopHealthCheck(poolId);
    }
    console.log('[HealthChecker] Stopped all health checks');
  }

  /**
   * Get health check status
   */
  getStatus() {
    return {
      activeHealthChecks: this.intervals.size,
      pools: Array.from(this.intervals.keys())
    };
  }
}

// Singleton instance
const healthChecker = new HealthChecker();

module.exports = healthChecker;
