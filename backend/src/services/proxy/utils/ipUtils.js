/**
 * IP utility functions
 */

/**
 * Detect if a string is an IP address (IPv4 or IPv6)
 * @param {string} host - The hostname to check
 * @returns {boolean} True if host appears to be an IP address
 */
function isIpAddress(host) {
    if (!host || typeof host !== 'string') return false;
    // IPv4
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
    // IPv6 (heuristic: contains ':' or is bracketed)
    if (host.includes(':') || (host.startsWith('[') && host.endsWith(']'))) return true;
    return false;
}

/**
 * Normalize IP address (remove IPv6 prefix, convert localhost)
 * @param {string} raw - Raw IP address
 * @returns {string} Normalized IP address
 */
function normalizeIp(raw) {
    if (!raw) return '';
    if (raw.startsWith('::ffff:')) return raw.replace('::ffff:', '');
    if (raw === '::1') return '127.0.0.1';
    return raw;
}

module.exports = { isIpAddress, normalizeIp };
