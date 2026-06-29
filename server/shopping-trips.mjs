import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { toIso } from './db.mjs';
import { parseReceiptFile } from './receipt-ocr.mjs';
import { ensureGroupForUserMonth } from './purchases.mjs';
import { lookupProduct } from './products.mjs';
import { getHouseholdUserIds } from './household.mjs';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

export function getTripReceiptsUpload(uploadsRoot) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = path.join(uploadsRoot, req.user.id, 'trips');
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, ALLOWED_EXT.has(ext));
    },
  }).single('receipt');
}

export function tripReceiptPath(uploadsRoot, userId, storedFilename) {
  return path.join(uploadsRoot, userId, 'trips', storedFilename);
}

export function deleteTripReceiptFile(uploadsRoot, userId, storedFilename) {
  if (!storedFilename) return;
  const full = tripReceiptPath(uploadsRoot, userId, storedFilename);
  if (existsSync(full)) {
    try {
      unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function rowToTripItem(row) {
  return {
    id: row.id,
    barcode: row.barcode ?? undefined,
    name: row.name,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    isWeighed: Boolean(row.is_weighed),
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : undefined,
    sortOrder: row.sort_order,
  };
}

export function rowToTrip(row, items = [], receipts = []) {
  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    storeName: row.store_name ?? undefined,
    chainId: row.chain_id ?? undefined,
    totalAmount: Number(row.total_amount),
    tripDate: toIso(row.trip_date),
    source: row.source,
    createdAt: toIso(row.created_at),
    items,
    receipts: receipts.map((r) => ({
      id: r.id,
      originalName: r.original_name ?? undefined,
      mimeType: r.mime_type ?? undefined,
      createdAt: toIso(r.created_at),
    })),
  };
}

export async function getTripItems(pool, tripId) {
  const [rows] = await pool.query(
    `SELECT * FROM shopping_trip_items
     WHERE trip_id = ?
     ORDER BY sort_order, id`,
    [tripId],
  );
  return rows.map(rowToTripItem);
}

export async function getTripReceipts(pool, tripId) {
  const [rows] = await pool.query(
    `SELECT id, original_name, mime_type, created_at, stored_filename, content_hash
     FROM shopping_trip_receipts
     WHERE trip_id = ?
     ORDER BY created_at`,
    [tripId],
  );
  return rows;
}

export async function loadTripDto(pool, row) {
  const items = await getTripItems(pool, row.id);
  const receipts = await getTripReceipts(pool, row.id);
  return rowToTrip(row, items, receipts);
}

export async function getGroupShoppingTrips(pool, groupId, userId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT st.id, st.store_name, st.total_amount, st.trip_date, st.source,
            (SELECT COUNT(*) FROM shopping_trip_items WHERE trip_id = st.id) AS item_count
     FROM shopping_trips st
     WHERE st.group_id = ? AND st.user_id IN (${placeholders})
     ORDER BY st.trip_date DESC`,
    [groupId, ...userIds],
  );
  return rows.map((r) => ({
    id: r.id,
    storeName: r.store_name ?? undefined,
    totalAmount: Number(r.total_amount),
    tripDate: toIso(r.trip_date),
    source: r.source,
    itemCount: Number(r.item_count),
  }));
}

export function normalizeTripItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const err = new Error('at least one item is required');
    err.status = 400;
    throw err;
  }

  return rawItems.map((item, index) => {
    const name = String(item.name ?? '').trim();
    if (!name) {
      const err = new Error(`item ${index + 1}: name is required`);
      err.status = 400;
      throw err;
    }
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unitPrice ?? item.unit_price);
    const lineTotal = Number(
      item.lineTotal ?? item.line_total ?? quantity * unitPrice,
    );
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(lineTotal)
    ) {
      const err = new Error(`item ${index + 1}: invalid numbers`);
      err.status = 400;
      throw err;
    }
    return {
      barcode: item.barcode ? String(item.barcode).trim() : null,
      name,
      quantity,
      unitPrice,
      lineTotal: Math.round(lineTotal * 100) / 100,
      isWeighed: Boolean(item.isWeighed ?? item.is_weighed),
      weightKg:
        item.weightKg != null || item.weight_kg != null
          ? Number(item.weightKg ?? item.weight_kg)
          : null,
      sortOrder: index,
    };
  });
}

export async function resolveGroupId(pool, user, body, deps) {
  if (body.groupId) {
    const [rows] = await pool.query(
      `SELECT g.id FROM \`groups\` g
       INNER JOIN group_members gm ON gm.group_id = g.id
       WHERE g.id = ? AND gm.user_id = ?`,
      [body.groupId, user.id],
    );
    if (!rows.length) {
      const err = new Error('group not found');
      err.status = 404;
      throw err;
    }
    return body.groupId;
  }

  const tripDate = body.tripDate ? new Date(body.tripDate) : new Date();
  if (Number.isNaN(tripDate.getTime())) {
    const err = new Error('invalid trip date');
    err.status = 400;
    throw err;
  }
  const month = tripDate.getMonth() + 1;
  const year = tripDate.getFullYear();
  return ensureGroupForUserMonth(pool, user, month, year, deps);
}

