const proxyModel = require('../models/proxyModel');
const proxyManager = require('../services/proxyManager');

async function list(req, res) {
  try {
    const rows = await proxyModel.listProxies();
    return res.json(rows);
  } catch (err) {
    console.error('proxyController.list error', err);
    return res.status(500).send('Server error');
  }
}

async function create(req, res) {
  const { name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, enabled, vhosts } = req.body || {};
  try {
    console.log('proxyController.create called with body:', req.body);
    if (!name || !listen_host || !listen_port || !target_host || !target_port) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const proto = (protocol || 'tcp').toLowerCase();
    const listenProto = (listen_protocol || proto).toLowerCase();
    const targetProto = (target_protocol || proto).toLowerCase();

    const result = await proxyModel.createProxy({
      name,
      protocol: proto,
      listen_protocol: listenProto,
      target_protocol: targetProto,
      listen_host,
      listen_port: parseInt(listen_port, 10),
      target_host,
      target_port: parseInt(target_port, 10),
      vhosts: vhosts || null,
      enabled: enabled === true
    });
    console.log('proxyController.create inserted:', result);
    const id = result.id;
    try {
      proxyManager.startProxy(id, listenProto, listen_host, parseInt(listen_port, 10), targetProto, target_host, parseInt(target_port, 10), vhosts || null, null);
    } catch (e) {
      console.error('Start proxy failed', e && e.message ? e.message : e);
    }
    return res.json({ id });
  } catch (err) {
    console.error('proxyController.create error', err);
    return res.status(500).send('Server error');
  }
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    proxyManager.stopProxy(id);
    await proxyModel.deleteProxy(id);
    return res.sendStatus(204);
  } catch (err) {
    console.error('proxyController.remove error', err);
    return res.status(500).send('Server error');
  }
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, protocol, listen_protocol, target_protocol, listen_host, listen_port, target_host, target_port, enabled, vhosts } = req.body || {};
  try {
    console.log('proxyController.update called id=', id, 'body=', req.body);
    const existing = await proxyModel.getProxyById(id);
    if (!existing) return res.status(404).json({ error: 'Proxy not found' });

    const resolvedName = name || existing.name;
    const resolvedListenHost = listen_host || existing.listen_host;
    const resolvedListenPort = (listen_port !== undefined && listen_port !== null && listen_port !== '') ? parseInt(listen_port, 10) : existing.listen_port;
    const resolvedTargetHost = target_host || existing.target_host;
    const resolvedTargetPort = (target_port !== undefined && target_port !== null && target_port !== '') ? parseInt(target_port, 10) : existing.target_port;

    const missing = [];
    if (!id) missing.push('id');
    if (!resolvedName) missing.push('name');
    if (!resolvedListenHost) missing.push('listen_host');
    if (!resolvedListenPort) missing.push('listen_port');
    if (!resolvedTargetHost) missing.push('target_host');
    if (!resolvedTargetPort) missing.push('target_port');
    if (missing.length) return res.status(400).json({ error: 'Missing fields', missing });

    const proto = (protocol || 'tcp').toLowerCase();
    const listenProto = (listen_protocol || proto).toLowerCase();
    const targetProto = (target_protocol || proto).toLowerCase();

    proxyManager.stopProxy(id);
    const updated = await proxyModel.updateProxy(id, {
      name: resolvedName,
      protocol: proto,
      listen_protocol: listenProto,
      target_protocol: targetProto,
      listen_host: resolvedListenHost,
      listen_port: resolvedListenPort,
      target_host: resolvedTargetHost,
      target_port: resolvedTargetPort,
      vhosts: vhosts || existing.vhosts || null,
      enabled: enabled === true
    });
    console.log('proxyController.update result:', updated);
    if (updated && updated.enabled) {
      try {
        proxyManager.startProxy(
          updated.id,
          updated.listen_protocol || updated.protocol || 'tcp',
          updated.listen_host,
          updated.listen_port,
          updated.target_protocol || updated.protocol || 'tcp',
          updated.target_host,
          updated.target_port,
          updated.vhosts || null,
          updated.error_page_html || null
        );
      } catch (e) {
        console.error('Start proxy failed', e && e.message ? e.message : e);
      }
    }
    return res.json(updated);
  } catch (err) {
    console.error('proxyController.update error', err);
    return res.status(500).send('Server error');
  }
}

async function getErrorPage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    const html = await proxyModel.getErrorPage(id);
    return res.json({ html: html || '' });
  } catch (err) {
    console.error('proxyController.getErrorPage error', err);
    return res.status(500).send('Server error');
  }
}

