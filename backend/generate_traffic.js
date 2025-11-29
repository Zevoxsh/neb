const http = require('http');

function makeRequest() {
    const req = http.request({
        hostname: 'localhost',
        port: 5000,
        method: 'GET',
        path: '/'
    }, (res) => {
        console.log(`Status: ${res.statusCode}`);
        res.resume();
    });
    req.on('error', (e) => console.error(`Problem with request: ${e.message}`));
    req.end();
}

console.log('Generating traffic to localhost:5000...');
setInterval(makeRequest, 500); // 2 requests per second
