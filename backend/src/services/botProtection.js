/**
 * Bot Protection Service
 * Cloudflare-style "Under Attack" mode
 */

const crypto = require('crypto');

class BotProtection {
    constructor() {
        this.requestsPerSecond = 0;
        this.threshold = 100; // Configurable - requests per second
        this.enabled = false; // Mode "Under Attack" off by default
        this.verifiedIPs = new Map(); // IP => expiration timestamp
        this.requestCounts = new Map(); // IP => count per second
        this.ipRequestHistory = new Map(); // IP => array of timestamps for rate limiting
        this.perIpLimit = 100; // Max requests per IP per minute
        this.secret = process.env.BOT_SECRET || crypto.randomBytes(32).toString('hex');

        // Reset counters every second
        setInterval(() => {
            this.requestsPerSecond = 0;
            this.requestCounts.clear();
        }, 1000);

        // Clean expired IPs every minute
        setInterval(() => {
            const now = Date.now();
            for (const [ip, expiration] of this.verifiedIPs.entries()) {
                if (expiration < now) {
                    this.verifiedIPs.delete(ip);
                }
            }
        }, 60000);
    }

    trackRequest(ip) {
        this.requestsPerSecond++;
        const count = (this.requestCounts.get(ip) || 0) + 1;
        this.requestCounts.set(ip, count);

        // Track request history for per-IP rate limiting
        const now = Date.now();
        if (!this.ipRequestHistory.has(ip)) {
            this.ipRequestHistory.set(ip, []);
        }
        const history = this.ipRequestHistory.get(ip);
        
        // Add current request
        history.push(now);
        
        // Remove requests older than 1 minute
        const oneMinuteAgo = now - 60000;
        while (history.length > 0 && history[0] < oneMinuteAgo) {
            history.shift();
        }
        
        // Debug logging
        if (history.length % 10 === 0) {
            console.log(`[BotProtection] IP ${ip}: ${history.length} requests in last minute`);
        }
    }

    getRequestsPerMinute(ip) {
        const history = this.ipRequestHistory.get(ip);
        return history ? history.length : 0;
    }

    isRateLimited(ip) {
        const requestsInLastMinute = this.getRequestsPerMinute(ip);
        return requestsInLastMinute > this.perIpLimit;
    }

    isUnderAttack() {
        return this.enabled || this.requestsPerSecond > this.threshold;
    }

    shouldChallenge(ip) {
        // Check if IP already verified
        const expiration = this.verifiedIPs.get(ip);
        if (expiration && expiration > Date.now()) {
            return false;
        }

        // Challenge if under attack OR if this specific IP is rate limited
        const shouldBlock = this.isUnderAttack() || this.isRateLimited(ip);
        
        if (shouldBlock) {
            const reqCount = this.getRequestsPerMinute(ip);
            console.log(`[BotProtection] Challenging IP ${ip} - ${reqCount} requests in last minute (limit: ${this.perIpLimit})`);
        }
        
        return shouldBlock;
    }

    verifyIP(ip) {
        // Mark IP as verified for 24 hours
        const expiration = Date.now() + (24 * 60 * 60 * 1000);
        this.verifiedIPs.set(ip, expiration);
    }

    generateChallenge(ip) {
        const timestamp = Date.now();
        const token = crypto
            .createHmac('sha256', this.secret)
            .update(ip + timestamp)
            .digest('hex');

        return { token, timestamp };
    }

    verifyChallenge(ip, token, timestamp) {
        // Check if timestamp is recent (within 30 seconds)
        const now = Date.now();
        if (Math.abs(now - timestamp) > 30000) {
            return false;
        }

        const expected = crypto
            .createHmac('sha256', this.secret)
            .update(ip + timestamp)
            .digest('hex');

        return token === expected;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }

    setThreshold(threshold) {
        this.threshold = threshold;
    }

    setPerIpLimit(limit) {
        this.perIpLimit = limit;
    }

    getStats() {
        return {
            enabled: this.enabled,
            threshold: this.threshold,
            perIpLimit: this.perIpLimit,
            requestsPerSecond: this.requestsPerSecond,
            verifiedIPs: this.verifiedIPs.size,
            trackedIPs: this.ipRequestHistory.size,
            isUnderAttack: this.isUnderAttack()
        };
    }
}

const botProtection = new BotProtection();

module.exports = botProtection;
