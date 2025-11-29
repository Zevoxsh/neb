const jwt = require('jsonwebtoken');

function isApiRequest(req) {
  const accept = req.headers && req.headers.accept;
  return (req.path && req.path.startsWith('/api')) || (accept && accept.indexOf('application/json') !== -1) || req.xhr;
}

function authenticateToken(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) {
    if (isApiRequest(req)) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login');
  }
  jwt.verify(token, process.env.JWT_SECRET || 'changeme', (err, user) => {
    if (err) {
      if (isApiRequest(req)) return res.status(401).json({ error: 'Invalid token' });
      return res.redirect('/login');
    }
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken };
