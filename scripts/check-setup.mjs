#!/usr/bin/env node
/**
 * Validates .env and MySQL connectivity before smoke tests.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';

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
const required = [
  ['MYSQL_HOST', 'MySQL host'],
  ['MYSQL_USER', 'MySQL user'],
  ['MYSQL_DATABASE', 'Database name'],
  ['JWT_SECRET', 'JWT secret'],
];

let ok = true;
for (const [key, label] of required) {
  const val = env[key]?.trim();
  if (!val && key !== 'MYSQL_PASSWORD') {
    console.error(`✗ Missing ${key} (${label})`);
    ok = false;
  } else {
    console.log(`✓ ${key}`);
  }
}

if (!ok) {
  console.log('\n→ Fill .env from .env.example');
  process.exit(1);
}

try {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST ?? 'localhost',
    port: Number(env.MYSQL_PORT ?? '3306'),
    user: env.MYSQL_USER ?? 'root',
    password: env.MYSQL_PASSWORD ?? '',
    database: env.MYSQL_DATABASE ?? 'budgeted',
  });
  await conn.ping();
  await conn.end();
  console.log('\n✓ MySQL connection OK');
} catch (error) {
  console.error('\n✗ MySQL connection failed:', error.message);
  console.log('\n→ Start MySQL and create the database: CREATE DATABASE budgeted;');
  process.exit(1);
}

console.log('\n→ Run npm run dev:server && npm run dev');
