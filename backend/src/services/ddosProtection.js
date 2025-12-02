const { createLogger } = require('../utils/logger');
const { RateLimiter } = require('../utils/security');

const logger = createLogger('DDoSProtection');

/**
 * DDoS Protection Service
 * Advanced protection against various DDoS attack vectors
 */

class DDoSProtectionService {
  constructor() {
    // Connection tracking
    this.activeConnections = new Map(); // IP -> { count, lastSeen }
    this.suspiciousIPs = new Map(); // IP -> { score, bannedUntil }

    // Request pattern tracking
    this.requestPatterns = new Map(); // IP -> { timestamps[], paths[] }

    // HTTP flood detection
    this.httpFloodLimiter = new RateLimiter(
      parseInt(process.env.DDOS_HTTP_REQUESTS_PER_MINUTE) || 120,
      60000
    );

    // Connection limits
    this.maxConnectionsPerIP = parseInt(process.env.DDOS_MAX_CONNECTIONS_PER_IP) || 50;
    this.maxHalfOpenConnections = parseInt(process.env.DDOS_MAX_HALF_OPEN) || 10;

    // Slowloris protection (tracked elsewhere via timeouts)
    this.slowRequestTimeout = parseInt(process.env.DDOS_SLOW_REQUEST_TIMEOUT_MS) || 30000;

    // Pattern detection thresholds
    this.patternDetectionWindow = 60000; // 1 minute
    this.suspiciousPatternThreshold = 50; // Requests to same path

    // Ban durations (progressive)
    this.banDurations = [
      5 * 60 * 1000,    // 5 minutes
      30 * 60 * 1000,   // 30 minutes
      2 * 60 * 60 * 1000, // 2 hours
      24 * 60 * 60 * 1000 // 24 hours
    ];

    // Cleanup old data every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);

    logger.info('DDoS Protection initialized', {
      maxConnectionsPerIP: this.maxConnectionsPerIP,
      httpRequestsPerMinute: this.httpFloodLimiter.maxRequests
    });
  }

  /**
   * Track incoming connection
   */
  trackConnection(ip, isOpen = true) {
    if (!this.activeConnections.has(ip)) {
      this.activeConnections.set(ip, { count: 0, halfOpen: 0, lastSeen: Date.now() });
    }

    const conn = this.activeConnections.get(ip);

    if (isOpen) {
      conn.count++;
      conn.halfOpen++;
    }

    conn.lastSeen = Date.now();

    // Check connection limits
    if (conn.count > this.maxConnectionsPerIP) {
      this.addSuspicionScore(ip, 20, 'connection_limit_exceeded');
      return false;
    }

    if (conn.halfOpen > this.maxHalfOpenConnections) {
      this.addSuspicionScore(ip, 30, 'syn_flood_detected');
      return false;
    }

    return true;
  }

  /**
   * Mark connection as established (no longer half-open)
   */
  connectionEstablished(ip) {
    const conn = this.activeConnections.get(ip);
    if (conn && conn.halfOpen > 0) {
      conn.halfOpen--;
    }
  }

  /**
   * Release connection
   */
  releaseConnection(ip) {
    const conn = this.activeConnections.get(ip);
    if (conn) {
      conn.count = Math.max(0, conn.count - 1);
      conn.halfOpen = Math.max(0, conn.halfOpen - 1);
    }
  }

  /**
   * Check if IP is allowed (not banned)
   */
  isAllowed(ip) {
    const suspicious = this.suspiciousIPs.get(ip);

    if (!suspicious) return true;

    // Check if ban expired
    if (suspicious.bannedUntil && Date.now() < suspicious.bannedUntil) {
      logger.debug('Blocked banned IP', { ip, remainingMs: suspicious.bannedUntil - Date.now() });
      return false;
    }

    // Ban expired, clear it
    if (suspicious.bannedUntil && Date.now() >= suspicious.bannedUntil) {
      logger.info('Ban expired for IP', { ip });
      this.suspiciousIPs.delete(ip);
      return true;
    }

    return true;
  }

  /**
   * Analyze HTTP request for flood patterns
   */
  analyzeRequest(ip, path, method, headers) {
    // Check if banned
    if (!this.isAllowed(ip)) {
      return { allowed: false, reason: 'ip_banned' };
    }

    // Check rate limit
    if (!this.httpFloodLimiter.isAllowed(ip)) {
      this.addSuspicionScore(ip, 10, 'rate_limit_exceeded');
      return { allowed: false, reason: 'rate_limit_exceeded' };
    }

    // Track request pattern
    this.trackRequestPattern(ip, path, method);

    // Check for suspicious patterns
    const pattern = this.requestPatterns.get(ip);
    if (pattern) {
      const recentRequests = pattern.timestamps.filter(t => Date.now() - t < this.patternDetectionWindow);

      // HTTP flood detection - too many requests to same endpoint
      const samePaths = pattern.paths.filter(p => p === path);
      if (samePaths.length > this.suspiciousPatternThreshold) {
        logger.warn('HTTP flood pattern detected', { ip, path, count: samePaths.length });
        this.addSuspicionScore(ip, 25, 'http_flood_pattern');
        return { allowed: false, reason: 'http_flood_detected' };
      }

      // Request burst detection
      if (recentRequests.length > 100) {
        logger.warn('Request burst detected', { ip, count: recentRequests.length });
        this.addSuspicionScore(ip, 15, 'request_burst');
      }
    }

    // Check User-Agent
    const userAgent = headers['user-agent'] || '';
    if (this.isSuspiciousUserAgent(userAgent)) {
      logger.debug('Suspicious User-Agent detected', { ip, userAgent });
      this.addSuspicionScore(ip, 1, 'suspicious_user_agent');
    }

    // Check for missing common headers (possible bot)
    if (!headers['accept'] || !headers['accept-language']) {
      this.addSuspicionScore(ip, 1, 'missing_headers');
    }

    return { allowed: true };
  }

