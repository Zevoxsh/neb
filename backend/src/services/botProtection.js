/**
 * Bot Protection Service
 * Cloudflare-style "Under Attack" mode with CAPTCHA
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
        this.challengeFirstVisit = false; // DISABLED by default - only on proxy HTTPS
        this.activeChallenges = new Map(); // IP => { code, timestamp, attempts }
        this.maxAttempts = 3; // Max failed attempts before temporary ban
        this.bannedIPs = new Map(); // IP => ban expiration timestamp
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
            // Clean expired bans
            for (const [ip, expiration] of this.bannedIPs.entries()) {
                if (expiration < now) {
                    this.bannedIPs.delete(ip);
                    console.log(`[BotProtection] IP ${ip} unbanned`);
                }
            }
            // Clean expired challenges
            for (const [ip, challenge] of this.activeChallenges.entries()) {
                if (now - challenge.timestamp > 300000) { // 5 minutes
                    this.activeChallenges.delete(ip);
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

    isBanned(ip) {
        const banExpiration = this.bannedIPs.get(ip);
        return banExpiration && banExpiration > Date.now();
    }

    banIP(ip, durationMs = 300000) { // 5 minutes by default
        const expiration = Date.now() + durationMs;
        this.bannedIPs.set(ip, expiration);
        console.log(`[BotProtection] IP ${ip} banned until ${new Date(expiration).toISOString()}`);
    }

    isUnderAttack() {
        return this.enabled || this.requestsPerSecond > this.threshold;
    }

    shouldChallenge(ip, forceNewVisitor = false) {
        // Check if IP is banned
        if (this.isBanned(ip)) {
            return 'banned';
        }

        // Check if IP already verified
        const expiration = this.verifiedIPs.get(ip);
        if (expiration && expiration > Date.now()) {
            return false;
        }

        // Challenge if:
        // 1. Under attack mode is enabled
        // 2. IP is rate limited (too many requests)
        // 3. First visit and (challengeFirstVisit is enabled OR forceNewVisitor is true)
        const isRateLimited = this.isRateLimited(ip);
        const isUnderAttack = this.isUnderAttack();
        const isNewVisitor = (this.challengeFirstVisit || forceNewVisitor) && !this.verifiedIPs.has(ip);
        
        const shouldBlock = isUnderAttack || isRateLimited || isNewVisitor;
        
        if (shouldBlock) {
            const reqCount = this.getRequestsPerMinute(ip);
            const reason = isNewVisitor ? 'New visitor' : `${reqCount} requests in last minute`;
            console.log(`[BotProtection] Challenging IP ${ip} - ${reason} (limit: ${this.perIpLimit})`);
        }
        
        return shouldBlock;
    }

    verifyIP(ip) {
        // Mark IP as verified for 24 hours
        const expiration = Date.now() + (24 * 60 * 60 * 1000);
        this.verifiedIPs.set(ip, expiration);
        console.log(`[BotProtection] IP ${ip} verified until ${new Date(expiration).toISOString()}`);
    }

    generateChallenge(ip) {
        const timestamp = Date.now();
        
        // Generate a random 6-character code
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        // Store challenge
        this.activeChallenges.set(ip, {
            code,
            timestamp,
            attempts: 0
        });
        
        // Generate cryptographic token
        const token = crypto
            .createHmac('sha256', this.secret)
            .update(ip + code + timestamp)
            .digest('hex');

        return { token, timestamp, code };
    }

    getActiveChallenge(ip) {
        const challenge = this.activeChallenges.get(ip);
        if (!challenge) return null;
        
        // Check if expired (5 minutes)
        const now = Date.now();
        if (now - challenge.timestamp > 300000) {
            this.activeChallenges.delete(ip);
            return null;
        }
        
        return {
            code: challenge.code,
            timestamp: challenge.timestamp,
            token: crypto
                .createHmac('sha256', this.secret)
                .update(ip + challenge.code + challenge.timestamp)
                .digest('hex')
        };
    }

    verifyChallengeAnswer(ip, userInput) {
        const challenge = this.activeChallenges.get(ip);
        
        console.log(`[BotProtection] Verify challenge - IP: ${ip}, userInput: ${userInput}, hasChallenge: ${!!challenge}`);
        
        if (!challenge) {
            console.warn(`[BotProtection] No active challenge for IP ${ip}`);
            console.log(`[BotProtection] Active challenges:`, Array.from(this.activeChallenges.keys()));
            return { success: false, reason: 'no_challenge' };
        }

        // Check if challenge is expired (5 minutes)
        const now = Date.now();
        if (now - challenge.timestamp > 300000) {
            this.activeChallenges.delete(ip);
            return { success: false, reason: 'expired' };
        }

        // Increment attempt counter
        challenge.attempts++;

        // Check if too many attempts
        if (challenge.attempts > this.maxAttempts) {
            this.activeChallenges.delete(ip);
            this.banIP(ip, 600000); // Ban for 10 minutes
            return { success: false, reason: 'too_many_attempts', banned: true };
        }

        // Verify answer
        if (userInput.toUpperCase() !== challenge.code) {
            console.warn(`[BotProtection] IP ${ip} failed challenge (attempt ${challenge.attempts}/${this.maxAttempts})`);
            return { 
                success: false, 
                reason: 'wrong_answer',
                attemptsLeft: this.maxAttempts - challenge.attempts
            };
        }

        // Success!
        this.activeChallenges.delete(ip);
        this.verifyIP(ip);
        console.log(`[BotProtection] IP ${ip} passed challenge`);
        return { success: true };
    }

    verifyChallenge(ip, token, timestamp) {
        // Legacy method for backward compatibility
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

    setChallengeFirstVisit(enabled) {
        this.challengeFirstVisit = enabled;
    }

    getStats() {
        return {
            enabled: this.enabled,
            threshold: this.threshold,
            perIpLimit: this.perIpLimit,
            challengeFirstVisit: this.challengeFirstVisit,
            requestsPerSecond: this.requestsPerSecond,
            verifiedIPs: this.verifiedIPs.size,
            bannedIPs: this.bannedIPs.size,
            activeChallenges: this.activeChallenges.size,
            trackedIPs: this.ipRequestHistory.size,
            isUnderAttack: this.isUnderAttack()
        };
    }
}

const botProtection = new BotProtection();

module.exports = botProtection;
