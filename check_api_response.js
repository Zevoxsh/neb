const http = require('http');

function checkEndpoint(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:3000${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`GET ${path} -> ${res.statusCode}`);
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        console.log('ServerTime:', json.serverTime);
                        if (json.metrics && json.metrics.length > 0) {
                            console.log('Sample Metric:', JSON.stringify(json.metrics[0], null, 2));
                            console.log('Bucket Type:', typeof json.metrics[0].bucket);
                        } else {
                            console.log('No metrics found in response.');
                        }
                    } catch (e) {
                        console.log('Error parsing JSON:', e.message);
                    }
                }
                resolve();
            });
        });
        req.on('error', (e) => {
            console.error(`GET ${path} failed:`, e.message);
            resolve();
        });
    });
}

checkEndpoint('/api/metrics/combined?last=600&interval=1');
