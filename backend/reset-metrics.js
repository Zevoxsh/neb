const pool = require('./src/config/db');

async function resetMetrics() {
  try {
    console.log('Resetting metrics table...');
    await pool.query('TRUNCATE TABLE metrics RESTART IDENTITY CASCADE');
    console.log('Metrics table reset successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error resetting metrics:', err);
    process.exit(1);
  }
}

resetMetrics();
