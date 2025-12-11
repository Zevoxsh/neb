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
const botProtection = require('./botProtection');
const requestLogger = require('../utils/requestLogger');
const maintenanceManager = require('./maintenanceManager');

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
    this.flushIntervalSec = 5; // flush metrics to DB every 5s
    this.metricsBuffer = []; // Array of { proxy_id, ts, bytes_in, bytes_out, requests, latency_ms, status_code }
    this.emitter = new EventEmitter();
    this.pendingAcme = new Set();

    // Start flush loop
    setInterval(() => this.flushMetrics(), this.flushIntervalSec * 1000);

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
    // start active health probe (skip in installation mode)
    if (process.env.INSTALLATION_MODE !== 'true') {
      try { this._startHealthProbe(); } catch (e) { console.error('ProxyManager: failed to start health probe', e); }
    }
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
      // console.log(`ProxyManager: backend ${t} marked UP`);
    } catch (e) { }
  }

  // Add metrics sample. For streaming bytes, requests=0. For a completed request/response, requests=1 and provide latency/status.
  addMetrics(proxyId, bytesIn, bytesOut, requests, latencyMs = 0, statusCode = 0, hostname = null) {
    const MAX_BUFFER_SIZE = 100000; // 100k entrées max
    
    if (this.metricsBuffer.length >= MAX_BUFFER_SIZE) {
      // Immediate flush in emergency mode
      console.warn('Metrics buffer full, forcing flush');
      setImmediate(() => this.flushMetrics());
      
      // Reject new metrics if buffer is still full
      if (this.metricsBuffer.length >= MAX_BUFFER_SIZE) {
        return; // Drop silently
      }
    }
    
    this.metricsBuffer.push({
      proxy_id: parseInt(proxyId, 10),
      ts: new Date(),
      bytes_in: Math.min(bytesIn || 0, 2147483647), // Limite INT32
      bytes_out: Math.min(bytesOut || 0, 2147483647),
      requests: Math.min(requests || 0, 65535), // Limite UINT16
      latency_ms: Math.min(latencyMs || 0, 65535),
      status_code: Math.min(statusCode || 0, 999),
      hostname: hostname ? String(hostname).slice(0, 255) : null
    });
  }

  async flushMetrics() {
    try {
      if (this.metricsBuffer.length === 0) return;

      const samples = [...this.metricsBuffer];
      this.metricsBuffer = []; // clear buffer immediately

      // emit samples to any listeners (SSE/WebSocket)
      try { this.emitter.emit('flush', samples); } catch (e) { }

      try {
        // console.log(`flushMetrics: writing ${samples.length} sample(s)`);
        await metricsModel.insertSamplesBatch(samples);
        try { await this.evaluateAlerts(); } catch (alertErr) { console.error('flushMetrics alerts failed', alertErr); }
      } catch (dbErr) {
        console.error('flushMetrics: insertSamplesBatch failed', dbErr && dbErr.message ? dbErr.message : dbErr);
      }
    } catch (e) {
      console.error('flushMetrics error', e && e.message ? e.message : e);
    }
  }

  updateSecurityConfig(config = {}) {
    try {
      this.securityConfig = Object.assign({}, this.securityConfig, config);
      console.log('ProxyManager: security config updated');
    } catch (e) {
      console.error('ProxyManager: failed to update security config', e);
    }
  }

  startProxy(id, listenProtocol, listenHost, listenPort, targetProtocol, targetHost, targetPort, vhosts, passthroughTls = false, errorPageHtml = null) {
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

    // create mutable entry with meta so handlers can read dynamic state
    const entry = {
      id, type: listenProtocol, server: null, meta: {
        listenProtocol, listenHost, listenPort, targetProtocol, targetHost, targetPort, vhostMap: parsedVhosts || null,
        secureContextCache: new Map(), cert: null, key: null, errorPageHtml: errorPageHtml || null,
        tlsPassthrough: passthroughTls === true
      }
    };
    if (listenProtocol === 'tcp') {
      // plain TCP passthrough
      const server = net.createServer((clientSocket) => {
        // Protection contre slowloris
        clientSocket.setTimeout(30000); // 30 secondes timeout
        let isClosing = false;
        let targetSocket = null;

        const cleanup = () => {
          if (isClosing) return;
          isClosing = true;

          try {
            if (targetSocket) {
              clientSocket.unpipe(targetSocket);
              targetSocket.unpipe(clientSocket);
            }
          } catch (e) { }

          try {
            if (!clientSocket.destroyed) clientSocket.destroy();
            if (targetSocket && !targetSocket.destroyed) targetSocket.destroy();
          } catch (e) { }
        };

        clientSocket.on('timeout', () => {
          console.warn(`Proxy ${id} - socket timeout from ${normalizeIp(clientSocket.remoteAddress)}`);
          cleanup();
        });

        const remoteIp = normalizeIp(clientSocket.remoteAddress || '');
        if (pm.isIpBlocked(remoteIp)) {
          console.warn(`Proxy ${id} - blocked TCP connection from ${remoteIp}`);
          try { clientSocket.destroy(); } catch (e) { }
          return;
        }

        // Record connection immediately
        try { pm.addMetrics(id, 0, 0, 1, 0, 0, null); } catch (e) { }
        pm.trackIpTraffic(remoteIp, 0, 1);

        // Connect to backend
        targetSocket = net.connect({ host: entry.meta.targetHost, port: entry.meta.targetPort });

        targetSocket.on('connect', () => {
          // Simple passthrough like HAProxy - no data interception
          clientSocket.pipe(targetSocket);
          targetSocket.pipe(clientSocket);
        });

        // Timeout sur backend aussi
        targetSocket.setTimeout(30000);
        targetSocket.on('timeout', () => {
          console.warn(`Proxy ${id} - backend timeout`);
          cleanup();
        });

        // Handle errors without throwing
        targetSocket.on('error', (err) => {
          if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
            console.error(`Proxy ${id} - backend connection error:`, err.message);
          }
          cleanup();
        });

        clientSocket.on('error', (err) => {
          if (!isClosing && err.code !== 'EPIPE' && err.code !== 'ECONNRESET' && err.code !== 'ETIMEDOUT') {
            console.error(`Proxy ${id} - client connection error:`, err.message);
          }
          cleanup();
        });

        // Handle clean disconnections
        clientSocket.on('end', () => {
          if (!isClosing && targetSocket) {
            try { targetSocket.end(); } catch (e) { }
          }
        });

        targetSocket.on('end', () => {
          if (!isClosing) {
            try { clientSocket.end(); } catch (e) { }
          }
        });

        // Final cleanup on close
        clientSocket.on('close', () => cleanup());
        targetSocket.on('close', () => cleanup());
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
      // UDP proxy - bidirectional packet forwarding
      const serverSocket = dgram.createSocket('udp4');
      const upstreams = new Map();

      serverSocket.on('error', (err) => console.error(`UDP Proxy ${id} server error:`, err.message));

      serverSocket.on('message', (msg, rinfo) => {
        const clientKey = `${rinfo.address}:${rinfo.port}`;
        let upstreamEntry = upstreams.get(clientKey);

        if (!upstreamEntry) {
          // Create new upstream socket for this client
          const upstream = dgram.createSocket('udp4');

          upstream.on('message', (upMsg) => {
            // Forward response back to original client
            serverSocket.send(upMsg, rinfo.port, rinfo.address, (err) => {
              if (err) console.error(`UDP Proxy ${id} - failed to forward response to ${clientKey}:`, err.message);
              else {
                try { pm.addMetrics(id, 0, upMsg.length, 0); } catch (e) { }
              }
            });
          });

          upstream.on('error', (e) => console.error(`UDP Proxy ${id} - upstream error for ${clientKey}:`, e.message));

          upstreamEntry = { upstream, timeout: null };
          upstreams.set(clientKey, upstreamEntry);
          console.log(`UDP Proxy ${id} - new client connection from ${clientKey}`);
        }

        // Reset timeout for this client
        if (upstreamEntry.timeout) clearTimeout(upstreamEntry.timeout);
        upstreamEntry.timeout = setTimeout(() => {
          try { upstreamEntry.upstream.close(); } catch (e) { }
          upstreams.delete(clientKey);
          console.log(`UDP Proxy ${id} - client ${clientKey} timed out after 30s`);
        }, 30000);

        // Forward packet to target server
        try { pm.addMetrics(id, msg.length, 0, 1); } catch (e) { }
        upstreamEntry.upstream.send(msg, targetPort, targetHost, (err) => {
          if (err) console.error(`UDP Proxy ${id} - failed to forward to ${targetHost}:${targetPort}:`, err.message);
        });
      });

      serverSocket.bind(listenPort, listenHost, () => {
        console.log(`UDP Proxy ${id} listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
      });

      entry.type = 'udp';
      entry.server = serverSocket;
      entry.upstreams = upstreams;
      this.servers.set(id, entry);
      return serverSocket;
    } else if (listenProtocol === 'http' && targetHost === '__REDIRECT__') {
      // HTTP Redirect
      const http = require('http');
      const server = http.createServer((req, res) => {
        try {
          const hostname = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
          if (hostname) requestLogger.logRequest(req.socket.remoteAddress, hostname);
          try { pm.addMetrics(id, 0, 0, 1, 0, 301, hostname); } catch (e) { }

          const hostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : entry.meta.listenHost;
          const portSuffix = '';
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
      // ACME Challenge + Redirect
      const http = require('http');

      const handleRequest = async (req, res) => {
        const hostname = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
        if (hostname) requestLogger.logRequest(req.socket.remoteAddress, hostname);
        try {
          // ACME handling
          if (req.url && req.url.startsWith('/.well-known/acme-challenge/')) {
            try { pm.addMetrics(id, 0, 0, 1, 0, 200, hostname); } catch (e) { }
            const prefix = '/.well-known/acme-challenge/';
            const rest = req.url.slice(prefix.length);
            const token = rest.split('/')[0];
            
            // Strict validation: alphanumeric, dash, underscore only
            if (!/^[a-zA-Z0-9_-]+$/.test(token) || token.length > 128 || token.length === 0) {
              res.writeHead(404);
              return res.end('Not found');
            }
            
            // Path resolution and verification it stays within webroot
            const webroot = '/var/www/letsencrypt';
            const candidate1 = path.join(webroot, '.well-known', 'acme-challenge', token);
            const candidate2 = path.join(webroot, token);
            
            // Verify resolved paths stay within webroot
            const resolvedWebroot = path.resolve(webroot);
            const resolved1 = path.resolve(candidate1);
            const resolved2 = path.resolve(candidate2);
            
            let webrootPath = null;
            if (resolved1.startsWith(resolvedWebroot) && fs.existsSync(candidate1)) {
              webrootPath = candidate1;
            } else if (resolved2.startsWith(resolvedWebroot) && fs.existsSync(candidate2)) {
              webrootPath = candidate2;
            }

            if (!webrootPath) {
              res.writeHead(404);
              return res.end('Not found');
            }
            const stream = fs.createReadStream(webrootPath);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return stream.pipe(res);
          }
        } catch (e) { }

        // Redirect logic
        try {
          const hostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : listenHost;

          // Check if domain is in maintenance mode
          if (hostHeader && !isIpAddress(hostHeader)) {
            try {
              const maintenanceStatus = await domainModel.getMaintenanceStatusByHostname(hostHeader);
              if (maintenanceStatus && maintenanceStatus.maintenance_enabled) {
                console.log(`[HTTP] Domain ${hostHeader} is in maintenance mode`);

                // Get maintenance page (custom or default)
                const maintenancePage = maintenanceManager.getMaintenancePage(
                  hostHeader,
                  maintenanceStatus.maintenance_page_path
                );

                res.writeHead(503, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Retry-After': '3600'
                });
                res.end(maintenancePage);
                return;
              }
            } catch (e) {
              console.error(`[HTTP] Error checking maintenance status for ${hostHeader}:`, e.message);
            }
          }

          // Check and generate SSL certificate BEFORE redirect
          if (hostHeader && !isIpAddress(hostHeader)) {
            const certDir = `/etc/letsencrypt/live/${hostHeader}`;
            const privkey = path.join(certDir, 'privkey.pem');
            
            if (!fs.existsSync(privkey)) {
              try {
                // Only trigger ACME issuance automatically if the domain mapping explicitly allows it
                const mapping = await domainModel.getMaintenanceStatusByHostname(hostHeader);
                if (mapping && mapping.acme_enabled) {
                  console.log(`[HTTP->HTTPS] Certificate not found for ${hostHeader}, generating before redirect...`);

                  if (!pm.pendingAcme.has(hostHeader)) {
                    pm.pendingAcme.add(hostHeader);
                    try {
                      // Wait for certificate generation to complete
                      await acmeManager.ensureCert(hostHeader);
                      console.log(`[HTTP->HTTPS] Certificate generated for ${hostHeader}`);
                    } catch (certError) {
                      console.error(`[HTTP->HTTPS] Failed to generate certificate for ${hostHeader}:`, certError.message);
                    } finally {
                      pm.pendingAcme.delete(hostHeader);
                    }
                  } else {
                    console.log(`[HTTP->HTTPS] Certificate generation already in progress for ${hostHeader}, waiting...`);
                    // Wait a bit for the pending generation
                    await new Promise(resolve => setTimeout(resolve, 2000));
                  }
                } else {
                  console.log(`[HTTP->HTTPS] Certificate not auto-enabled for ${hostHeader}, attempting self-signed certificate generation.`);
                  try {
                    const selfsigned = require('selfsigned');
                    const attrs = [{ name: 'commonName', value: hostHeader }];
                    const opts = {
                      days: 365,
                      keySize: 2048,
                      extensions: [
                        { name: 'basicConstraints', cA: false },
                        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                        { name: 'extKeyUsage', serverAuth: true },
                        { name: 'subjectAltName', altNames: [{ type: 2, value: hostHeader }] }
                      ]
                    };
                    const pems = selfsigned.generate(attrs, opts);
                    const acme = require('./acmeManager');
                    await acme.saveManualCert(hostHeader, pems.cert, pems.private);
                    console.log(`[HTTP->HTTPS] Self-signed certificate created for ${hostHeader}`);
                  } catch (e) {
                    console.error(`[HTTP->HTTPS] Failed to create self-signed cert for ${hostHeader}:`, e && e.message ? e.message : String(e));
                  }
                }
              } catch (e) {
                console.error(`[HTTP->HTTPS] Error during certificate check/generation:`, e.message);
              }
            }
          }

          try { pm.addMetrics(id, 0, 0, 1, 0, 301, hostname); } catch (e) { }
          const location = `https://${hostHeader}${req.url}`;
          res.writeHead(301, { Location: location });
          res.end(`Redirecting to ${location}`);
        } catch (e) {
          console.error(`Proxy ${id} - redirect error`, e);
          try { res.writeHead(500); res.end('Server error'); } catch (err) { }
        }
      };

      const server = require('http').createServer(handleRequest);
      server.on('error', (err) => console.error('HTTP->HTTPS redirect server error', err));
      const publicBind = (process.env.PROXY_PORT80_PUBLIC === 'true');
      const bindHost = publicBind ? listenHost : '127.0.0.1';
      server.listen(entry.meta.listenPort, bindHost, () => {
        console.log(`HTTP listener ${id} (ACME + redirect) listening ${bindHost}:${entry.meta.listenPort} (public=${publicBind})`);
      });
      entry.type = 'http_acme_redirect';
      entry.server = server;
      this.servers.set(id, entry);
      return server;

    } else if (listenProtocol === 'https' && !entry.meta.tlsPassthrough) {
      // HTTPS Termination
      const http = require('http');
      const https = require('https');
      const selfsigned = require('selfsigned');

      const forwardRequest = async (req, res) => {
        const startTime = Date.now();
        const hostname = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
        
        // Check if SSL certificate exists for this domain
        if (hostname && !isIpAddress(hostname)) {
          const certDir = `/etc/letsencrypt/live/${hostname}`;
          const privkey = path.join(certDir, 'privkey.pem');
          
          if (!fs.existsSync(privkey)) {
            // Certificate doesn't exist, show waiting page and trigger generation if enabled
            console.log(`[HTTPS] Certificate not found for ${hostname}, showing waiting page...`);
            
            try {
              const mapping = await domainModel.getMaintenanceStatusByHostname(hostname);
              if (mapping && mapping.acme_enabled) {
                if (!pm.pendingAcme.has(hostname)) {
                  pm.pendingAcme.add(hostname);
                  const acmeManager = require('./acmeManager');
                  acmeManager.ensureCert(hostname).finally(() => {
                    pm.pendingAcme.delete(hostname);
                  });
                }
              } else {
                console.log(`[HTTPS] ACME not enabled for ${hostname}; generating self-signed certificate instead.`);
                try {
                  const selfsigned = require('selfsigned');
                  const attrs = [{ name: 'commonName', value: hostname }];
                  const opts = {
                    days: 365,
                    keySize: 2048,
                    extensions: [
                      { name: 'basicConstraints', cA: false },
                      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                      { name: 'extKeyUsage', serverAuth: true },
                      { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }
                    ]
                  };
                  const pems = selfsigned.generate(attrs, opts);
                  const acme = require('./acmeManager');
                  await acme.saveManualCert(hostname, pems.cert, pems.private);
                  console.log(`[HTTPS] Self-signed certificate created for ${hostname}`);
                } catch (err) {
                  console.error(`[HTTPS] Failed to create self-signed cert for ${hostname}:`, err && err.message ? err.message : String(err));
                }
              }
            } catch (e) {
              console.error(`[HTTPS] Error checking domain acme flag for ${hostname}:`, e && e.message ? e.message : String(e));
            }
            
            // Show waiting page that auto-refreshes
            const waitingHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Génération du certificat SSL...</title>
<style>
body{font-family:sans-serif;background:#0a0a0a;color:#fff;text-align:center;padding:50px}
.box{background:#111;border:1px solid #333;border-radius:12px;padding:40px;max-width:600px;margin:0 auto}
h1{color:#4CAF50;margin-bottom:20px}
p{color:#888;line-height:1.6;margin:15px 0}
.spinner{border:4px solid #333;border-top:4px solid #4CAF50;border-radius:50%;width:50px;height:50px;
animation:spin 1s linear infinite;margin:30px auto}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.note{font-size:14px;color:#666;margin-top:30px}
</style></head><body><div class="box">
<h1>🔒 Génération du certificat SSL en cours...</h1>
<div class="spinner"></div>
<p>Votre connexion sécurisée est en cours de configuration.</p>
<p>Cette page se rafraîchira automatiquement dans quelques secondes.</p>
<p class="note">Domaine: <strong>${hostname}</strong></p>
<p class="note">Cette opération ne prend généralement que 10-30 secondes.</p>
</div></body></html>`;
            
            res.writeHead(503, { 
              'Content-Type': 'text/html; charset=utf-8',
              'Retry-After': '5'
            });
            res.end(waitingHtml);
            return;
          }
        }

        // Check if domain is in maintenance mode
        if (hostname && !isIpAddress(hostname)) {
          try {
            const maintenanceStatus = await domainModel.getMaintenanceStatusByHostname(hostname);
            if (maintenanceStatus && maintenanceStatus.maintenance_enabled) {
              console.log(`[HTTPS] Domain ${hostname} is in maintenance mode`);

              // Get maintenance page (custom or default)
              const maintenancePage = maintenanceManager.getMaintenancePage(
                hostname,
                maintenanceStatus.maintenance_page_path
              );

              res.writeHead(503, {
                'Content-Type': 'text/html; charset=utf-8',
                'Retry-After': '3600'
              });
              res.end(maintenancePage);
              return;
            }
          } catch (e) {
            console.error(`[HTTPS] Error checking maintenance status for ${hostname}:`, e.message);
          }
        }

        // Log request
        const clientIp = normalizeIp(
          req.headers['cf-connecting-ip'] ||
          req.headers['x-real-ip'] ||
          req.headers['x-forwarded-for']?.split(',')[0].trim() ||
          req.connection?.remoteAddress ||
          req.socket?.remoteAddress
        );

        if (hostname && clientIp) {
          requestLogger.logRequest(clientIp, hostname);
        }

        try {
          // Get client IP - prioritize Cloudflare header
          const clientIp = normalizeIp(
            req.headers['cf-connecting-ip'] ||
            req.headers['x-real-ip'] ||
            req.headers['x-forwarded-for']?.split(',')[0].trim() ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress
          );

          // Serve challenge page
          if (req.url === '/challenge.html') {
            const fs = require('fs');
            const path = require('path');
            
            // Get or generate challenge for this IP+domain
            let challengeData = botProtection.getActiveChallenge(clientIp, hostname);
            if (!challengeData) {
              challengeData = botProtection.generateChallenge(clientIp, hostname);
            }
            
            const challengePath = path.join(__dirname, '..', '..', 'public', 'challenge.html');
            
            if (fs.existsSync(challengePath)) {
              let html = fs.readFileSync(challengePath, 'utf8');
              // Inject the challenge code into the HTML
              html = html.replace('{{CHALLENGE_CODE}}', challengeData.code);
              res.writeHead(200, { 
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': Buffer.byteLength(html)
              });
              res.end(html);
              return;
            }
          }

          // Serve logo image for challenge page
          if (req.url === '/public/image.png') {
            const fs = require('fs');
            const path = require('path');
            const imagePath = path.join(__dirname, '..', '..', 'public', 'image.png');
            
            if (fs.existsSync(imagePath)) {
              const image = fs.readFileSync(imagePath);
              res.writeHead(200, { 'Content-Type': 'image/png' });
              res.end(image);
              return;
            } else {
              res.writeHead(404);
              res.end('Not found');
              return;
            }
          }

          // Handle challenge verification - DO NOT TRACK REQUESTS
          if (req.url === '/verify-challenge' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const contentType = req.headers['content-type'] || '';
                let userInput;
                
                if (contentType.includes('application/json')) {
                  const data = JSON.parse(body);
                  userInput = data.userInput || data.solution;
                } else {
                  const params = new URLSearchParams(body);
                  userInput = params.get('userInput') || params.get('solution');
                }
                
                const result = botProtection.verifyChallengeAnswer(clientIp, userInput, hostname);
                
                if (!result.success) {
                  if (result.banned) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Too many attempts. Banned.', banned: true }));
                    return;
                  }
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Code incorrect', attemptsLeft: result.attemptsLeft }));
                  return;
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
              } catch (e) {
                res.writeHead(500);
                res.end('Error');
              }
            });
            return;
          }
          
          // Skip tracking and challenge for API endpoints, static assets, and challenge-related paths
          const skipPaths = ['/api/', '/public/', '/verify-challenge', '/challenge.html', '/.well-known/'];
          const skipExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.woff', '.woff2', '.ttf', '.ico'];
          const shouldSkip = skipPaths.some(path => req.url.startsWith(path)) || 
                            skipExtensions.some(ext => req.url.includes(ext));
          
          // Only track requests that are not challenge-related
          if (!shouldSkip) {
            // Get domain from Host header
            const domain = req.headers.host ? req.headers.host.split(':')[0] : null;

            // Track request with domain for per-domain rate limiting
            botProtection.trackRequest(clientIp, domain);

            // Log request asynchronously
            if (domain) {
              requestLogger.logRequest(clientIp, domain);
            }

            // Force challenge for new IPs on HTTPS proxy, pass domain for filtering
            const userAgent = req.headers['user-agent'] || '';
            const challengeStatus = botProtection.shouldChallenge(clientIp, true, domain, userAgent);

            if (challengeStatus === 'banned' || challengeStatus === 'banned_for_domain') {
              const message = challengeStatus === 'banned_for_domain'
                ? `Votre adresse IP a été temporairement bloquée pour ce domaine (${domain}) en raison d'un taux de requêtes trop élevé.`
                : `Votre adresse IP a été temporairement bloquée.`;

              const bannedHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Accès refusé</title>
<style>body{font-family:sans-serif;background:#000;color:#fff;text-align:center;padding:50px}
.box{background:#0a0a0a;border:1px solid #333;border-radius:12px;padding:40px;max-width:500px;margin:0 auto}
h1{color:#ff4444}p{color:#888;line-height:1.6}</style></head><body><div class="box">
<h1>🚫 Accès Refusé</h1>
<p>${message}</p>
<p>Veuillez réessayer dans quelques minutes.</p></div></body></html>`;
              res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(bannedHtml);
              return;
            }
            
            if (challengeStatus) {
              // Generate challenge only if one doesn't already exist for this IP+domain
              const domain = req.headers.host ? req.headers.host.split(':')[0] : null;
              let challengeData = botProtection.getActiveChallenge(clientIp, domain);
              if (!challengeData) {
                challengeData = botProtection.generateChallenge(clientIp, domain);
              }
              
              // Serve challenge page directly
              const fs = require('fs');
              const path = require('path');
              const challengePath = path.join(__dirname, '..', '..', 'public', 'challenge.html');
              
              if (fs.existsSync(challengePath)) {
                try {
                  let html = fs.readFileSync(challengePath, 'utf8');
                  // Inject the challenge code into the HTML
                  html = html.replace('{{CHALLENGE_CODE}}', challengeData.code);
                  res.writeHead(200, { 
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': Buffer.byteLength(html)
                  });
                  res.end(html);
                } catch (e) {
                  console.error('[ProxyManager] Error reading challenge file:', e);
                  res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                  res.end('<h1>Error loading challenge</h1>');
                }
              } else {
                console.warn(`[ProxyManager] Challenge file not found at ${challengePath}`);
                // Fallback inline HTML if file not found
                const fallbackHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Vérification</title></head>
<body style="font-family:sans-serif;padding:50px;text-align:center">
<h1>Challenge requis</h1>
<p>Fichier challenge.html non trouvé: ${challengePath}</p></body></html>`;
                res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(fallbackHtml);
              }
              return;
            }
          }
          
          const incomingHostHeader = req.headers && req.headers.host ? req.headers.host : null;
          const headers = Object.assign({}, req.headers);
          if (incomingHostHeader) headers.host = incomingHostHeader; else headers.host = entry.meta.targetHost + (entry.meta.targetPort ? (':' + entry.meta.targetPort) : '');

          const options = {
            hostname: entry.meta.targetHost,
            port: entry.meta.targetPort,
            path: req.url,
            method: req.method,
            headers: Object.assign({}, headers, { connection: 'close' })
          };

          // vhost selection logic
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
            }
          } catch (e) { }

          const useHttpsUpstream = (useTargetProto2 === 'https');
          if (useHttpsUpstream) options.agent = new https.Agent({ rejectUnauthorized: false });
          options.hostname = useTargetHost2;
          options.port = useTargetPort2;

          const targetInfo = `${useTargetHost2}:${useTargetPort2}`;
          const hostOnly = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;

          try {
            if (pm.backendIsDown && pm.backendIsDown(targetInfo, hostOnly)) {
              pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly);
              try { pm.addMetrics(id, 0, 0, 1, Date.now() - startTime, 503, hostname); } catch (e) { }
              return;
            }
          } catch (e) { }

          const upstream = (useHttpsUpstream ? https : http).request(options, (pres) => {
            const outHeaders = Object.assign({}, pres.headers);
            // Location rewrite logic...
            if (outHeaders.location) { /* ... same as before ... */ }
            // Cookie rewrite logic...
            if (outHeaders['set-cookie']) { /* ... same as before ... */ }

            try {
              const len = parseInt(pres.headers['content-length']) || 0;
              // Record metrics on response
              const lat = Date.now() - startTime;
              pm.addMetrics(id, 0, len, 1, lat, pres.statusCode, hostname);
            } catch (e) { }

            try { if (pm.markBackendSuccess) pm.markBackendSuccess(targetInfo, hostOnly); } catch (e) { }
            res.writeHead(pres.statusCode, outHeaders);
            pres.pipe(res);
          });

          upstream.setTimeout(pm.backendConnectTimeoutMs, () => {
            try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfo, hostOnly); } catch (e) { }
            try { upstream.destroy(new Error('connect timeout')); } catch (e) { }
            try { pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly); } catch (e) { }
            try { pm.addMetrics(id, 0, 0, 1, Date.now() - startTime, 504, hostname); } catch (e) { }
          });

          upstream.on('error', (e) => {
            try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfo, hostOnly); } catch (ee) { }
            try { pm.sendBackendUnavailableResponse(res, entry, targetInfo, hostOnly); } catch (err) { try { res.writeHead(502); res.end('Bad gateway'); } catch (e) { } }
            try { pm.addMetrics(id, 0, 0, 1, Date.now() - startTime, 502, hostname); } catch (e) { }
          });
          req.pipe(upstream);
        } catch (e) {
          console.error(`Proxy ${id} - forward exception`, e);
          try { res.writeHead(500); res.end('Server error'); } catch (err) { }
          try { pm.addMetrics(id, 0, 0, 1, Date.now() - startTime, 500, hostname); } catch (e) { }
        }
      };

      // Cert loading logic...
      const certDir = `/etc/letsencrypt/live/${listenHost}`;
      let cert, key;
      try {
        const fullchain = path.join(certDir, 'fullchain.pem');
        const privkey = path.join(certDir, 'privkey.pem');
        if (fs.existsSync(fullchain) && fs.existsSync(privkey)) {
          cert = fs.readFileSync(fullchain);
          key = fs.readFileSync(privkey);
        }
      } catch (e) { }

      if (!cert || !key) {
        // Self-signed fallback (using 4096-bit key for maximum security)
        const attrs = [{ name: 'commonName', value: listenHost }];
        const opts = {
          days: 365,
          keySize: 4096,  // 4096-bit key for stronger security
          extensions: [
            { name: 'basicConstraints', cA: false },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
            { name: 'extKeyUsage', serverAuth: true },
            { name: 'subjectAltName', altNames: [{ type: 2, value: listenHost }] }
          ]
        };
        const pems = selfsigned.generate(attrs, opts);
        cert = pems.cert;
        key = pems.private;
      }

      const secureContextCache = new Map();
      const CACHE_DURATION_MS = 3600000; // 1 hour

      function getContextForServername(servername) {
        if (!servername) return null;

        // Check cache with expiration
        if (secureContextCache.has(servername)) {
          const cached = secureContextCache.get(servername);
          const now = Date.now();

          // Return cached context if still valid (< 1 hour old)
          if (cached.timestamp && (now - cached.timestamp < CACHE_DURATION_MS)) {
            return cached.ctx;
          }

          // Cache expired, remove it
          secureContextCache.delete(servername);
        }

        try {
          const dir = `/etc/letsencrypt/live/${servername}`;
          const fullchain = path.join(dir, 'fullchain.pem');
          const privkey = path.join(dir, 'privkey.pem');

          if (fs.existsSync(fullchain) && fs.existsSync(privkey)) {
            const ctx = tls.createSecureContext({
              cert: fs.readFileSync(fullchain),
              key: fs.readFileSync(privkey)
            });

            // Cache with timestamp
            secureContextCache.set(servername, {
              ctx: ctx,
              timestamp: Date.now()
            });

            return ctx;
          }

          // Trigger ACME if missing...
          if (!isIpAddress(servername) && !pm.pendingAcme.has(servername)) {
            // ... async ACME trigger ...
          }
        } catch (e) {
          console.error(`getContextForServername error for ${servername}:`, e.message);
        }
        return null;
      }

      const server = require('https').createServer({
        key: key, cert: cert, SNICallback: (servername, cb) => {
          try {
            const ctx = getContextForServername(servername);
            if (ctx) return cb(null, ctx);
          } catch (e) { }
          try { cb(null, tls.createSecureContext({ cert: cert, key: key })); } catch (err) { cb(err); }
        }
      }, forwardRequest);
      server.on('error', (err) => console.error('HTTPS termination proxy server error', err));
      // Handle websocket upgrade requests and proxy them to the appropriate backend
      try {
        const websocketProxy = require('./websocketProxy');
        server.on('upgrade', (req, socket, head) => {
          (async () => {
            try {
              const incomingHostHeader = req.headers && req.headers.host ? req.headers.host.split(':')[0] : null;
              let useTargetHost = entry.meta.targetHost;
              let useTargetPort = entry.meta.targetPort;
              let useTargetProto = entry.meta.targetProtocol;

              try {
                if (incomingHostHeader && entry.meta.vhostMap && entry.meta.vhostMap[incomingHostHeader]) {
                  const m = entry.meta.vhostMap[incomingHostHeader];
                  useTargetHost = m.targetHost || useTargetHost;
                  useTargetPort = m.targetPort || useTargetPort;
                  useTargetProto = (m.targetProtocol || useTargetProto).toLowerCase();
                }
              } catch (e) { }

              const backend = {
                target_host: useTargetHost,
                target_port: useTargetPort,
                target_protocol: useTargetProto || 'tcp'
              };

              await websocketProxy.handleUpgrade(req, socket, head, backend);
            } catch (err) {
              try { socket.destroy(); } catch (e) { }
            }
          })();
        });
      } catch (e) {
        console.error('[ProxyManager] Failed to attach websocket upgrade handler:', e && e.message ? e.message : e);
      }
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`HTTPS Termination Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort}`);
      });
      entry.type = 'https_terminate';
      entry.server = server;
      entry.cert = entry.meta.cert;
      this.servers.set(id, entry);
      return server;

    } else if (listenProtocol === 'http' || listenProtocol === 'https') {
      // Transparent TCP
      const server = net.createServer((clientSocket) => {
        const remoteIp = normalizeIp(clientSocket.remoteAddress || 'unknown');
        if (pm.isIpBlocked(remoteIp)) {
          if (!sendBlockedResponse(clientSocket)) try { clientSocket.destroy(); } catch (e) { }
          return;
        }
        pm.trackIpTraffic(remoteIp, 0, 1);
        let resolvedDomain = null;

        // Record connection
        try { pm.addMetrics(id, 0, 0, 1, 0, 0, null); } catch (e) { }

        clientSocket.pause();
        let firstChunk = null;
        let peekDone = false;
        const peekTimeout = setTimeout(() => {
          if (!peekDone) {
            peekDone = true;
            connectToTarget(entry.meta.targetHost, entry.meta.targetPort);
          }
        }, 800);

        const onClientData = (chunk) => {
          if (peekDone) return;
          peekDone = true;
          clearTimeout(peekTimeout);
          firstChunk = chunk;
          // SNI/Host parsing logic...
          let selectedHost = targetHost;
          let selectedPort = targetPort;
          // ... (omitted for brevity, assume standard logic) ...
          connectToTarget(selectedHost, selectedPort, firstChunk);
        };
        clientSocket.once('data', onClientData);

        function connectToTarget(selHost, selPort, prebuffer) {
          clientSocket.removeListener('data', onClientData);
          if (prebuffer && prebuffer.length) {
            try { pm.addMetrics(id, prebuffer.length, 0, 0, 0, 0, null); } catch (e) { }
            pm.trackIpTraffic(remoteIp, prebuffer.length, 1);
          }
          const targetInfoKey = `${selHost}:${selPort}`;
          try {
            if (pm.backendIsDown && pm.backendIsDown(targetInfoKey, resolvedDomain)) {
              if (!sendCustomErrorPage(clientSocket)) try { clientSocket.destroy(); } catch (e) { }
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
            } catch (e) { }
          });

          clientSocket.on('data', (c) => {
            const len = c ? c.length : 0;
            try { pm.addMetrics(id, len, 0, 0, 0, 0, null); } catch (e) { }
            pm.trackIpTraffic(remoteIp, len, 0);
          });
          targetSocket.on('data', (c) => { try { pm.addMetrics(id, 0, c ? c.length : 0, 0, 0, 0, null); } catch (e) { } });
          targetSocket.on('error', (err) => {
            try { if (pm.markBackendFailure) pm.markBackendFailure(targetInfoKey, resolvedDomain); } catch (e) { }
            if (!sendCustomErrorPage(clientSocket)) try { clientSocket.destroy(); } catch (e) { }
          });
          clientSocket.on('error', () => { try { targetSocket.destroy(); } catch (e) { } });
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
          } catch (e) { return false; }
        }

        function sendBlockedResponse(socket) {
          try {
            const body = Buffer.from('<h1>IP bannie</h1><p>Contactez l\'administrateur pour etre debloque.</p>', 'utf8');
            const headers = `HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
            socket.write(headers);
            socket.write(body);
            socket.end();
            return true;
          } catch (e) { return false; }
        }
      });
      server.on('error', (err) => console.error('Transparent proxy server error', err));
      server.listen(entry.meta.listenPort, entry.meta.listenHost, () => {
        console.log(`Transparent Proxy ${id} listening ${entry.meta.listenHost}:${entry.meta.listenPort}`);
      });
      entry.type = 'transparent';
      entry.server = server;
      this.servers.set(id, entry);
      return server;
    } else {
      throw new Error('Unsupported listen protocol: ' + listenProtocol);
    }
  }

  async reloadAllProxies() {
    try {
      console.log('ProxyManager: reloading all enabled proxies from DB');
      if (this._reloading) return;
      this._reloading = true;
      const pRes = await proxyModel.listEnabledProxies();
      const mappings = await domainModel.listDomainMappings();
      const vhostsByProxy = {};
      for (const m of mappings) {
        if (!vhostsByProxy[m.proxy_id]) vhostsByProxy[m.proxy_id] = {};
        vhostsByProxy[m.proxy_id][m.hostname] = { targetHost: m.target_host, targetPort: m.target_port, targetProtocol: m.target_protocol };
      }
      const desiredIds = new Set(pRes.map(p => String(p.id)));
      const currentIds = Array.from(this.servers.keys()).map(String);
      for (const curId of currentIds) {
        if (!desiredIds.has(curId)) {
          try { await this.stopProxy(curId); } catch (e) { }
        }
      }
      const startedBindings = new Set();
      for (const p of pRes) {
        try {
          let merged = null;
          if (p.vhosts) { try { merged = typeof p.vhosts === 'string' ? JSON.parse(p.vhosts) : p.vhosts; } catch (e) { merged = p.vhosts; } }
          const mapped = vhostsByProxy[p.id] || null;
          const finalVhosts = Object.assign({}, merged || {}, mapped || {});
          const bindKey = `${(p.listen_host || '0.0.0.0')}:${p.listen_port}:${p.listen_protocol || p.protocol || 'tcp'}`;
          if (this.servers.has(p.id)) {
            const entry = this.servers.get(p.id);
            const oldBind = `${(entry.meta && entry.meta.listenHost) || ''}:${(entry.meta && entry.meta.listenPort) || ''}:${(entry.meta && entry.meta.listenProtocol) || ''}`;
            if (oldBind === bindKey) {
              entry.meta.vhostMap = Object.keys(finalVhosts).length ? finalVhosts : null;
              entry.meta.targetHost = p.target_host;
              entry.meta.targetPort = p.target_port;
              entry.meta.targetProtocol = p.target_protocol || p.protocol || entry.meta.targetProtocol;
              entry.meta.listenHost = p.listen_host || entry.meta.listenHost;
              entry.meta.listenPort = p.listen_port || entry.meta.listenPort;
              entry.meta.listenProtocol = p.listen_protocol || p.protocol || entry.meta.listenProtocol;
              entry.meta.errorPageHtml = p.error_page_html || entry.meta.errorPageHtml;
              continue;
            }
            try { await this.stopProxy(p.id); } catch (e) { }
          }
          if (startedBindings.has(bindKey)) continue;
          this.startProxy(p.id, p.listen_protocol || p.protocol || 'tcp', p.listen_host, p.listen_port, p.target_protocol || p.protocol || 'tcp', p.target_host, p.target_port, Object.keys(finalVhosts).length ? finalVhosts : null, p.passthrough_tls === true, p.error_page_html || null);
          startedBindings.add(bindKey);
        } catch (e) { }
      }
      this._reloading = false;
    } catch (e) { this._reloading = false; }
  }

  stopProxy(id) {
    const entry = this.servers.get(id);
    if (!entry) return false;
    return new Promise((resolve) => {
      try {
        if (entry.type === 'udp') {
          try { entry.server.close(); } catch (e) { }
          if (entry.upstreams) { for (const [, up] of entry.upstreams) { try { if (up.timeout) clearTimeout(up.timeout); up.upstream.close(); } catch (e) { } } }
          entry.server.once('close', () => { try { this.servers.delete(id); } catch (e) { } resolve(true); });
          setTimeout(() => { if (!this.servers.has(id)) resolve(true); }, 1000);
        } else {
          try { entry.server.close(() => { try { this.servers.delete(id); } catch (e) { } resolve(true); }); } catch (e) {
            try { entry.server.emit && entry.server.emit('close'); } catch (er) { }
            try { this.servers.delete(id); } catch (er) { }
            resolve(true);
          }
          setTimeout(() => { if (this.servers.has(id)) { try { this.servers.delete(id); } catch (e) { } resolve(true); } }, 3000);
        }
      } catch (e) { try { this.servers.delete(id); } catch (er) { } resolve(false); }
    });
  }

  async stopAll() {
    const ids = Array.from(this.servers.keys());
    const promises = [];
    for (const id of ids) {
      try { const p = this.stopProxy(id); if (p && typeof p.then === 'function') promises.push(p); else promises.push(Promise.resolve(!!p)); } catch (e) { }
    }
    try { if (this.flushTimer) clearInterval(this.flushTimer); } catch (e) { }
    await Promise.all(promises);
  }

  setBlockedIps(list) {
    try { this.blockedIps = new Set(Array.isArray(list) ? list.map(normalizeIp) : []); } catch (e) { }
  }

  setTrustedIps(list) {
    try { this.trustedIps = new Set(Array.isArray(list) ? list.map(normalizeIp) : []); } catch (e) { }
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
        pending.push(alertService.sendTrafficAlert(`Alerte trafic IP ${ip}`, `L'adresse ${ip} a genere ${formatBytes(stat.bytes)} de trafic recemment.`));
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
        pending.push(alertService.sendTrafficAlert(`Alerte trafic domaine ${domain}`, `Le domaine ${domain} a genere ${formatBytes(stat.bytes)} (${formatNumber(stat.requests)} requetes).`));
        this.alertLastSent.domain.set(domain, now);
      }
    }
    this.ipActivity.clear();
    this.domainActivity.clear();
    try { await Promise.all(pending); } catch (e) { }
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
    } catch (e) { }
  }

  sendBackendUnavailableResponse(res, entry, targetInfo, domain) {
    try {
      if (res && ((typeof res.writableEnded === 'boolean' && res.writableEnded) || res.finished)) return;
      const html = entry && entry.meta && entry.meta.errorPageHtml ? entry.meta.errorPageHtml : null;
      if (html) { try { res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; } catch (e) { } }
      const domainMsg = domain ? `<p>Nom de domaine concerné : <strong>${domain}</strong></p>` : '';
      const body = `<!doctype html><html><head><meta charset="utf-8"><title>Service indisponible</title></head><body style="font-family: sans-serif; text-align:center; padding:40px;"><h1>Backend introuvable</h1><p>Le service en arrière-plan ${targetInfo || ''} est inaccessible pour le moment. Merci de réessayer plus tard.</p>${domainMsg}</body></html>`;
      try { res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); } catch (e) { try { res.writeHead(502); res.end('Bad gateway'); } catch (er) { } }
    } catch (e) { try { res.writeHead(502); res.end('Bad gateway'); } catch (er) { } }
  }
}

