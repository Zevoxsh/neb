#!/usr/bin/env node
const path = require('path');
// ensure we load the repo root .env even when running this script from backend/
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const pool = require('../src/config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function generatePassword(len = 16) {
  return crypto.randomBytes(len).toString('base64').replace(/\/+|=|\+/g, '').slice(0, len);
}

async function resetAdmin() {
  const username = process.env.DEFAULT_ADMIN_USER || 'admin';
  const plain = await generatePassword(16);
  const hash = await bcrypt.hash(plain, 10);

  try {
    const res = await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id', [hash, username]);
    if (res.rowCount === 0) {
      await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);
      console.log('Inserted new admin user:', username);
    } else {
      console.log('Updated password for user:', username);
    }

    // close pool and output the generated password
    await pool.end();
    console.log('\nNEW_ADMIN_CREDENTIALS');
    console.log('Username:', username);
    console.log('Password:', plain);
  } catch (err) {
    console.error('Failed to reset admin password:', err.message || err);
    process.exit(1);
  }
}

resetAdmin();
