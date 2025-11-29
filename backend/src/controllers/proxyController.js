const proxyModel = require('../models/proxyModel');
const proxyManager = require('../services/proxyManager');

async function list(req, res) {
  try {
    const rows = await proxyModel.listProxies();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

async function create(req, res) {
  const { name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, enabled, vhosts } = req.body;
  if (!name || !listen_host || !listen_port || !target_host || !target_port) return res.status(400).send('Missing fields');
  const proto = (protocol || 'tcp').toLowerCase();
  const listenProto = (listen_protocol || proto).toLowerCase();
  const targetProto = (target_protocol || proto).toLowerCase();
  try {
    const result = await proxyModel.createProxy({ name, protocol: proto, listen_protocol: listenProto, target_protocol: targetProto, listen_host, listen_port: parseInt(listen_port,10), target_host, target_port: parseInt(target_port,10), vhosts: vhosts || null, enabled: enabled === true });
    const id = result.id;
    try { proxyManager.startProxy(id, listenProto, listen_host, parseInt(listen_port,10), targetProto, target_host, parseInt(target_port,10), vhosts || null); } catch (e) { console.error('Start proxy failed', e.message); }
    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    proxyManager.stopProxy(id);
    await proxyModel.deleteProxy(id);
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, enabled, vhosts } = req.body;
  if (!id || !name || !listen_host || !listen_port || !target_host || !target_port) return res.status(400).send('Missing fields');
  const proto = (protocol || 'tcp').toLowerCase();
  const listenProto = (listen_protocol || proto).toLowerCase();
  const targetProto = (target_protocol || proto).toLowerCase();
  try {
    proxyManager.stopProxy(id); // stop current
    const updated = await proxyModel.updateProxy(id, { name, protocol: proto, listen_protocol: listenProto, target_protocol: targetProto, listen_host, listen_port: parseInt(listen_port,10), target_host, target_port: parseInt(target_port,10), vhosts: vhosts || null, enabled: enabled === true });
    if (updated.enabled) {
      try { proxyManager.startProxy(updated.id, updated.listen_protocol || updated.protocol || 'tcp', updated.listen_host, updated.listen_port, updated.target_protocol || updated.protocol || 'tcp', updated.target_host, updated.target_port, updated.vhosts || null); } catch (e) { console.error('Start proxy failed', e.message); }
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

module.exports = { list, create, remove, update };
