const http = require('http');

function checkEndpoint(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:3000${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`GET ${path} -> ${res.statusCode}`);
                if (res.statusCode >= 400) {
                    console.log('Body:', data);
                }
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error(`GET ${path} failed:`, e.message);
            resolve(); // Don't reject, just log
        });
    });
}

async function run() {
    console.log('Checking API endpoints...');
    await checkEndpoint('/api/proxies');
    await checkEndpoint('/api/metrics/combined?last=20&interval=1');
}

run();