  /**
   * Track request patterns for behavioral analysis
   */
  trackRequestPattern(ip, path, method) {
    if (!this.requestPatterns.has(ip)) {
      this.requestPatterns.set(ip, { timestamps: [], paths: [] });
    }

    const pattern = this.requestPatterns.get(ip);
    const now = Date.now();

    // Add current request
    pattern.timestamps.push(now);
    pattern.paths.push(path);

    // Keep only recent data (last minute)
    pattern.timestamps = pattern.timestamps.filter(t => now - t < this.patternDetectionWindow);
    pattern.paths = pattern.paths.slice(-100); // Keep last 100 paths
  }

  /**
   * Check if User-Agent is suspicious
   */
  isSuspiciousUserAgent(userAgent) {
    if (!userAgent || userAgent.length < 10) return true;

    const suspiciousPatterns = [
      /bot|crawler|spider|scraper/i,
      /curl|wget|python-requests|go-http-client/i
    ];

    // Known good bots (allow these)
    const allowedBots = [
      /googlebot|bingbot|slurp|duckduckbot/i
    ];

    for (const allowed of allowedBots) {
      if (allowed.test(userAgent)) return false;
    }

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(userAgent)) return true;
    }

    return false;
  }

  /**
   * Add suspicion score to IP
   */
  addSuspicionScore(ip, points, reason) {
    if (!this.suspiciousIPs.has(ip)) {
      this.suspiciousIPs.set(ip, { score: 0, reasons: [], banCount: 0 });
    }

    const suspicious = this.suspiciousIPs.get(ip);
    suspicious.score += points;
    suspicious.reasons.push({ reason, timestamp: Date.now() });

    logger.debug('Added suspicion score', { ip, points, reason, totalScore: suspicious.score });

    // Progressive banning based on score
    if (suspicious.score >= 200) {
      const banIndex = Math.min(suspicious.banCount, this.banDurations.length - 1);
      const banDuration = this.banDurations[banIndex];
      suspicious.bannedUntil = Date.now() + banDuration;
      suspicious.banCount++;

      logger.warn('IP banned due to suspicion score', {
        ip,
        score: suspicious.score,
        duration: banDuration,
        banCount: suspicious.banCount,
        reasons: suspicious.reasons.map(r => r.reason)
      });

      // Reset score after ban
      suspicious.score = 0;
      suspicious.reasons = [];
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const bannedIPs = Array.from(this.suspiciousIPs.entries())
      .filter(([ip, data]) => data.bannedUntil && Date.now() < data.bannedUntil)
      .map(([ip, data]) => ({
        ip,
        bannedUntil: new Date(data.bannedUntil).toISOString(),
        score: data.score,
        banCount: data.banCount
      }));

    return {
      activeConnections: this.activeConnections.size,
      suspiciousIPs: this.suspiciousIPs.size,
      bannedIPs: bannedIPs.length,
      bannedIPsList: bannedIPs,
      config: {
        maxConnectionsPerIP: this.maxConnectionsPerIP,
        maxHalfOpenConnections: this.maxHalfOpenConnections,
        httpRequestsPerMinute: this.httpFloodLimiter.maxRequests,
        slowRequestTimeout: this.slowRequestTimeout
      }
    };
  }

  /**
   * Manually ban an IP
   */
  banIP(ip, durationMs = 24 * 60 * 60 * 1000) {
    if (!this.suspiciousIPs.has(ip)) {
      this.suspiciousIPs.set(ip, { score: 0, reasons: [], banCount: 0 });
    }

    const suspicious = this.suspiciousIPs.get(ip);
    suspicious.bannedUntil = Date.now() + durationMs;
    suspicious.banCount++;

    logger.info('IP manually banned', { ip, duration: durationMs });
  }

  /**
   * Unban an IP
   */
  unbanIP(ip) {
    this.suspiciousIPs.delete(ip);
    logger.info('IP unbanned', { ip });
  }

  /**
   * Cleanup old data
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    // Clean old connections
    for (const [ip, conn] of this.activeConnections.entries()) {
      if (now - conn.lastSeen > maxAge) {
        this.activeConnections.delete(ip);
      }
    }

    // Clean old patterns
    for (const [ip, pattern] of this.requestPatterns.entries()) {
      pattern.timestamps = pattern.timestamps.filter(t => now - t < this.patternDetectionWindow);
      if (pattern.timestamps.length === 0) {
        this.requestPatterns.delete(ip);
      }
    }

    // Clean expired bans
    for (const [ip, suspicious] of this.suspiciousIPs.entries()) {
      if (suspicious.bannedUntil && now > suspicious.bannedUntil + 60000) {
        this.suspiciousIPs.delete(ip);
      }
    }

    logger.debug('DDoS protection cleanup completed', {
      activeConnections: this.activeConnections.size,
      requestPatterns: this.requestPatterns.size,
      suspiciousIPs: this.suspiciousIPs.size
    });
  }
}

// Singleton instance
const ddosProtection = new DDoSProtectionService();

module.exports = ddosProtection;
