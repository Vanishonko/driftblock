/* Shared static file handler, used by both tools/serve.mjs and the
   wheel bridge so the game is always served the same way. */

import fs from 'node:fs';
import path from 'node:path';

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * @param {string} root directory to serve
 * @returns {(req, res) => boolean} handler; returns true if it took the request
 */
export function createStaticHandler(root) {
  return function handle(req, res) {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return true;
    }
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return true;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + urlPath);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      res.end(data);
    });
    return true;
  };
}

/** Walk upwards from `start` until a free port is found. */
export function listenWithFallback(server, startPort, attempts, onReady) {
  const tryPort = (port, left) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && left > 0) {
        tryPort(port + 1, left - 1);
      } else {
        console.error('\n  Could not start the server:', err.message, '\n');
        process.exit(1);
      }
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      onReady(port);
    });
  };
  tryPort(startPort, attempts);
}
