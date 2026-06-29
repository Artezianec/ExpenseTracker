import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(serverRoot, '..');

function loadDotEnvFile(envPath) {
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      let s = line.trim();
      if (!s || s.startsWith('#')) continue;
      if (s.toLowerCase().startsWith('export ')) s = s.slice(7).trim();
      const eq = s.indexOf('=');
      if (eq <= 0) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = val;
    }
  } catch {
    /* optional file */
  }
}

let loaded = false;

/** Load MYSQL_*, JWT_*, etc. from .env (once per process). */
export function loadProjectEnv() {
  if (loaded) return;
  loaded = true;
  loadDotEnvFile(path.join(serverRoot, '.env'));
  loadDotEnvFile(path.join(projectRoot, '.env.local'));
  loadDotEnvFile(path.join(projectRoot, '.env'));
}

loadProjectEnv();
