import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
const MAX_RECEIPTS = 20;

export function getUploadsRoot(serverDir) {
  return path.join(serverDir, 'uploads', 'receipts');
}

export function monthLabel(month, year) {
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

export function addCalendarMonths(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function receiptPath(uploadsRoot, userId, storedFilename) {
  return path.join(uploadsRoot, userId, storedFilename);
}

export function deleteReceiptFile(uploadsRoot, userId, storedFilename) {
  if (!storedFilename) return;
  const full = receiptPath(uploadsRoot, userId, storedFilename);
  if (existsSync(full)) {
    try {
      unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function createReceiptsUpload(uploadsRoot) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = path.join(uploadsRoot, req.user.id);
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
  }).array('receipts', MAX_RECEIPTS);
}

export async function ensureGroupForUserMonth(
  pool,
  user,
  month,
  year,
  { ensureParticipantForUser, monthLabelFn = monthLabel },
) {
  const [dupes] = await pool.query(
    `SELECT g.id FROM \`groups\` g
     INNER JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ? AND g.month = ? AND g.year = ?`,
    [user.id, month, year],
  );
  if (dupes.length) return dupes[0].id;

  const groupId = randomUUID();
  const now = new Date();
  const name = monthLabelFn(month, year);

  await pool.query(
    `INSERT INTO \`groups\`
     (id, name, description, type, month, year, created_by, created_at, max_budget, budget_type)
     VALUES (?, ?, ?, 'household', ?, ?, ?, ?, ?, ?)`,
    [groupId, name, null, month, year, user.id, now, null, 'monthly'],
  );
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)`,
    [groupId, user.id, now],
  );
  await ensureParticipantForUser(groupId, user, now);
  return groupId;
}

export function effectiveMonthlyRateDecimal(ratePercent, period = 'monthly') {
  const value = Math.max(0, Number(ratePercent) || 0);
  if (value === 0) return 0;
  if (period === 'annual') {
    return Math.pow(1 + value / 100, 1 / 12) - 1;
  }
  return value / 100;
}

export function computeInstallmentAmounts(
  principal,
  count,
  ratePercent = 0,
  ratePeriod = 'monthly',
) {
  if (count <= 1) return [];

  const rate = effectiveMonthlyRateDecimal(ratePercent, ratePeriod);

  if (rate === 0) {
    const perPayment = Math.floor((principal * 100) / count) / 100;
    const remainder =
      Math.round((principal - perPayment * count) * 100) / 100;
    return Array.from({ length: count }, (_, i) =>
      i === count - 1
        ? Math.round((perPayment + remainder) * 100) / 100
        : perPayment,
    );
  }

  const factor = Math.pow(1 + rate, count);
  const payment =
    Math.round(((principal * rate * factor) / (factor - 1)) * 100) / 100;
  return Array.from({ length: count }, () => payment);
}

export async function createInstallments(
  pool,
  user,
  purchaseId,
  totalAmount,
  installmentCount,
  purchaseDate,
  interestRate,
  interestRatePeriod,
  deps,
) {
  if (installmentCount <= 1) return [];

  const baseMonth = purchaseDate.getMonth() + 1;
  const baseYear = purchaseDate.getFullYear();
  const paymentAmounts = computeInstallmentAmounts(
    totalAmount,
    installmentCount,
    interestRate,
    interestRatePeriod,
  );
  const created = [];

  for (let i = 1; i <= installmentCount; i += 1) {
    const { month, year } = addCalendarMonths(baseYear, baseMonth, i);
    const groupId = await ensureGroupForUserMonth(pool, user, month, year, deps);
    const amount = paymentAmounts[i - 1];
    const installmentId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_installments
       (id, purchase_id, group_id, installment_number, amount, month, year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [installmentId, purchaseId, groupId, i, amount, month, year],
    );
    created.push({
      id: installmentId,
      groupId,
      installmentNumber: i,
      amount,
      month,
      year,
    });
  }

  return created;
}

export async function rebuildInstallments(
  pool,
  user,
  purchaseId,
  totalAmount,
  installmentCount,
  purchaseDate,
  interestRate,
  interestRatePeriod,
  deps,
) {
  await pool.query('DELETE FROM purchase_installments WHERE purchase_id = ?', [
    purchaseId,
  ]);
  return createInstallments(
    pool,
    user,
    purchaseId,
    totalAmount,
    installmentCount,
    purchaseDate,
    interestRate,
    interestRatePeriod,
    deps,
  );
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

export function rowToReceipt(row) {
  return {
    id: row.id,
    originalName: row.original_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    createdAt: toIso(row.created_at),
  };
}

export function rowToPurchase(row, installments = [], receipts = []) {
  const amount = Number(row.amount);
  const totalScheduled = installments.reduce((sum, inst) => sum + inst.amount, 0);
  const roundedTotal =
    installments.length > 0
      ? Math.round(totalScheduled * 100) / 100
      : undefined;

  return {
    id: row.id,
    name: row.name,
    amount,
    store: row.store ?? undefined,
    purchaseDate: toIso(row.purchase_date),
    warrantyExpiresAt: row.warranty_expires_at
      ? toIso(row.warranty_expires_at)
      : undefined,
    installmentCount: row.installment_count,
    interestRate:
      row.monthly_interest_rate != null
        ? Number(row.monthly_interest_rate)
        : undefined,
    interestRatePeriod: row.interest_rate_period ?? 'annual',
    receipts,
    createdAt: toIso(row.created_at),
    installments,
    ...(roundedTotal != null
      ? {
          totalScheduled: roundedTotal,
          totalInterest: Math.round((roundedTotal - amount) * 100) / 100,
        }
      : {}),
  };
}

export async function getPurchaseReceipts(pool, purchaseId) {
  const [rows] = await pool.query(
    `SELECT id, original_name, mime_type, created_at, stored_filename
     FROM purchase_receipts
     WHERE purchase_id = ?
     ORDER BY created_at`,
    [purchaseId],
  );
  return rows.map(rowToReceipt);
}

export async function insertPurchaseReceipts(pool, purchaseId, files, now = new Date()) {
  const created = [];
  for (const file of files) {
    const receiptId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_receipts
       (id, purchase_id, stored_filename, original_name, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        receiptId,
        purchaseId,
        file.filename,
        file.originalname,
        file.mimetype,
        now,
      ],
    );
    created.push({
      id: receiptId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      createdAt: now.toISOString(),
    });
  }
  return created;
}

export async function deleteAllPurchaseReceiptFiles(
  pool,
  uploadsRoot,
  userId,
  purchaseId,
) {
  const [rows] = await pool.query(
    'SELECT stored_filename FROM purchase_receipts WHERE purchase_id = ?',
    [purchaseId],
  );
  for (const row of rows) {
    deleteReceiptFile(uploadsRoot, userId, row.stored_filename);
  }
}

export async function requirePurchaseReceipt(
  pool,
  userId,
  purchaseId,
  receiptId,
) {
  const [rows] = await pool.query(
    `SELECT pr.* FROM purchase_receipts pr
     INNER JOIN purchases p ON p.id = pr.purchase_id
     WHERE pr.id = ? AND pr.purchase_id = ? AND p.user_id = ?`,
    [receiptId, purchaseId, userId],
  );
  if (!rows.length) {
    const err = new Error('receipt not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

export async function loadPurchaseDto(pool, row) {
  const installments = await getPurchaseInstallments(pool, row.id);
  const receipts = await getPurchaseReceipts(pool, row.id);
  return rowToPurchase(row, installments, receipts);
}

export async function getPurchaseInstallments(pool, purchaseId) {
  const [rows] = await pool.query(
    `SELECT id, group_id AS groupId, installment_number AS installmentNumber,
            amount, month, year
     FROM purchase_installments
     WHERE purchase_id = ?
     ORDER BY installment_number`,
    [purchaseId],
  );
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    installmentNumber: r.installmentNumber,
    amount: Number(r.amount),
    month: r.month,
    year: r.year,
  }));
}

import { getHouseholdUserIds } from './household.mjs';

export async function getGroupInstallments(pool, groupId, userId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT pi.id, pi.purchase_id AS purchaseId, pi.amount,
            pi.installment_number AS installmentNumber, pi.month, pi.year,
            p.name AS purchaseName, p.store
     FROM purchase_installments pi
     INNER JOIN purchases p ON p.id = pi.purchase_id
     WHERE pi.group_id = ? AND p.user_id IN (${placeholders})
     ORDER BY pi.installment_number`,
    [groupId, ...userIds],
  );
  return rows.map((r) => ({
    id: r.id,
    purchaseId: r.purchaseId,
    purchaseName: r.purchaseName,
    store: r.store ?? undefined,
    amount: Number(r.amount),
    installmentNumber: r.installmentNumber,
    month: r.month,
    year: r.year,
  }));
}

export function cleanupUploadedFiles(uploadsRoot, userId, files) {
  if (!files?.length) return;
  for (const file of files) {
    deleteReceiptFile(uploadsRoot, userId, file.filename);
  }
}
