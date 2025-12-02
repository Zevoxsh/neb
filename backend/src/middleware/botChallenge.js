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
    // - Authenticated users (check for valid JWT cookie)
    const shouldSkip = req.path.startsWith('/api') ||
        req.path.startsWith('/public') ||
        req.path === '/verify-challenge' ||
        req.path === '/challenge.html' ||
        req.cookies?.token; // Skip if user has authentication token

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
            // Get or generate challenge for this IP
            let challengeData = botProtection.getActiveChallenge(ip);
            if (!challengeData) {
                challengeData = botProtection.generateChallenge(ip);
                // Only log partial code for security (prevent code leakage in logs)
                console.log(`[BotChallenge-Middleware] New challenge generated for IP ${ip}, code: ${challengeData.code.substring(0,2)}****`);
            } else {
                console.log(`[BotChallenge-Middleware] Reusing existing challenge for IP ${ip}`);
            }

            // Read and inject challenge code into HTML
            const fs = require('fs');
            const challengePath = path.join(__dirname, '..', '..', 'public', 'challenge.html');
            
            if (fs.existsSync(challengePath)) {
                let html = fs.readFileSync(challengePath, 'utf8');
                
                // XSS protection: escape code before injection
                const escapeHtml = (str) => {
                    return String(str).replace(/[&<>"']/g, char => ({
                        '&': '&amp;',
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#39;'
                    })[char]);
                };
                
                const safeCode = escapeHtml(challengeData.code);
                html = html.replace('{{CHALLENGE_CODE}}', safeCode);
                
                res.writeHead(200, { 
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': Buffer.byteLength(html)
                });
                return res.end(html);
            } else {
                // Fallback if file not found
                res.status(503).send('<h1>Challenge page not found</h1>');
                return;
            }
        }
    }

    next();
}

module.exports = { botChallengeMiddleware, getClientIp };
