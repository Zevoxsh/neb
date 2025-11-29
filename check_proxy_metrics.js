require('dotenv').config();
const pool = require('./backend/src/config/db');

async function checkProxyMetrics() {
    try {
        console.log('Checking metrics for Proxy 5 in the last 5 minutes...');
        const res = await pool.query(`
      SELECT * FROM metrics 
      WHERE proxy_id = 5 
      AND ts > NOW() - INTERVAL '5 minutes'
      ORDER BY ts DESC
    `);

        console.log(`Found ${res.rows.length} rows.`);
        res.rows.forEach(r => {
            console.log(`TS: ${r.ts.toISOString()} Req: ${r.requests} In: ${r.bytes_in}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkProxyMetrics();
