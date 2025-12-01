/**
 * Error Handler Middleware
 * Centralized error handling for Express routes
 */

/**
 * Custom error class for application errors
 */
class AppError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = true; // Distinguish from programming errors
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function errorHandler(err, req, res, next) {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';
    let details = err.details || null;

    // Log error
    if (statusCode >= 500) {
        console.error('[ERROR]', {
            message: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
        });
    } else {
        console.warn('[WARNING]', {
            message: err.message,
            path: req.path,
            method: req.method,
            statusCode
        });
    }

    // Don't leak stack traces in production
    const isDev = process.env.NODE_ENV === 'development';

    res.status(statusCode).json({
        error: {
            message,
            ...(details && { details }),
            ...(isDev && { stack: err.stack })
        }
    });
}

/**
 * Async handler wrapper to catch promise rejections
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res, next) {
    const err = new AppError(`Route not found: ${req.method} ${req.path}`, 404);
    next(err);
}

module.exports = {
    AppError,
    errorHandler,
    asyncHandler,
    notFoundHandler
};
