import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hub } from './hub.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

export function createServer(options = {}) {
  const config = {
    name: options.name ?? process.env.SERVER_NAME ?? 'Brinkgame Server',
    password: options.password ?? process.env.SERVER_PASSWORD ?? '',
    maxLobbies: Number(options.maxLobbies ?? process.env.MAX_LOBBIES ?? 50),
    webDir: options.webDir ?? process.env.WEB_DIR ?? path.resolve(here, '../../client/dist'),
  };
  const hub = new Hub(config);
  const webRoot = path.resolve(config.webDir);
  const hasWeb = fs.existsSync(path.join(webRoot, 'index.html'));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(hub.info()));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (!hasWeb) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${config.name} läuft. Verbinde dich mit der Brinkgame-App.`);
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(webRoot, `.${rel}`);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket, head);
  });

  return {
    server,
    hub,
    config,
    listen(port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '0.0.0.0') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close() {
      hub.close();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createServer();
  app.listen().then((addr) => {
    console.log(`[brinkgame] ${app.config.name} hört auf Port ${addr.port}`);
    console.log(`[brinkgame] Passwort: ${app.config.password ? 'gesetzt' : 'keins'} · TURN: ${process.env.TURN_URLS ? 'konfiguriert' : 'nicht konfiguriert'}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
