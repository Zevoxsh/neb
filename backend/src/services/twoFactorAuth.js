const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

/**
 * Two-Factor Authentication Service
 * Implements TOTP (Time-based One-Time Password) using Google Authenticator
 */

class TwoFactorAuthService {
  /**
   * Generate a new 2FA secret for a user
   * @param {string} username - Username for the account
   * @param {string} issuer - Issuer name (e.g., "Nebula Proxy")
   * @returns {Object} { secret, qrCodeUrl, backupCodes }
   */
  async generateSecret(username, issuer = 'Nebula Proxy') {
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${issuer} (${username})`,
      issuer: issuer,
      length: 32
    });

    // Generate QR code data URL
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    // Generate backup codes (8 codes, 8 characters each)
    const backupCodes = this.generateBackupCodes(8);

    console.log(`[2FA] Generated secret for user ${username}`);

    return {
      secret: secret.base32, // Store this in database
      qrCodeUrl, // Display to user for scanning
      backupCodes, // Display to user and store hashed in DB
      otpauthUrl: secret.otpauth_url
    };
  }

  /**
   * Verify a TOTP token
   * @param {string} token - 6-digit token from authenticator app
   * @param {string} secret - User's secret (from database)
   * @returns {boolean} True if token is valid
   */
  verifyToken(token, secret) {
    if (!token || !secret) {
      return false;
    }

    // Remove spaces and dashes from token
    const cleanToken = token.replace(/[\s-]/g, '');

    // Verify with window of ±1 time step (30 seconds before/after)
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: cleanToken,
      window: 1 // Allow 1 step tolerance (30 seconds)
    });

    if (verified) {
      console.log('[2FA] Token verified successfully');
    } else {
      console.warn('[2FA] Token verification failed');
    }

    return verified;
  }

  /**
   * Generate backup codes for emergency access
   * @param {number} count - Number of backup codes to generate
   * @returns {Array<string>} Array of backup codes
   */
  generateBackupCodes(count = 8) {
    const codes = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    for (let i = 0; i < count; i++) {
      let code = '';
      for (let j = 0; j < 8; j++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      // Format: XXXX-XXXX
      code = code.substring(0, 4) + '-' + code.substring(4);
      codes.push(code);
    }

    return codes;
  }

  /**
   * Hash backup codes for storage
   * @param {Array<string>} codes - Backup codes to hash
   * @returns {Array<string>} Hashed backup codes
   */
  async hashBackupCodes(codes) {
    const bcrypt = require('bcrypt');
    const hashed = [];

    for (const code of codes) {
      const hash = await bcrypt.hash(code.replace('-', ''), 10);
      hashed.push(hash);
    }

    return hashed;
  }

  /**
   * Verify a backup code
   * @param {string} code - Backup code provided by user
   * @param {Array<string>} hashedCodes - Hashed backup codes from database
   * @returns {number} Index of matched code, or -1 if no match
   */
  async verifyBackupCode(code, hashedCodes) {
    const bcrypt = require('bcrypt');
    const cleanCode = code.replace(/[\s-]/g, '');

    for (let i = 0; i < hashedCodes.length; i++) {
      const match = await bcrypt.compare(cleanCode, hashedCodes[i]);
      if (match) {
        console.log(`[2FA] Backup code ${i} verified`);
        return i;
      }
    }

    console.warn('[2FA] Backup code verification failed');
    return -1;
  }

  /**
   * Generate current TOTP token (for testing)
   * @param {string} secret - Secret key
   * @returns {string} Current 6-digit token
   */
  generateToken(secret) {
    return speakeasy.totp({
      secret: secret,
      encoding: 'base32'
    });
  }

  /**
   * Check if 2FA is required for a user
   * @param {Object} user - User object from database
   * @returns {boolean} True if 2FA is enabled and required
   */
  isRequired(user) {
    return user.twofa_enabled === true && user.twofa_secret !== null;
  }

  /**
   * Validate 2FA setup (during enrollment)
   * @param {string} secret - Generated secret
   * @param {string} token - Token entered by user
   * @returns {boolean} True if setup is valid
   */
  validateSetup(secret, token) {
    // Verify that the user can generate valid tokens
    return this.verifyToken(token, secret);
  }
}

// Singleton instance
const twoFactorAuth = new TwoFactorAuthService();

module.exports = twoFactorAuth;
