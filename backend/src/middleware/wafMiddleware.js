const wafEngine = require('../services/wafEngine');
const alertService = require('../services/alertService');

/**
 * WAF Middleware
 * Analyzes requests for security threats and blocks malicious traffic
 */

async function wafMiddleware(req, res, next) {
  // Skip WAF for static assets and auth endpoints (optional)
  const skipPaths = [
    '/public/',
    '/favicon.ico',
    '/login',
    '/api/login'
  ];

  if (skipPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  try {
    const result = await wafEngine.analyzeRequest(req);

    if (result.blocked) {
      // Log security alert
      try {
        await alertService.createAlert({
          type: 'WAF_BLOCK',
          severity: result.score >= 10 ? 'high' : 'medium',
          ipAddress: req.ip,
          hostname: req.hostname,
          message: `WAF blocked request: ${result.reason}`,
          details: {
            path: req.path,
            method: req.method,
            violations: result.violations,
            score: result.score,
            userAgent: req.get('user-agent')
          }
        });
      } catch (alertError) {
        console.error('[WAF] Failed to create security alert:', alertError);
      }

      // Return 403 Forbidden
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Request blocked by Web Application Firewall',
        requestId: req.id || Date.now().toString()
      });
    }

    // Request is clean, continue
    next();
  } catch (error) {
    console.error('[WAF] Middleware error:', error);
    // On WAF error, allow request through (fail-open for availability)
    next();
  }
}

module.exports = wafMiddleware;
