require('dotenv').config();
const net = require('net');
const pool = require('./backend/src/config/db');

async function getMetricsSum() {
    const res = await pool.query("SELECT sum(bytes_in) as total_in FROM metrics WHERE ts > NOW() - INTERVAL '10 seconds'");
    return parseInt(res.rows[0].total_in || 0, 10);
}

async function verify() {
    try {
        console.log('Initial metrics check...');
        const startSum = await getMetricsSum();
        console.log('Start Sum:', startSum);

        const client = new net.Socket();

        await new Promise((resolve) => client.connect(5000, '127.0.0.1', resolve));
        console.log('Connected to proxy');

        // Send 500 bytes
        const chunk = Buffer.alloc(500, 'a');
        client.write(chunk);
        console.log('Sent 500 bytes');

        // Wait 3 seconds for flush (flush interval is 1s)
        await new Promise(r => setTimeout(r, 3000));

        const midSum = await getMetricsSum();
        console.log('Mid Sum:', midSum);

        if (midSum <= startSum) {
            console.error('FAIL: Metrics did not increase after sending data (connection still open)');
            client.destroy();
            process.exit(1);
        } else {
            console.log('PASS: Metrics increased while connection open');
        }

        client.destroy();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

verify();
