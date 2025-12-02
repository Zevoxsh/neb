#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const pool = require('../src/config/db');

async function whitelistAdminIP() {
  const adminIP = process.argv[2] || '82.64.136.176';
  
  console.log('========================================');
  console.log('Whitelist Admin IP Tool');
  console.log('========================================');
  console.log('IP to whitelist:', adminIP);
  console.log('');

  try {
    // 1. Add to trusted_ips table
    const insertResult = await pool.query(
      `INSERT INTO trusted_ips (ip, label) 
       VALUES ($1, $2) 
       ON CONFLICT (ip) DO UPDATE SET label = $2
       RETURNING id, ip, label`,
      [adminIP, 'Admin IP - Auto-whitelisted']
    );

    console.log('✅ IP added to trusted_ips table:');
    console.log('   ID:', insertResult.rows[0].id);
    console.log('   IP:', insertResult.rows[0].ip);
    console.log('   Label:', insertResult.rows[0].label);
    console.log('');

    // 2. Remove from blocked_ips if present
    const deleteResult = await pool.query(
      'DELETE FROM blocked_ips WHERE ip = $1 RETURNING ip',
      [adminIP]
    );

    if (deleteResult.rowCount > 0) {
      console.log('✅ IP removed from blocked_ips table');
    } else {
      console.log('ℹ️  IP was not in blocked_ips table');
    }
    console.log('');

    // 3. Show current trusted IPs
    const allTrusted = await pool.query(
      'SELECT ip, label FROM trusted_ips ORDER BY created_at DESC LIMIT 10'
    );

    console.log('Current Trusted IPs:');
    console.log('────────────────────────────────────────');
    allTrusted.rows.forEach(row => {
      console.log(`  ${row.ip.padEnd(20)} - ${row.label || '(no label)'}`);
    });
    console.log('');

    console.log('✅ Done! Your IP is now whitelisted.');
    console.log('   You can now access the proxy without being banned.');
    console.log('   Please restart the backend server for changes to take effect.');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

// Run the script
whitelistAdminIP();
