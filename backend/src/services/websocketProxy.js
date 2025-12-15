const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

/**
 * WebSocket Proxy Service
 * Handles WebSocket connection upgrades and proxies them to backend servers
 */

class WebSocketProxy {
  constructor() {
    this.activeConnections = new Map(); // Track active WS connections
  }

  /**
   * Handle WebSocket upgrade request
   * @param {http.IncomingMessage} req - Incoming request
   * @param {net.Socket} socket - TCP socket
   * @param {Buffer} head - First packet of upgraded stream
   * @param {Object} backend - Backend server configuration
   */
  async handleUpgrade(req, socket, head, backend) {
    const connectionId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;

    console.log(`[WebSocketProxy] Upgrading connection ${connectionId} to ${backend.target_host}:${backend.target_port} (${backend.target_protocol})`);

    // Use TCP tunneling for HTTP/HTTPS backends (proxy-to-proxy)
    // This allows the WebSocket upgrade to pass through transparently
    if (backend.target_protocol === 'http' || backend.target_protocol === 'https') {
      return this.handleUpgradeWithTunnel(req, socket, head, backend, connectionId);
    }

    // Original WebSocket client method for direct backends
    try {
      // Create WebSocket connection to backend
      const backendProtocol = backend.target_protocol === 'https' ? 'wss' : 'ws';
      const backendUrl = `${backendProtocol}://${backend.target_host}:${backend.target_port}${req.url}`;

      const proxyHeaders = this.buildProxyHeaders(req);
      console.log(`[WebSocketProxy] Backend URL: ${backendUrl}`);

      const backendWs = new WebSocket(backendUrl, {
        headers: proxyHeaders,
        rejectUnauthorized: false // Allow self-signed certificates
      });

      // Handle backend connection errors
      backendWs.on('error', (error) => {
        console.error(`[WebSocketProxy] Backend error for ${connectionId}:`, error.message);
        socket.destroy();
        this.activeConnections.delete(connectionId);
      });

      // Wait for backend connection to open
      backendWs.on('open', () => {
        console.log(`[WebSocketProxy] Backend connected for ${connectionId}`);

        // Complete the upgrade on client side
        const wss = new WebSocket.Server({ noServer: true });

        wss.handleUpgrade(req, socket, head, (clientWs) => {
          console.log(`[WebSocketProxy] Client upgraded for ${connectionId}`);

          // Track connection
          this.activeConnections.set(connectionId, {
            client: clientWs,
            backend: backendWs,
            startTime: Date.now(),
            bytesReceived: 0,
            bytesSent: 0
          });

          // Proxy messages from client to backend
          clientWs.on('message', (data, isBinary) => {
            if (backendWs.readyState === WebSocket.OPEN) {
              backendWs.send(data, { binary: isBinary });
              const conn = this.activeConnections.get(connectionId);
              if (conn) conn.bytesSent += data.length;
            }
          });

          // Proxy messages from backend to client
          backendWs.on('message', (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
              const conn = this.activeConnections.get(connectionId);
              if (conn) conn.bytesReceived += data.length;
            }
          });

          // Handle client close
          clientWs.on('close', (code, reason) => {
            console.log(`[WebSocketProxy] Client closed ${connectionId} (code: ${code})`);
            if (backendWs.readyState === WebSocket.OPEN) {
              backendWs.close(code, reason);
            }
            this.activeConnections.delete(connectionId);
          });

          // Handle backend close
          backendWs.on('close', (code, reason) => {
            console.log(`[WebSocketProxy] Backend closed ${connectionId} (code: ${code})`);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(code, reason);
            }
            this.activeConnections.delete(connectionId);
          });

          // Handle client error
          clientWs.on('error', (error) => {
            console.error(`[WebSocketProxy] Client error for ${connectionId}:`, error.message);
            backendWs.close();
            this.activeConnections.delete(connectionId);
          });

          // Ping/pong keepalive
          const pingInterval = setInterval(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.ping();
            } else {
              clearInterval(pingInterval);
            }
          }, 30000); // Ping every 30 seconds

          clientWs.on('pong', () => {
            // Keep connection alive
          });
        });
      });

      // Handle backend connection timeout
      const timeout = setTimeout(() => {
        if (backendWs.readyState === WebSocket.CONNECTING) {
          console.error(`[WebSocketProxy] Backend connection timeout for ${connectionId}`);
          backendWs.terminate();
          socket.destroy();
          this.activeConnections.delete(connectionId);
        }
      }, 10000); // 10 second timeout

      backendWs.on('open', () => clearTimeout(timeout));

    } catch (error) {
      console.error(`[WebSocketProxy] Upgrade failed for ${connectionId}:`, error.message);
      socket.destroy();
      this.activeConnections.delete(connectionId);
    }
  }

  /**
   * Handle WebSocket upgrade with TCP tunneling (for proxy-to-proxy)
   * This forwards the raw HTTP upgrade request to the backend without terminating the WebSocket
   * @param {http.IncomingMessage} req - Incoming request
   * @param {net.Socket} socket - Client socket
   * @param {Buffer} head - First packet of upgraded stream
   * @param {Object} backend - Backend server configuration
   * @param {string} connectionId - Connection identifier
   */
  handleUpgradeWithTunnel(req, socket, head, backend, connectionId) {
    console.log(`[WebSocketProxy] Using TCP tunnel mode for ${connectionId}`);

    // Create connection to backend (TCP or TLS)
    const isSecure = backend.target_protocol === 'https';
    const backendSocket = isSecure
      ? tls.connect({
          host: backend.target_host,
          port: backend.target_port,
          rejectUnauthorized: false // Allow self-signed certificates
        })
      : net.connect({
          host: backend.target_host,
          port: backend.target_port
        });

    let backendConnected = false;

    // Function to send upgrade request once connected
    const sendUpgradeRequest = () => {
      backendConnected = true;
      console.log(`[WebSocketProxy] Backend connected for ${connectionId} (secure: ${isSecure})`);

      // Build and send the HTTP upgrade request to backend
      const upgradeRequest = this.buildUpgradeRequest(req, backend);
      backendSocket.write(upgradeRequest);

      // If there's data in head, send it too
      if (head && head.length > 0) {
        backendSocket.write(head);
      }
    };

    // Handle backend connection
    if (isSecure) {
      // For HTTPS backends, wait for TLS handshake to complete
      backendSocket.on('secureConnect', () => {
        console.log(`[WebSocketProxy] TLS tunnel established for ${connectionId}`);
        sendUpgradeRequest();
      });
    } else {
      // For HTTP backends, send on connect
      backendSocket.on('connect', () => {
        console.log(`[WebSocketProxy] TCP tunnel connected to backend for ${connectionId}`);
        sendUpgradeRequest();
      });
    }

    // Pipe data bidirectionally
    backendSocket.on('data', (data) => {
      if (!socket.destroyed) {
        socket.write(data);
      }
    });

    socket.on('data', (data) => {
      if (!backendSocket.destroyed) {
        backendSocket.write(data);
      }
    });

    // Handle errors
    backendSocket.on('error', (error) => {
      console.error(`[WebSocketProxy] Backend socket error for ${connectionId}:`, error.message);
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    socket.on('error', (error) => {
      console.error(`[WebSocketProxy] Client socket error for ${connectionId}:`, error.message);
      if (!backendSocket.destroyed) {
        backendSocket.destroy();
      }
    });

    // Handle connection close
    backendSocket.on('close', () => {
      console.log(`[WebSocketProxy] Backend socket closed for ${connectionId}`);
      if (!socket.destroyed) {
        socket.destroy();
      }
      this.activeConnections.delete(connectionId);
    });

    socket.on('close', () => {
      console.log(`[WebSocketProxy] Client socket closed for ${connectionId}`);
      if (!backendSocket.destroyed) {
        backendSocket.destroy();
      }
      this.activeConnections.delete(connectionId);
    });

    // Connection timeout
    const timeout = setTimeout(() => {
      if (!backendConnected) {
        console.error(`[WebSocketProxy] Backend connection timeout for ${connectionId}`);
        backendSocket.destroy();
        socket.destroy();
      }
    }, 10000); // 10 second timeout

    // Clear timeout when connection is ready (differs for HTTP vs HTTPS)
    if (isSecure) {
      backendSocket.on('secureConnect', () => clearTimeout(timeout));
    } else {
      backendSocket.on('connect', () => clearTimeout(timeout));
    }

    // Track connection
    this.activeConnections.set(connectionId, {
      client: socket,
      backend: backendSocket,
      startTime: Date.now(),
      mode: 'tunnel'
    });
  }

  /**
   * Build HTTP upgrade request for backend
   */
  buildUpgradeRequest(req, backend) {
    const lines = [];

    // Request line
    lines.push(`${req.method} ${req.url} HTTP/1.1`);

    // Headers
    const headers = { ...req.headers };

    // Update Host header to match backend
    headers.host = `${backend.target_host}:${backend.target_port}`;

    // Add X-Forwarded headers
    headers['x-forwarded-for'] = headers['x-forwarded-for'] || req.socket.remoteAddress;
    headers['x-forwarded-proto'] = req.connection.encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host;

    // Add all headers to request
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        lines.push(`${key}: ${value}`);
      }
    }

    // End of headers
    lines.push('');
    lines.push('');

    return lines.join('\r\n');
  }

  /**
   * Build proxy headers for backend connection
   */
  buildProxyHeaders(req) {
    const headers = {};

    // Forward important headers
    const forwardHeaders = [
      'cookie',
      'authorization',
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'origin',
      'sec-websocket-protocol',
      'sec-websocket-extensions'
    ];

    for (const header of forwardHeaders) {
      if (req.headers[header]) {
        headers[header] = req.headers[header];
      }
    }

    // Add X-Forwarded headers
    headers['x-forwarded-for'] = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    headers['x-forwarded-proto'] = req.connection.encrypted ? 'https' : 'http';
    headers['x-forwarded-host'] = req.headers.host;

    // Add custom proxy header
    headers['x-proxied-by'] = 'Nebula-Proxy/1.0';

    return headers;
  }

  /**
   * Get statistics about active WebSocket connections
   */
  getStats() {
    const stats = {
      activeConnections: this.activeConnections.size,
      connections: []
    };

    for (const [id, conn] of this.activeConnections.entries()) {
      stats.connections.push({
        id,
        duration: Date.now() - conn.startTime,
        bytesReceived: conn.bytesReceived,
        bytesSent: conn.bytesSent,
        clientState: this.getWebSocketState(conn.client),
        backendState: this.getWebSocketState(conn.backend)
      });
    }

    return stats;
  }

  /**
   * Get human-readable WebSocket state
   */
  getWebSocketState(ws) {
    switch (ws.readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return 'UNKNOWN';
    }
  }

  /**
   * Close all active connections
   */
  closeAll() {
    console.log(`[WebSocketProxy] Closing ${this.activeConnections.size} active connections`);

    for (const [id, conn] of this.activeConnections.entries()) {
      try {
        conn.client.close(1001, 'Server shutdown');
        conn.backend.close(1001, 'Server shutdown');
      } catch (error) {
        console.error(`[WebSocketProxy] Error closing connection ${id}:`, error.message);
      }
    }

    this.activeConnections.clear();
  }
}

// Singleton instance
const websocketProxy = new WebSocketProxy();

module.exports = websocketProxy;
