import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import {
  addCalendarMonths,
  deleteReceiptFile,
  ensureGroupForUserMonth,
  monthLabel,
  receiptPath,
} from './purchases.mjs';
import { getHouseholdUserIds } from './household.mjs';

const MAX_CONTRACTS = 20;
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

export { receiptPath, deleteReceiptFile };

function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

export function parsePaymentDay(raw) {
  const day = raw != null && raw !== '' ? parseInt(String(raw), 10) : 1;
  if (!Number.isFinite(day) || day < 1 || day > 28) {
    const err = new Error('payment day must be between 1 and 28');
    err.status = 400;
    throw err;
  }
  return day;
}

export function parseSubjectType(raw) {
  if (raw === 'person' || raw === 'purchase' || raw === 'other') return raw;
  const err = new Error('subject type must be person, purchase, or other');
  err.status = 400;
  throw err;
}

export function countScheduleMonths(startDate, endDate) {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 24;

  if (!endDate) return 24;

  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return 24;

  let count = 0;
  let year = start.getFullYear();
  let month = start.getMonth() + 1;
  const endYear = end.getFullYear();
  const endMonth = end.getMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    count += 1;
    if (count > 120) break;
    const next = addCalendarMonths(year, month, 1);
    year = next.year;
    month = next.month;
  }

  return Math.max(1, count);
}

export function createContractsUpload(uploadsRoot) {
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
  }).array('contracts', MAX_CONTRACTS);
}

export async function validateInsuranceSubject(
  pool,
  userId,
  subjectType,
  subjectUserId,
  subjectPurchaseId,
  subjectLabel,
) {
  const userIds = await getHouseholdUserIds(pool, userId);

  if (subjectType === 'person') {
    if (!subjectUserId) {
      const err = new Error('select a household member');
      err.status = 400;
      throw err;
    }
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT id, display_name, email FROM users WHERE id = ? AND id IN (${placeholders})`,
      [subjectUserId, ...userIds],
    );
    if (!rows.length) {
      const err = new Error('invalid household member');
      err.status = 400;
      throw err;
    }
    const u = rows[0];
    return u.display_name || u.email;
  }

  if (subjectType === 'purchase') {
    if (!subjectPurchaseId) {
      const err = new Error('select a product');
      err.status = 400;
      throw err;
    }
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT id, name, store FROM purchases WHERE id = ? AND user_id IN (${placeholders})`,
      [subjectPurchaseId, ...userIds],
    );
    if (!rows.length) {
      const err = new Error('invalid product');
      err.status = 400;
      throw err;
    }
    const p = rows[0];
    return p.store ? `${p.name} (${p.store})` : p.name;
  }

  const label = String(subjectLabel ?? '').trim();
  if (!label) {
    const err = new Error('describe what this insurance covers');
    err.status = 400;
    throw err;
  }
  return label;
}

export async function getInsuranceContracts(pool, insuranceId) {
  const [rows] = await pool.query(
    `SELECT id, original_name AS originalName, mime_type AS mimeType,
            created_at AS createdAt
     FROM insurance_contracts
     WHERE insurance_id = ?
     ORDER BY created_at`,
    [insuranceId],
  );
  return rows.map((r) => ({
    id: r.id,
    originalName: r.originalName ?? undefined,
    mimeType: r.mimeType ?? undefined,
    createdAt: toIso(r.createdAt),
  }));
}

export async function getInsurancePayments(pool, insuranceId) {
  const [rows] = await pool.query(
    `SELECT id, group_id AS groupId, payment_number AS paymentNumber,
            amount, month, year
     FROM insurance_payments
     WHERE insurance_id = ?
     ORDER BY payment_number`,
    [insuranceId],
  );
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    paymentNumber: r.paymentNumber,
    amount: Number(r.amount),
    month: r.month,
    year: r.year,
  }));
}

function resolveSubjectDisplay(row) {
  if (row.subject_type === 'person') {
    return row.person_name || row.person_email || 'Household member';
  }
  if (row.subject_type === 'purchase') {
    if (row.purchase_store) {
      return `${row.purchase_name} (${row.purchase_store})`;
    }
    return row.purchase_name || 'Product';
  }
  return row.subject_label || 'Other';
}

export function rowToInsurance(row, contracts = [], payments = []) {
  const monthlyAmount = Number(row.monthly_amount);
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    monthlyAmount,
    subjectType: row.subject_type,
    subjectUserId: row.subject_user_id ?? undefined,
    subjectPurchaseId: row.subject_purchase_id ?? undefined,
    subjectLabel: row.subject_label ?? undefined,
    subjectDisplayName: resolveSubjectDisplay(row),
    paymentDay: row.payment_day,
    startDate: toIso(row.start_date),
    endDate: row.end_date ? toIso(row.end_date) : undefined,
    createdAt: toIso(row.created_at),
    contracts,
    payments,
    scheduleMonths: payments.length,
  };
}

const INSURANCE_SELECT = `
  SELECT i.*,
         u.display_name AS person_name, u.email AS person_email,
         p.name AS purchase_name, p.store AS purchase_store
  FROM insurances i
  LEFT JOIN users u ON u.id = i.subject_user_id
  LEFT JOIN purchases p ON p.id = i.subject_purchase_id
`;

