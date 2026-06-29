#!/usr/bin/env node
/**
 * Smoke test: register, login, create group, add expense.
 * Requires Budget API + MySQL running and .env filled in.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function loadEnv() {
  const env = { ...process.env };
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['../.env.local', '../.env']) {
    try {
      const raw = readFileSync(path.join(root, file), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        let s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const eq = s.indexOf('=');
        if (eq <= 0) continue;
        const key = s.slice(0, eq).trim();
        let val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!env[key]) env[key] = val;
      }
    } catch {
      /* optional */
    }
  }
  return env;
}

const env = loadEnv();
const base = `http://localhost:${env.BUDGET_API_PORT ?? '3001'}/api`;
const email = `test-${Date.now()}@example.com`;
const password = 'testpass123';

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

console.log('→ Register');
await api('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});

console.log('→ Login');
const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});

const auth = { Authorization: `Bearer ${token}` };

console.log('→ Create group');
const group = await api('/groups', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ name: 'Smoke Test Group', type: 'household' }),
});

console.log('→ Add expense');
await api(`/groups/${group.id}/expenses`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    amount: 42.5,
    description: 'Coffee',
    category: 'Food',
    date: new Date().toISOString(),
  }),
});

console.log('→ List expenses');
const expenses = await api(`/groups/${group.id}/expenses`, { headers: auth });
if (!expenses.length) throw new Error('expected expenses');

console.log('\n✓ Smoke test passed');
