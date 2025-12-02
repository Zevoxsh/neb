const pool = require('../config/db');

async function findByUsername(username) {
  try {
    const res = await pool.query(`
      SELECT id, username, password_hash,
             twofa_enabled, twofa_secret, twofa_backup_codes, twofa_verified_at
      FROM users WHERE username = $1
    `, [username]);
    return res.rows[0];
  } catch (error) {
    // Fallback if 2FA columns don't exist yet
    if (error.code === '42703') {
      const res = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
      return res.rows[0];
    }
    throw error;
  }
}

async function getUserById(id) {
  try {
    const res = await pool.query(`
      SELECT id, username, password_hash,
             twofa_enabled, twofa_secret, twofa_backup_codes, twofa_verified_at
      FROM users WHERE id = $1
    `, [id]);
    return res.rows[0];
  } catch (error) {
    // Fallback if 2FA columns don't exist yet
    if (error.code === '42703') {
      const res = await pool.query('SELECT id, username, password_hash FROM users WHERE id = $1', [id]);
      return res.rows[0];
    }
    throw error;
  }
}

async function createUser(username, passwordHash) {
  const res = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [username, passwordHash]);
  return res.rows[0];
}

async function updateUser2FASetup(userId, secret, hashedBackupCodes) {
  try {
    await pool.query(`
      UPDATE users SET
        twofa_secret = $2,
        twofa_backup_codes = $3,
        twofa_enabled = false
      WHERE id = $1
    `, [userId, secret, JSON.stringify(hashedBackupCodes)]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

async function enable2FA(userId) {
  try {
    await pool.query(`
      UPDATE users SET
        twofa_enabled = true,
        twofa_verified_at = now()
      WHERE id = $1
    `, [userId]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

async function disable2FA(userId) {
  try {
    await pool.query(`
      UPDATE users SET
        twofa_enabled = false,
        twofa_secret = NULL,
        twofa_backup_codes = NULL,
        twofa_verified_at = NULL
      WHERE id = $1
    `, [userId]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

async function updateBackupCodes(userId, hashedBackupCodes) {
  try {
    await pool.query(`
      UPDATE users SET twofa_backup_codes = $2
      WHERE id = $1
    `, [userId, JSON.stringify(hashedBackupCodes)]);
  } catch (error) {
    if (error.code !== '42703') throw error;
  }
}

module.exports = {
  findByUsername,
  getUserById,
  createUser,
  updateUser2FASetup,
  enable2FA,
  disable2FA,
  updateBackupCodes
};