export async function loadInsuranceDto(pool, row) {
  const contracts = await getInsuranceContracts(pool, row.id);
  const payments = await getInsurancePayments(pool, row.id);
  return rowToInsurance(row, contracts, payments);
}

export async function fetchInsuranceRow(pool, insuranceId) {
  const [rows] = await pool.query(`${INSURANCE_SELECT} WHERE i.id = ?`, [
    insuranceId,
  ]);
  return rows[0] ?? null;
}

export async function createInsurancePayments(
  pool,
  user,
  insuranceId,
  monthlyAmount,
  scheduleMonths,
  startDate,
  deps,
) {
  const baseMonth = startDate.getMonth() + 1;
  const baseYear = startDate.getFullYear();
  const created = [];

  for (let i = 1; i <= scheduleMonths; i += 1) {
    const { month, year } = addCalendarMonths(baseYear, baseMonth, i);
    const groupId = await ensureGroupForUserMonth(pool, user, month, year, {
      ...deps,
      monthLabelFn: monthLabel,
    });
    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO insurance_payments
       (id, insurance_id, group_id, payment_number, amount, month, year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, insuranceId, groupId, i, monthlyAmount, month, year],
    );
    created.push({
      id: paymentId,
      groupId,
      paymentNumber: i,
      amount: monthlyAmount,
      month,
      year,
    });
  }

  return created;
}

export async function rebuildInsurancePayments(
  pool,
  user,
  insuranceId,
  monthlyAmount,
  scheduleMonths,
  startDate,
  deps,
) {
  await pool.query('DELETE FROM insurance_payments WHERE insurance_id = ?', [
    insuranceId,
  ]);
  return createInsurancePayments(
    pool,
    user,
    insuranceId,
    monthlyAmount,
    scheduleMonths,
    startDate,
    deps,
  );
}

export async function insertInsuranceContracts(
  pool,
  insuranceId,
  files,
  now = new Date(),
) {
  if (!files?.length) return [];
  const inserted = [];
  for (const file of files) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO insurance_contracts
       (id, insurance_id, stored_filename, original_name, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        insuranceId,
        file.filename,
        file.originalname || null,
        file.mimetype || null,
        now,
      ],
    );
    inserted.push({
      id,
      originalName: file.originalname || undefined,
      mimeType: file.mimetype || undefined,
      createdAt: toIso(now),
    });
  }
  return inserted;
}

export async function requireInsuranceContract(
  pool,
  userId,
  insuranceId,
  contractId,
) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT c.* FROM insurance_contracts c
     INNER JOIN insurances i ON i.id = c.insurance_id
     WHERE c.id = ? AND c.insurance_id = ? AND i.user_id IN (${placeholders})`,
    [contractId, insuranceId, ...userIds],
  );
  if (!rows.length) {
    const err = new Error('contract not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

export async function deleteInsuranceFiles(
  pool,
  uploadsRoot,
  userId,
  insuranceId,
) {
  const [contracts] = await pool.query(
    'SELECT stored_filename FROM insurance_contracts WHERE insurance_id = ?',
    [insuranceId],
  );
  for (const c of contracts) {
    deleteReceiptFile(uploadsRoot, userId, c.stored_filename);
  }
}

export async function getGroupInsurancePayments(pool, groupId, userId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT ip.id, ip.insurance_id AS insuranceId, ip.amount,
            ip.payment_number AS paymentNumber, ip.month, ip.year,
            ins.name AS insuranceName, ins.company, ins.payment_day AS paymentDay,
            ins.subject_type AS subjectType, ins.subject_label AS subjectLabel,
            u.display_name AS personName, u.email AS personEmail,
            p.name AS purchaseName, p.store AS purchaseStore
     FROM insurance_payments ip
     INNER JOIN insurances ins ON ins.id = ip.insurance_id
     LEFT JOIN users u ON u.id = ins.subject_user_id
     LEFT JOIN purchases p ON p.id = ins.subject_purchase_id
     WHERE ip.group_id = ? AND ins.user_id IN (${placeholders})
     ORDER BY ip.payment_number`,
    [groupId, ...userIds],
  );
  return rows.map((r) => {
    let subjectLabel = r.subjectLabel ?? undefined;
    if (r.subjectType === 'person') {
      subjectLabel = r.personName || r.personEmail || 'Member';
    } else if (r.subjectType === 'purchase') {
      subjectLabel = r.purchaseStore
        ? `${r.purchaseName} (${r.purchaseStore})`
        : r.purchaseName;
    }
    return {
      id: r.id,
      insuranceId: r.insuranceId,
      insuranceName: r.insuranceName,
      company: r.company,
      subjectLabel,
      amount: Number(r.amount),
      paymentNumber: r.paymentNumber,
      paymentDay: r.paymentDay,
      month: r.month,
      year: r.year,
    };
  });
}

export function cleanupUploadedContractFiles(uploadsRoot, userId, files) {
  if (!files?.length) return;
  for (const file of files) {
    deleteReceiptFile(uploadsRoot, userId, file.filename);
  }
}
