require('dotenv').config();
const pool = require('./backend/src/config/db');

async function checkLatest() {
    try {
        const res = await pool.query('SELECT * FROM metrics ORDER BY ts DESC LIMIT 1');
        if (res.rows.length > 0) {
            console.log('Latest Metric TS:', res.rows[0].ts);
            console.log('Latest Metric Requests:', res.rows[0].requests);
        } else {
            console.log('No metrics found');
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkLatest();
