require('dotenv').config();
const pool = require('./src/config/db');

async function test() {
    console.log('Testing DB connection...');
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('DB Connection successful:', res.rows[0]);
        process.exit(0);
    } catch (err) {
        console.error('DB Connection failed:', err);
        process.exit(1);
    }
}

test();
