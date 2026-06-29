#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const py =
  process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');

if (!existsSync(py)) {
  console.error(
    'Python venv not found. Run once:\n  npm run scraper:setup',
  );
  process.exit(1);
}

const result = spawnSync(py, ['scripts/download-supermarket-dumps.py'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
