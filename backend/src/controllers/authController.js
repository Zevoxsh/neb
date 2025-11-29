const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const userModel = require('../models/userModel');

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: 60 * 60 * 1000,
    secure: (process.env.COOKIE_SECURE === 'true') || (process.env.NODE_ENV === 'production'),
    sameSite: 'lax'
  };
}

async function webLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Username and password required');
  const user = await userModel.findByUsername(username);
  if (!user) return res.status(401).send('Invalid credentials');
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).send('Invalid credentials');
  const payload = { id: user.id, username: user.username };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'changeme', { expiresIn: '1h' });
  res.cookie('token', token, cookieOptions());
  return res.redirect('/');
}

async function apiLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await userModel.findByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const payload = { id: user.id, username: user.username };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'changeme', { expiresIn: '1h' });
  // Also set the auth cookie for API clients that use fetch with credentials
  try {
    res.cookie('token', token, cookieOptions());
  } catch (e) { /* ignore cookie set errors */ }
  return res.json({ ok: true });
}

function logout(req, res) {
  res.clearCookie('token');
  res.redirect('/login');
}

module.exports = { webLogin, apiLogin, logout };
