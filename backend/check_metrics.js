require('dotenv').config();
const pool = require('./src/config/db');

async function check() {
    try {
        const resCount = await pool.query('SELECT COUNT(*) FROM metrics');
        console.log('Total metrics count:', resCount.rows[0].count);

        const resRecent = await pool.query('SELECT * FROM metrics ORDER BY ts DESC LIMIT 5');
        console.log('Recent metrics:', resRecent.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
