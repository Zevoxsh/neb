const auditLogger = require('../services/auditLogger');

/**
 * Audit Middleware
 * Automatically logs API actions for audit trail
 */

/**
 * Create audit log middleware for specific actions
 * @param {Object} options - Configuration
 * @param {string} options.action - Action type (CREATE, UPDATE, DELETE, etc.)
 * @param {string} options.resource - Resource type (proxy, backend, domain, etc.)
 * @param {Function} options.getResourceId - Function to extract resource ID from req
 */
function auditMiddleware(options) {
  const { action, resource, getResourceId } = options;

  return async (req, res, next) => {
    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // Capture response
    let responseData = null;
    let isSuccess = false;

    res.json = function (data) {
      responseData = data;
      isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      return originalJson(data);
    };

    res.send = function (data) {
      responseData = data;
      isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      return originalSend(data);
    };

    // Log after response is sent
    res.on('finish', async () => {
      try {
        // Extract user info
        const userId = req.user?.id;
        const username = req.user?.username || 'anonymous';

        // Extract IP
        const ipAddress = req.headers['cf-connecting-ip'] ||
          req.headers['x-real-ip'] ||
          req.headers['x-forwarded-for']?.split(',')[0].trim() ||
          req.ip;

        // Get resource ID
        const resourceId = getResourceId ? getResourceId(req, responseData) : null;

        // Capture changes (before/after)
        const changes = {
          before: null,
          after: req.body
        };

        // Log the action
        if (isSuccess) {
          await auditLogger.logSuccess({
            action,
            resource,
            resourceId,
            userId,
            username,
            ipAddress,
            changes,
            metadata: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode
            }
          });
        } else if (res.statusCode >= 400) {
          await auditLogger.logFailure({
            action,
            resource,
            resourceId,
            userId,
            username,
            ipAddress,
            errorMessage: responseData?.error || responseData?.message || 'Unknown error',
            metadata: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode
            }
          });
        }
      } catch (error) {
        // Don't fail the request if audit logging fails
        console.error('Audit logging error:', error.message);
      }
    });

    next();
  };
}

/**
 * Audit middleware for authentication actions
 */
function auditAuthMiddleware(action) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let isSuccess = false;

    res.json = function (data) {
      isSuccess = res.statusCode >= 200 && res.statusCode < 300 && data?.ok !== false;
      return originalJson(data);
    };

    res.send = function (data) {
      isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      return originalSend(data);
    };

    res.on('finish', async () => {
      try {
        const username = req.body?.username || 'unknown';

        const ipAddress = req.headers['cf-connecting-ip'] ||
          req.headers['x-real-ip'] ||
          req.headers['x-forwarded-for']?.split(',')[0].trim() ||
          req.ip;

        if (isSuccess) {
          await auditLogger.logSuccess({
            action,
            resource: 'auth',
            resourceId: null,
            userId: req.user?.id || null,
            username,
            ipAddress,
            metadata: {
              userAgent: req.headers['user-agent'],
              method: action
            }
          });
        } else {
          await auditLogger.logFailure({
            action,
            resource: 'auth',
            resourceId: null,
            userId: null,
            username,
            ipAddress,
            errorMessage: 'Authentication failed',
            metadata: {
              userAgent: req.headers['user-agent'],
              method: action
            }
          });
        }
      } catch (error) {
        console.error('Audit logging error:', error.message);
      }
    });

    next();
  };
}

module.exports = {
  auditMiddleware,
  auditAuthMiddleware
};
