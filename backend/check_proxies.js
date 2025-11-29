require('dotenv').config();
const pool = require('./src/config/db');

async function check() {
    try {
        const res = await pool.query('SELECT * FROM proxies');
        console.log('Proxies:', res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
