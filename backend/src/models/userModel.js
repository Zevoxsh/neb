const pool = require('../config/db');

async function findByUsername(username) {
  const res = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  return res.rows[0];
}

async function createUser(username, passwordHash) {
  const res = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [username, passwordHash]);
  return res.rows[0];
}

module.exports = { findByUsername, createUser };
