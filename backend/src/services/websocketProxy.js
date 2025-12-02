const WebSocket = require('ws');
const http = require('http');
const https = require('https');

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

    console.log(`[WebSocketProxy] Upgrading connection ${connectionId} to ${backend.target_host}:${backend.target_port}`);

    try {
      // Create WebSocket connection to backend
      const backendProtocol = backend.target_protocol === 'https' ? 'wss' : 'ws';
      const backendUrl = `${backendProtocol}://${backend.target_host}:${backend.target_port}${req.url}`;

      const backendWs = new WebSocket(backendUrl, {
        headers: this.buildProxyHeaders(req),
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
