#!/usr/bin/env node
/**
 * Budgeted API — Document DB writes with sk_live_ (server-side only).
 * Pattern: apexstream/examples/document-db/server
 *
 * Browser uses pk_live_ for reads + db.* subscriptions; mutations go here.
 */

import express from 'express';
import { ApexStreamDatabase } from '@apexstream/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function loadDotEnv(envPath) {
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
    /* optional */
  }
}

const root = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(root, '.env'));
loadDotEnv(path.join(root, '..', '.env.local'));
loadDotEnv(path.join(root, '..', '.env'));

const controlPlaneUrl = (
  process.env.APEXSTREAM_CONTROL_PLANE_URL ??
  process.env.VITE_APEXSTREAM_CONTROL_PLANE_URL ??
  'http://localhost:8080'
).replace(/\/$/, '');

const secretKey = (
  process.env.APEXSTREAM_SECRET_KEY ??
  process.env.VITE_APEXSTREAM_SECRET_KEY ??
  ''
).trim();

const appId = (
  process.env.APEXSTREAM_APP_ID ??
  process.env.VITE_APEXSTREAM_APP_ID ??
  ''
).trim();

const port = Number(process.env.BUDGET_API_PORT ?? process.env.PORT ?? '3001');

if (!secretKey) {
  console.error('Set APEXSTREAM_SECRET_KEY=sk_live_… in .env.local (server writes).');
  process.exit(1);
}

if (!appId) {
  console.error('Set APEXSTREAM_APP_ID in .env.local (auth verification).');
  process.exit(1);
}

const db = new ApexStreamDatabase({
  controlPlaneUrl,
  apiKey: secretKey,
});

async function verifyUser(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('missing bearer token');
    err.status = 401;
    throw err;
  }
  const token = header.slice(7).trim();
  const res = await fetch(
    `${controlPlaneUrl}/v1/auth/apps/${encodeURIComponent(appId)}/user`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const err = new Error('invalid or expired session');
    err.status = 401;
    throw err;
  }
  const body = await res.json();
  return body.user;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.put(
  '/api/db/collections/:collection/documents/:id',
  async (req, res) => {
    try {
      await verifyUser(req);
      const doc = await db
        .collection(req.params.collection)
        .doc(req.params.id)
        .set(req.body?.data ?? req.body ?? {});
      res.json(doc);
    } catch (error) {
      const status = error.status ?? 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : 'write failed',
      });
    }
  },
);

app.patch(
  '/api/db/collections/:collection/documents/:id',
  async (req, res) => {
    try {
      await verifyUser(req);
      const doc = await db
        .collection(req.params.collection)
        .doc(req.params.id)
        .patch(req.body?.data ?? req.body ?? {});
      res.json(doc);
    } catch (error) {
      const status = error.status ?? 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : 'patch failed',
      });
    }
  },
);

app.delete(
  '/api/db/collections/:collection/documents/:id',
  async (req, res) => {
    try {
      await verifyUser(req);
      await db.collection(req.params.collection).doc(req.params.id).delete();
      res.status(204).end();
    } catch (error) {
      const status = error.status ?? 500;
      res.status(status).json({
        error: error instanceof Error ? error.message : 'delete failed',
      });
    }
  },
);

app.listen(port, '0.0.0.0', () => {
  console.log(`Budget API listening on http://0.0.0.0:${port}`);
  console.log(`  control plane: ${controlPlaneUrl}`);
  console.log(`  app id:        ${appId}`);
  console.log(`  key prefix:    ${secretKey.slice(0, 12)}…`);
});
