/**
 * Bot Protection Service
 * Cloudflare-style "Under Attack" mode
 */

const crypto = require('crypto');

class BotProtection {
    constructor() {
        this.requestsPerSecond = 0;
        this.threshold = 100; // Configurable
        this.enabled = false; // Mode "Under Attack" off by default
        this.verifiedIPs = new Map(); // IP => expiration timestamp
        this.requestCounts = new Map(); // IP => count
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
    }

    isUnderAttack() {
        return this.enabled || this.requestsPerSecond > this.threshold;
    }

    shouldChallenge(ip) {
        if (!this.isUnderAttack()) return false;

        // Check if IP already verified
        const expiration = this.verifiedIPs.get(ip);
        if (expiration && expiration > Date.now()) {
            return false;
        }

        return true;
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

    getStats() {
        return {
            enabled: this.enabled,
            threshold: this.threshold,
            requestsPerSecond: this.requestsPerSecond,
            verifiedIPs: this.verifiedIPs.size,
            isUnderAttack: this.isUnderAttack()
        };
    }
}

const botProtection = new BotProtection();

module.exports = botProtection;
