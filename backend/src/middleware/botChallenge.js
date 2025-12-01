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

    // Track request
    botProtection.trackRequest(ip);

    // Skip challenge for:
    // - API endpoints
    // - Static assets
    // - Challenge verification endpoint
    if (req.path.startsWith('/api') ||
        req.path.startsWith('/public') ||
        req.path === '/verify-challenge' ||
        req.path === '/challenge.html') {
        return next();
    }

    // Check if we should challenge this IP
    if (botProtection.shouldChallenge(ip)) {
        // Generate challenge
        const { token, timestamp } = botProtection.generateChallenge(ip);

        // Store in session/cookie for verification
        res.cookie('challenge_ts', timestamp, { httpOnly: true, maxAge: 30000 });

        // Send challenge page
        return res.sendFile(path.join(__dirname, '..', '..', 'public', 'challenge.html'));
    }

    next();
}

module.exports = { botChallengeMiddleware, getClientIp };
