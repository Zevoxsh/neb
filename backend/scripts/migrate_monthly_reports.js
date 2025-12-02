const pool = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('Running monthly reports migration...');

  try {
    const sqlPath = path.join(__dirname, '../../db/monthly_reports.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Monthly reports tables created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
