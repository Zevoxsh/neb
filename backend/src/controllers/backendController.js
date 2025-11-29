const backendModel = require('../models/backendModel');
const proxyManager = require('../services/proxyManager');

async function list(req, res) {
  try {
    const rows = await backendModel.listBackends();
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function create(req, res) {
  const { name, targetHost, targetPort, targetProtocol } = req.body;
  console.log('backendController.create called with body:', req.body);
  if (!name || !targetHost || !targetPort) return res.status(400).send('Missing fields');
  try {
    const b = await backendModel.createBackend({ name, targetHost, targetPort: parseInt(targetPort, 10), targetProtocol: targetProtocol || 'http' });
    console.log('backendController.create inserted:', b);
    res.json(b);
    (async () => { try { await proxyManager.reloadAllProxies(); } catch (e) { console.error('backendController: failed to reload proxies', e); } })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    await backendModel.deleteBackend(id);
    res.sendStatus(204);
    (async () => { try { await proxyManager.reloadAllProxies(); } catch (e) { console.error('backendController: failed to reload proxies after delete', e); } })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, targetHost, targetPort, targetProtocol } = req.body;
  console.log('backendController.update called id=', id, 'body=', req.body);
  if (!id || !name || !targetHost || !targetPort) return res.status(400).send('Missing fields');
  try {
    const updated = await backendModel.updateBackend(id, { name, targetHost, targetPort: parseInt(targetPort, 10), targetProtocol: targetProtocol || 'http' });
    console.log('backendController.update result:', updated);
    if (!updated) return res.status(404).send('Backend not found');
    res.json(updated);
    (async () => { try { await proxyManager.reloadAllProxies(); } catch (e) { console.error('backendController: failed to reload proxies after update', e); } })();
  } catch (e) { console.error(e); res.status(500).send('Server error'); }
}

module.exports = { list, create, remove, update };