export async function createShoppingTrip(
  pool,
  user,
  body,
  files,
  uploadsRoot,
  deps,
) {
  const items = normalizeTripItems(body.items);
  const totalFromItems = items.reduce((s, i) => s + i.lineTotal, 0);
  const totalAmount = Math.round(
    (body.totalAmount != null ? Number(body.totalAmount) : totalFromItems) *
      100,
  ) / 100;

  const tripDate = body.tripDate ? new Date(body.tripDate) : new Date();
  if (Number.isNaN(tripDate.getTime())) {
    const err = new Error('invalid trip date');
    err.status = 400;
    throw err;
  }

  const groupId = await resolveGroupId(pool, user, body, deps);
  const tripId = randomUUID();
  const now = new Date();
  const source = ['scan', 'receipt', 'manual'].includes(body.source)
    ? body.source
    : 'scan';

  await pool.query(
    `INSERT INTO shopping_trips
     (id, user_id, group_id, store_name, chain_id, total_amount, trip_date, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tripId,
      user.id,
      groupId,
      body.storeName?.trim() || null,
      body.chainId || null,
      totalAmount,
      tripDate,
      source,
      now,
    ],
  );

  for (const item of items) {
    await pool.query(
      `INSERT INTO shopping_trip_items
       (id, trip_id, barcode, name, quantity, unit_price, line_total, is_weighed, weight_kg, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        tripId,
        item.barcode,
        item.name,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.isWeighed ? 1 : 0,
        item.weightKg,
        item.sortOrder,
      ],
    );
  }

  if (files?.length) {
    for (const file of files) {
      const hash = file.buffer
        ? createHash('sha256').update(file.buffer).digest('hex')
        : null;
      await pool.query(
        `INSERT INTO shopping_trip_receipts
         (id, trip_id, stored_filename, original_name, mime_type, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          tripId,
          file.filename,
          file.originalname,
          file.mimetype,
          hash,
          now,
        ],
      );
    }
  }

  const [rows] = await pool.query('SELECT * FROM shopping_trips WHERE id = ?', [
    tripId,
  ]);
  return loadTripDto(pool, rows[0]);
}

export async function listShoppingTrips(pool, userId, groupId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  let sql = `SELECT * FROM shopping_trips WHERE user_id IN (${placeholders})`;
  const params = [...userIds];
  if (groupId) {
    sql += ' AND group_id = ?';
    params.push(groupId);
  }
  sql += ' ORDER BY trip_date DESC LIMIT 100';

  const [rows] = await pool.query(sql, params);
  return Promise.all(rows.map((row) => loadTripDto(pool, row)));
}

export async function requireTripOwner(pool, userId, tripId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT * FROM shopping_trips WHERE id = ? AND user_id IN (${placeholders})`,
    [tripId, ...userIds],
  );
  if (!rows.length) {
    const err = new Error('trip not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

export async function deleteShoppingTrip(
  pool,
  userId,
  tripId,
  uploadsRoot,
) {
  const row = await requireTripOwner(pool, userId, tripId);
  const receipts = await getTripReceipts(pool, tripId);
  await pool.query('DELETE FROM shopping_trips WHERE id = ?', [tripId]);
  for (const r of receipts) {
    deleteTripReceiptFile(uploadsRoot, row.user_id, r.stored_filename);
  }
}


export async function parseReceiptImage(pool, filePath, mimeType) {
  const parsed = await parseReceiptFile(filePath, mimeType);
  const items = normalizeTripItems(parsed.items ?? []);

  for (const item of items) {
    if (item.barcode && item.barcode.length >= 8) {
      const product = await lookupProduct(pool, item.barcode);
      if (product && (!item.name || item.name === item.barcode)) {
        item.name = product.nameHe;
      }
    }
  }

  return {
    storeName: parsed.storeName ?? undefined,
    tripDate: parsed.tripDate ?? new Date().toISOString(),
    totalAmount:
      parsed.totalAmount ??
      items.reduce((s, i) => s + i.lineTotal, 0),
    items,
    source: 'receipt',
  };
}

/** @deprecated alias */
export async function parseReceiptWithGemini(pool, filePath, mimeType) {
  return parseReceiptImage(pool, filePath, mimeType);
}
