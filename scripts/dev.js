#!/usr/bin/env node
// 开发模式：同时启动 API(3001) 与 Vite，转发 --host/--port 等参数给 Vite
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const api = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, API_PORT: process.env.API_PORT || '3001' },
});

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

const shutdown = () => { api.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', (code) => { api.kill(); process.exit(code ?? 0); });
api.on('exit', (code) => { if (code) { vite.kill(); process.exit(code); } });
