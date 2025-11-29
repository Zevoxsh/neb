require('dotenv').config();
const pool = require('./backend/src/config/db');
const fs = require('fs');

async function checkTime() {
    try {
        const jsTime = new Date().toISOString();
        const res = await pool.query("SELECT now() as db_now, now() AT TIME ZONE 'UTC' as db_utc");

        const output = `JS Time (UTC): ${jsTime}
DB Time (Local): ${res.rows[0].db_now}
DB Time (UTC): ${res.rows[0].db_utc}
`;
        fs.writeFileSync('time_check.txt', output);
        process.exit(0);
    } catch (err) {
        fs.writeFileSync('time_check.txt', 'Error: ' + err.message);
        process.exit(1);
    }
}

checkTime();
