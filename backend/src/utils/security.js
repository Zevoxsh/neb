/**
 * Security Utilities
 * Fonctions de validation et sanitization réutilisables
 */

// Regex précompilées pour performances
const IPV4_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_REGEX = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9_-]+$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Valide un nom de domaine selon RFC 1035
 * @param {string} domain - Le domaine à valider
 * @returns {boolean}
 */
function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') return false;
    
    const clean = domain.trim().toLowerCase();
    
    // Longueur maximale
    if (clean.length > 253) return false;
    
    // Format
    if (!DOMAIN_REGEX.test(clean)) return false;
    
    // Chaque label ne doit pas dépasser 63 caractères
    const labels = clean.split('.');
    for (const label of labels) {
        if (label.length > 63) return false;
    }
    
    return true;
}

/**
 * Valide une adresse IP (v4 ou v6)
 * @param {string} ip - L'IP à valider
 * @returns {boolean}
 */
function isValidIP(ip) {
    if (!ip || typeof ip !== 'string') return false;
    return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip);
}

/**
 * Échappe les caractères HTML pour prévenir XSS
 * @param {string} str - La chaîne à échapper
 * @returns {string}
 */
function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

/**
 * Sanitize un nom de domaine
 * @param {string} domain - Le domaine à nettoyer
 * @returns {string|null} - Le domaine nettoyé ou null si invalide
 */
function sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') return null;
    
    const clean = domain.trim().toLowerCase();
    
    if (!isValidDomain(clean)) return null;
    
    return clean;
}

/**
 * Valide une chaîne alphanumérique (avec dash et underscore)
 * @param {string} str - La chaîne à valider
 * @param {number} maxLength - Longueur maximale (défaut: 128)
 * @returns {boolean}
 */
function isAlphanumeric(str, maxLength = 128) {
    if (!str || typeof str !== 'string') return false;
    if (str.length > maxLength) return false;
    return ALPHANUMERIC_REGEX.test(str);
}

/**
 * Valide un email
 * @param {string} email - L'email à valider
 * @returns {boolean}
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    if (email.length > 254) return false;
    return EMAIL_REGEX.test(email);
}

/**
 * Rate limiter simple basé sur Token Bucket
 */
class TokenBucket {
    constructor(capacity, refillRate) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillRate; // tokens per second
        this.lastRefill = Date.now();
    }
    
    refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(
            this.capacity,
            this.tokens + (elapsed * this.refillRate)
        );
        this.lastRefill = now;
    }
    
    consume(tokens = 1) {
        this.refill();
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return true;
        }
        return false;
    }
    
    getAvailableTokens() {
        this.refill();
        return Math.floor(this.tokens);
    }
}

/**
 * Circuit Breaker pour protection des backends
 */
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = 0;
    }
    
    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker open');
            }
            this.state = 'HALF_OPEN';
        }
        
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (err) {
            this.onFailure();
            throw err;
        }
    }
    
    onSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
    }
    
    onFailure() {
        this.failures++;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }
    
    getState() {
        return this.state;
    }
}

/**
 * Limite le taux de requêtes par clé (IP, user, etc)
 */
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = new Map(); // key => [timestamps]
    }
    
    isAllowed(key) {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        
        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }
        
        const timestamps = this.requests.get(key);
        
        // Nettoyer les anciennes timestamps
        const filtered = timestamps.filter(ts => ts > windowStart);
        this.requests.set(key, filtered);
        
        if (filtered.length >= this.maxRequests) {
            return false;
        }
        
        filtered.push(now);
        return true;
    }
    
    reset(key) {
        this.requests.delete(key);
    }
    
    cleanup() {
        const now = Date.now();
        const windowStart = now - this.windowMs;
        
        for (const [key, timestamps] of this.requests.entries()) {
            const filtered = timestamps.filter(ts => ts > windowStart);
            if (filtered.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, filtered);
            }
        }
    }
}

// Nettoyage périodique des rate limiters
setInterval(() => {
    // Cleanup sera appelé par les instances
}, 60000);

module.exports = {
    // Validation
    isValidDomain,
    isValidIP,
    isValidEmail,
    isAlphanumeric,
    
    // Sanitization
    sanitizeDomain,
    escapeHtml,
    
    // Classes utilitaires
    TokenBucket,
    CircuitBreaker,
    RateLimiter,
    
    // Regex exportées
    IPV4_REGEX,
    IPV6_REGEX,
    DOMAIN_REGEX,
    ALPHANUMERIC_REGEX,
    EMAIL_REGEX
};
