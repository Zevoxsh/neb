const pool = require('../config/db');

async function getSetting(key) {
  const res = await pool.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [key]);
  if (!res || res.rowCount === 0) return null;
  return res.rows[0].value;
}

async function setSetting(key, value) {
  // Upsert
  await pool.query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
}

async function listSettings() {
  const res = await pool.query('SELECT key, value FROM settings');
  return res.rows;
}

module.exports = { getSetting, setSetting, listSettings };