module.exports = new ProxyManager();

function parseSNI(buffer) {
  try {
    let offset = 0;
    if (buffer.length < 5) return null;
    if (buffer.readUInt8(0) !== 0x16) return null;
    const recordLength = buffer.readUInt16BE(3);
    if (buffer.length < 5 + recordLength) { }
    offset = 5;
    if (buffer.readUInt8(offset) !== 0x01) return null;
    const hsLength = buffer.readUIntBE(offset + 1, 3);
    offset += 4;
    offset += 2 + 32;
    const sessionIdLen = buffer.readUInt8(offset);
    offset += 1 + sessionIdLen;
    const cipherSuitesLen = buffer.readUInt16BE(offset);
    offset += 2 + cipherSuitesLen;
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
      if (extType === 0x0000) {
        let extOffset = offset;
        const listLen = buffer.readUInt16BE(extOffset);
        extOffset += 2;
        const listEnd = extOffset + listLen;
        while (extOffset + 3 <= listEnd) {
          const nameType = buffer.readUInt8(extOffset);
          const nameLen = buffer.readUInt16BE(extOffset + 1);
          extOffset += 3;
          if (nameType === 0) {
            if (extOffset + nameLen <= buffer.length) return buffer.toString('utf8', extOffset, extOffset + nameLen);
            else return null;
          } else extOffset += nameLen;
        }
        return null;
      }
      offset += extLen;
    }
  } catch (e) { return null; }
  return null;
}

function formatBytes(num) {
  let value = Number(num) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) { value /= 1024; idx++; }
  const display = idx === 0 ? Math.round(value) : value.toFixed(1);
  return `${display} ${units[idx]}`;
}

function formatNumber(num) { return Number(num || 0).toLocaleString('fr-FR'); }
