const pool = require('../config/db');
const dbState = require('../utils/dbState');

async function getSetting(key) {
  if (!dbState.isConnected()) return null;
  try {
    const res = await pool.query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [key]);
    if (!res || res.rowCount === 0) return null;
    return res.rows[0].value;
  } catch (error) {
    console.error('[settingsModel] getSetting failed:', error.message);
    return null;
  }
}

async function setSetting(key, value) {
  if (!dbState.isConnected()) {
    throw dbState.getUnavailableError();
  }
  try {
    await pool.query(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
  } catch (error) {
    console.error('[settingsModel] setSetting failed:', error.message);
    throw error;
  }
}

async function listSettings() {
  if (!dbState.isConnected()) return [];
  try {
    const res = await pool.query('SELECT key, value FROM settings');
    return res.rows;
  } catch (error) {
    console.error('[settingsModel] listSettings failed:', error.message);
    return [];
  }
}

module.exports = { getSetting, setSetting, listSettings };
