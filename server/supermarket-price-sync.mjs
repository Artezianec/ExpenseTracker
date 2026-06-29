import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { ensureDefaultChains, upsertProductFromPriceFile } from './products.mjs';
import { toIso } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const CHAIN_FOLDER_MAP = {
  shufersal: 'SHUFERSAL',
  rami: 'RAMI_LEVY',
  rami_levy: 'RAMI_LEVY',
  hazi: 'HAZI_HINAM',
  hinam: 'HAZI_HINAM',
  hatzi: 'HAZI_HINAM',
};

export function getDumpsDirs() {
  const dumpsDir =
    process.env.SUPERMARKET_DUMPS_DIR ??
    path.join(projectRoot, 'data', 'supermarket-dumps');
  return [dumpsDir, path.join(projectRoot, 'dumps')];
}

function detectChainKey(filePath) {
  const lower = filePath.toLowerCase();
  for (const [needle, key] of Object.entries(CHAIN_FOLDER_MAP)) {
    if (lower.includes(needle)) return key;
  }
  return process.env.DEFAULT_CHAIN_KEY ?? 'HAZI_HINAM';
}

async function readMaybeGzip(filePath) {
  const buf = readFileSync(filePath);
  if (filePath.endsWith('.gz')) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const gunzip = createGunzip();
      gunzip.on('data', (c) => chunks.push(c));
      gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      gunzip.on('error', reject);
      gunzip.end(buf);
    });
  }
  return buf.toString('utf8');
}

function extractItems(parsed) {
  const root =
    parsed?.Root ??
    parsed?.root ??
    parsed?.Prices ??
    parsed?.prices ??
    parsed;
  let items =
    root?.Items?.Item ??
    root?.items?.item ??
    root?.Item ??
    root?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function normalizeItem(raw) {
  const get = (...keys) => {
    for (const k of keys) {
      if (raw[k] != null && raw[k] !== '') return raw[k];
      const lower = k.toLowerCase();
      if (raw[lower] != null && raw[lower] !== '') return raw[lower];
      const upper = k.toUpperCase();
      if (raw[upper] != null && raw[upper] !== '') return raw[upper];
    }
    return null;
  };
  return {
    barcode: String(get('ItemCode', 'Barcode', 'ItemId') ?? '').trim(),
    nameHe: String(get('ItemName', 'ItemNm', 'Name') ?? '').trim(),
    manufacturer: get('ManufacturerName', 'Manufacturer'),
    unitQty: get('Quantity', 'QtyInPackage'),
    unitMeasure: get('UnitOfMeasure', 'UnitQty'),
    price: Number(get('ItemPrice', 'Price')),
    priceUpdatedAt: get('PriceUpdateDate', 'PriceUpdatedDate'),
  };
}

function collectXmlFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectXmlFiles(full, acc);
    else if (/\.(xml|gz)$/i.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Import XML/GZ price dumps from disk into MySQL.
 * @returns {{ filesProcessed: number, productsUpserted: number, fileCount: number }}
 */
export async function runPriceSyncImport(pool) {
  const chainIds = await ensureDefaultChains(pool);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
  });

  const files = [];
  for (const dir of getDumpsDirs()) {
    collectXmlFiles(dir, files);
  }

  if (!files.length) {
    return { filesProcessed: 0, productsUpserted: 0, fileCount: 0 };
  }

  let filesProcessed = 0;
  let productsUpserted = 0;

  for (const filePath of files) {
    const chainKey = detectChainKey(filePath);
    const chainId = chainIds[chainKey];
    if (!chainId) continue;

    const runId = randomUUID();
    const started = new Date();
    await pool.query(
      `INSERT INTO price_sync_runs
       (id, chain_id, files_processed, products_upserted, prices_upserted, status, started_at)
       VALUES (?, ?, 0, 0, 0, 'running', ?)`,
      [runId, chainId, started],
    );

    try {
      const xml = await readMaybeGzip(filePath);
      const parsed = parser.parse(xml);
      const items = extractItems(parsed);
      let count = 0;

      for (const raw of items) {
        const item = normalizeItem(raw);
        const barcode = await upsertProductFromPriceFile(
          pool,
          item,
          chainId,
          null,
        );
        if (barcode) count += 1;
      }

      filesProcessed += 1;
      productsUpserted += count;
      await pool.query(
        `UPDATE price_sync_runs
         SET files_processed = 1, products_upserted = ?, prices_upserted = ?,
             status = 'success', finished_at = ?
         WHERE id = ?`,
        [count, count, new Date(), runId],
      );
    } catch (error) {
      await pool.query(
        `UPDATE price_sync_runs
         SET status = 'failed', error_message = ?, finished_at = ?
         WHERE id = ?`,
        [error.message, new Date(), runId],
      );
      throw error;
    }
  }

  return { filesProcessed, productsUpserted, fileCount: files.length };
}

export async function getPriceSyncStatus(pool) {
  const [lastSuccess] = await pool.query(
    `SELECT finished_at, products_upserted, files_processed
     FROM price_sync_runs
     WHERE status = 'success' AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`,
  );

  const [lastRun] = await pool.query(
    `SELECT status, started_at, finished_at, error_message, products_upserted
     FROM price_sync_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );

  const [running] = await pool.query(
    `SELECT id, started_at FROM price_sync_runs
     WHERE status = 'running'
     ORDER BY started_at DESC
     LIMIT 1`,
  );

  const [productCount] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM products',
  );
  const [priceCount] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM product_prices',
  );

  return {
    enabled: process.env.PRICE_SYNC_ENABLED === 'true',
    running: running.length > 0,
    lastSuccessAt: lastSuccess[0]?.finished_at
      ? toIso(lastSuccess[0].finished_at)
      : null,
    lastSuccessProducts: lastSuccess[0]?.products_upserted ?? 0,
    lastRun: lastRun[0]
      ? {
          status: lastRun[0].status,
          startedAt: toIso(lastRun[0].started_at),
          finishedAt: lastRun[0].finished_at
            ? toIso(lastRun[0].finished_at)
            : null,
          errorMessage: lastRun[0].error_message ?? undefined,
          productsUpserted: lastRun[0].products_upserted ?? 0,
        }
      : null,
    productCount: Number(productCount[0]?.cnt ?? 0),
    priceCount: Number(priceCount[0]?.cnt ?? 0),
  };
}
