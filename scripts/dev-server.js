#!/usr/bin/env node
'use strict';

// Zero-dependency local server: serves this static site and reloads browsers on file changes.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const ignored = new Set(['.git', '.github', '.idea', 'node_modules']);
const clients = new Set();
const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.moc': 'application/octet-stream', '.mtn': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};
let reloadTimer;

function reload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => clients.forEach((client) => client.write('data: reload\n\n')), 80);
}
function watch(directory) {
  if (ignored.has(path.basename(directory))) return;
  fs.watch(directory, (event, name) => {
    if (!name || ignored.has(name.toString())) return;
    const changed = path.join(directory, name.toString());
    if (event === 'rename' && fs.existsSync(changed) && fs.statSync(changed).isDirectory()) watch(changed);
    reload();
  });
  fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).forEach((entry) => watch(path.join(directory, entry.name)));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/__story_reload') {
    response.writeHead(200, { 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Content-Type': 'text/event-stream' });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end('Forbidden');
  fs.readFile(file, (error, data) => {
    if (error) return response.writeHead(404).end('Not found');
    const type = mime[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': type });
    response.end(type.startsWith('text/html') ? data.toString().replace('</body>', '<script>new EventSource("/__story_reload").onmessage=()=>location.reload()</script></body>') : data);
  });
});

watch(root);
server.listen(port, host, () => console.log(`Story development server: http://${host}:${port}`));
