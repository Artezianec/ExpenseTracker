#!/usr/bin/env node
/**
 * End-to-end smoke test: auth → create group → expense → delete → cleanup.
 * Requires ApexStream + Budget API running and .env.local filled in.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApexStreamAuth } from '@apexstream/client';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    env[s.slice(0, eq).trim()] = s
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = {
  ...loadEnvFile(path.join(root, '.env')),
  ...loadEnvFile(path.join(root, '.env.local')),
  ...process.env,
};

const controlPlaneUrl = (
  env.APEXSTREAM_CONTROL_PLANE_URL ??
  env.VITE_APEXSTREAM_CONTROL_PLANE_URL ??
  'http://localhost:8080'
).replace(/\/$/, '');

const appId = env.VITE_APEXSTREAM_APP_ID?.trim();
const publishableKey = env.VITE_APEXSTREAM_PUBLISHABLE_KEY?.trim();
const budgetApi = `http://127.0.0.1:${env.BUDGET_API_PORT ?? '3001'}`;

if (!appId || !publishableKey) {
  console.error('Set VITE_APEXSTREAM_APP_ID and VITE_APEXSTREAM_PUBLISHABLE_KEY in .env.local');
  process.exit(1);
}

const auth = new ApexStreamAuth({ controlPlaneUrl, appId, publishableKey });

const testEmail = `smoke-${Date.now()}@budgeted.test`;
const testPassword = 'SmokeTest123!';

async function api(method, collection, id, accessToken, body) {
  const url = `${budgetApi}/api/db/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  if (!res.ok && method !== 'DELETE') {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? res.statusText);
  }
}

function step(name) {
  console.log(`\n→ ${name}`);
}

try {
  step('Sign up');
  let session;
  try {
    session = await auth.signUp(testEmail, testPassword);
  } catch {
    session = null;
  }

  step('Sign in');
  session = await auth.signInWithPassword(testEmail, testPassword);
  const token = session.accessToken;
  const userId = session.user.id;
  console.log(`   user: ${userId.slice(0, 8)}…`);

  step('Create group via Budget API');
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await api('PUT', 'groups', groupId, token, {
    name: 'Smoke Test Group',
    type: 'personal',
    createdBy: userId,
    createdAt: now,
    memberIds: [userId],
  });
  await api('PUT', 'members', `${groupId}__${userId}`, token, {
    groupId,
    uid: userId,
    role: 'admin',
    joinedAt: now,
    email: testEmail,
  });
  console.log(`   group: ${groupId}`);

  step('Create expense');
  const expenseId = crypto.randomUUID();
  await api('PUT', 'expenses', expenseId, token, {
    groupId,
    amount: 42.5,
    description: 'Smoke test coffee',
    category: 'Food',
    paidBy: userId,
    date: now,
    createdAt: now,
    splitType: 'equal',
  });
  console.log(`   expense: ${expenseId}`);

  step('Patch expense');
  await api('PATCH', 'expenses', expenseId, token, { amount: 43 });

  step('Delete expense + group');
  await api('DELETE', 'expenses', expenseId, token);
  await api('DELETE', 'members', `${groupId}__${userId}`, token);
  await api('DELETE', 'groups', groupId, token);

  step('Sign out');
  await auth.signOut();

  console.log('\n✓ Smoke test passed');
} catch (error) {
  console.error('\n✗ Smoke test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
