const settingsModel = require('../models/settingsModel');
const acmeManager = require('../services/acmeManager');

async function getLocalTlds(req, res) {
  try {
    const raw = await settingsModel.getSetting('local_tlds');
    const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : acmeManager.getLocalTlds();
    res.json({ localTlds: list });
  } catch (e) {
    console.error('settingsController.getLocalTlds error', e);
    res.status(500).send('Server error');
  }
}

async function updateLocalTlds(req, res) {
  try {
    const body = req.body || {};
    let list = [];
    if (Array.isArray(body.localTlds)) list = body.localTlds;
    else if (typeof body.localTlds === 'string') list = body.localTlds.split(',').map(s => s.trim()).filter(Boolean);
    else return res.status(400).send('localTlds required');

    // Persist as comma-separated string
    await settingsModel.setSetting('local_tlds', list.join(','));

    // Update acmeManager runtime list
    acmeManager.setLocalTlds(list);

    res.json({ ok: true, localTlds: list });
  } catch (e) {
    console.error('settingsController.updateLocalTlds error', e);
    res.status(500).send('Server error');
  }
}

module.exports = { getLocalTlds, updateLocalTlds };
