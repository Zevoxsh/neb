#!/usr/bin/env node
/**
 * Simple CLI to refresh a domain screenshot using the server-side screenshot service.
 * Usage:
 *   node backend/scripts/refresh-domain.js <hostname|id>
 * Examples:
 *   node backend/scripts/refresh-domain.js vault.8paxcia.net
 *   node backend/scripts/refresh-domain.js 9
 */

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node backend/scripts/refresh-domain.js <hostname|id>');
  process.exit(2);
}

const screenshotService = require('../src/services/screenshotService');
const domainModel = require('../src/models/domainModel');

(async function main() {
  try {
    let hostname = null;
    let id = null;

    if (arg.indexOf('.') !== -1) {
      // looks like a hostname
      hostname = String(arg).trim();
      // try to find id from mapping
      try {
        const mappings = await domainModel.listDomainMappings();
        const mapping = mappings.find(m => m.hostname === hostname);
        if (mapping) id = mapping.id;
      } catch (e) {
        // ignore, we can proceed with hostname only
      }
    } else {
      id = Number(arg);
      if (isNaN(id)) {
        console.error('Argument must be a hostname or numeric id');
        process.exit(2);
      }
      // lookup hostname
      try {
        const mappings = await domainModel.listDomainMappings();
        const mapping = mappings.find(m => Number(m.id) === Number(id));
        if (mapping) hostname = mapping.hostname;
      } catch (e) {
        // ignore
      }
    }

    if (!hostname) {
      console.warn('Hostname not found in DB mapping; proceeding with provided input if it is a hostname');
      if (!arg || arg.indexOf('.') === -1) {
        console.error('Cannot determine hostname for id', id);
        process.exit(3);
      }
      hostname = arg;
    }

    console.log('Refreshing screenshot for', hostname, 'id=', id || '(unknown)');

    // accept optional port override as second CLI arg and optional waitMs as third arg
    const portArg = process.argv[3];
    const waitArg = process.argv[4];
    const opts = { method: 'local' };
    if (portArg && !isNaN(Number(portArg))) opts.targetPort = Number(portArg);
    if (waitArg && !isNaN(Number(waitArg))) opts.waitMs = Number(waitArg);

    const result = await screenshotService.refreshScreenshot(hostname, id || String(hostname), opts);

    if (result) {
      console.log('Screenshot refreshed:', result);
      process.exit(0);
    } else {
      console.error('Screenshot service returned no result');
      process.exit(4);
    }
  } catch (err) {
    console.error('Error refreshing screenshot:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    process.exit(5);
  }
})();
