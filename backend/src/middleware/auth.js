const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
    process.exit(1);
}

function isApiRequest(req) {
  const accept = req.headers && req.headers.accept;
  return (req.path && req.path.startsWith('/api')) || (accept && accept.indexOf('application/json') !== -1) || req.xhr;
}

function authenticateToken(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    // Only log non-static resources
    if (!req.originalUrl.match(/\.(css|js|png|jpg|ico|svg|woff|woff2|ttf)$/)) {
      console.log(`[Auth] 🔐 Missing token: ${req.method} ${req.originalUrl}`);
    }
    if (isApiRequest(req)) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login');
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log(`[Auth] ⚠️ Invalid token: ${req.method} ${req.originalUrl} - ${err.message}`);
      if (isApiRequest(req)) return res.status(401).json({ error: 'Invalid token' });
      return res.redirect('/login');
    }
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken };
