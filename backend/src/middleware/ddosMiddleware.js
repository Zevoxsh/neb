const ddosProtection = require('../services/ddosProtection');
const geoBlocking = require('../services/geoBlocking');
const { createLogger } = require('../utils/logger');

const logger = createLogger('DDoSMiddleware');

/**
 * DDoS Protection Middleware
 * Integrates DDoS protection and geo-blocking into request pipeline
 */

function ddosProtectionMiddleware(req, res, next) {
  // Extract real IP
  const ip = req.headers['cf-connecting-ip'] ||
             req.headers['x-real-ip'] ||
             req.headers['x-forwarded-for']?.split(',')[0].trim() ||
             req.connection?.remoteAddress ||
             req.socket?.remoteAddress ||
             req.ip;

  // Track connection
  const connectionAllowed = ddosProtection.trackConnection(ip);
  if (!connectionAllowed) {
    logger.warn('Connection limit exceeded', { ip });
    return res.status(429).json({
      error: 'Too many connections',
      message: 'Connection limit exceeded. Please try again later.'
    });
  }

  // Mark connection as established
  ddosProtection.connectionEstablished(ip);

  // Cleanup on response finish
  res.on('finish', () => {
    ddosProtection.releaseConnection(ip);
  });

  // Analyze request
  const requestAnalysis = ddosProtection.analyzeRequest(
    ip,
    req.path,
    req.method,
    req.headers
  );

  if (!requestAnalysis.allowed) {
    logger.warn('Request blocked by DDoS protection', {
      ip,
      reason: requestAnalysis.reason,
      path: req.path
    });

    return res.status(429).json({
      error: 'Request blocked',
      reason: requestAnalysis.reason,
      message: 'Your request has been blocked due to suspicious activity.'
    });
  }

  // Geo-blocking check
  const geoCheck = geoBlocking.isAllowed(ip, req.headers);

  if (!geoCheck.allowed) {
    logger.warn('Request blocked by geo-blocking', {
      ip,
      countryCode: geoCheck.countryCode,
      reason: geoCheck.reason
    });

    return res.status(403).json({
      error: 'Access denied',
      reason: geoCheck.reason,
      message: 'Access from your country is not allowed.'
    });
  }

  // Add country info to request for logging
  if (geoCheck.countryCode) {
    req.geoInfo = {
      countryCode: geoCheck.countryCode,
      isHighRisk: geoCheck.isHighRisk
    };
  }

  // Log high-risk country access
  if (geoCheck.isHighRisk) {
    logger.info('High-risk country access', {
      ip,
      countryCode: geoCheck.countryCode,
      path: req.path
    });
  }

  next();
}

/**
 * Optional: Apply to specific routes only
 */
function ddosProtectionForRoute(options = {}) {
  return (req, res, next) => {
    // Can customize behavior per route
    const customLimits = options.customLimits || {};

    // Apply protection
    ddosProtectionMiddleware(req, res, next);
  };
}

module.exports = {
  ddosProtectionMiddleware,
  ddosProtectionForRoute
};
