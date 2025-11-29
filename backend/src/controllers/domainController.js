const domainModel = require('../models/domainModel');
const proxyModel = require('../models/proxyModel');
const backendModel = require('../models/backendModel');
const acmeManager = require('../services/acmeManager');
const proxyManager = require('../services/proxyManager');

async function list(req, res) {
  try {
    const rows = await domainModel.listDomainMappings();
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function listForProxy(req, res) {
  const proxyId = parseInt(req.params.id, 10);
  if (!proxyId) return res.status(400).send('Invalid proxy id');
  try {
    const rows = await domainModel.listMappingsForProxy(proxyId);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function create(req, res) {
  const { hostname, proxyId, backendId, useProxyTarget } = req.body;
  if (!hostname || !proxyId) return res.status(400).send('Missing fields');
  try {
    let finalBackendId = null;
    if (useProxyTarget) {
      // get proxy target host/port and find or create backend record
      const proxy = await proxyModel.getProxyById(parseInt(proxyId, 10));
      if (!proxy) return res.status(400).send('Proxy not found');
      const th = proxy.target_host;
      const tp = proxy.target_port;
      let b = await backendModel.findBackendByHostPort(th, tp);
      if (!b) {
        // create a backend entry named after proxy
        b = await backendModel.createBackend({ name: `from-proxy-${proxy.id}`, targetHost: th, targetPort: tp, targetProtocol: proxy.target_protocol || proxy.protocol || 'tcp' });
      }
      finalBackendId = b.id;
    } else {
      if (!backendId) return res.status(400).send('Missing backendId');
      finalBackendId = parseInt(backendId, 10);
    }

    const m = await domainModel.createDomainMapping({ hostname, proxyId: parseInt(proxyId, 10), backendId: finalBackendId });
    res.json(m);

    // Reload proxy configuration so new domain mapping is active immediately
    (async () => {
      try {
        await proxyManager.reloadAllProxies();
      } catch (e) { console.error('domainController: failed to reload proxies', e); }
    })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { hostname, proxyId, backendId, useProxyTarget } = req.body;
  if (!id || !hostname || !proxyId) return res.status(400).send('Missing fields');

  try {
    let finalBackendId = null;
    if (useProxyTarget) {
      // get proxy target host/port and find or create backend record
      const proxy = await proxyModel.getProxyById(parseInt(proxyId, 10));
      if (!proxy) return res.status(400).send('Proxy not found');
      const th = proxy.target_host;
      const tp = proxy.target_port;
      let b = await backendModel.findBackendByHostPort(th, tp);
      if (!b) {
        // create a backend entry named after proxy
        b = await backendModel.createBackend({ name: `from-proxy-${proxy.id}`, targetHost: th, targetPort: tp, targetProtocol: proxy.target_protocol || proxy.protocol || 'tcp' });
      }
      finalBackendId = b.id;
    } else {
      if (!backendId) return res.status(400).send('Missing backendId');
      finalBackendId = parseInt(backendId, 10);
    }

    const m = await domainModel.updateDomainMapping(id, { hostname, proxyId: parseInt(proxyId, 10), backendId: finalBackendId });
    if (!m) return res.status(404).send('Domain not found');
    res.json(m);

    // Reload proxy configuration
    (async () => {
      try {
        await proxyManager.reloadAllProxies();
      } catch (e) { console.error('domainController: failed to reload proxies after update', e); }
    })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    await domainModel.deleteDomainMapping(id);
    res.sendStatus(204);
    (async () => {
      try { await proxyManager.reloadAllProxies(); } catch (e) { console.error('domainController: failed to reload proxies after delete', e); }
    })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

module.exports = { list, create, update, remove, listForProxy };
