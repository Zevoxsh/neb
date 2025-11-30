const net = require('net');
const dgram = require('dgram');
const EventEmitter = require('events');
const metricsModel = require('../models/metricsModel');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const acmeManager = require('./acmeManager');
const domainModel = require('../models/domainModel');
const proxyModel = require('../models/proxyModel');
const backendModel = require('../models/backendModel');
const blockedIpModel = require('../models/blockedIpModel');
const trustedIpModel = require('../models/trustedIpModel');
const alertService = require('./alertService');

// simple helper to detect IP addresses (IPv4 or IPv6 heuristics)
function isIpAddress(host) {
  if (!host || typeof host !== 'string') return false;
  // IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (heuristic: contains ':' or is bracketed)
  if (host.includes(':') || host.startsWith('[') && host.endsWith(']')) return true;
  return false;
}

function normalizeIp(raw) {
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.replace('::ffff:', '');
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

class ProxyManager {
  constructor() {
    // store { type: 'tcp'|'udp', server: <server>, meta: ... }
    this.servers = new Map();
    // start periodic flush for in-memory metrics
    this.emitter = new EventEmitter();
    this.flushTimer = setInterval(() => { try { this.flushMetrics().catch(() => { }); } catch (e) { } }, this.flushIntervalSec * 1000);
    // track domains currently being requested for ACME issuance to avoid duplicate runs
    this.pendingAcme = new Set();
    // reload in progress flag
    this._reloading = false;
    this.blockedIps = new Set();
    this.trustedIps = new Set();
    this.ipActivity = new Map();
    this.domainActivity = new Map();
    this.alertLastSent = { ip: new Map(), domain: new Map() };
    this.securityConfig = {
      autoBlockIps: true,
      autoAlertDomains: true,
      ipBytesThreshold: 50 * 1024 * 1024,
      ipRequestsThreshold: 1000,
      domainBytesThreshold: 100 * 1024 * 1024,
      domainRequestsThreshold: 5000,
      cooldown: Number(process.env.ALERT_COOLDOWN_MS) || 15 * 60 * 1000
    };
    // backend failure tracking: Map<targetInfo, { count, downUntil }>
    this.backendFailures = new Map();
    this.failureThreshold = Number(process.env.BACKEND_FAILURE_THRESHOLD) || 3;
    this.failureCooldownMs = Number(process.env.BACKEND_FAILURE_COOLDOWN_MS) || 60 * 1000; // 1 minute
    this.backendConnectTimeoutMs = Number(process.env.BACKEND_CONNECT_TIMEOUT_MS) || 2000; // 2s
    this.healthProbeIntervalMs = Number(process.env.BACKEND_HEALTH_INTERVAL_MS) || 30000; // 30s
    this._healthProbeTimer = null;
    // start active health probe
    try { this._startHealthProbe(); } catch (e) { console.error('ProxyManager: failed to start health probe', e); }
  }

  async _startHealthProbe() {
    try {
      if (this._healthProbeTimer) return;
      // run immediately then schedule
      await this._runHealthProbe();
      this._healthProbeTimer = setInterval(() => { this._runHealthProbe().catch((e) => { console.error('Health probe error', e); }); }, this.healthProbeIntervalMs);
      console.log(`ProxyManager: backend health probe started (interval=${this.healthProbeIntervalMs}ms)`);
    } catch (e) { console.error('ProxyManager._startHealthProbe error', e); }
  }

  async _runHealthProbe() {
    try {
      const backends = await backendModel.listBackends();
      if (!backends || !Array.isArray(backends) || backends.length === 0) return;
      for (const b of backends) {
        try {
          const host = b.target_host;
          const port = Number(b.target_port) || 0;
          const targetInfo = `${host}:${port}`;
          // attempt TCP connect with timeout
          const ok = await this._tcpConnectCheck(host, port, this.backendConnectTimeoutMs);
          if (ok) {
            if (this.markBackendSuccess) this.markBackendSuccess(targetInfo);
          } else {
            if (this.markBackendFailure) this.markBackendFailure(targetInfo);
          }
        } catch (e) { /* per-backend ignore */ }
      }
    } catch (e) { console.error('ProxyManager._runHealthProbe error', e); }
  }

  _tcpConnectCheck(host, port, timeoutMs) {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let resolved = false;
      const onDone = (ok) => { if (resolved) return; resolved = true; try { sock.destroy(); } catch (e) { } resolve(ok); };
      sock.setTimeout(timeoutMs || 2000, () => onDone(false));
      sock.once('error', () => onDone(false));
      sock.once('connect', () => onDone(true));
      try { sock.connect(port, host); } catch (e) { onDone(false); }
      // safety timeout
      setTimeout(() => onDone(resolved ? false : false), (timeoutMs || 2000) + 100);
    });
  }

  backendIsDown(targetInfo) {
    try {
      // signature: backendIsDown(targetInfo, domain)
      const args = Array.from(arguments);
      const t = args[0];
      const domain = args[1] || '';
      if (!t) return false;
      const domainKey = `${t}|@|${domain}`;
      const hostKey = `${t}`;
      const recDomain = this.backendFailures.get(domainKey);
      if (recDomain && recDomain.downUntil && Date.now() < recDomain.downUntil) return true;
      const recHost = this.backendFailures.get(hostKey);
      if (recHost && recHost.downUntil && Date.now() < recHost.downUntil) return true;
      return false;
    } catch (e) { return false; }
  }

  markBackendFailure(targetInfo) {
    try {
      // signature: markBackendFailure(targetInfo, domain)
      const args = Array.from(arguments);
      const t = args[0];
      const domain = args[1] || '';
      if (!t) return;
      const key = `${t}|@|${domain}`;
      const now = Date.now();
      const rec = this.backendFailures.get(key) || { count: 0, downUntil: 0 };
      rec.count = (rec.count || 0) + 1;
      if (rec.count >= (this.failureThreshold || 3)) {
        rec.downUntil = now + (this.failureCooldownMs || 60000);
        console.warn(`ProxyManager: marking backend ${t} (domain=${domain || '<all>'}) as DOWN until ${new Date(rec.downUntil).toISOString()} (failures=${rec.count})`);
        // reset count to avoid overflow
        rec.count = 0;
      }
      this.backendFailures.set(key, rec);
    } catch (e) { }
  }

  markBackendSuccess(targetInfo) {
    try {
      // signature: markBackendSuccess(targetInfo, domain)
      const args = Array.from(arguments);
      const t = args[0];
      const domain = args[1];
      if (!t) return;
      if (domain !== undefined && domain !== null) {
        const key = `${t}|@|${domain || ''}`;
        if (this.backendFailures.has(key)) {
          this.backendFailures.delete(key);
          console.log(`ProxyManager: backend ${t} (domain=${domain || '<all>'}) marked UP`);
        }
        return;
      }
      // no domain provided: clear all entries for this host (host-only and domain-specific)
      const prefix = `${t}|@|`;
      const keys = Array.from(this.backendFailures.keys());
      for (const k of keys) {
        if (k === t || k.startsWith(prefix)) {
          this.backendFailures.delete(k);
        }
      }
      console.log(`ProxyManager: backend ${t} marked UP (cleared host and domain entries)`);
    } catch (e) { }
  }

  // in-memory metrics buffer and periodic flush
  // buffer: Map<proxyId, { bytesIn, bytesOut, requests }>
  metricsBuffer = new Map();
  flushIntervalSec = 1;
  flushTimer = null;

  addMetrics(proxyId, bytesIn = 0, bytesOut = 0, requests = 0) {
    try {
      const id = String(proxyId);
      // console.log(`addMetrics id=${id} req=${requests}`);
      const cur = this.metricsBuffer.get(id) || { bytesIn: 0, bytesOut: 0, requests: 0 };
      cur.bytesIn += Number(bytesIn || 0);
      cur.bytesOut += Number(bytesOut || 0);
      cur.requests += Number(requests || 0);
      this.metricsBuffer.set(id, cur);
    } catch (e) { }
  }

  async flushMetrics() {
    try {
      if (!this.metricsBuffer || this.metricsBuffer.size === 0) return;
      const samples = [];
      const now = Date.now();
      const bucket = new Date(Math.floor(now / (this.flushIntervalSec * 1000)) * (this.flushIntervalSec * 1000));
      for (const [pid, val] of this.metricsBuffer.entries()) {
        samples.push({ proxy_id: parseInt(pid, 10) || null, ts: bucket.toISOString(), bytes_in: val.bytesIn, bytes_out: val.bytesOut, requests: val.requests });
      }
      // clear buffer before writing
      this.metricsBuffer = new Map();
      if (samples.length) {
        // emit samples to any listeners (SSE/WebSocket) before/after DB write
        try { this.emitter.emit('flush', samples); } catch (e) { }
        try {
          console.log(`flushMetrics: writing ${samples.length} sample(s) for bucket ${bucket.toISOString()}`);
          await metricsModel.insertSamplesBatch(samples);
          console.log('flushMetrics: write successful');
          try { await this.evaluateAlerts(); } catch (alertErr) { console.error('flushMetrics alerts failed', alertErr); }
        } catch (dbErr) {
          console.error('flushMetrics: insertSamplesBatch failed', dbErr && dbErr.message ? dbErr.message : dbErr);
        }
      }
    } catch (e) {
      console.error('flushMetrics error', e && e.message ? e.message : e);
    }
    const pm = this;
  }

  updateSecurityConfig(config = {}) {
    try {
      this.securityConfig = Object.assign({}, this.securityConfig, config);
      console.log('ProxyManager: security config updated');
    } catch (e) {
      console.error('ProxyManager: failed to update security config', e);
    }
  }

  startProxy(id, listenProtocol, listenHost, listenPort, targetProtocol, targetHost, targetPort, vhosts, errorPageHtml = null) {
    if (this.servers.has(id)) throw new Error('Proxy already running');
    const pm = this;
    listenProtocol = (listenProtocol || 'tcp').toLowerCase();
    targetProtocol = (targetProtocol || 'tcp').toLowerCase();
    // normalize vhosts: accept object or JSON string
    let parsedVhosts = null;
    try {
      if (vhosts) parsedVhosts = (typeof vhosts === 'string') ? JSON.parse(vhosts) : vhosts;
    } catch (e) {
      console.error(`Proxy ${id} - invalid vhosts JSON`, e);
      parsedVhosts = null;
    }

    // create mutable entry with meta so handlers can read dynamic state (will be populated
    // further down when server is created)
    const entry = {
      id, type: listenProtocol, server: null, meta: {
        listenProtocol, listenHost, listenPort, targetProtocol, targetHost, targetPort, vhostMap: parsedVhosts || null,
        secureContextCache: new Map(), cert: null, key: null, errorPageHtml: errorPageHtml || null
      }
    };
    if (listenProtocol === 'tcp') {
      // plain TCP passthrough
      const server = net.createServer((clientSocket) => {
        clientSocket.on('error', (err) => console.error(`Proxy ${id} - client socket error (tcp)`, err));
        const remoteIp = normalizeIp(clientSocket.remoteAddress || '');
        if (pm.isIpBlocked(remoteIp)) {
          console.warn(`Proxy ${id} - blocked TCP connection from ${remoteIp}`);
          try { clientSocket.destroy(); } catch (e) { }
          return;
        }

        // Record connection immediately
        try { pm.addMetrics(id, 0, 0, 1); } catch (e) { }
        pm.trackIpTraffic(remoteIp, 0, 1);

        const targetSocket = net.connect({ host: entry.meta.targetHost, port: entry.meta.targetPort }, () => {
          clientSocket.pipe(targetSocket);
          targetSocket.pipe(clientSocket);
        });

        clientSocket.on('data', (c) => {
          const len = c ? c.length : 0;
          try { pm.addMetrics(id, len, 0, 0); } catch (e) { }
          pm.trackIpTraffic(remoteIp, len, 0);
        });
        targetSocket.on('data', (c) => {
          try { pm.addMetrics(id, 0, c ? c.length : 0, 0); } catch (e) { }
        });

        targetSocket.on('error', () => { try { clientSocket.destroy(); } catch (e) { } });
        clientSocket.on('error', () => { try { targetSocket.destroy(); } catch (e) { } });
      });
      server.on('error', (err) => console.error('Proxy server error', err.message));
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`TCP Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort} -> ${entry.meta.targetHost}:${entry.meta.targetPort}`);
      });
      entry.type = 'tcp';
      entry.server = server;
      this.servers.set(id, entry);
      return server;
    } else if (listenProtocol === 'udp') {
      // UDP proxy: listen for clients, forward to target, and forward responses back
      const serverSocket = dgram.createSocket('udp4');
      // upstream sockets per client to receive replies from target
      const upstreams = new Map();

      serverSocket.on('error', (err) => console.error('UDP proxy server error', err.message));

      serverSocket.on('message', (msg, rinfo) => {
        const key = `${rinfo.address}:${rinfo.port}`;
        let entry = upstreams.get(key);
        if (!entry) {
          const upstream = dgram.createSocket('udp4');
          upstream.on('message', (upMsg) => {
            // forward back to original client
            serverSocket.send(upMsg, rinfo.port, rinfo.address, (err) => { if (err) console.error('UDP forward back error', err); });
          });
          upstream.on('error', (e) => console.error('Upstream UDP error', e));
          // set a timeout to close idle upstreams
          entry = { upstream, timeout: null };
          upstreams.set(key, entry);
        }
        // reset idle timeout
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.timeout = setTimeout(() => { try { entry.upstream.close(); } catch (e) { } upstreams.delete(key); }, 30000);
        // send to target
        try { pm.addMetrics(id, msg.length, 0, 1); } catch (e) { }
        entry.upstream.send(msg, entry.meta.targetPort, entry.meta.targetHost, (err) => { if (err) console.error('UDP send to target failed', err); });
      });

      serverSocket.bind(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`UDP Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort} -> ${entry.meta.targetHost}:${entry.meta.targetPort}`);
      });

      entry.type = 'udp';
      entry.server = serverSocket;
      entry.upstreams = upstreams;
      this.servers.set(id, entry);
      return serverSocket;
    } else if (listenProtocol === 'http' && targetHost === '__REDIRECT__') {
      // Special mode: listen for HTTP and redirect clients to HTTPS on same host.
      const http = require('http');
      const server = http.createServer((req, res) => {
        try {
          // Record a request for metrics (this listener primarily redirects to HTTPS)
          try { pm.addMetrics(id, 0, 0, 1); } catch (e) { }

          const hostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : entry.meta.listenHost;
          const portSuffix = '';// default HTTPS port 443, do not include
          const location = `https://${hostHeader}${portSuffix}${req.url}`;
          res.writeHead(301, { Location: location });
          res.end(`Redirecting to ${location}`);
          console.log(`Proxy ${id} - redirected http ${req.url} -> ${location}`);
        } catch (e) {
          console.error(`Proxy ${id} - redirect handler error`, e);
          try { res.writeHead(500); res.end('Server error'); } catch (err) { }
        }
      });
      server.on('error', (err) => console.error('HTTP redirect server error', err));
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`HTTP->HTTPS Redirector ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort}`);
      });
      entry.type = 'http_redirect';
      entry.server = server;
      this.servers.set(id, entry);
      return server;
    } else if (listenProtocol === 'http' && targetProtocol === 'https') {
      // Special case: accept plaintext HTTP on port 80 but do NOT proxy arbitrary HTTP requests to backends.
      // Behavior:
      // - Serve ACME HTTP-01 challenges from /var/www/letsencrypt
      // - Redirect all other requests to https://<host><url> (301)
      const http = require('http');

      const handleRequest = async (req, res) => {
        try {
          // Count this request for metrics (ACME + redirect listener)
          try { pm.addMetrics(id, 0, 0, 1); } catch (e) { }
          if (req.url && req.url.startsWith('/.well-known/acme-challenge/')) {
            const prefix = '/.well-known/acme-challenge/';
            const rest = req.url.slice(prefix.length);
            const token = rest.split('/')[0];
            if (!token) {
              res.writeHead(404);
              return res.end('Not found');
            }
            // prevent path traversal
            if (token.includes('..') || token.includes('/')) {
              res.writeHead(400);
              return res.end('Bad request');
            }
            // Certbot places challenges in $WEBROOT/.well-known/acme-challenge/<token>
            // but other flows may write directly to $WEBROOT/<token>. Support both.
            const candidate1 = path.join('/var/www/letsencrypt', '.well-known', 'acme-challenge', token);
            const candidate2 = path.join('/var/www/letsencrypt', token);
            let webrootPath = null;
            try {
              if (fs.existsSync(candidate1)) {
                const st1 = fs.statSync(candidate1);
                if (st1.isFile()) webrootPath = candidate1;
              }
            } catch (e) { }
            if (!webrootPath) {
              try {
                if (fs.existsSync(candidate2)) {
                  const st2 = fs.statSync(candidate2);
                  if (st2.isFile()) webrootPath = candidate2;
                }
              } catch (e) { }
            }
            if (!webrootPath) {
              res.writeHead(404);
              return res.end('Not found');
            }
            const stream = fs.createReadStream(webrootPath);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return stream.pipe(res);
          }
        } catch (e) {
          // if any error, fall through to redirect
        }

        // Before redirecting, if this Host is new we trigger ACME issuance in background
        try {
          const hostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : listenHost;
          // debug: log resolved host header and raw headers to help diagnose ACME triggers
          try {
            console.log(`Proxy ${id} - HTTP ACME redirect incoming host resolution: hostHeader=${hostHeader}, rawHost=${req.headers && req.headers.host}, remote=${req.connection ? req.connection.remoteAddress : req.socket ? req.socket.remoteAddress : 'unknown'}`);
          } catch (e) { }
          if (hostHeader && !isIpAddress(hostHeader)) {
            const certDir = `/etc/letsencrypt/live/${hostHeader}`;
            const privkey = path.join(certDir, 'privkey.pem');
            if (!fs.existsSync(privkey)) {
              try {
                const exists = await domainModel.domainExists(hostHeader);
                try { console.log(`Proxy ${id} - domainExists(${hostHeader}) => ${exists}`); } catch (e) { }
                if (!exists) {
                  console.log(`Proxy ${id} - host ${hostHeader} not in domain_mappings; skipping ACME issuance`);
                } else {
                  // trigger ACME in background if not already pending
                  if (!pm.pendingAcme.has(hostHeader)) {
                    pm.pendingAcme.add(hostHeader);
                    console.log(`Proxy ${id} - triggering ACME issuance for ${hostHeader}`);
                    acmeManager.ensureCert(hostHeader).then(() => {
                      console.log(`Proxy ${id} - ACME issuance finished for ${hostHeader}`);
                    }).catch((e) => {
                      console.error(`Proxy ${id} - ACME issuance error for ${hostHeader}:`, e && e.message ? e.message : e);
                    }).finally(() => { try { pm.pendingAcme.delete(hostHeader); } catch (e) { } });
                  }

                  // Wait for certificate to appear (short polling) before redirecting to HTTPS
                  const maxWaitSec = 60;
                  let waited = 0;
                  while (waited < maxWaitSec) {
                    if (fs.existsSync(privkey)) break;
                    // sleep 1s
                    await new Promise(r => setTimeout(r, 1000));
                    waited++;
                  }
                  if (!fs.existsSync(privkey)) {
                    // Still no cert: inform client to retry later
                    res.writeHead(503, { 'Content-Type': 'text/html', 'Retry-After': String(Math.max(30, maxWaitSec)) });
                    return res.end(`<html><body><h1>Certificate en cours de génération</h1><p>Nous générons un certificat pour ${hostHeader}. Réessayez dans quelques instants.</p></body></html>`);
                  }
                }
              } catch (e) {
                console.error(`Proxy ${id} - error checking domain existence for ${hostHeader}:`, e && e.message ? e.message : e);
              }
            }
          } else if (hostHeader) {
            console.log(`Proxy ${id} - not triggering ACME for IP/invalid host: ${hostHeader}`);
          }

          const location = `https://${hostHeader}${req.url}`;
          res.writeHead(301, { Location: location });
          res.end(`Redirecting to ${location}`);
          console.log(`Proxy ${id} - HTTP->HTTPS redirect ${req.method} ${req.url} -> ${location}`);
        } catch (e) {
          console.error(`Proxy ${id} - redirect error`, e);
          try { res.writeHead(500); res.end('Server error'); } catch (err) { }
        }
      };

      const server = require('http').createServer(handleRequest);
      server.on('error', (err) => console.error('HTTP->HTTPS redirect server error', err));

      // By default bind HTTP ACME/redirect listener to localhost so fronting servers
      // (Plesk/nginx) can own public port 80. To force public binding, set
      // environment variable PROXY_PORT80_PUBLIC=true
      const publicBind = (process.env.PROXY_PORT80_PUBLIC === 'true');
      const bindHost = publicBind ? listenHost : '127.0.0.1';

      server.listen(entry.meta.listenPort, bindHost, () => {
        console.log(`HTTP listener ${id} (ACME + redirect) listening ${bindHost}:${entry.meta.listenPort} (public=${publicBind})`);
      });
      entry.type = 'http_acme_redirect';
      entry.server = server;
      this.servers.set(id, entry);
      return server;

    } else if (listenProtocol === 'https') {
      // Terminate TLS on proxy: accept HTTPS from client, forward to target (HTTP or HTTPS),
      // and rewrite Location and Set-Cookie headers so clients stay on the proxy host:port.
      const http = require('http');
      const https = require('https');
      const selfsigned = require('selfsigned');

      const forwardRequest = (req, res) => {
        try {
          // Count incoming request immediately so we record it even if upstream fails
          try { pm.addMetrics(id, 0, 0, 1); } catch (e) { }
          const incomingHostHeader = req.headers && req.headers.host ? req.headers.host : null;
          const headers = Object.assign({}, req.headers);
          // Preserve the original Host header when forwarding to upstream when possible
          if (incomingHostHeader) headers.host = incomingHostHeader; else headers.host = entry.meta.targetHost + (entry.meta.targetPort ? (':' + entry.meta.targetPort) : '');

          const options = {
            hostname: entry.meta.targetHost,
            port: entry.meta.targetPort,
            path: req.url,
            method: req.method,
            headers: Object.assign({}, headers, { connection: 'close' })
          };

          // choose upstream based on vhost mapping if present
          let useTargetHost2 = entry.meta.targetHost;
          let useTargetPort2 = entry.meta.targetPort;
          let useTargetProto2 = entry.meta.targetProtocol;
          try {
            const incomingHostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
            if (incomingHostHeader && entry.meta.vhostMap && entry.meta.vhostMap[incomingHostHeader]) {
              const m = entry.meta.vhostMap[incomingHostHeader];
              useTargetHost2 = m.targetHost || useTargetHost2;
              useTargetPort2 = m.targetPort || useTargetPort2;
              useTargetProto2 = (m.targetProtocol || useTargetProto2).toLowerCase();
              console.log(`Proxy ${id} - vhost match for ${incomingHostHeader} -> ${useTargetHost2}:${useTargetPort2} (${useTargetProto2})`);
            }
          } catch (e) { console.error(`Proxy ${id} - error selecting vhost`, e); }

          const useHttpsUpstream = (useTargetProto2 === 'https');
          if (useHttpsUpstream) options.agent = new https.Agent({ rejectUnauthorized: false });

          // override options hostname/port with selected upstream
          options.hostname = useTargetHost2;
          options.port = useTargetPort2;
          if (useHttpsUpstream) options.agent = new https.Agent({ rejectUnauthorized: false });

          const targetInfo = `${useTargetHost2}:${useTargetPort2}`;
          // resolve host-only for domain-aware checks
          const hostOnly = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
          // If this backend/domain is temporarily marked as down, short-circuit and return a friendly page
          try {
            if (pm.backendIsDown && pm.backendIsDown(targetInfo, hostOnly)) {
              console.warn(`Proxy ${id} - backend ${targetInfo} (domain=${hostOnly}) is marked DOWN, returning unavailable response`);
              pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly);
              return;
            }
          } catch (e) { }

          const upstream = (useHttpsUpstream ? https : http).request(options, (pres) => {
            const outHeaders = Object.assign({}, pres.headers);
            // Rewrite Location header to a relative path so the client stays on the same Host and to avoid redirect loops
            if (outHeaders.location && typeof outHeaders.location === 'string') {
              try {
                const loc = outHeaders.location;
                try {
                  const parsed2 = new URL(loc);
                  const relative2 = parsed2.pathname + (parsed2.search || '') + (parsed2.hash || '');
                  outHeaders.location = relative2;
                  console.log(`Proxy ${id} - rewritten Location header to relative: ${loc} -> ${relative2}`);
                } catch (e) {
                  const targetHostPort = `${entry.meta.targetHost}${entry.meta.targetPort ? (':' + entry.meta.targetPort) : ''}`;
                  const proxyHostPort = `${entry.meta.listenHost}${entry.meta.listenPort ? (':' + entry.meta.listenPort) : ''}`;
                  const newLoc = loc.replace(new RegExp(targetHostPort, 'g'), proxyHostPort).replace(new RegExp(entry.meta.targetHost, 'g'), entry.meta.listenHost + (entry.meta.listenPort ? (':' + entry.meta.listenPort) : ''));
                  outHeaders.location = newLoc;
                  console.log(`Proxy ${id} - rewritten Location header (fallback): ${loc} -> ${newLoc}`);
                }
              } catch (e) {
                console.error(`Proxy ${id} - error rewriting Location header`, e);
              }
            }

            // Rewrite Set-Cookie domain attributes so cookie binds to proxy host (remove Domain or replace)
            if (outHeaders['set-cookie']) {
              try {
                const cookies = Array.isArray(outHeaders['set-cookie']) ? outHeaders['set-cookie'] : [outHeaders['set-cookie']];
                const newCookies = cookies.map((c) => {
                  // Remove Domain attribute so cookie defaults to proxy host. Safer than rewriting to 0.0.0.0.
                  return c.replace(/;?\s*Domain=[^;]+/gi, '');
                });
                outHeaders['set-cookie'] = newCookies;
                console.log(`Proxy ${id} - rewritten Set-Cookie headers`);
              } catch (e) {
                console.error(`Proxy ${id} - error rewriting Set-Cookie`, e);
              }
            }

            try { const len = parseInt(pres.headers['content-length']) || 0; pm.addMetrics(id, 0, len, 1); } catch (e) { }
            // mark backend success/reset failure counter (domain-aware)
            try { if (pm.markBackendSuccess) pm.markBackendSuccess(targetInfo, hostOnly); } catch (e) { }
            console.log(`Forwarded ${req.method} ${req.url} -> ${useHttpsUpstream ? 'HTTPS' : 'HTTP'} ${useTargetHost2}:${useTargetPort2} [${pres.statusCode}]`);
            res.writeHead(pres.statusCode, outHeaders);
            pres.pipe(res);
          });
          // set a short timeout for backend connect/response to fail fast
          try {
            if (typeof upstream.setTimeout === 'function') {
              upstream.setTimeout(pm.backendConnectTimeoutMs, () => {
                try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfo, hostOnly); } catch (e) { }
                try {
                  const m = (req && req.method) ? req.method : 'UNKNOWN';
                  const u = (req && req.url) ? req.url : 'UNKNOWN';
                  console.warn(`Proxy ${id} - upstream timeout connecting to ${targetInfo} after ${pm.backendConnectTimeoutMs}ms (request=${m} ${u})`);
                } catch (e) { console.warn(`Proxy ${id} - upstream timeout connecting to ${targetInfo} after ${pm.backendConnectTimeoutMs}ms`); }
                try { upstream.destroy(new Error('connect timeout')); } catch (e) { try { upstream.abort && upstream.abort(); } catch (er) { } }
                try { pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly); } catch (e) { }
              });
            }
          } catch (e) { }

          upstream.on('error', (e) => {
            try {
              // record a failure for this backend so we can avoid hot loops
              try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfo, hostOnly); } catch (ee) { }
              const protoInfo = useHttpsUpstream ? 'https' : 'http';
              console.error(`Proxy ${id} - upstream error -> ${targetInfo} (${protoInfo})`, e && e.message ? e.message : e);
              if (e && e.stack) console.error(e.stack);
            } catch (logErr) {
              console.error(`Proxy ${id} - upstream error (logging failed)`, logErr);
            }
            try {
              // send a nicer HTML page to the client (use configured error page if provided)
              pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly);
            } catch (err) {
              try { res.writeHead(502); res.end('Bad gateway'); } catch (e) { }
            }
          });
          req.pipe(upstream);
        } catch (e) {
          console.error(`Proxy ${id} - forward exception`, e);
          try { res.writeHead(500); res.end('Server error'); } catch (err) { }
        }
      };

      // Try to load production certificates from /etc/letsencrypt/live/<host>/ by default.
      // If not present, fall back to a self-signed cert (for dev/testing).
      const certDir = `/etc/letsencrypt/live/${listenHost}`;
      let cert, key;
      try {
        const fullchain = path.join(certDir, 'fullchain.pem');
        const privkey = path.join(certDir, 'privkey.pem');
        if (fs.existsSync(fullchain) && fs.existsSync(privkey)) {
          cert = fs.readFileSync(fullchain);
          key = fs.readFileSync(privkey);
          console.log(`Proxy ${id} - loaded TLS certificate from ${certDir}`);
        }
      } catch (e) {
        console.error(`Proxy ${id} - error reading cert files:`, e && e.message ? e.message : e);
      }

      if (!cert || !key) {
        // generate self-signed cert for the proxy (suitable for development/testing)
        const attrs = [{ name: 'commonName', value: listenHost }];
        const opts = {
          days: 365,
          keySize: 2048,
          extensions: [
            { name: 'basicConstraints', cA: false },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
            { name: 'extKeyUsage', serverAuth: true },
            {
              name: 'subjectAltName',
              altNames: [
                { type: 2, value: listenHost }
              ]
            }
          ]
        };
        const pems = selfsigned.generate(attrs, opts);
        cert = pems.cert;
        key = pems.private;
      }

      // prepare SNI callback: try to load certs for the requested servername from
      // /etc/letsencrypt/live/<servername> and cache tls contexts.
      const secureContextCache = new Map();
      const acmeManager = require('./acmeManager');

      function getContextForServername(servername) {
        if (!servername) return null;
        if (secureContextCache.has(servername)) return secureContextCache.get(servername);
        try {
          const dir = `/etc/letsencrypt/live/${servername}`;
          const fullchain = path.join(dir, 'fullchain.pem');
          const privkey = path.join(dir, 'privkey.pem');
          if (fs.existsSync(fullchain) && fs.existsSync(privkey)) {
            const ctx = tls.createSecureContext({ cert: fs.readFileSync(fullchain), key: fs.readFileSync(privkey) });
            secureContextCache.set(servername, ctx);
            console.log(`Proxy ${id} - loaded TLS certificate for SNI ${servername} from ${dir}`);
            return ctx;
          }
          // If cert doesn't exist, trigger issuance (webroot mode) in background
          if (!isIpAddress(servername) && !pm.pendingAcme.has(servername)) {
            (async () => {
              try {
                const exists = await domainModel.domainExists(servername);
                if (!exists) {
                  console.log(`Proxy ${id} - SNI ${servername} not present in domain_mappings; skipping ACME`);
                  return;
                }
                pm.pendingAcme.add(servername);
                await acmeManager.ensureCert(servername);
                console.log(`Proxy ${id} - ACME issuance finished for SNI ${servername}`);
              } catch (e) {
                /* ignore */
              } finally {
                try { pm.pendingAcme.delete(servername); } catch (e) { }
              }
            })();
          } else {
            if (isIpAddress(servername)) console.log(`Proxy ${id} - skipping ACME for SNI IP address ${servername}`);
            try { console.log(`Proxy ${id} - getContextForServername checked SNI: ${servername}`); } catch (e) { }
          }
        } catch (e) {
          // ignore and fall back to default
          console.error(`Proxy ${id} - error loading cert for ${servername}:`, e && e.message ? e.message : e);
        }
        // do not cache negative result — allow future attempts after issuance
        return null;
      }

      const server = require('https').createServer({
        key: key, cert: cert, SNICallback: (servername, cb) => {
          try {
            const ctx = getContextForServername(servername);
            if (ctx) return cb(null, ctx);
          } catch (e) { }
          // fallback to default context
          try { cb(null, tls.createSecureContext({ cert: cert, key: key })); } catch (err) { cb(err); }
        }
      }, forwardRequest);
      server.on('error', (err) => console.error('HTTPS termination proxy server error', err));
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`HTTPS Termination Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort} -> ${entry.meta.targetProtocol.toUpperCase()} ${entry.meta.targetHost}:${entry.meta.targetPort}`);
      });
      entry.type = 'https_terminate';
      entry.server = server;
      entry.cert = entry.meta.cert;
      this.servers.set(id, entry);
      return server;

    } else if (listenProtocol === 'http' || listenProtocol === 'https') {
      // Transparent TCP pass-through for HTTP/HTTPS: do not terminate or modify TLS/HTTP,
      // just forward raw bytes between client and target so TLS and HTTP remain intact.
      const server = net.createServer((clientSocket) => {
        clientSocket.on('error', (err) => console.error(`Proxy ${id} - client socket error (pre-connect)`, err));
        const remoteIp = normalizeIp(clientSocket.remoteAddress || 'unknown');
        const clientAddr = `${remoteIp || 'unknown'}:${clientSocket.remotePort || 'unknown'}`;
        if (pm.isIpBlocked(remoteIp)) {
          console.warn(`Proxy ${id} - blocked HTTP/S connection from ${clientAddr}`);
          if (!sendBlockedResponse(clientSocket)) {
            try { clientSocket.destroy(); } catch (e) { }
          }
          return;
        }
        pm.trackIpTraffic(remoteIp, 0, 1);
        let resolvedDomain = null;
        console.log(`Proxy ${id} - client connected from ${clientAddr} -> default target ${entry.meta.targetHost}:${entry.meta.targetPort} (listen=${listenProtocol}, target=${entry.meta.targetProtocol})`);

        // Record connection immediately
        try { pm.addMetrics(id, 0, 0, 1); } catch (e) { }

        clientSocket.pause();
        let firstChunk = null;
        let peekDone = false;
        const peekTimeout = setTimeout(() => {
          if (!peekDone) {
            peekDone = true;
            console.log(`Proxy ${id} - peek timeout, proceeding to default target`);
            connectToTarget(entry.meta.targetHost, entry.meta.targetPort);
          }
        }, 800);

        const onClientData = (chunk) => {
          if (peekDone) return;
          peekDone = true;
          clearTimeout(peekTimeout);
          firstChunk = chunk;

          // Detect TLS ClientHello (0x16) or plaintext HTTP
          const firstByte = chunk && chunk.length ? chunk[0] : null;
          const clientIsTls = firstByte === 0x16;
          let selectedHost = targetHost;
          let selectedPort = targetPort;
          let selectedProto = targetProtocol;

          if (clientIsTls) {
            // try to parse SNI
            const sni = parseSNI(chunk);
            if (sni && entry.meta.vhostMap && entry.meta.vhostMap[sni]) {
              resolvedDomain = sni;
              const m = entry.meta.vhostMap[sni];
              selectedHost = m.targetHost || selectedHost;
              selectedPort = m.targetPort || selectedPort;
              selectedProto = (m.targetProtocol || selectedProto).toLowerCase();
              console.log(`Proxy ${id} - SNI match ${sni} -> ${selectedHost}:${selectedPort} (${selectedProto})`);
            } else {
              console.log(`Proxy ${id} - TLS ClientHello detected, no SNI vhost match`);
            }
          } else {
            // try parse Host header from plaintext HTTP
            try {
              const s = chunk.toString('utf8');
              const m = s.match(/\r?\nHost:\s*([^:\r\n]+)/i);
              if (m && m[1] && entry.meta.vhostMap && entry.meta.vhostMap[m[1]]) {
                const map = entry.meta.vhostMap[m[1]];
                resolvedDomain = m[1];
                selectedHost = map.targetHost || selectedHost;
                selectedPort = map.targetPort || selectedPort;
                selectedProto = (map.targetProtocol || selectedProto).toLowerCase();
                console.log(`Proxy ${id} - Host header match ${m[1]} -> ${selectedHost}:${selectedPort} (${selectedProto})`);
              } else {
                console.log(`Proxy ${id} - plaintext request, no Host vhost match`);
              }
            } catch (e) { /* ignore */ }
          }

          connectToTarget(selectedHost, selectedPort, firstChunk);
        };

        clientSocket.once('data', onClientData);

        function connectToTarget(selHost, selPort, prebuffer) {
          clientSocket.removeListener('data', onClientData);

          // Record prebuffer bytes
          if (prebuffer && prebuffer.length) {
            try { pm.addMetrics(id, prebuffer.length, 0, 0); } catch (e) { }
            pm.trackIpTraffic(remoteIp, prebuffer.length, 1);
            if (resolvedDomain) pm.trackDomainTraffic(resolvedDomain, prebuffer.length, 1);
          }

        const targetInfoKey = `${selHost}:${selPort}`;
        // If this backend/domain is marked down, short-circuit and return a custom error page to the client
        try {
          if (pm.backendIsDown && pm.backendIsDown(targetInfoKey, resolvedDomain)) {
            console.warn(`Proxy ${id} - target ${targetInfoKey} for domain=${resolvedDomain} is marked DOWN, returning custom error page`);
            if (!sendCustomErrorPage(clientSocket)) {
              try { clientSocket.destroy(); } catch (e) { }
            }
            return;
          }
        } catch (e) { }

        const targetSocket = net.connect({ host: selHost, port: selPort }, () => {
          try {
            if (prebuffer && prebuffer.length) targetSocket.write(prebuffer);
            clientSocket.resume();
            clientSocket.pipe(targetSocket);
            targetSocket.pipe(clientSocket);
            try { if (pm.markBackendSuccess) pm.markBackendSuccess(targetInfoKey, resolvedDomain); } catch (e) { }
            } catch (e) {
              console.error(`Proxy ${id} - error during piping setup`, e);
              try { clientSocket.destroy(); } catch (err) { }
              try { targetSocket.destroy(); } catch (err) { }
            }
          });

          // Metrics listeners - stream bytes immediately
          clientSocket.on('data', (c) => {
            const len = c ? c.length : 0;
            try { pm.addMetrics(id, len, 0, 0); } catch (e) { }
            pm.trackIpTraffic(remoteIp, len, 0);
            if (resolvedDomain) pm.trackDomainTraffic(resolvedDomain, len, 0);
          });
          targetSocket.on('data', (c) => { try { pm.addMetrics(id, 0, c ? c.length : 0, 0); } catch (e) { } });

          targetSocket.on('error', (err) => {
            try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfoKey, resolvedDomain); } catch (e) { }
            console.error(`Proxy ${id} - target TCP error connecting to ${selHost}:${selPort} (domain=${resolvedDomain})`, err);
            if (!sendCustomErrorPage(clientSocket)) {
              try { clientSocket.destroy(); } catch (e) { }
            }
          });
          clientSocket.on('error', (err) => {
            console.error(`Proxy ${id} - client TCP error`, err);
            try { targetSocket.destroy(); } catch (e) { }
          });
        }

        function sendCustomErrorPage(socket) {
          if (!entry.meta.errorPageHtml) return false;
          try {
            const html = entry.meta.errorPageHtml;
            let payload = html;
            if (!html.startsWith('HTTP/')) {
              const body = Buffer.from(html, 'utf8');
              payload = `HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
              socket.write(payload);
              socket.write(body);
              socket.end();
              return true;
            }
            socket.write(payload);
            socket.end();
            return true;
          } catch (e) {
            return false;
          }
        }

        function sendBlockedResponse(socket) {
          try {
            const body = Buffer.from('<h1>IP bannie</h1><p>Contactez l\'administrateur pour etre debloque.</p>', 'utf8');
            const headers = `HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
            socket.write(headers);
            socket.write(body);
            socket.end();
            return true;
          } catch (e) {
            return false;
          }
        }
      });
      server.on('error', (err) => console.error('Transparent proxy server error', err));
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`Transparent Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort} -> ${entry.meta.targetProtocol.toUpperCase()} ${entry.meta.targetHost}:${entry.meta.targetPort}`);
      });
      entry.type = 'transparent';
      entry.server = server;
      this.servers.set(id, entry);
      return server;
    } else {
      throw new Error('Unsupported listen protocol: ' + listenProtocol);
    }
  }

  // Reload all enabled proxies from the database and restart them in-memory
  async reloadAllProxies() {
    try {
      console.log('ProxyManager: reloading all enabled proxies from DB');
      // prevent concurrent reloads
      if (this._reloading) {
        console.log('ProxyManager: reload already in progress, skipping');
        return;
      }
      this._reloading = true;
      // fetch proxies and domain mappings
      this._reloading = true;
      const pRes = await proxyModel.listEnabledProxies();
      const mappings = await domainModel.listDomainMappings();

      const vhostsByProxy = {};
      for (const m of mappings) {
        if (!vhostsByProxy[m.proxy_id]) vhostsByProxy[m.proxy_id] = {};
        vhostsByProxy[m.proxy_id][m.hostname] = {
          targetHost: m.target_host,
          targetPort: m.target_port,
          targetProtocol: m.target_protocol,
        };
      }

      // Determine desired proxies set
      const desiredIds = new Set(pRes.map(p => String(p.id)));

      // Stop any currently running proxies that are no longer desired
      const currentIds = Array.from(this.servers.keys()).map(String);
      for (const curId of currentIds) {
        if (!desiredIds.has(curId)) {
          console.log(`ProxyManager: stopping proxy ${curId} because it is not present in DB`);
          try { await this.stopProxy(curId); } catch (e) { console.error('stopProxy error', e); }
        }
      }

      // Start or update desired proxies
      const startedBindings = new Set();
      for (const p of pRes) {
        try {
          let merged = null;
          if (p.vhosts) {
            try { merged = typeof p.vhosts === 'string' ? JSON.parse(p.vhosts) : p.vhosts; } catch (e) { merged = p.vhosts; }
          }
          const mapped = vhostsByProxy[p.id] || null;
          const finalVhosts = Object.assign({}, merged || {}, mapped || {});
          const bindKey = `${(p.listen_host || '0.0.0.0')}:${p.listen_port}:${p.listen_protocol || p.protocol || 'tcp'}`;

          // If already running, attempt in-place meta update when bind is unchanged
          if (this.servers.has(p.id)) {
            const entry = this.servers.get(p.id);
            const oldBind = `${(entry.meta && entry.meta.listenHost) || ''}:${(entry.meta && entry.meta.listenPort) || ''}:${(entry.meta && entry.meta.listenProtocol) || ''}`;
            if (oldBind === bindKey) {
              // update meta in-place
              entry.meta.vhostMap = Object.keys(finalVhosts).length ? finalVhosts : null;
              entry.meta.targetHost = p.target_host;
              entry.meta.targetPort = p.target_port;
              entry.meta.targetProtocol = p.target_protocol || p.protocol || entry.meta.targetProtocol;
              entry.meta.listenHost = p.listen_host || entry.meta.listenHost;
              entry.meta.listenPort = p.listen_port || entry.meta.listenPort;
              entry.meta.listenProtocol = p.listen_protocol || p.protocol || entry.meta.listenProtocol;
              entry.meta.errorPageHtml = p.error_page_html || entry.meta.errorPageHtml;
              console.log(`ProxyManager: updated proxy ${p.id} metadata in-place`);
              continue;
            }
            // bind changed: stop and restart below
            try { await this.stopProxy(p.id); } catch (e) { console.error('stopProxy before restart error', e); }
          }

          // Start new proxy if bind isn't already used during this reload
          if (startedBindings.has(bindKey)) {
            console.log(`ProxyManager: skipping start of proxy ${p.id} because bind ${bindKey} already in use by this reload`);
            continue;
          }

          this.startProxy(
            p.id,
            p.listen_protocol || p.protocol || 'tcp',
            p.listen_host,
            p.listen_port,
            p.target_protocol || p.protocol || 'tcp',
            p.target_host,
            p.target_port,
            Object.keys(finalVhosts).length ? finalVhosts : null,
            p.error_page_html || null
          );
          startedBindings.add(bindKey);
        } catch (e) { console.error('ProxyManager: start proxy failed during reload', e && e.message ? e.message : e); }
      }
      console.log('ProxyManager: reload complete');
      this._reloading = false;
    } catch (e) {
      console.error('ProxyManager.reloadAllProxies error', e && e.message ? e.message : e);
      this._reloading = false;
    }
  }

  stopProxy(id) {
    const entry = this.servers.get(id);
    if (!entry) return false;
    try {
      // Return a promise that resolves when the server is closed
      return new Promise((resolve) => {
        try {
          if (entry.type === 'udp') {
            try { entry.server.close(); } catch (e) { }
            if (entry.upstreams) {
              for (const [, up] of entry.upstreams) {
                try { if (up.timeout) clearTimeout(up.timeout); up.upstream.close(); } catch (e) { }
              }
            }
            // UDP socket emits 'close'
            entry.server.once('close', () => { try { this.servers.delete(id); } catch (e) { } resolve(true); });
            // In case close already happened
            setTimeout(() => { if (!this.servers.has(id)) resolve(true); }, 1000);
          } else {
            // TCP/HTTP/HTTPS servers
            try { entry.server.close(() => { try { this.servers.delete(id); } catch (e) { } resolve(true); }); } catch (e) {
              // Fallback: destroy and resolve
              try { entry.server.emit && entry.server.emit('close'); } catch (er) { }
              try { this.servers.delete(id); } catch (er) { }
              resolve(true);
            }
            // safety: if close callback not called, resolve after timeout
            setTimeout(() => { if (this.servers.has(id)) { try { this.servers.delete(id); } catch (e) { } resolve(true); } }, 3000);
          }
        } catch (e) {
          try { this.servers.delete(id); } catch (er) { }
          resolve(false);
        }
      });
    } catch (e) {
      try { this.servers.delete(id); } catch (er) { }
      return false;
    }
  }

  async stopAll() {
    const ids = Array.from(this.servers.keys());
    const promises = [];
    for (const id of ids) {
      try {
        const p = this.stopProxy(id);
        // stopProxy may return boolean or Promise; normalize
        if (p && typeof p.then === 'function') promises.push(p); else promises.push(Promise.resolve(!!p));
      } catch (e) { /* ignore */ }
    }
    try { if (this.flushTimer) clearInterval(this.flushTimer); } catch (e) { }
    await Promise.all(promises);
  }

  setBlockedIps(list) {
    try {
      this.blockedIps = new Set(Array.isArray(list) ? list.map(normalizeIp) : []);
      console.log('ProxyManager: blocked IPs updated ->', this.blockedIps.size);
    } catch (e) {
      console.error('ProxyManager: failed to set blocked IPs', e);
    }
  }

  setTrustedIps(list) {
    try {
      this.trustedIps = new Set(Array.isArray(list) ? list.map(normalizeIp) : []);
      console.log('ProxyManager: trusted IPs updated ->', this.trustedIps.size);
    } catch (e) {
      console.error('ProxyManager: failed to set trusted IPs', e);
    }
  }

  isTrustedIp(ip) {
    if (!ip) return false;
    return this.trustedIps.has(normalizeIp(ip));
  }

  isIpBlocked(ip) {
    if (!ip) return false;
    const normalized = normalizeIp(ip);
    if (this.isTrustedIp(normalized)) return false;
    return this.blockedIps.has(normalized);
  }

  trackIpTraffic(ip, bytes = 0, requests = 0) {
    if (!ip) return;
    const key = normalizeIp(ip);
    const stat = this.ipActivity.get(key) || { bytes: 0, events: 0 };
    stat.bytes += Number(bytes || 0);
    stat.events += Number(requests || 0);
    this.ipActivity.set(key, stat);
  }

  trackDomainTraffic(domain, bytes = 0, requests = 0) {
    if (!domain) return;
    const key = domain.toLowerCase();
    const stat = this.domainActivity.get(key) || { bytes: 0, requests: 0 };
    stat.bytes += Number(bytes || 0);
    stat.requests += Number(requests || 0);
    this.domainActivity.set(key, stat);
  }

  async evaluateAlerts() {
    const now = Date.now();
    const pending = [];
    const cfg = this.securityConfig || {};
    const ipBytesThreshold = Number(cfg.ipBytesThreshold) || 0;
    const ipReqThreshold = Number(cfg.ipRequestsThreshold) || 0;
    const domainBytesThreshold = Number(cfg.domainBytesThreshold) || 0;
    const domainReqThreshold = Number(cfg.domainRequestsThreshold) || 0;
    const autoBlockIps = !!cfg.autoBlockIps;
    const autoAlertDomains = cfg.autoAlertDomains !== false;

    for (const [ip, stat] of this.ipActivity.entries()) {
      const bytesBreached = ipBytesThreshold && stat.bytes >= ipBytesThreshold;
      const reqBreached = ipReqThreshold && stat.events >= ipReqThreshold;
      if (bytesBreached && this._cooldownOk('ip', ip, now)) {
        pending.push(alertService.sendTrafficAlert(
          `Alerte trafic IP ${ip}`,
          `L'adresse ${ip} a genere ${formatBytes(stat.bytes)} de trafic recemment.`
        ));
        this.alertLastSent.ip.set(ip, now);
      }
      if (autoBlockIps && !this.isTrustedIp(ip) && (bytesBreached || reqBreached)) {
        pending.push(this.autoBlockIp(ip, 'Autoblocage automatique'));
      }
    }
    for (const [domain, stat] of this.domainActivity.entries()) {
      const bytesBreached = domainBytesThreshold && stat.bytes >= domainBytesThreshold;
      const reqBreached = domainReqThreshold && stat.requests >= domainReqThreshold;
      if (autoAlertDomains && (bytesBreached || reqBreached) && this._cooldownOk('domain', domain, now)) {
        pending.push(alertService.sendTrafficAlert(
          `Alerte trafic domaine ${domain}`,
          `Le domaine ${domain} a genere ${formatBytes(stat.bytes)} (${formatNumber(stat.requests)} requetes).`
        ));
        this.alertLastSent.domain.set(domain, now);
      }
    }
    this.ipActivity.clear();
    this.domainActivity.clear();
    try { await Promise.all(pending); } catch (e) { console.error('ProxyManager alerts error', e); }
  }

  _cooldownOk(type, key, now) {
    const map = type === 'ip' ? this.alertLastSent.ip : this.alertLastSent.domain;
    const last = map.get(key) || 0;
    const cooldown = Number(this.securityConfig && this.securityConfig.cooldown) || 15 * 60 * 1000;
    return now - last > cooldown;
  }

  async autoBlockIp(ip, reason) {
    try {
      await blockedIpModel.blockIp(ip, reason || 'Autoblocage');
      const list = await blockedIpModel.listIpsOnly();
      this.setBlockedIps(list);
      console.log(`ProxyManager: auto-blocked IP ${ip}`);
    } catch (e) {
      console.error('ProxyManager autoBlockIp error', e);
    }
  }

  // Send a friendly backend-unavailable HTML response to the client.
  // domain is optional and will be shown in the message when provided
  sendBackendUnavailableResponse(res, entry, targetInfo, domain) {
    try {
      // If the response is already finished, do nothing to avoid write-after-end errors
      if (res && ((typeof res.writableEnded === 'boolean' && res.writableEnded) || res.finished)) {
        try { console.warn(`ProxyManager: response already finished for ${targetInfo}, skipping unavailable response`); } catch (e) { }
        return;
      }
      const html = entry && entry.meta && entry.meta.errorPageHtml ? entry.meta.errorPageHtml : null;
      if (html) {
        try { res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; } catch (e) { }
      }
      const domainMsg = domain ? `<p>Nom de domaine concerné : <strong>${domain}</strong></p>` : '';
      const body = `<!doctype html><html><head><meta charset="utf-8"><title>Service indisponible</title></head><body style="font-family: sans-serif; text-align:center; padding:40px;"><h1>Backend introuvable</h1><p>Le service en arrière-plan ${targetInfo || ''} est inaccessible pour le moment. Merci de réessayer plus tard.</p>${domainMsg}</body></html>`;
      try { res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); } catch (e) { try { res.writeHead(502); res.end('Bad gateway'); } catch (er) { } }
    } catch (e) {
      try { res.writeHead(502); res.end('Bad gateway'); } catch (er) { }
    }
  }
}

