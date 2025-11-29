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
                        if (json.metrics && json.metrics.length > 0) {
                            console.log('Metrics found:', json.metrics.length);
                            console.log('Sample:', JSON.stringify(json.metrics[0]));
                            console.log('ServerTime:', json.serverTime);
                        } else {
                            console.log('No metrics in response');
                            console.log('Full response:', data);
                        }
                    } catch (e) {
                        console.log('Body:', data);
                    }
                } else {
                    console.log('Body:', data);
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

async function run() {
    // Need cookie for auth? The previous check failed with 401.
    // I need to bypass auth or login.
    // Or I can temporarily disable auth in the route for testing?
    // Or I can use the `check_query.js` approach which uses the model directly, 
    // but I want to test the API layer (controller + response format).

    // Let's try to login first? No, too complex.
    // I'll assume the user is logged in.
    // But `check_api.js` is running from node, not browser.

    // I will use a mock request to the controller directly in a script, 
    // similar to verify_fix.js but with real DB.

    // Wait, verify_fix.js mocked the DB.
    // I want real DB + Controller logic.

    // Let's modify verify_fix.js to use REAL metricsModel but mock Request/Response.
}

// Actually, let's just use the model check I did before?
// No, I need to see if the controller returns the right JSON structure (serverTime).
// verify_fix.js verified the structure.
// check_proxy_metrics.js verified the DB content.

// If DB has data, and Controller has logic (verified by verify_fix), 
// then the API *should* return data.

// Maybe the "interval" logic is filtering it out?
// DB has `ts`. Controller does `queryAggregated`.
// Let's simulate the controller call with real DB.

const metricsController = require('./backend/src/controllers/metricsController');
const httpMocks = require('node-mocks-http');
const proxyModel = require('./backend/src/models/proxyModel');
// We need real metricsModel
const metricsModel = require('./backend/src/models/metricsModel');

async function checkControllerWithRealDB() {
    const req = httpMocks.createRequest({
        method: 'GET',
        url: '/api/metrics/combined',
        query: {
            last: '600', // Last 10 minutes to be sure
            interval: '1'
        }
    });
    const res = httpMocks.createResponse();

    await metricsController.combined(req, res);

    const data = res._getJSONData();
    console.log('Server Time:', data.serverTime);
    console.log('Metrics Count:', data.metrics ? data.metrics.length : 0);
    if (data.metrics && data.metrics.length > 0) {
        console.log('Sample Metric:', data.metrics[0]);
    }
    process.exit(0);
}

checkControllerWithRealDB();
