#!/usr/bin/env node
/**
 * Parse supermarket PriceFull XML dumps and upsert into MySQL.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../server/db.mjs';
import {
  getDumpsDirs,
  runPriceSyncImport,
} from '../server/supermarket-price-sync.mjs';

function loadEnv() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['../.env.local', '../.env', '../server/.env']) {
    try {
      const raw = readFileSync(path.join(root, file), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        let s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const eq = s.indexOf('=');
        if (eq <= 0) continue;
        const key = s.slice(0, eq).trim();
        let val = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      /* optional */
    }
  }
}

loadEnv();

async function main() {
  const pool = createPool();
  const dirs = getDumpsDirs();
  const result = await runPriceSyncImport(pool);

  if (!result.fileCount) {
    console.log(`No XML/GZ files in:\n  ${dirs.join('\n  ')}`);
    console.log('Run scraper first or use npm run seed:products for demo data.');
    await pool.end();
    return;
  }

  console.log(
    `Done: ${result.filesProcessed} files, ${result.productsUpserted} product updates`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
