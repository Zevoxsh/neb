const metricsModel = require('../models/metricsModel');
const proxyModel = require('../models/proxyModel');
const proxyManager = require('../services/proxyManager');

// GET /api/metrics?from=ISO&to=ISO&interval=20&proxyId=123&last=20
async function aggregated(req, res) {
  try {
    const { from, to, interval, proxyId, last } = req.query;
    let toTs = to ? new Date(to) : new Date();
    let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

    if (last) {
      const sec = parseInt(last, 10) || 20;
      toTs = new Date();
      fromTs = new Date(toTs.getTime() - sec * 1000);
    }

    const intervalSec = parseInt(interval, 10) || 20;
    const pid = proxyId ? parseInt(proxyId, 10) : null;
    const rows = await metricsModel.queryAggregated(pid, fromTs.toISOString(), toTs.toISOString(), intervalSec);
    res.json(rows);
  } catch (e) {
    console.error('metrics aggregated error', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

// GET /api/metrics/all?from=ISO&to=ISO&interval=20&last=20
// Returns aggregated rows for all proxies in one call. Each row contains proxy_id, bucket, bytes_in, bytes_out, requests
async function allAggregated(req, res) {
  try {
    const { from, to, interval, last } = req.query;
    let toTs = to ? new Date(to) : new Date();
    let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

    if (last) {
      const sec = parseInt(last, 10) || 20;
      toTs = new Date();
      fromTs = new Date(toTs.getTime() - sec * 1000);
    }

    const intervalSec = parseInt(interval, 10) || 20;
    const rows = await metricsModel.queryAggregatedPerProxy(fromTs.toISOString(), toTs.toISOString(), intervalSec);
    res.json(rows);
  } catch (e) {
    console.error('metrics allAggregated error', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

// Combined endpoint: return proxy list and aggregated metrics in one response
async function combined(req, res) {
  try {
    const { from, to, interval, last } = req.query;
    let toTs = to ? new Date(to) : new Date();
    let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

    if (last) {
      const sec = parseInt(last, 10) || 20;
      toTs = new Date();
      fromTs = new Date(toTs.getTime() - sec * 1000);
    }

    const intervalSec = parseInt(interval, 10) || 20;
    const metrics = await metricsModel.queryAggregatedPerProxy(fromTs.toISOString(), toTs.toISOString(), intervalSec);
    const proxies = await proxyModel.listProxies();

    // Return serverTime so client can align graphs correctly
    res.json({
      proxies,
      metrics,
      serverTime: toTs.toISOString(),
      window: { from: fromTs.toISOString(), to: toTs.toISOString() }
    });
  } catch (e) {
    console.error('metrics combined error', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { aggregated, allAggregated, combined };

// SSE stream for real-time metrics flush events
function streamMetrics(req, res) {
  // authentication handled in routes via middleware
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(': connected\n\n');

  const onFlush = (samples) => {
    try {
      const payload = JSON.stringify({ type: 'flush', samples });
      res.write(`data: ${payload}\n\n`);
    } catch (e) { }
  };

  proxyManager.emitter.on('flush', onFlush);

  req.on('close', () => {
    try { proxyManager.emitter.removeListener('flush', onFlush); } catch (e) { }
  });
}

module.exports.streamMetrics = streamMetrics;
