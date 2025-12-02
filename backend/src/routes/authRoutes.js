const express = require('express');
const router = express.Router();
const path = require('path');
const authController = require('../controllers/authController');
const { RateLimiter } = require('../utils/security');

// Rate limiter: 5 login attempts per minute per IP
const loginRateLimiter = new RateLimiter(5, 60000);

// Rate limiting middleware for login routes
function loginRateLimitMiddleware(req, res, next) {
  const ip = req.headers['cf-connecting-ip'] ||
             req.headers['x-real-ip'] ||
             req.headers['x-forwarded-for']?.split(',')[0].trim() ||
             req.connection?.remoteAddress ||
             req.socket?.remoteAddress ||
             req.ip;

  if (!loginRateLimiter.isAllowed(ip)) {
    console.warn(`[Auth] Rate limit exceeded for IP ${ip}`);
    return res.status(429).json({
      error: 'Too many login attempts. Please try again in 1 minute.',
      retryAfter: 60
    });
  }

  next();
}

// Serve the login page (fixed path relative to this file)
router.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'login.html')));
router.post('/login', loginRateLimitMiddleware, authController.webLogin);
router.post('/api/login', loginRateLimitMiddleware, authController.apiLogin);
router.get('/logout', authController.logout);

module.exports = router;
