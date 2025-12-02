/**
 * WAF (Web Application Firewall) Engine
 * Implements OWASP Top 10 protection rules
 */

class WAFEngine {
  constructor() {
    this.enabled = process.env.WAF_ENABLED !== 'false';
    this.customRules = [];
    this.stats = {
      totalRequests: 0,
      blocked: 0,
      byType: {}
    };
  }

  /**
   * Analyze request for threats
   * Returns { blocked: boolean, reason: string, score: number }
   */
  async analyzeRequest(req) {
    if (!this.enabled) {
      return { blocked: false, reason: null, score: 0 };
    }

    this.stats.totalRequests++;

    let score = 0;
    const violations = [];

    // Check all rules
    const checks = [
      this.checkSQLInjection(req),
      this.checkXSS(req),
      this.checkPathTraversal(req),
      this.checkCommandInjection(req),
      this.checkLDAPInjection(req),
      this.checkXMLInjection(req),
      this.checkSSRF(req),
      this.checkHeaderInjection(req),
      this.checkSuspiciousUserAgent(req),
      ...this.customRules.map(rule => this.checkCustomRule(req, rule))
    ];

    for (const check of checks) {
      if (check.score > 0) {
        score += check.score;
        violations.push(check.type);
      }
    }

    // Score threshold for blocking (5 = block)
    const blocked = score >= 5;

    if (blocked) {
      this.stats.blocked++;
      violations.forEach(type => {
        this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
      });

      console.warn(`[WAF] Blocked request from ${req.ip}: ${violations.join(', ')} (score: ${score})`);
    }

    return {
      blocked,
      reason: blocked ? violations.join(', ') : null,
      score,
      violations
    };
  }

  /**
   * SQL Injection Detection
   */
  checkSQLInjection(req) {
    const patterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/gi,
      /(--|;|\/\*|\*\/|xp_|sp_)/gi,
      /('|")\s*(OR|AND)\s*('|")?\s*\d+\s*(=|<|>)/gi,
      /\b(UNION\s+SELECT|UNION\s+ALL\s+SELECT)\b/gi
    ];

    const score = this.scanPatterns(req, patterns, 5);
    return { score, type: 'SQL_INJECTION' };
  }

  /**
   * Cross-Site Scripting (XSS) Detection
   */
  checkXSS(req) {
    const patterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=\s*["'][^"']*["']/gi,
      /<iframe[^>]*>/gi,
      /<embed[^>]*>/gi,
      /<object[^>]*>/gi,
      /document\.(cookie|write|location)/gi,
      /window\.(location|open)/gi,
      /<img[^>]*\son\w+\s*=/gi
    ];

