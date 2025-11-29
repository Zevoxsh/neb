require('dotenv').config();
const metricsController = require('./backend/src/controllers/metricsController');
const httpMocks = require('node-mocks-http');
const proxyModel = require('./backend/src/models/proxyModel');
const metricsModel = require('./backend/src/models/metricsModel');

// Mock dependencies
proxyModel.listProxies = async () => [{ id: 1, name: 'test' }];
metricsModel.queryAggregatedPerProxy = async () => [{ proxy_id: 1, bucket: new Date().toISOString(), requests: 5 }];

async function verifyFix() {
    const req = httpMocks.createRequest({
        method: 'GET',
        url: '/api/metrics/combined',
        query: {
            last: '20',
            interval: '1'
        }
    });
    const res = httpMocks.createResponse();

    await metricsController.combined(req, res);

    const data = res._getJSONData();
    console.log('Server Time Present:', !!data.serverTime);
    console.log('Window Present:', !!data.window);

    if (data.serverTime && data.window) {
        console.log('Verification Passed: serverTime and window are present in response.');
        process.exit(0);
    } else {
        console.error('Verification Failed: serverTime or window missing.');
        process.exit(1);
    }
}

verifyFix();
