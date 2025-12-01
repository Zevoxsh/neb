const pool = require('../src/config/db');

async function addColumn() {
  try {
    console.log('Adding bot_protection column to domain_mappings...');
    
    await pool.query(`
      ALTER TABLE domain_mappings 
      ADD COLUMN IF NOT EXISTS bot_protection VARCHAR(20) DEFAULT 'default'
    `);
    
    console.log('Column added successfully');
    
    await pool.query(`
      UPDATE domain_mappings 
      SET bot_protection = 'default' 
      WHERE bot_protection IS NULL
    `);
    
    console.log('Existing rows updated');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addColumn();
