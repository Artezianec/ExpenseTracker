#!/usr/bin/env node
/**
 * One-time setup: local Python venv (no admin / no system pip).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const venvDir = path.join(root, '.venv');
const py =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
const pip =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

function run(cmd, args, label) {
  console.log(`→ ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(py)) {
  run('python', ['-m', 'venv', '.venv'], 'Create .venv');
}

run(pip, ['install', 'il-supermarket-scraper'], 'Install il-supermarket-scraper');
run(py, ['-m', 'playwright', 'install', 'chromium'], 'Install Playwright browser');

console.log('\nDone. Run: npm run scraper:download');
