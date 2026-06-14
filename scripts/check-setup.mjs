#!/usr/bin/env node
/**
 * Validates .env.local and ApexStream connectivity before smoke tests.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const env = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...process.env,
};

const required = [
  ['VITE_APEXSTREAM_APP_ID', 'App ID (dashboard)'],
  ['VITE_APEXSTREAM_PUBLISHABLE_KEY', 'Publishable key pk_live_…'],
  ['VITE_APEXSTREAM_API_KEY', 'API key pk_live_… (reads + WS)'],
  ['APEXSTREAM_SECRET_KEY', 'Secret key sk_live_… (Budget API writes)'],
];

const controlPlane = (
  env.APEXSTREAM_CONTROL_PLANE_URL ??
  env.VITE_APEXSTREAM_CONTROL_PLANE_URL ??
  'http://localhost:8080'
).replace(/\/$/, '');

const budgetApi = `http://127.0.0.1:${env.BUDGET_API_PORT ?? '3001'}`;

console.log('Budgeted — setup check\n');

let ok = true;

if (!existsSync(path.join(root, '.env.local'))) {
  console.log('⚠  .env.local missing — run: cp .env.example .env.local');
  ok = false;
}

for (const [key, label] of required) {
  const val = (env[key] ?? '').trim();
  if (!val || val.includes('REPLACE') || val.endsWith('…')) {
    console.log(`✗  ${key} — ${label}`);
    ok = false;
  } else {
    console.log(`✓  ${key} (${val.slice(0, 14)}…)`);
  }
}

async function ping(name, url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    console.log(`✓  ${name} reachable (${res.status}) ${url}`);
    return true;
  } catch (error) {
    console.log(
      `✗  ${name} unreachable ${url} — ${error instanceof Error ? error.message : error}`,
    );
    return false;
  }
}

console.log('');
const cpOk = await ping('Control plane', controlPlane);
const apiOk = await ping('Budget API', `${budgetApi}/health`);

if (!cpOk) {
  console.log('\n→ Start ApexStream (API + gateway). See https://apexstream.org/');
}

if (!apiOk) {
  console.log('\n→ Start Budget API: npm run dev:server');
}

if (!ok) {
  console.log('\n→ Fill .env.local with keys from the ApexStream dashboard.');
  process.exit(1);
}

if (!cpOk || !apiOk) {
  process.exit(1);
}

console.log('\nAll checks passed. Run: npm run test:smoke');
