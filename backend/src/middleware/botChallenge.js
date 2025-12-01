/**
 * Bot Challenge Middleware
 * Shows challenge page for unverified IPs when under attack
 */

const botProtection = require('../services/botProtection');
const path = require('path');

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
        req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress;
}

function botChallengeMiddleware(req, res, next) {
    const ip = getClientIp(req);

    // Skip challenge for:
    // - API endpoints (authenticated)
    // - Static assets
    // - Challenge verification endpoint
    const shouldSkip = req.path.startsWith('/api') ||
        req.path.startsWith('/public') ||
        req.path === '/verify-challenge' ||
        req.path === '/challenge.html';

    // Only track requests that can be challenged
    if (!shouldSkip) {
        // Track request
        botProtection.trackRequest(ip);

        // Check if we should challenge this IP
        if (botProtection.shouldChallenge(ip)) {
            // Generate challenge
            const { token, timestamp } = botProtection.generateChallenge(ip);

            // Store in session/cookie for verification
            res.cookie('challenge_ts', timestamp, { httpOnly: true, maxAge: 30000 });

            // Send challenge page
            return res.sendFile(path.join(__dirname, '..', '..', 'public', 'challenge.html'));
        }
    }

    next();
}

module.exports = { botChallengeMiddleware, getClientIp };
