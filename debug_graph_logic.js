const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function run() {
    try {
        // 1. Insert a fresh metric
        const now = new Date();
        console.log('Current Time (Node):', now.toISOString());

        await pool.query(
            'INSERT INTO metrics (proxy_id, ts, bytes_in, bytes_out, requests) VALUES ($1, $2, $3, $4, $5)',
            [5, now, 100, 100, 1]
        );
        console.log('Inserted metric at:', now.toISOString());

        // 2. Fetch like frontend
        // Frontend: const from = new Date(now.getTime() - 20000).toISOString();
        const from = new Date(now.getTime() - 20000).toISOString();
        const to = new Date(now.getTime() + 2000).toISOString(); // Add buffer for query delay

        console.log('Fetching from:', from, 'to:', to);

        const query = `
        SELECT 
          date_trunc('second', ts) as bucket, 
          SUM(requests) as requests
        FROM metrics 
        WHERE ts >= $1 AND ts <= $2
        GROUP BY bucket
        ORDER BY bucket ASC
    `;

        const res = await pool.query(query, [from, to]);
        const rows = res.rows;
        console.log('DB returned rows:', rows.length);
        if (rows.length > 0) {
            console.log('Last row:', rows[rows.length - 1]);
        }

        // 3. Simulate Frontend Logic
        // app.js: const now = Math.floor(Date.now() / 1000);
        const frontendNow = Math.floor(Date.now() / 1000);
        const labels = [];
        const dataMap = {};

        console.log('Frontend Now (sec):', frontendNow);

        for (let i = 19; i >= 0; i--) {
            const ts = new Date((frontendNow - i) * 1000);
            ts.setMilliseconds(0);
            const key = ts.toISOString();
            labels.push(key);
            dataMap[key] = 0;
        }

        console.log('Frontend Buckets (last 3):', labels.slice(-3));

        rows.forEach(row => {
            const d = new Date(row.bucket); // Postgres returns object or string? pg driver returns Date object for timestamp
            // app.js expects string or Date. 
            // If pg returns Date, d is Date.
            d.setMilliseconds(0);
            const key = d.toISOString();

            const match = dataMap.hasOwnProperty(key);
            if (match) {
                console.log('MATCH:', key, row.requests);
                dataMap[key] += Number(row.requests || 0);
            } else {
                console.log('NO MATCH:', key, '(Available buckets end at', labels[labels.length - 1], ')');
            }
        });

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
