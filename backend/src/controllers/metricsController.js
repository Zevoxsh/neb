/**
 * Metrics Controller (Refactored)
 */

const metricsModel = require('../models/metricsModel');
const proxyModel = require('../models/proxyModel');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { createLogger } = require('../utils/logger');

const logger = createLogger('MetricsController');

// GET /api/metrics
const aggregated = asyncHandler(async (req, res) => {
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

  logger.debug('Getting aggregated metrics', { proxyId: pid, interval: intervalSec });

  const rows = await metricsModel.queryAggregated(pid, fromTs.toISOString(), toTs.toISOString(), intervalSec);
  res.json(rows || []);
});

// GET /api/metrics/all
const allAggregated = asyncHandler(async (req, res) => {
  const { from, to, interval, last } = req.query;

  let toTs = to ? new Date(to) : new Date();
  let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

  if (last) {
    const sec = parseInt(last, 10) || 20;
    toTs = new Date();
    fromTs = new Date(toTs.getTime() - sec * 1000);
  }

  const intervalSec = parseInt(interval, 10) || 20;

  logger.debug('Getting all aggregated metrics', { interval: intervalSec });

  const rows = await metricsModel.queryAggregatedPerProxy(fromTs.toISOString(), toTs.toISOString(), intervalSec);
  res.json(rows || []);
});

// GET /api/metrics/combined
const combined = asyncHandler(async (req, res) => {
  const { from, to, interval, last } = req.query;

  let toTs = to ? new Date(to) : new Date();
  let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

  if (last) {
    const sec = parseInt(last, 10) || 20;
    toTs = new Date();
    fromTs = new Date(toTs.getTime() - sec * 1000);
  }

  const intervalSec = parseInt(interval, 10) || 20;

  logger.debug('Getting combined metrics', { interval: intervalSec });

  const metrics = await metricsModel.queryAggregatedPerProxy(fromTs.toISOString(), toTs.toISOString(), intervalSec);
  const proxies = await proxyModel.listProxies();

  res.json({
    proxies,
    metrics,
    serverTime: toTs.toISOString(),
    window: { from: fromTs.toISOString(), to: toTs.toISOString() }
  });
});

// GET /api/metrics/domains
const domainInsights = asyncHandler(async (req, res) => {
  const { from, to, interval, last } = req.query;

  let toTs = to ? new Date(to) : new Date();
  let fromTs = from ? new Date(from) : new Date(toTs.getTime() - 24 * 3600 * 1000);

  if (last) {
    const sec = parseInt(last, 10) || 20;
    toTs = new Date();
    fromTs = new Date(toTs.getTime() - sec * 1000);
  }

  const intervalSec = parseInt(interval, 10) || 300;

  logger.debug('Getting domain insights', { interval: intervalSec });

  const rows = await metricsModel.queryAggregatedPerDomain(fromTs.toISOString(), toTs.toISOString(), intervalSec);
  res.json({
    metrics: rows || [],
    window: { from: fromTs.toISOString(), to: toTs.toISOString() }
  });
});

// GET /api/metrics/stream (SSE)
function streamMetrics(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write(': connected\n\n');

  const proxyManager = require('../services/proxyManager');

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

module.exports = {
  aggregated,
  allAggregated,
  combined,
  domainInsights,
  streamMetrics
};
