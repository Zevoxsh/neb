/**
 * Bot Protection Service
 * Cloudflare-style "Under Attack" mode with CAPTCHA
 */

const crypto = require('crypto');

class BotProtection {
    constructor() {
        this.requestsPerSecond = 0;
        this.threshold = 10000; // Configurable - requests per second (très élevé maintenant)
        this.enabled = false; // Mode "Under Attack" off by default
        this.verifiedIPs = new Map(); // IP => expiration timestamp
        this.requestCounts = new Map(); // IP => count per second
        this.ipRequestHistory = new Map(); // IP => array of timestamps for rate limiting
        this.ipDomainRequestHistory = new Map(); // key: "IP:domain" => array of timestamps
        this.bannedIpDomains = new Map(); // key: "IP:domain" => ban expiration timestamp
        this.activeConnections = new Map(); // IP => count (pour limiter connexions)
        this.maxConnectionsPerIP = 1000; // Max connexions simultanées par IP (augmenté de 100 à 1000)

        // Limites très permissives
        this.perIpLimit = 1000; // Max requests per IP per minute (augmenté de 60 à 1000)
        this.perIpLimitProtected = 600; // Max requests per IP per minute for protected domains (augmenté de 30 à 600)
        this.perIpLimitUnprotected = 10000; // Limite TRÈS élevée pour domaines non protégés (10000 req/min)
        this.verifiedIpLimit = 12000; // Higher limit for verified IPs (200 req/s) (augmenté de 600 à 12000)
        this.burstLimit = 200; // Max requests in 10 seconds (augmenté de 10 à 200)
        this.burstLimitUnprotected = 2000; // Burst limit for unprotected domains (augmenté)
        
        this.challengeFirstVisit = false; // DISABLED by default - only on proxy HTTPS
        this.activeChallenges = new Map(); // IP => { code, timestamp, attempts }
        this.maxAttempts = 3; // Max failed attempts before temporary ban
        this.bannedIPs = new Map(); // IP => ban expiration timestamp
        this.secret = process.env.BOT_SECRET || crypto.randomBytes(32).toString('hex');
        this.verificationDuration = 6 * 60 * 60 * 1000; // 6 hours by default
        this.protectedDomains = new Set(); // Domains that require verification
        this.unprotectedDomains = new Set(); // Domains that bypass verification

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
            // Clean expired domain-specific bans
            for (const [key, expiration] of this.bannedIpDomains.entries()) {
                if (expiration < now) {
                    this.bannedIpDomains.delete(key);
                    console.log(`[BotProtection] ${key} unbanned`);
                }
            }
            // Clean expired challenges
            for (const [ip, challenge] of this.activeChallenges.entries()) {
                if (now - challenge.timestamp > 300000) { // 5 minutes
                    this.activeChallenges.delete(ip);
                }
            }
            // Clean old domain request histories
            const oneMinuteAgo = now - 60000;
            for (const [key, history] of this.ipDomainRequestHistory.entries()) {
                while (history.length > 0 && history[0] < oneMinuteAgo) {
                    history.shift();
                }
                if (history.length === 0) {
                    this.ipDomainRequestHistory.delete(key);
                }
            }
        }, 60000);
    }

    trackRequest(ip, domain = null) {
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

        // Track per-domain request history if domain is provided
        if (domain) {
            const key = `${ip}:${domain}`;
            if (!this.ipDomainRequestHistory.has(key)) {
                this.ipDomainRequestHistory.set(key, []);
            }
            const domainHistory = this.ipDomainRequestHistory.get(key);
            domainHistory.push(now);

            // Remove requests older than 1 minute
            while (domainHistory.length > 0 && domainHistory[0] < oneMinuteAgo) {
                domainHistory.shift();
            }
        }

        // Debug logging
        // if (history.length % 10 === 0) {
        //     console.log(`[BotProtection] IP ${ip}: ${history.length} requests in last minute`);
        // }
    }

    getRequestsPerMinuteForDomain(ip, domain) {
        const key = `${ip}:${domain}`;
        const history = this.ipDomainRequestHistory.get(key);
        return history ? history.length : 0;
    }

    getRequestsInLastSecondsForDomain(ip, domain, seconds) {
        const key = `${ip}:${domain}`;
        const history = this.ipDomainRequestHistory.get(key);
        if (!history) return 0;

        const now = Date.now();
        const cutoff = now - (seconds * 1000);
        return history.filter(ts => ts > cutoff).length;
    }

    isIpDomainBanned(ip, domain) {
        const key = `${ip}:${domain}`;
        const banExpiration = this.bannedIpDomains.get(key);
        return banExpiration && banExpiration > Date.now();
    }

    banIpForDomain(ip, domain, durationMs = 300000) { // 5 minutes by default
        const key = `${ip}:${domain}`;
        const expiration = Date.now() + durationMs;
        this.bannedIpDomains.set(key, expiration);
        console.log(`[BotProtection] IP ${ip} banned for domain ${domain} until ${new Date(expiration).toISOString()}`);
    }

    getRequestsPerMinute(ip) {
        const history = this.ipRequestHistory.get(ip);
        return history ? history.length : 0;
    }

    getRequestsInLastSeconds(ip, seconds) {
        const history = this.ipRequestHistory.get(ip);
        if (!history) return 0;
        
        const now = Date.now();
        const cutoff = now - (seconds * 1000);
        return history.filter(ts => ts > cutoff).length;
    }

    isRateLimited(ip, domain = null) {
        // CRITICAL: Check if IP is trusted FIRST - trusted IPs bypass all rate limiting
        const proxyManager = require('./proxyManager');
        if (proxyManager.isTrustedIp(ip)) {
            return false; // Trusted IPs are never rate limited
        }

        const requestsInLastMinute = this.getRequestsPerMinute(ip);
        const requestsInLast10Sec = this.getRequestsInLastSeconds(ip, 10);
        const isVerified = this.verifiedIPs.has(ip) && this.verifiedIPs.get(ip) > Date.now();
        
        // Check burst protection (200 requests in 10 seconds)
        if (requestsInLast10Sec > this.burstLimit) {
            // Auto-ban if extreme burst (more than 5x the limit = 1000 req/10s)
            if (requestsInLast10Sec > this.burstLimit * 5) {
                console.log(`[BotProtection] 🚫 IP ${ip} auto-banned: burst ${requestsInLast10Sec} req/10s (limit: ${this.burstLimit})`);
                this.banIP(ip, 300000); // Ban for 5 minutes (will also create alert if not trusted)
            } else {
                // Create alert for burst attack (only if not trusted)
                const alertService = require('./alertService');
                alertService.createSecurityAlert({
                    type: 'RATE_LIMIT',
                    severity: 'high',
                    ipAddress: ip,
                    hostname: domain,
                    message: `IP ${ip} exceeded burst limit: ${requestsInLast10Sec} requests in 10 seconds`,
                    details: { 
                        requestsInLast10Sec,
                        burstLimit: this.burstLimit,
                        attackType: 'burst'
                    }
                });
            }
            
            return true;
        }
        
        // Different limits based on domain protection and verification status
        let limit = this.perIpLimit;
        let limitType = 'standard';
        
        if (domain && this.protectedDomains.has(domain)) {
            // Stricter limit for protected domains
            limit = this.perIpLimitProtected;
            limitType = 'protected_domain';
        } else if (isVerified) {
            // Higher limit for verified IPs on unprotected domains
            limit = this.verifiedIpLimit;
            limitType = 'verified_ip';
        }
        
        if (requestsInLastMinute > limit) {
            console.log(`[BotProtection] IP ${ip} rate limited: ${requestsInLastMinute} requests/min (limit: ${limit}, verified: ${isVerified}, protected: ${domain && this.protectedDomains.has(domain)})`);
            
            // Determine severity based on how much the limit was exceeded
            const exceededBy = requestsInLastMinute - limit;
            const exceededPercent = (exceededBy / limit) * 100;
            let severity = 'medium';
            
            if (exceededPercent > 300) {
                severity = 'critical'; // More than 4x the limit
                // Auto-ban for extreme abuse (more than 4x limit)
                console.log(`[BotProtection] 🚫 IP ${ip} auto-banned: ${requestsInLastMinute} req/min (limit: ${limit})`);
                this.banIP(ip, 300000); // Ban for 5 minutes (will also create alert if not trusted)
            } else if (exceededPercent > 200) {
                severity = 'high';
            } else {
                // Only create rate limit alert if not auto-banned (to avoid duplicate)
                const alertService = require('./alertService');
                alertService.createSecurityAlert({
                    type: 'RATE_LIMIT',
                    severity: severity,
                    ipAddress: ip,
                    hostname: domain,
                    message: `IP ${ip} exceeded rate limit: ${requestsInLastMinute} requests/min (limit: ${limit})`,
                    details: { 
                        requestsPerMinute: requestsInLastMinute,
                        limit,
                        limitType,
                        isVerified,
                        exceededBy,
                        exceededPercent: Math.round(exceededPercent)
                    }
                });
            }
            
            return true;
        }
        
        return false;
    }

    isBanned(ip) {
        const banExpiration = this.bannedIPs.get(ip);
        return banExpiration && banExpiration > Date.now();
    }

    banIP(ip, durationMs = 300000) { // 5 minutes by default
        // CRITICAL: Never ban trusted IPs
        const proxyManager = require('./proxyManager');
        if (proxyManager.isTrustedIp(ip)) {
            console.log(`[BotProtection] ⚠️  Attempt to ban trusted IP ${ip} - BLOCKED`);
            return; // Don't ban trusted IPs - also don't create alert
        }

        const expiration = Date.now() + durationMs;
        this.bannedIPs.set(ip, expiration);
        console.log(`[BotProtection] IP ${ip} banned until ${new Date(expiration).toISOString()}`);
        
        // Create security alert
        const alertService = require('./alertService');
        alertService.createSecurityAlert({
            type: 'IP_BANNED',
            severity: 'high',
            ipAddress: ip,
            hostname: null,
            message: `IP ${ip} has been banned for ${Math.round(durationMs / 60000)} minutes`,
            details: { duration: durationMs, expiresAt: new Date(expiration).toISOString() }
        });
    }

    isUnderAttack() {
        return this.enabled || this.requestsPerSecond > this.threshold;
    }

    shouldChallenge(ip, forceNewVisitor = false, domain = null) {
        // CRITICAL: Check if IP is trusted FIRST - trusted IPs bypass all protection
        const proxyManager = require('./proxyManager');
        if (proxyManager.isTrustedIp(ip)) {
            return false; // Trusted IPs never get challenged
        }

        // Check if domain is unprotected - Pas de challenge, uniquement ban par domaine si VRAIMENT excessif
        if (domain && this.unprotectedDomains.has(domain)) {
            // Vérifier si IP est bannie pour ce domaine spécifique
            if (this.isIpDomainBanned(ip, domain)) {
                return 'banned_for_domain';
            }

            // Vérifier le rate limit TRÈS élevé pour domaines non protégés
            const requestsInLastMinute = this.getRequestsPerMinuteForDomain(ip, domain);
            const requestsInLast10Sec = this.getRequestsInLastSecondsForDomain(ip, domain, 10);

            // Burst check pour domaines non protégés (2000 req/10s)
            if (requestsInLast10Sec > this.burstLimitUnprotected) {
                console.log(`[BotProtection] IP ${ip} exceeded burst limit on unprotected domain ${domain}: ${requestsInLast10Sec} req/10s`);
                this.banIpForDomain(ip, domain, 300000); // Ban 5 minutes pour ce domaine uniquement
                return 'banned_for_domain';
            }

            // Rate limit check pour domaines non protégés (10000 req/min)
            if (requestsInLastMinute > this.perIpLimitUnprotected) {
                console.log(`[BotProtection] IP ${ip} exceeded rate limit on unprotected domain ${domain}: ${requestsInLastMinute} req/min`);
                this.banIpForDomain(ip, domain, 300000); // Ban 5 minutes pour ce domaine uniquement
                return 'banned_for_domain';
            }

            // Pas de challenge pour domaines non protégés, juste laisser passer
            return false;
        }

        // Check if IP is banned
        if (this.isBanned(ip)) {
            return 'banned';
        }

        // Check if IP already verified
        const expiration = this.verifiedIPs.get(ip);
        const isVerified = expiration && expiration > Date.now();
        
        // Even verified IPs need to respect rate limits
        const isRateLimited = this.isRateLimited(ip, domain);
        if (isRateLimited) {
            // If verified IP is rate limited, remove verification and challenge again
            if (isVerified) {
                console.log(`[BotProtection] Verified IP ${ip} exceeded rate limit, removing verification`);
                this.verifiedIPs.delete(ip);
                
                // Create alert for suspicious behavior from verified IP
                const alertService = require('./alertService');
                alertService.createSecurityAlert({
                    type: 'SUSPICIOUS_ACTIVITY',
                    severity: 'high',
                    ipAddress: ip,
                    hostname: domain,
                    message: `Verified IP ${ip} exceeded rate limit and lost verification status`,
                    details: { 
                        previouslyVerified: true,
                        requestsPerMinute: this.getRequestsPerMinute(ip),
                        domain
                    }
                });
            }
            return true;
        }

        // If verified and not rate limited, allow
        if (isVerified) {
            return false;
        }

        // If domain is specified and in protected list, force challenge
        const isDomainProtected = domain && this.protectedDomains.size > 0 && this.protectedDomains.has(domain);
        
        // Challenge if:
        // 1. Domain is in protected list (always challenge new IPs)
        // 2. Under attack mode is enabled
        // 3. First visit and (challengeFirstVisit is enabled OR forceNewVisitor is true)
        const isUnderAttack = this.isUnderAttack();
        const isNewVisitor = (this.challengeFirstVisit || forceNewVisitor) && !this.verifiedIPs.has(ip);
        
        const shouldBlock = isDomainProtected || isUnderAttack || isNewVisitor;
        
        // Log only important events (not normal new visitors)
        if (shouldBlock && !isNewVisitor) {
            const reqCount = this.getRequestsPerMinute(ip);
            const reason = isDomainProtected ? 'Protected domain' : 'Under attack mode';
            console.log(`[BotProtection] 🛡️ Challenging IP ${ip} - ${reason} (${reqCount} req/min)`);
        }
        
        return shouldBlock;
    }

    verifyIP(ip) {
        // Mark IP as verified (duration configurable, default 6 hours)
        const expiration = Date.now() + this.verificationDuration;
        this.verifiedIPs.set(ip, expiration);
        // Silent log - IP verified for 6h
    }

    generateChallenge(ip) {
        const timestamp = Date.now();
        
        // Generate a random 6-character code
        // Use only safe characters (no < > & \" ')
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
        
        if (!challenge) {
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
        console.log(`[BotProtection] ✓ IP ${ip} verified (challenge passed)`);
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

    setVerificationDuration(hours) {
        this.verificationDuration = hours * 60 * 60 * 1000;
        console.log(`[BotProtection] Verification duration set to ${hours} hours`);
    }

    addProtectedDomain(domain) {
        this.protectedDomains.add(domain);
        console.log(`[BotProtection] Domain ${domain} added to protected list`);
    }

    removeProtectedDomain(domain) {
        this.protectedDomains.delete(domain);
        console.log(`[BotProtection] Domain ${domain} removed from protected list`);
    }

    addUnprotectedDomain(domain) {
        this.unprotectedDomains.add(domain);
        console.log(`[BotProtection] Domain ${domain} added to unprotected list (bypass)`);
    }

    removeUnprotectedDomain(domain) {
        this.unprotectedDomains.delete(domain);
        console.log(`[BotProtection] Domain ${domain} removed from unprotected list`);
    }

    clearDomainLists() {
        this.protectedDomains.clear();
        this.unprotectedDomains.clear();
        console.log(`[BotProtection] Domain lists cleared`);
    }

    getStats() {
        return {
            enabled: this.enabled,
            threshold: this.threshold,
            perIpLimit: this.perIpLimit,
            perIpLimitProtected: this.perIpLimitProtected,
            perIpLimitUnprotected: this.perIpLimitUnprotected,
            verifiedIpLimit: this.verifiedIpLimit,
            burstLimit: this.burstLimit,
            burstLimitUnprotected: this.burstLimitUnprotected,
            challengeFirstVisit: this.challengeFirstVisit,
            verificationDuration: this.verificationDuration / (60 * 60 * 1000), // Convert to hours
            requestsPerSecond: this.requestsPerSecond,
            verifiedIPs: this.verifiedIPs.size,
            bannedIPs: this.bannedIPs.size,
            bannedIpDomains: this.bannedIpDomains.size,
            activeChallenges: this.activeChallenges.size,
            trackedIPs: this.ipRequestHistory.size,
            trackedIpDomains: this.ipDomainRequestHistory.size,
            protectedDomains: Array.from(this.protectedDomains),
            unprotectedDomains: Array.from(this.unprotectedDomains),
            isUnderAttack: this.isUnderAttack(),
            activeConnections: this.activeConnections ? this.activeConnections.size : 0,
            maxConnectionsPerIP: this.maxConnectionsPerIP || 100
        };
    }
    
    // Active connection management to prevent resource exhaustion
    trackConnection(ip) {
        if (!this.activeConnections) this.activeConnections = new Map();
        if (!this.maxConnectionsPerIP) this.maxConnectionsPerIP = 100;
        
        const count = (this.activeConnections.get(ip) || 0) + 1;
        this.activeConnections.set(ip, count);
        
        if (count > this.maxConnectionsPerIP) {
            console.warn(`[BotProtection] IP ${ip} exceeded max connections: ${count}`);
            return false; // Refuser la connexion
        }
        
        return true;
    }
    
    releaseConnection(ip) {
        if (!this.activeConnections) return;
        
        const count = (this.activeConnections.get(ip) || 1) - 1;
        if (count <= 0) {
            this.activeConnections.delete(ip);
        } else {
            this.activeConnections.set(ip, count);
        }
    }
    
    getActiveConnections(ip) {
        if (!this.activeConnections) return 0;
        return this.activeConnections.get(ip) || 0;
    }
}

const botProtection = new BotProtection();

module.exports = botProtection;