module.exports = new ProxyManager();

// Helper: parse SNI from a TLS ClientHello buffer. Returns servername string or null.
function parseSNI(buffer) {
  try {
    let offset = 0;
    if (buffer.length < 5) return null;
    const contentType = buffer.readUInt8(0);
    if (contentType !== 0x16) return null; // not handshake
    // TLS record length
    const recordLength = buffer.readUInt16BE(3);
    if (buffer.length < 5 + recordLength) {
      // might be fragmented, still try to parse available
    }
    offset = 5; // start of handshake
    const hsType = buffer.readUInt8(offset);
    if (hsType !== 0x01) return null; // not ClientHello
    const hsLength = buffer.readUIntBE(offset + 1, 3);
    offset += 4; // handshake header
    // client version (2), random (32)
    offset += 2 + 32;
    // session id
    const sessionIdLen = buffer.readUInt8(offset);
    offset += 1 + sessionIdLen;
    // cipher suites
    const cipherSuitesLen = buffer.readUInt16BE(offset);
    offset += 2 + cipherSuitesLen;
    // compression methods
    const compMethodsLen = buffer.readUInt8(offset);
    offset += 1 + compMethodsLen;
    if (offset + 2 > buffer.length) return null;
    const extensionsLength = buffer.readUInt16BE(offset);
    offset += 2;
    const extensionsEnd = offset + extensionsLength;
    while (offset + 4 <= buffer.length && offset + 4 <= extensionsEnd) {
      const extType = buffer.readUInt16BE(offset);
      const extLen = buffer.readUInt16BE(offset + 2);
      offset += 4;
      if (extType === 0x0000) { // server_name
        // read server_name extension
        let extOffset = offset;
        const listLen = buffer.readUInt16BE(extOffset);
        extOffset += 2;
        const listEnd = extOffset + listLen;
        while (extOffset + 3 <= listEnd) {
          const nameType = buffer.readUInt8(extOffset);
          const nameLen = buffer.readUInt16BE(extOffset + 1);
          extOffset += 3;
          if (nameType === 0) {
            if (extOffset + nameLen <= buffer.length) {
              return buffer.toString('utf8', extOffset, extOffset + nameLen);
            } else return null;
          } else {
            extOffset += nameLen;
          }
        }
        return null;
      }
      offset += extLen;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function formatBytes(num) {
  let value = Number(num) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  const display = idx === 0 ? Math.round(value) : value.toFixed(1);
  return `${display} ${units[idx]}`;
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('fr-FR');
}