    const score = this.scanPatterns(req, patterns, 5);
    return { score, type: 'XSS' };
  }

  /**
   * Path Traversal Detection
   */
  checkPathTraversal(req) {
    const patterns = [
      /\.\.(\/|\\)/g,
      /%2e%2e(%2f|%5c)/gi,
      /(\.\.%2f|\.\.%5c)/gi,
      /\.\.\//g,
      /\.\.\\/g
    ];

    const urlScore = this.scanString(req.url, patterns, 5);
    const paramScore = this.scanParams(req, patterns, 5);

    return { score: Math.max(urlScore, paramScore), type: 'PATH_TRAVERSAL' };
  }

  /**
   * Command Injection Detection
   */
  checkCommandInjection(req) {
    const patterns = [
      /[;&|`$(){}[\]]/g,
      /\b(cat|ls|rm|mv|cp|chmod|chown|wget|curl|nc|netcat|bash|sh|python|perl|ruby|php)\b/gi,
      /(&&|\|\||;|\||`)/g
    ];

    const score = this.scanPatterns(req, patterns, 5);
    return { score, type: 'COMMAND_INJECTION' };
  }

  /**
   * LDAP Injection Detection
   */
  checkLDAPInjection(req) {
    const patterns = [
      /[*()|\\\&!]/g,
      /(\(|\)|\*|\|)/g
    ];

    const score = this.scanPatterns(req, patterns, 3);
    return { score, type: 'LDAP_INJECTION' };
  }

  /**
   * XML Injection Detection
   */
  checkXMLInjection(req) {
    const patterns = [
      /<!ENTITY/gi,
      /<!DOCTYPE/gi,
      /SYSTEM\s+"file:/gi
    ];

    const bodyScore = req.body && typeof req.body === 'string' ?
      this.scanString(req.body, patterns, 5) : 0;

    return { score: bodyScore, type: 'XML_INJECTION' };
  }

  /**
   * Server-Side Request Forgery (SSRF) Detection
   */
  checkSSRF(req) {
    const patterns = [
      /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|0:0:0:0:0:0:0:1)\b/gi,
      /\b(169\.254\.\d+\.\d+)\b/g, // AWS metadata
      /\b(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)\b/g // Private IPs
    ];

    const score = this.scanPatterns(req, patterns, 5);
    return { score, type: 'SSRF' };
  }

  /**
   * Header Injection Detection
   */
  checkHeaderInjection(req) {
    let score = 0;

    // Check for CRLF injection in headers
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && (/\r|\n/.test(value) || /\r|\n/.test(key))) {
        score += 5;
        break;
      }
    }

    return { score, type: 'HEADER_INJECTION' };
  }

  /**
   * Suspicious User-Agent Detection
   */
  checkSuspiciousUserAgent(req) {
    const ua = req.headers['user-agent'] || '';

    const suspiciousPatterns = [
      /sqlmap/i,
      /nikto/i,
      /nmap/i,
      /masscan/i,
      /nessus/i,
      /burp/i,
      /acunetix/i,
      /w3af/i,
      /metasploit/i,
      /havij/i
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(ua)) {
        return { score: 5, type: 'SUSPICIOUS_USER_AGENT' };
      }
    }

    return { score: 0, type: 'SUSPICIOUS_USER_AGENT' };
  }

  /**
   * Custom Rule Checker
   */
  checkCustomRule(req, rule) {
    try {
      const pattern = new RegExp(rule.pattern, rule.flags || 'gi');
      const score = this.scanPatterns(req, [pattern], rule.score || 3);
      return { score, type: `CUSTOM_${rule.name.toUpperCase()}` };
    } catch (error) {
      console.error('[WAF] Invalid custom rule:', error.message);
      return { score: 0, type: 'CUSTOM_ERROR' };
    }
  }

  /**
   * Scan request against multiple patterns
   */
  scanPatterns(req, patterns, scorePerMatch) {
    let maxScore = 0;

    // Scan URL
    const urlScore = this.scanString(req.url, patterns, scorePerMatch);
    maxScore = Math.max(maxScore, urlScore);

    // Scan query params
    const paramScore = this.scanParams(req, patterns, scorePerMatch);
    maxScore = Math.max(maxScore, paramScore);

    // Scan body (if present)
    if (req.body) {
      const bodyStr = typeof req.body === 'string' ?
        req.body : JSON.stringify(req.body);
      const bodyScore = this.scanString(bodyStr, patterns, scorePerMatch);
      maxScore = Math.max(maxScore, bodyScore);
    }

    return maxScore;
  }

  /**
   * Scan a string against patterns
   */
  scanString(str, patterns, scorePerMatch) {
    if (!str) return 0;

    for (const pattern of patterns) {
      if (pattern.test(str)) {
        return scorePerMatch;
      }
    }

    return 0;
  }

  /**
   * Scan query/body parameters
   */
  scanParams(req, patterns, scorePerMatch) {
    const params = { ...req.query, ...req.params };

    for (const value of Object.values(params)) {
      if (typeof value === 'string') {
        const score = this.scanString(value, patterns, scorePerMatch);
        if (score > 0) return score;
      }
    }

    return 0;
  }

  /**
   * Add custom WAF rule
   */
  addCustomRule(rule) {
    this.customRules.push(rule);
    console.log(`[WAF] Added custom rule: ${rule.name}`);
  }

  /**
   * Remove custom rule
   */
  removeCustomRule(name) {
    const index = this.customRules.findIndex(r => r.name === name);
    if (index !== -1) {
      this.customRules.splice(index, 1);
      console.log(`[WAF] Removed custom rule: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get WAF statistics
   */
  getStats() {
    return {
      ...this.stats,
      blockRate: this.stats.totalRequests > 0 ?
        (this.stats.blocked / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%',
      customRulesCount: this.customRules.length
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      blocked: 0,
      byType: {}
    };
  }

  /**
   * Enable/disable WAF
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[WAF] ${enabled ? 'Enabled' : 'Disabled'}`);
  }
}

// Singleton instance
const wafEngine = new WAFEngine();

module.exports = wafEngine;
