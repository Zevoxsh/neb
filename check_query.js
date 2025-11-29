require('dotenv').config();
const metricsModel = require('./backend/src/models/metricsModel');

async function checkQuery() {
    try {
        const now = new Date();
        const from = new Date(now.getTime() - 20000).toISOString();
        const to = now.toISOString();
        const interval = 1;

        console.log(`Querying from ${from} to ${to} with interval ${interval}`);

        const rows = await metricsModel.queryAggregatedPerProxy(from, to, interval);
        console.log('Rows found:', rows.length);
        if (rows.length > 0) {
            console.log('Sample row:', JSON.stringify(rows[0], null, 2));
            console.log('Bucket type:', typeof rows[0].bucket);
            if (rows[0].bucket instanceof Date) console.log('Bucket is Date');
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkQuery();
