const { createLogger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const logger = createLogger('GeoBlocking');

/**
 * Geo-Blocking Service
 * Block or allow requests based on geographic location
 *
 * Note: For production use, integrate with MaxMind GeoIP2 or similar
 * This implementation provides the framework
 */

class GeoBlockingService {
  constructor() {
    this.enabled = process.env.GEO_BLOCKING_ENABLED === 'true';
    this.mode = process.env.GEO_BLOCKING_MODE || 'blacklist'; // 'blacklist' or 'whitelist'

    // Load country lists
    this.loadCountryLists();

    // GeoIP database (optional)
    this.geoipReader = null;
    this.initializeGeoIP();

    logger.info('Geo-blocking initialized', {
      enabled: this.enabled,
      mode: this.mode,
      blacklistedCountries: this.blacklistedCountries.size,
      whitelistedCountries: this.whitelistedCountries.size
    });
  }

  /**
   * Load country lists from environment or config
   */
  loadCountryLists() {
    // Blacklist (block these countries)
    const blacklist = process.env.GEO_BLACKLIST_COUNTRIES || '';
    this.blacklistedCountries = new Set(
      blacklist.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    );

    // Whitelist (only allow these countries)
    const whitelist = process.env.GEO_WHITELIST_COUNTRIES || '';
    this.whitelistedCountries = new Set(
      whitelist.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    );

    // High-risk countries (add extra scrutiny)
    const highRisk = process.env.GEO_HIGH_RISK_COUNTRIES || '';
    this.highRiskCountries = new Set(
      highRisk.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    );
  }

  /**
   * Initialize GeoIP database (MaxMind)
   */
  async initializeGeoIP() {
    try {
      // Check if MaxMind database exists
      const dbPath = process.env.GEOIP_DB_PATH || path.join(__dirname, '..', '..', 'data', 'GeoLite2-Country.mmdb');

      if (!fs.existsSync(dbPath)) {
        logger.warn('GeoIP database not found', { dbPath });
        logger.info('Using IP-to-country mapping fallback');
        return;
      }

      // Load MaxMind reader (requires maxmind npm package)
      const maxmind = require('maxmind');
      this.geoipReader = await maxmind.open(dbPath);

      logger.info('GeoIP database loaded successfully', { dbPath });
    } catch (error) {
      logger.warn('Failed to load GeoIP database', { error: error.message });
      logger.info('Geo-blocking will use header-based detection only');
    }
  }

  /**
   * Get country code from IP address
   */
  getCountryCode(ip) {
    // Try GeoIP database first
    if (this.geoipReader) {
      try {
        const result = this.geoipReader.get(ip);
        if (result && result.country && result.country.iso_code) {
          return result.country.iso_code;
        }
      } catch (error) {
        logger.debug('GeoIP lookup failed', { ip, error: error.message });
      }
    }

    // Fallback: try to determine from headers or known IP ranges
    return this.getCountryFromIPRange(ip);
  }

  /**
   * Simple IP range to country mapping (fallback)
   * In production, use a proper GeoIP database
   */
  getCountryFromIPRange(ip) {
    // This is a very simplified example
    // In production, use MaxMind GeoIP2 or similar

    // Known public IP ranges for demonstration
    const ipRanges = {
      'US': [
        { start: '8.0.0.0', end: '8.255.255.255' },
        { start: '104.0.0.0', end: '104.255.255.255' }
      ],
      'CN': [
        { start: '1.0.0.0', end: '1.0.255.255' },
        { start: '27.0.0.0', end: '27.255.255.255' }
      ],
      'RU': [
        { start: '5.0.0.0', end: '5.255.255.255' },
        { start: '31.0.0.0', end: '31.255.255.255' }
      ]
      // Add more ranges as needed
    };

    const ipNum = this.ipToNumber(ip);

    for (const [country, ranges] of Object.entries(ipRanges)) {
      for (const range of ranges) {
        const startNum = this.ipToNumber(range.start);
        const endNum = this.ipToNumber(range.end);

        if (ipNum >= startNum && ipNum <= endNum) {
          return country;
        }
      }
    }

    return 'UNKNOWN';
  }

  /**
   * Convert IP address to number for comparison
   */
  ipToNumber(ip) {
    const parts = ip.split('.');
    return parts.reduce((acc, part, index) => {
      return acc + (parseInt(part) << (8 * (3 - index)));
    }, 0);
  }

  /**
   * Check if request from IP is allowed
   */
  isAllowed(ip, headers = {}) {
    if (!this.enabled) {
      return { allowed: true };
    }

    // Get country code
    let countryCode = this.getCountryCode(ip);

    // Also check CF-IPCountry header (Cloudflare)
    if (!countryCode || countryCode === 'UNKNOWN') {
      countryCode = headers['cf-ipcountry'] || countryCode;
    }

    if (!countryCode || countryCode === 'UNKNOWN') {
      // Unknown country - allow by default or block based on config
      const allowUnknown = process.env.GEO_ALLOW_UNKNOWN !== 'false';
      logger.debug('Unknown country for IP', { ip, allowed: allowUnknown });
      return {
        allowed: allowUnknown,
        reason: allowUnknown ? null : 'unknown_country',
        countryCode: 'UNKNOWN'
      };
    }

    logger.debug('Geo-blocking check', { ip, countryCode, mode: this.mode });

    // Check based on mode
    if (this.mode === 'whitelist') {
      // Whitelist mode: only allow listed countries
      const allowed = this.whitelistedCountries.has(countryCode);
      return {
        allowed,
        reason: allowed ? null : 'country_not_whitelisted',
        countryCode,
        isHighRisk: this.highRiskCountries.has(countryCode)
      };
    } else {
      // Blacklist mode: block listed countries
      const blocked = this.blacklistedCountries.has(countryCode);
      return {
        allowed: !blocked,
        reason: blocked ? 'country_blacklisted' : null,
        countryCode,
        isHighRisk: this.highRiskCountries.has(countryCode)
      };
    }
  }

  /**
   * Add country to blacklist
   */
  addToBlacklist(countryCode) {
    countryCode = countryCode.toUpperCase();
    this.blacklistedCountries.add(countryCode);
    logger.info('Country added to blacklist', { countryCode });
  }

  /**
   * Remove country from blacklist
   */
  removeFromBlacklist(countryCode) {
    countryCode = countryCode.toUpperCase();
    this.blacklistedCountries.delete(countryCode);
    logger.info('Country removed from blacklist', { countryCode });
  }

  /**
   * Add country to whitelist
   */
  addToWhitelist(countryCode) {
    countryCode = countryCode.toUpperCase();
    this.whitelistedCountries.add(countryCode);
    logger.info('Country added to whitelist', { countryCode });
  }

  /**
   * Remove country from whitelist
   */
  removeFromWhitelist(countryCode) {
    countryCode = countryCode.toUpperCase();
    this.whitelistedCountries.delete(countryCode);
    logger.info('Country removed from whitelist', { countryCode });
  }

  /**
   * Get configuration and stats
   */
  getStats() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      blacklistedCountries: Array.from(this.blacklistedCountries),
      whitelistedCountries: Array.from(this.whitelistedCountries),
      highRiskCountries: Array.from(this.highRiskCountries),
      geoipDatabaseLoaded: this.geoipReader !== null
    };
  }

  /**
   * Enable geo-blocking
   */
  enable() {
    this.enabled = true;
    logger.info('Geo-blocking enabled');
  }

  /**
   * Disable geo-blocking
   */
  disable() {
    this.enabled = false;
    logger.info('Geo-blocking disabled');
  }

  /**
   * Set mode (whitelist or blacklist)
   */
  setMode(mode) {
    if (mode !== 'whitelist' && mode !== 'blacklist') {
      throw new Error('Mode must be "whitelist" or "blacklist"');
    }
    this.mode = mode;
    logger.info('Geo-blocking mode changed', { mode });
  }
}

// Singleton instance
const geoBlocking = new GeoBlockingService();

module.exports = geoBlocking;