async function updateErrorPage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  const { html } = req.body || {};
  if (html !== undefined && typeof html !== 'string') return res.status(400).send('Invalid html');
  try {
    const normalized = typeof html === 'string' ? html : null;
    const stored = await proxyModel.updateErrorPage(id, normalized);
    return res.json({ html: stored || '' });
  } catch (err) {
    console.error('proxyController.updateErrorPage error', err);
    return res.status(500).send('Server error');
  }
}

module.exports = { list, create, remove, update, getErrorPage, updateErrorPage };
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
  console.log('proxyController.create called with body:', req.body);
  if (!name || !listen_host || !listen_port || !target_host || !target_port) return res.status(400).send('Missing fields');
  const proto = (protocol || 'tcp').toLowerCase();
  const listenProto = (listen_protocol || proto).toLowerCase();
  const targetProto = (target_protocol || proto).toLowerCase();
  try {
    const result = await proxyModel.createProxy({ name, protocol: proto, listen_protocol: listenProto, target_protocol: targetProto, listen_host, listen_port: parseInt(listen_port,10), target_host, target_port: parseInt(target_port,10), vhosts: vhosts || null, enabled: enabled === true });
    console.log('proxyController.create inserted:', result);
    const id = result.id;
    try { proxyManager.startProxy(id, listenProto, listen_host, parseInt(listen_port,10), targetProto, target_host, parseInt(target_port,10), vhosts || null, null); } catch (e) { console.error('Start proxy failed', e.message); }
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
  console.log('proxyController.update called id=', id, 'body=', req.body);
  try {
    // fetch existing proxy so we can preserve fields the client may omit
    const existing = await proxyModel.getProxyById(id);
    if (!existing) return res.status(404).json({ error: 'Proxy not found' });

    // resolve fields: prefer request body, otherwise fall back to existing values
    const resolvedName = name || existing.name;
    const resolvedListenHost = listen_host || existing.listen_host;
    const resolvedListenPort = (listen_port !== undefined && listen_port !== null && listen_port !== '') ? parseInt(listen_port, 10) : existing.listen_port;
    const resolvedTargetHost = target_host || existing.target_host;
    const resolvedTargetPort = (target_port !== undefined && target_port !== null && target_port !== '') ? parseInt(target_port, 10) : existing.target_port;

    const missing = [];
    if (!id) missing.push('id');
    if (!resolvedName) missing.push('name');
    if (!resolvedListenHost) missing.push('listen_host');
    if (!resolvedListenPort) missing.push('listen_port');
    if (!resolvedTargetHost) missing.push('target_host');
    if (!resolvedTargetPort) missing.push('target_port');
    if (missing.length) return res.status(400).json({ error: 'Missing fields', missing });

    const proto = (protocol || 'tcp').toLowerCase();
    const listenProto = (listen_protocol || proto).toLowerCase();
    const targetProto = (target_protocol || proto).toLowerCase();

    proxyManager.stopProxy(id); // stop current
    const updated = await proxyModel.updateProxy(id, {
      name: resolvedName,
      protocol: proto,
      listen_protocol: listenProto,
      target_protocol: targetProto,
      listen_host: resolvedListenHost,
      listen_port: resolvedListenPort,
      target_host: resolvedTargetHost,
      target_port: resolvedTargetPort,
      vhosts: vhosts || existing.vhosts || null,
      enabled: enabled === true
    });
    console.log('proxyController.update result:', updated);
    if (updated.enabled) {
      try {
        proxyManager.startProxy(
          updated.id,
          updated.listen_protocol || updated.protocol || 'tcp',
          updated.listen_host,
          updated.listen_port,
          updated.target_protocol || updated.protocol || 'tcp',
          updated.target_host,
          updated.target_port,
          updated.vhosts || null,
          updated.error_page_html || null
        );
      } catch (e) { console.error('Start proxy failed', e.message); }
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

async function getErrorPage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  try {
    const html = await proxyModel.getErrorPage(id);
    res.json({ html: html || '' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

async function updateErrorPage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).send('Invalid id');
  const { html } = req.body || {};
  if (html !== undefined && typeof html !== 'string') return res.status(400).send('Invalid html');
  try {
    const normalized = typeof html === 'string' ? html : null;
    const stored = await proxyModel.updateErrorPage(id, normalized);
    res.json({ html: stored || '' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
}

module.exports = { list, create, remove, update, getErrorPage, updateErrorPage };

