// A dependency-free static server, so `npm start` works the same on Windows,
// macOS and Linux without Python or any other tooling installed.
// Usage: node tools/serve.js [port] [--root dir] [--no-open]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const port = Number(args.find((a) => /^\d+$/.test(a))) || Number(process.env.PORT) || 8765;
const root = path.resolve(valueOf('--root', path.join(__dirname, '..')));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  // Strip the query string, then resolve inside the root. Anything that escapes
  // the root (../ and friends) is refused rather than served.
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found: ' + rel); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(buf);
    });
  });
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`Dominion is served from ${root}`);
  console.log(`Open ${url}  (Ctrl+C to stop)`);
  if (flag('--no-open') || process.env.CI) return;
  // Best effort: open the default browser. Failing is harmless, the URL is printed.
  const cmd = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? [process.env.COMSPEC || 'cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => { /* no browser available; the URL above still works */ });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is busy. Try: npm start -- ${port + 1}`); process.exit(1); }
  throw e;
});
