// ============================================================
// SEB — Local Proxy Server
// Domain-whitelisting HTTP/HTTPS proxy.
// Design Doc §3: Network Isolation Design
// ============================================================

const http = require('http');
const net = require('net');
const url = require('url');

class ProxyServer {
    /**
     * @param {object} logger - Logger instance
     * @param {object} policyEngine - PolicyEngine instance
     */
    constructor(logger, policyEngine) {
        this.logger = logger;
        this.policyEngine = policyEngine;
        this.server = null;
        this.port = policyEngine.getProxyConfig().port || 18080;
        this._requestCount = 0;
        this._blockedCount = 0;
        this._allowedCount = 0;
    }

    /**
     * Start the proxy server.
     * @returns {Promise<number>} The port the proxy is listening on
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this._handleRequest.bind(this));
            this.server.on('connect', this._handleConnect.bind(this));

            this.server.on('error', (err) => {
                this.logger.log('ALERT', 'PROXY', `Proxy server error: ${err.message}`);
                reject(err);
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                this.logger.log('INFO', 'PROXY', `Proxy server started on 127.0.0.1:${this.port}`);
                resolve(this.port);
            });
        });
    }

    /**
     * Stop the proxy server.
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.logger.log('INFO', 'PROXY', 'Proxy server stopped', {
                        totalRequests: this._requestCount,
                        allowed: this._allowedCount,
                        blocked: this._blockedCount
                    });
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle HTTP request (GET, POST, etc.)
     * Design Doc §2.2.2, Listing 2: Navigation Control
     */
    _handleRequest(clientReq, clientRes) {
        this._requestCount++;

        try {
            const parsedUrl = url.parse(clientReq.url);
            const hostname = parsedUrl.hostname;

            if (!this.policyEngine.isDomainAllowed(hostname)) {
                this._blockedCount++;
                this.logger.log('WARN', 'PROXY', `Blocked HTTP: ${hostname}${parsedUrl.path || '/'}`, { method: clientReq.method });

                clientRes.writeHead(403, { 'Content-Type': 'text/html' });
                clientRes.end(this._getBlockPage(hostname));
                return;
            }

            this._allowedCount++;
            this.logger.log('INFO', 'PROXY', `Allowed HTTP: ${hostname}${parsedUrl.path || '/'}`, { method: clientReq.method });

            // Forward the request
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 80,
                path: parsedUrl.path,
                method: clientReq.method,
                headers: clientReq.headers
            };

            // Remove proxy-hop headers
            delete options.headers['proxy-connection'];

            const proxyReq = http.request(options, (proxyRes) => {
                clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(clientRes);
            });

            proxyReq.on('error', (err) => {
                this.logger.log('WARN', 'PROXY', `Forward error for ${hostname}: ${err.message}`);
                clientRes.writeHead(502, { 'Content-Type': 'text/html' });
                clientRes.end(this._getErrorPage(hostname, err.message));
            });

            clientReq.pipe(proxyReq);

        } catch (err) {
            this.logger.log('WARN', 'PROXY', `Request handler error: ${err.message}`);
            clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
            clientRes.end('Internal Proxy Error');
        }
    }

    /**
     * Handle HTTPS CONNECT tunneling.
     * We check the domain BEFORE establishing the tunnel.
     */
    _handleConnect(req, clientSocket, head) {
        this._requestCount++;

        const [hostname, port] = req.url.split(':');

        if (!this.policyEngine.isDomainAllowed(hostname)) {
            this._blockedCount++;
            this.logger.log('WARN', 'PROXY', `Blocked HTTPS: ${hostname}:${port || 443}`);

            clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            clientSocket.end();
            return;
        }

        this._allowedCount++;
        this.logger.log('INFO', 'PROXY', `Allowed HTTPS tunnel: ${hostname}:${port || 443}`);

        // Establish TCP tunnel to destination
        const serverSocket = net.connect(parseInt(port) || 443, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', (err) => {
            this.logger.log('WARN', 'PROXY', `Tunnel error for ${hostname}: ${err.message}`);
            clientSocket.end();
        });

        clientSocket.on('error', (err) => {
            serverSocket.end();
        });
    }

    /**
     * Generate blocked page HTML.
     */
    _getBlockPage(hostname) {
        const config = this.policyEngine.getProxyConfig();
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${config.blockPageTitle || 'Access Blocked — SEB'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d1a;
      color: #e8e8f0;
      font-family: 'Inter', -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      max-width: 500px;
      padding: 40px;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      color: #ff6b6b;
      margin-bottom: 12px;
    }
    p {
      color: #8888aa;
      font-size: 14px;
      line-height: 1.6;
    }
    .domain {
      background: rgba(255, 107, 107, 0.15);
      color: #ff6b6b;
      padding: 4px 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 13px;
      display: inline-block;
      margin: 12px 0;
    }
    .note {
      margin-top: 20px;
      font-size: 12px;
      color: #555577;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🛡️</div>
    <h1>${config.blockPageTitle || 'Access Blocked'}</h1>
    <p>${config.blockPageMessage || 'This website is not allowed during the examination.'}</p>
    <div class="domain">${hostname || 'unknown'}</div>
    <p class="note">This attempt has been logged. If you believe this is an error, contact your invigilator.</p>
  </div>
</body>
</html>`;
    }

    /**
     * Generate error page HTML.
     */
    _getErrorPage(hostname, error) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Error — SEB</title>
  <style>
    body {
      background: #0d0d1a; color: #e8e8f0;
      font-family: 'Inter', sans-serif;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .container { text-align: center; max-width: 500px; padding: 40px; }
    h1 { font-size: 22px; color: #ffa94d; margin-bottom: 12px; }
    p { color: #8888aa; font-size: 14px; }
    .error { color: #555577; font-size: 12px; margin-top: 16px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>⚠️ Connection Error</h1>
    <p>Could not connect to <strong>${hostname}</strong></p>
    <p class="error">${error}</p>
  </div>
</body>
</html>`;
    }

    /**
     * Get proxy statistics.
     */
    getStats() {
        return {
            port: this.port,
            totalRequests: this._requestCount,
            allowed: this._allowedCount,
            blocked: this._blockedCount,
            isRunning: this.server !== null && this.server.listening
        };
    }
}

module.exports = ProxyServer;
