const pool = require('../src/config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('🔧 Adding dismissed_at columns to tables...');
    
    const sqlPath = path.join(__dirname, '../db/add_dismissed_columns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('   - Added dismissed_at column to security_alerts');
    console.log('   - Added dismissed_at column to request_logs');
    console.log('   - Added indexes for better performance');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
