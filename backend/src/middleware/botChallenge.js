/**
 * Bot Challenge Middleware
 * Shows challenge page for unverified IPs when under attack
 */

const botProtection = require('../services/botProtection');
const path = require('path');

function getClientIp(req) {
    return req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0].trim() ||
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

    // Only track and check requests that can be challenged
    if (!shouldSkip) {
        // Track request
        botProtection.trackRequest(ip);

        // Check if we should challenge this IP
        const challengeStatus = botProtection.shouldChallenge(ip);
        
        if (challengeStatus === 'banned') {
            // IP is banned
            res.status(403);
            res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Accès refusé</title>
<style>body{font-family:sans-serif;background:#000;color:#fff;text-align:center;padding:50px}
.box{background:#0a0a0a;border:1px solid #333;border-radius:12px;padding:40px;max-width:500px;margin:0 auto}
h1{color:#ff4444}p{color:#888;line-height:1.6}</style></head><body><div class="box">
<h1>🚫 Accès Refusé</h1>
<p>Votre adresse IP a été temporairement bloquée en raison de tentatives suspectes.</p>
<p>Veuillez réessayer dans quelques minutes.</p></div></body></html>`);
            return;
        }
        
        if (challengeStatus) {
            // Generate challenge
            botProtection.generateChallenge(ip);

            // Send challenge page
            return res.sendFile(path.join(__dirname, '..', '..', 'public', 'challenge.html'));
        }
    }

    next();
}

module.exports = { botChallengeMiddleware, getClientIp };
