import { randomUUID } from 'node:crypto';
import { toIso } from './db.mjs';

export const DEFAULT_CHAINS = [
  { scraperKey: 'SHUFERSAL', name: 'Shufersal' },
  { scraperKey: 'RAMI_LEVY', name: 'Rami Levy' },
  { scraperKey: 'HAZI_HINAM', name: 'Hatzi Hinam' },
];

/** Sample products from a real Hatzi Hinam receipt for offline demo. */
export const SAMPLE_PRODUCTS = [
  {
    barcode: '7290010051311',
    nameHe: 'סקי חצי אחוז ארוז',
    price: 5.9,
    chainKey: 'HAZI_HINAM',
  },
  {
    barcode: '7290000319834',
    nameHe: 'קנור פסטו 125',
    price: 16.1,
    chainKey: 'HAZI_HINAM',
  },
  {
    barcode: '7290014079847',
    nameHe: 'צמר פלדה נייבי',
    price: 16.9,
    chainKey: 'HAZI_HINAM',
  },
  {
    barcode: '7290015859233',
    nameHe: 'קייל ירוק',
    price: 9.9,
    chainKey: 'HAZI_HINAM',
  },
  {
    barcode: '7290003029815',
    nameHe: 'חלב מועשר 2 ליטר',
    price: 16.9,
    chainKey: 'HAZI_HINAM',
  },
  {
    barcode: '7290000176420',
    nameHe: 'נס קפה 200 גרם',
    price: 26.9,
    chainKey: 'HAZI_HINAM',
  },
];

function rowToProductPrice(row) {
  return {
    chainId: row.chain_id,
    chainName: row.chain_name,
    storeId: row.store_id ?? undefined,
    storeName: row.store_name ?? undefined,
    price: Number(row.price),
    priceUpdatedAt: row.price_updated_at ? toIso(row.price_updated_at) : undefined,
    syncedAt: toIso(row.synced_at),
  };
}

export function rowToProduct(row, prices = []) {
  return {
    barcode: row.barcode,
    nameHe: row.name_he,
    manufacturer: row.manufacturer ?? undefined,
    unitQty: row.unit_qty ?? undefined,
    unitMeasure: row.unit_measure ?? undefined,
    prices,
    minPrice:
      prices.length > 0
        ? Math.min(...prices.map((p) => p.price))
        : undefined,
    updatedAt: toIso(row.updated_at),
  };
}

export async function ensureDefaultChains(pool) {
  const chainIds = {};
  for (const chain of DEFAULT_CHAINS) {
    const [existing] = await pool.query(
      'SELECT id FROM supermarket_chains WHERE scraper_key = ?',
      [chain.scraperKey],
    );
    if (existing.length) {
      chainIds[chain.scraperKey] = existing[0].id;
      continue;
    }
    const id = randomUUID();
    await pool.query(
      `INSERT INTO supermarket_chains (id, name, scraper_key, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, chain.name, chain.scraperKey, new Date()],
    );
    chainIds[chain.scraperKey] = id;
  }
  return chainIds;
}

export async function seedSampleProducts(pool) {
  const chainIds = await ensureDefaultChains(pool);
  const now = new Date();

  /** Demo multi-chain price offsets (base price from receipt). */
  const chainMultipliers = {
    SHUFERSAL: 1.08,
    RAMI_LEVY: 0.97,
    HAZI_HINAM: 1,
  };

  for (const sample of SAMPLE_PRODUCTS) {
    await pool.query(
      `INSERT INTO products (barcode, name_he, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name_he = VALUES(name_he), updated_at = VALUES(updated_at)`,
      [sample.barcode, sample.nameHe, now, now],
    );

    for (const chain of DEFAULT_CHAINS) {
      const chainId = chainIds[chain.scraperKey];
      if (!chainId) continue;

      const mult = chainMultipliers[chain.scraperKey] ?? 1;
      const price =
        Math.round(sample.price * mult * 100) / 100;

      const [existing] = await pool.query(
        `SELECT id, price FROM product_prices
         WHERE barcode = ? AND chain_id = ? AND store_id IS NULL`,
        [sample.barcode, chainId],
      );

      if (existing.length) {
        const oldPrice = Number(existing[0].price);
        await pool.query(
          `UPDATE product_prices
           SET price = ?, price_updated_at = ?, synced_at = ?
           WHERE id = ?`,
          [price, now, now, existing[0].id],
        );
        if (Math.abs(oldPrice - price) > 0.001) {
          await pool.query(
            `INSERT INTO product_price_history (id, barcode, chain_id, price, recorded_at)
             VALUES (?, ?, ?, ?, ?)`,
            [randomUUID(), sample.barcode, chainId, price, now],
          );
        }
      } else {
        await pool.query(
          `INSERT INTO product_prices
           (id, barcode, chain_id, store_id, price, price_updated_at, synced_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`,
          [randomUUID(), sample.barcode, chainId, price, now, now],
        );
        await pool.query(
          `INSERT INTO product_price_history (id, barcode, chain_id, price, recorded_at)
           VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), sample.barcode, chainId, price, now],
        );
      }
    }
  }
}

export async function getProductPrices(pool, barcode) {
  const [rows] = await pool.query(
    `SELECT pp.*, sc.name AS chain_name, ss.name AS store_name
     FROM product_prices pp
     INNER JOIN supermarket_chains sc ON sc.id = pp.chain_id
     LEFT JOIN supermarket_stores ss ON ss.id = pp.store_id
     WHERE pp.barcode = ?
     ORDER BY pp.price ASC`,
    [barcode],
  );
  return rows.map(rowToProductPrice);
}

