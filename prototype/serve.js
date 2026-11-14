#!/usr/bin/env node
// 极简静态服务器：转发 --port/--host 参数，供预览使用（零依赖）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pick = (names, dft) => {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i >= 0 && args[i + 1]) return args[i + 1];
    const eq = args.find(a => a.startsWith(n + '='));
    if (eq) return eq.split('=')[1];
  }
  return dft;
};
const port = Number(pick(['--port', '-p'], 7100));
const host = pick(['--host', '-h'], '0.0.0.0');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, host, () => console.log(`[prototype] http://${host}:${port}`));