export async function lookupProduct(pool, barcode) {
  const [rows] = await pool.query('SELECT * FROM products WHERE barcode = ?', [
    barcode,
  ]);
  if (!rows.length) return null;
  const prices = await getProductPrices(pool, barcode);
  return rowToProduct(rows[0], prices);
}

export async function searchProducts(pool, query, limit = 30) {
  const q = String(query ?? '').trim();
  if (!q) return [];

  const like = `%${q}%`;
  const [rows] = await pool.query(
    `SELECT * FROM products
     WHERE barcode LIKE ? OR name_he LIKE ?
     ORDER BY name_he
     LIMIT ?`,
    [like, like, limit],
  );

  const results = [];
  for (const row of rows) {
    const prices = await getProductPrices(pool, row.barcode);
    results.push(rowToProduct(row, prices));
  }
  return results;
}

export async function getFavoriteProducts(pool, userId) {
  const [rows] = await pool.query(
    `SELECT fp.barcode, fp.nickname, fp.created_at,
            p.name_he, p.manufacturer, p.unit_qty, p.unit_measure, p.updated_at
     FROM favorite_products fp
     INNER JOIN products p ON p.barcode = fp.barcode
     WHERE fp.user_id = ?
     ORDER BY fp.created_at DESC`,
    [userId],
  );

  const favorites = [];
  for (const row of rows) {
    const prices = await getProductPrices(pool, row.barcode);
    const [history] = await pool.query(
      `SELECT pph.price, pph.recorded_at, pph.chain_id, sc.name AS chain_name
       FROM product_price_history pph
       LEFT JOIN supermarket_chains sc ON sc.id = pph.chain_id
       WHERE pph.barcode = ?
       ORDER BY pph.recorded_at DESC
       LIMIT 30`,
      [row.barcode],
    );
    favorites.push({
      barcode: row.barcode,
      nickname: row.nickname ?? undefined,
      createdAt: toIso(row.created_at),
      product: rowToProduct(
        {
          barcode: row.barcode,
          name_he: row.name_he,
          manufacturer: row.manufacturer,
          unit_qty: row.unit_qty,
          unit_measure: row.unit_measure,
          updated_at: row.updated_at,
        },
        prices,
      ),
      priceHistory: history.map((h) => ({
        price: Number(h.price),
        recordedAt: toIso(h.recorded_at),
        chainId: h.chain_id ?? undefined,
        chainName: h.chain_name ?? undefined,
      })),
    });
  }
  return favorites;
}

export async function addFavorite(pool, userId, barcode, nickname) {
  const product = await lookupProduct(pool, barcode);
  if (!product) {
    const err = new Error('product not found in catalog');
    err.status = 404;
    throw err;
  }
  const now = new Date();
  await pool.query(
    `INSERT INTO favorite_products (user_id, barcode, nickname, created_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nickname = COALESCE(VALUES(nickname), nickname)`,
    [userId, barcode, nickname ?? null, now],
  );
  return { barcode, nickname: nickname ?? undefined, createdAt: now.toISOString() };
}

export async function removeFavorite(pool, userId, barcode) {
  const [result] = await pool.query(
    'DELETE FROM favorite_products WHERE user_id = ? AND barcode = ?',
    [userId, barcode],
  );
  if (result.affectedRows === 0) {
    const err = new Error('favorite not found');
    err.status = 404;
    throw err;
  }
}

export async function upsertProductFromPriceFile(pool, item, chainId, storeId) {
  const now = new Date();
  const barcode = String(item.barcode ?? item.ItemCode ?? '').trim();
  if (!barcode) return null;

  const nameHe = String(item.nameHe ?? item.ItemName ?? barcode).trim();
  const manufacturer = item.manufacturer ?? item.ManufacturerName ?? null;
  const unitQty = item.unitQty ?? item.Quantity ?? null;
  const unitMeasure = item.unitMeasure ?? item.UnitOfMeasure ?? null;
  const price = Number(item.price ?? item.ItemPrice);
  if (!Number.isFinite(price)) return null;

  await pool.query(
    `INSERT INTO products (barcode, name_he, manufacturer, unit_qty, unit_measure, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name_he = VALUES(name_he),
       manufacturer = COALESCE(VALUES(manufacturer), manufacturer),
       unit_qty = COALESCE(VALUES(unit_qty), unit_qty),
       unit_measure = COALESCE(VALUES(unit_measure), unit_measure),
       updated_at = VALUES(updated_at)`,
    [barcode, nameHe, manufacturer, unitQty, unitMeasure, now, now],
  );

  const priceUpdatedAt = item.priceUpdatedAt
    ? new Date(item.priceUpdatedAt)
    : now;

  const [existing] = await pool.query(
    `SELECT id, price FROM product_prices
     WHERE barcode = ? AND chain_id = ? AND store_id <=> ?`,
    [barcode, chainId, storeId ?? null],
  );

  if (existing.length) {
    const oldPrice = Number(existing[0].price);
    await pool.query(
      `UPDATE product_prices
       SET price = ?, price_updated_at = ?, synced_at = ?
       WHERE id = ?`,
      [price, priceUpdatedAt, now, existing[0].id],
    );
    if (Math.abs(oldPrice - price) > 0.001) {
      await pool.query(
        `INSERT INTO product_price_history (id, barcode, chain_id, price, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), barcode, chainId, price, now],
      );
    }
  } else {
    await pool.query(
      `INSERT INTO product_prices
       (id, barcode, chain_id, store_id, price, price_updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        barcode,
        chainId,
        storeId ?? null,
        price,
        priceUpdatedAt,
        now,
      ],
    );
    await pool.query(
      `INSERT INTO product_price_history (id, barcode, chain_id, price, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), barcode, chainId, price, now],
    );
  }

  return barcode;
}
