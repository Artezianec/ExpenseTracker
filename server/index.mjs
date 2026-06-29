#!/usr/bin/env node
/**
 * Budgeted API — Express + MySQL with simple JWT auth.
 */

import express from 'express';
import multer from 'multer';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPool, initSchema, toIso } from './db.mjs';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  newUserId,
  rowToAppUser,
} from './auth.mjs';
import {
  createInstallments,
  createReceiptsUpload,
  cleanupUploadedFiles,
  deleteAllPurchaseReceiptFiles,
  deleteReceiptFile,
  getGroupInstallments,
  getPurchaseInstallments,
  getUploadsRoot,
  insertPurchaseReceipts,
  loadPurchaseDto,
  rebuildInstallments,
  receiptPath,
  requirePurchaseReceipt,
} from './purchases.mjs';
import {
  createCreditPayments,
  getGroupCreditPayments,
  loadCreditDto,
  parseInterestRate as parseCreditInterestRate,
  parseInterestRatePeriod as parseCreditInterestRatePeriod,
  parsePaymentDay,
  rebuildCreditPayments,
} from './credits.mjs';
import {
  cleanupUploadedContractFiles,
  countScheduleMonths,
  createContractsUpload,
  createInsurancePayments,
  deleteInsuranceFiles,
  fetchInsuranceRow,
  getGroupInsurancePayments,
  insertInsuranceContracts,
  loadInsuranceDto,
  parsePaymentDay as parseInsurancePaymentDay,
  parseSubjectType,
  rebuildInsurancePayments,
  requireInsuranceContract,
  validateInsuranceSubject,
} from './insurances.mjs';
import {
  addAllHouseholdMembersToGroup,
  createHouseholdForUser,
  ensureHouseholdForUser,
  getHouseholdId,
  getHouseholdUserIds,
  inviteHouseholdMember,
  listHouseholdMembers,
  removeHouseholdMember,
  resourceOwnedByHousehold,
  syncHouseholdParticipantsForGroup,
} from './household.mjs';
import {
  addFavorite,
  getFavoriteProducts,
  lookupProduct,
  removeFavorite,
  searchProducts,
  getProductPrices,
} from './products.mjs';
import {
  checkReceiptOcrAvailable,
  getReceiptOcrConfig,
} from './receipt-ocr.mjs';
import {
  commitExpenseImport,
  parseExpensePdfFiles,
} from './expense-import.mjs';
import {
  commitLoanImport,
  parseLoanImportFiles,
} from './loan-import.mjs';
import {
  checkAiInsightsAvailable,
  getAiInsightsConfig,
} from './llm.mjs';
import {
  getPriceSyncStatus,
  isPriceSyncRunning,
  startPriceSyncScheduler,
} from './price-sync-scheduler.mjs';
import {
  createShoppingTrip,
  deleteShoppingTrip,
  getGroupShoppingTrips,
  getTripReceiptsUpload,
  listShoppingTrips,
  loadTripDto,
  parseReceiptImage,
  requireTripOwner,
  tripReceiptPath,
  deleteTripReceiptFile,
} from './shopping-trips.mjs';

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
const uploadsRoot = getUploadsRoot(root);
const receiptsUpload = createReceiptsUpload(uploadsRoot);
const contractsUpload = createContractsUpload(uploadsRoot);
const tripReceiptUpload = getTripReceiptsUpload(uploadsRoot);
const installmentDeps = () => ({
  ensureParticipantForUser,
  monthLabelFn: monthLabel,
});

const expensePdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    cb(null, ok);
  },
}).array('pdfs', 25);

const loanImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname ?? '').toLowerCase();
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('image/') ||
      /\.(pdf|jpe?g|png|webp|heic)$/i.test(name);
    cb(null, ok);
  },
}).array('files', 5);
loadDotEnv(path.join(root, '.env'));
loadDotEnv(path.join(root, '..', '.env.local'));
loadDotEnv(path.join(root, '..', '.env'));

const port = Number(process.env.BUDGET_API_PORT ?? process.env.PORT ?? '3001');
const pool = createPool();

async function requireUser(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('missing bearer token');
    err.status = 401;
    throw err;
  }
  try {
    const payload = verifyToken(header.slice(7).trim());
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [
      payload.sub,
    ]);
    if (!rows.length) {
      const err = new Error('user not found');
      err.status = 401;
      throw err;
    }
    return rows[0];
  } catch (error) {
    if (error.status) throw error;
    const err = new Error('invalid or expired session');
    err.status = 401;
    throw err;
  }
}

async function requireGroupMember(userId, groupId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
    [groupId, userId],
  );
  if (!rows.length) {
    const err = new Error('forbidden');
    err.status = 403;
    throw err;
  }
}

async function rowToGroup(
  row,
  memberIds,
  installments = undefined,
  creditPayments = undefined,
  insurancePayments = undefined,
  shoppingTrips = undefined,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    type: row.type,
    month: row.month,
    year: row.year,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    memberIds,
    ...(installments?.length ? { installments } : {}),
    ...(creditPayments?.length ? { creditPayments } : {}),
    ...(insurancePayments?.length ? { insurancePayments } : {}),
    ...(shoppingTrips?.length ? { shoppingTrips } : {}),
    ...(row.max_budget != null
      ? {
          maxBudget: Number(row.max_budget),
          budgetType: row.budget_type ?? 'monthly',
        }
      : {}),
  };
}

function monthLabel(month, year) {
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

async function ensureParticipantForUser(groupId, userRow, joinedAt = new Date()) {
  const [existing] = await pool.query(
    'SELECT id FROM participants WHERE group_id = ? AND user_id = ?',
    [groupId, userRow.id],
  );
  if (existing.length) return existing[0].id;

  const participantId = randomUUID();
  const name = userRow.display_name ?? userRow.email;
  await pool.query(
    `INSERT INTO participants (id, group_id, name, user_id, joined_at)
     VALUES (?, ?, ?, ?, ?)`,
    [participantId, groupId, name, userRow.id, joinedAt],
  );
  return participantId;
}

async function getGroupMemberIds(groupId) {
  const [rows] = await pool.query(
    'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at',
    [groupId],
  );
  return rows.map((r) => r.user_id);
}

async function getGroupById(groupId, userId = null) {
  const [rows] = await pool.query('SELECT * FROM `groups` WHERE id = ?', [
    groupId,
  ]);
  if (!rows.length) return null;
  const memberIds = await getGroupMemberIds(groupId);
  const installments = userId
    ? await getGroupInstallments(pool, groupId, userId)
    : undefined;
  const creditPayments = userId
    ? await getGroupCreditPayments(pool, groupId, userId)
    : undefined;
  const insurancePayments = userId
    ? await getGroupInsurancePayments(pool, groupId, userId)
    : undefined;
  const shoppingTrips = userId
    ? await getGroupShoppingTrips(pool, groupId, userId)
    : undefined;
  return rowToGroup(
    rows[0],
    memberIds,
    installments,
    creditPayments,
    insurancePayments,
    shoppingTrips,
  );
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/health', async (_req, res) => {
  const receiptOcr = getReceiptOcrConfig();
  const aiInsights = getAiInsightsConfig();
  const [receiptAvailable, insightsAvailable] = await Promise.all([
    checkReceiptOcrAvailable(),
    checkAiInsightsAvailable(),
  ]);
  res.json({
    ok: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    receiptOcr: { ...receiptOcr, available: receiptAvailable },
    aiInsights: { ...aiInsights, available: insightsAvailable },
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    const receiptOcr = getReceiptOcrConfig();
    const aiInsights = getAiInsightsConfig();
    const [receiptAvailable, insightsAvailable, sync] = await Promise.all([
      checkReceiptOcrAvailable(),
      checkAiInsightsAvailable(),
      getPriceSyncStatus(pool),
    ]);
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      receiptOcr: { ...receiptOcr, available: receiptAvailable },
      aiInsights: { ...aiInsights, available: insightsAvailable },
      priceSync: sync,
    });
  } catch {
    const receiptOcr = getReceiptOcrConfig();
    const aiInsights = getAiInsightsConfig();
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      receiptOcr: { ...receiptOcr, available: false },
      aiInsights: { ...aiInsights, available: false },
    });
  }
});

const DEFAULT_CATEGORIES = [
  { name: 'Rent', priority: 1 },
  { name: 'Food', priority: 2 },
  { name: 'Health', priority: 2 },
  { name: 'Utilities', priority: 3 },
  { name: 'Transport', priority: 3 },
  { name: 'Shopping', priority: 4 },
  { name: 'Entertainment', priority: 4 },
  { name: 'Travel', priority: 4 },
  { name: 'Other', priority: 5 },
];

async function seedDefaultCategories(userId) {
  const now = new Date();
  for (const cat of DEFAULT_CATEGORIES) {
    await pool.query(
      `INSERT IGNORE INTO categories (id, user_id, name, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), userId, cat.name, cat.priority, now],
    );
  }
}

async function listUserCategories(userId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT id, name, priority, created_at AS createdAt
     FROM categories WHERE user_id IN (${placeholders})
     ORDER BY priority ASC, name ASC`,
    userIds,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    createdAt: toIso(r.createdAt),
  }));
}

async function categoryInHousehold(userId, categoryId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT * FROM categories WHERE id = ? AND user_id IN (${placeholders})`,
    [categoryId, ...userIds],
  );
  if (!rows.length) {
    const err = new Error('category not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

function clampPriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

// --- Auth ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const displayName =
      String(req.body?.displayName ?? '').trim() || email.split('@')[0];

    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 characters' });
      return;
    }

    const id = newUserId();
    const now = new Date();
    const passwordHash = await hashPassword(password);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, email, passwordHash, displayName, now],
    );

    await seedDefaultCategories(id);
    await createHouseholdForUser(pool, id);

    const user = rowToAppUser({
      id,
      email,
      display_name: displayName,
      photo_url: null,
    });
    const token = signToken({ id, email });
    res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'email already registered' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [
      email,
    ]);
    if (!rows.length) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }

    const row = rows[0];
    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }

    const user = rowToAppUser(row);
    const token = signToken({ id: row.id, email: row.email });
    res.json({ token, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const row = await requireUser(req);
    res.json({
      user: rowToAppUser(row),
      profile: {
        uid: row.id,
        displayName: row.display_name,
        email: row.email,
        photoURL: row.photo_url,
        createdAt: toIso(row.created_at),
      },
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'auth failed',
    });
  }
});

// --- Categories ---

app.get('/api/categories', async (req, res) => {
  try {
    const user = await requireUser(req);
    let categories = await listUserCategories(user.id);
    if (!categories.length) {
      await seedDefaultCategories(user.id);
      categories = await listUserCategories(user.id);
    }
    res.json(categories);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const user = await requireUser(req);
    const name = String(req.body?.name ?? '').trim();
    const priority = clampPriority(req.body?.priority ?? 3);

    if (!name) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const id = randomUUID();
    const now = new Date();
    await pool.query(
      `INSERT INTO categories (id, user_id, name, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, user.id, name, priority, now],
    );

    res.status(201).json({
      id,
      name,
      priority,
      createdAt: toIso(now),
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'category already exists' });
      return;
    }
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.patch('/api/categories/:categoryId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const existing = await categoryInHousehold(user.id, req.params.categoryId);

    const oldName = existing.name;
    const fields = [];
    const values = [];
    let newName = oldName;

    if (req.body?.name != null) {
      newName = String(req.body.name).trim();
      if (!newName) {
        res.status(400).json({ error: 'name required' });
        return;
      }
      fields.push('name = ?');
      values.push(newName);
    }
    if (req.body?.priority != null) {
      fields.push('priority = ?');
      values.push(clampPriority(req.body.priority));
    }

    if (fields.length) {
      values.push(req.params.categoryId);
      await pool.query(
        `UPDATE categories SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );
    }

    if (newName !== oldName) {
      const userIds = await getHouseholdUserIds(pool, user.id);
      const placeholders = userIds.map(() => '?').join(', ');
      await pool.query(
        `UPDATE expenses e
         INNER JOIN group_members gm ON gm.group_id = e.group_id
         SET e.category = ?
         WHERE gm.user_id IN (${placeholders}) AND e.category = ?`,
        [newName, ...userIds, oldName],
      );
    }

    const [updated] = await pool.query(
      `SELECT id, name, priority, created_at AS createdAt
       FROM categories WHERE id = ?`,
      [req.params.categoryId],
    );
    const r = updated[0];
    res.json({
      id: r.id,
      name: r.name,
      priority: r.priority,
      createdAt: toIso(r.createdAt),
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'category already exists' });
      return;
    }
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/categories/:categoryId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await categoryInHousehold(user.id, req.params.categoryId);
    await pool.query('DELETE FROM categories WHERE id = ?', [
      req.params.categoryId,
    ]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Groups ---

app.get('/api/groups', async (req, res) => {
  try {
    const user = await requireUser(req);

    const [memberRows] = await pool.query(
      `SELECT g.* FROM \`groups\` g
       INNER JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.year DESC, g.month DESC`,
      [user.id],
    );

    const groups = await Promise.all(
      memberRows.map(async (row) => {
        const memberIds = await getGroupMemberIds(row.id);
        const installments = await getGroupInstallments(pool, row.id, user.id);
        const creditPayments = await getGroupCreditPayments(
          pool,
          row.id,
          user.id,
        );
        const insurancePayments = await getGroupInsurancePayments(
          pool,
          row.id,
          user.id,
        );
        const shoppingTrips = await getGroupShoppingTrips(
          pool,
          row.id,
          user.id,
        );
        return rowToGroup(
          row,
          memberIds,
          installments,
          creditPayments,
          insurancePayments,
          shoppingTrips,
        );
      }),
    );

    res.json(groups);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.get('/api/groups/:groupId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);
    const group = await getGroupById(req.params.groupId, user.id);
    if (!group) {
      res.status(404).json({ error: 'group not found' });
      return;
    }
    res.json(group);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'get failed',
    });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const user = await requireUser(req);
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const description = req.body?.description?.trim() || null;
    const maxBudget =
      req.body?.maxBudget != null ? Number(req.body.maxBudget) : null;

    if (!month || month < 1 || month > 12 || !year || year < 2000) {
      res.status(400).json({ error: 'valid month and year required' });
      return;
    }

    const householdId = await ensureHouseholdForUser(pool, user.id);
    const userIds = await getHouseholdUserIds(pool, user.id);
    const placeholders = userIds.map(() => '?').join(', ');
    const [dupes] = await pool.query(
      `SELECT g.id FROM \`groups\` g
       INNER JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id IN (${placeholders}) AND g.month = ? AND g.year = ?`,
      [...userIds, month, year],
    );
    if (dupes.length) {
      res.status(409).json({ error: 'month already exists' });
      return;
    }

    const groupId = randomUUID();
    const now = new Date();
    const name = monthLabel(month, year);

    await pool.query(
      `INSERT INTO \`groups\`
       (id, name, description, type, month, year, created_by, created_at, max_budget, budget_type)
       VALUES (?, ?, ?, 'household', ?, ?, ?, ?, ?, ?)`,
      [
        groupId,
        name,
        description,
        month,
        year,
        user.id,
        now,
        maxBudget,
        maxBudget != null ? 'monthly' : null,
      ],
    );

    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, 'admin', ?)`,
      [groupId, user.id, now],
    );

    await addAllHouseholdMembersToGroup(pool, groupId, householdId, now);

    const group = await getGroupById(groupId, user.id);
    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.patch('/api/groups/:groupId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const fields = [];
    const values = [];

    if (req.body?.name != null) {
      fields.push('name = ?');
      values.push(String(req.body.name).trim());
    }
    if (req.body?.month != null && req.body?.year != null) {
      const month = Number(req.body.month);
      const year = Number(req.body.year);
      if (month >= 1 && month <= 12 && year >= 2000) {
        fields.push('month = ?', 'year = ?', 'name = ?');
        values.push(month, year, monthLabel(month, year));
      }
    }
    if (req.body?.description !== undefined) {
      fields.push('description = ?');
      values.push(req.body.description?.trim() || null);
    }
    if (req.body?.maxBudget !== undefined) {
      fields.push('max_budget = ?');
      values.push(
        req.body.maxBudget != null ? Number(req.body.maxBudget) : null,
      );
    }
    if (req.body?.budgetType !== undefined) {
      fields.push('budget_type = ?');
      values.push(req.body.budgetType);
    }

    if (fields.length) {
      values.push(req.params.groupId);
      await pool.query(
        `UPDATE \`groups\` SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );
    }

    const group = await getGroupById(req.params.groupId, user.id);
    res.json(group);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/groups/:groupId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const group = await getGroupById(req.params.groupId, user.id);
    if (!group) {
      res.status(404).json({ error: 'group not found' });
      return;
    }
    if (group.createdBy !== user.id) {
      res.status(403).json({ error: 'only creator can delete group' });
      return;
    }

    await pool.query('DELETE FROM `groups` WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Members ---

app.get('/api/groups/:groupId/members', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const [rows] = await pool.query(
      `SELECT gm.user_id AS uid, gm.group_id AS groupId, gm.role,
              gm.joined_at AS joinedAt, u.display_name AS displayName, u.email
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at`,
      [req.params.groupId],
    );

    res.json(
      rows.map((r) => ({
        uid: r.uid,
        groupId: r.groupId,
        role: r.role,
        joinedAt: toIso(r.joinedAt),
        displayName: r.displayName,
        email: r.email,
      })),
    );
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

// --- Participants ---

app.get('/api/groups/:groupId/participants', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const householdId = await getHouseholdId(pool, user.id);
    await syncHouseholdParticipantsForGroup(
      pool,
      req.params.groupId,
      householdId,
    );

    const [rows] = await pool.query(
      `SELECT p.id, p.group_id AS groupId, p.name, p.user_id AS userId,
              p.joined_at AS joinedAt,
              COALESCE(SUM(i.amount), 0) AS totalIncome
       FROM participants p
       LEFT JOIN incomes i ON i.participant_id = p.id
       WHERE p.group_id = ?
       GROUP BY p.id, p.group_id, p.name, p.user_id, p.joined_at
       ORDER BY p.joined_at`,
      [req.params.groupId],
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        name: r.name,
        userId: r.userId ?? undefined,
        joinedAt: toIso(r.joinedAt),
        totalIncome: Number(r.totalIncome),
      })),
    );
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/groups/:groupId/participants', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();

    if (email) {
      res.status(400).json({
        error:
          'To give dashboard access, invite this person from the Dashboard (Household section). Use this form only for a name label without an account.',
      });
      return;
    }

    if (!name) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const now = new Date();
    const participantName = name;

    const [nameExists] = await pool.query(
      'SELECT id FROM participants WHERE group_id = ? AND LOWER(name) = LOWER(?)',
      [req.params.groupId, participantName],
    );
    if (nameExists.length) {
      res.status(409).json({ error: 'person with this name already exists' });
      return;
    }

    const participantId = randomUUID();
    await pool.query(
      `INSERT INTO participants (id, group_id, name, user_id, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
      [participantId, req.params.groupId, participantName, null, now],
    );

    res.status(201).json({
      id: participantId,
      groupId: req.params.groupId,
      name: participantName,
      userId: undefined,
      joinedAt: toIso(now),
      totalIncome: 0,
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.delete('/api/participants/:participantId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [rows] = await pool.query(
      'SELECT * FROM participants WHERE id = ?',
      [req.params.participantId],
    );
    if (!rows.length) {
      res.status(404).json({ error: 'participant not found' });
      return;
    }
    await requireGroupMember(user.id, rows[0].group_id);
    await pool.query('DELETE FROM participants WHERE id = ?', [
      req.params.participantId,
    ]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Incomes ---

app.get('/api/groups/:groupId/incomes', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const [rows] = await pool.query(
      `SELECT i.id, i.group_id AS groupId, i.participant_id AS participantId,
              i.amount, i.source, i.income_date AS date, i.created_at AS createdAt,
              p.name AS participantName
       FROM incomes i
       INNER JOIN participants p ON p.id = i.participant_id
       WHERE i.group_id = ?
       ORDER BY i.income_date DESC`,
      [req.params.groupId],
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        groupId: r.groupId,
        participantId: r.participantId,
        participantName: r.participantName,
        amount: Number(r.amount),
        source: r.source,
        date: toIso(r.date),
        createdAt: toIso(r.createdAt),
      })),
    );
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/groups/:groupId/incomes', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const participantId = String(req.body?.participantId ?? '');
    const amount = Number(req.body?.amount);
    const source = String(req.body?.source ?? '').trim();
    const date = req.body?.date ? new Date(req.body.date) : new Date();

    if (!participantId || !amount || !source) {
      res.status(400).json({
        error: 'participantId, amount and source required',
      });
      return;
    }

    const [participant] = await pool.query(
      'SELECT id FROM participants WHERE id = ? AND group_id = ?',
      [participantId, req.params.groupId],
    );
    if (!participant.length) {
      res.status(400).json({ error: 'invalid participant' });
      return;
    }

    const incomeId = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO incomes
       (id, group_id, participant_id, amount, source, income_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [incomeId, req.params.groupId, participantId, amount, source, date, now],
    );

    const [rows] = await pool.query(
      `SELECT i.id, i.group_id AS groupId, i.participant_id AS participantId,
              i.amount, i.source, i.income_date AS date, i.created_at AS createdAt,
              p.name AS participantName
       FROM incomes i
       INNER JOIN participants p ON p.id = i.participant_id
       WHERE i.id = ?`,
      [incomeId],
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id,
      groupId: r.groupId,
      participantId: r.participantId,
      participantName: r.participantName,
      amount: Number(r.amount),
      source: r.source,
      date: toIso(r.date),
      createdAt: toIso(r.createdAt),
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.patch('/api/incomes/:incomeId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [existing] = await pool.query(
      'SELECT * FROM incomes WHERE id = ?',
      [req.params.incomeId],
    );
    if (!existing.length) {
      res.status(404).json({ error: 'income not found' });
      return;
    }
    await requireGroupMember(user.id, existing[0].group_id);

    const fields = [];
    const values = [];

    if (req.body?.amount != null) {
      fields.push('amount = ?');
      values.push(Number(req.body.amount));
    }
    if (req.body?.source != null) {
      fields.push('source = ?');
      values.push(String(req.body.source).trim());
    }
    if (req.body?.date != null) {
      fields.push('income_date = ?');
      values.push(new Date(req.body.date));
    }
    if (req.body?.participantId != null) {
      fields.push('participant_id = ?');
      values.push(req.body.participantId);
    }

    if (fields.length) {
      values.push(req.params.incomeId);
      await pool.query(
        `UPDATE incomes SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );
    }

    const [rows] = await pool.query(
      `SELECT i.id, i.group_id AS groupId, i.participant_id AS participantId,
              i.amount, i.source, i.income_date AS date, i.created_at AS createdAt,
              p.name AS participantName
       FROM incomes i
       INNER JOIN participants p ON p.id = i.participant_id
       WHERE i.id = ?`,
      [req.params.incomeId],
    );
    const r = rows[0];
    res.json({
      id: r.id,
      groupId: r.groupId,
      participantId: r.participantId,
      participantName: r.participantName,
      amount: Number(r.amount),
      source: r.source,
      date: toIso(r.date),
      createdAt: toIso(r.createdAt),
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/incomes/:incomeId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [existing] = await pool.query(
      'SELECT * FROM incomes WHERE id = ?',
      [req.params.incomeId],
    );
    if (!existing.length) {
      res.status(404).json({ error: 'income not found' });
      return;
    }
    await requireGroupMember(user.id, existing[0].group_id);
    await pool.query('DELETE FROM incomes WHERE id = ?', [req.params.incomeId]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Expenses ---

app.get('/api/groups/:groupId/expenses', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const [rows] = await pool.query(
      `SELECT id, group_id AS groupId, amount, description, category,
              paid_by AS paidBy, expense_date AS date, created_at AS createdAt,
              split_type AS splitType
       FROM expenses
       WHERE group_id = ?
       ORDER BY expense_date DESC`,
      [req.params.groupId],
    );

    res.json(
      rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        date: toIso(r.date),
        createdAt: toIso(r.createdAt),
      })),
    );
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/groups/:groupId/expenses', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireGroupMember(user.id, req.params.groupId);

    const amount = Number(req.body?.amount);
    const description = String(req.body?.description ?? '').trim();
    const category = String(req.body?.category ?? 'Other');
    const date = req.body?.date ? new Date(req.body.date) : new Date();

    if (!amount || !description) {
      res.status(400).json({ error: 'amount and description required' });
      return;
    }

    const expenseId = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO expenses
       (id, group_id, amount, description, category, paid_by, expense_date, created_at, split_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'equal')`,
      [
        expenseId,
        req.params.groupId,
        amount,
        description,
        category,
        user.id,
        date,
        now,
      ],
    );

    res.status(201).json({
      id: expenseId,
      groupId: req.params.groupId,
      amount,
      description,
      category,
      paidBy: user.id,
      date: toIso(date),
      createdAt: toIso(now),
      splitType: 'equal',
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.patch('/api/expenses/:expenseId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [existing] = await pool.query(
      'SELECT * FROM expenses WHERE id = ?',
      [req.params.expenseId],
    );
    if (!existing.length) {
      res.status(404).json({ error: 'expense not found' });
      return;
    }

    const expense = existing[0];
    await requireGroupMember(user.id, expense.group_id);

    const fields = [];
    const values = [];

    if (req.body?.amount != null) {
      fields.push('amount = ?');
      values.push(Number(req.body.amount));
    }
    if (req.body?.description != null) {
      fields.push('description = ?');
      values.push(String(req.body.description).trim());
    }
    if (req.body?.category != null) {
      fields.push('category = ?');
      values.push(req.body.category);
    }
    if (req.body?.date != null) {
      fields.push('expense_date = ?');
      values.push(new Date(req.body.date));
    }

    if (fields.length) {
      values.push(req.params.expenseId);
      await pool.query(
        `UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );
    }

    const [updated] = await pool.query(
      `SELECT id, group_id AS groupId, amount, description, category,
              paid_by AS paidBy, expense_date AS date, created_at AS createdAt,
              split_type AS splitType
       FROM expenses WHERE id = ?`,
      [req.params.expenseId],
    );

    const r = updated[0];
    res.json({
      ...r,
      amount: Number(r.amount),
      date: toIso(r.date),
      createdAt: toIso(r.createdAt),
    });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/expenses/:expenseId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [existing] = await pool.query(
      'SELECT * FROM expenses WHERE id = ?',
      [req.params.expenseId],
    );
    if (!existing.length) {
      res.status(404).json({ error: 'expense not found' });
      return;
    }

    await requireGroupMember(user.id, existing[0].group_id);
    await pool.query('DELETE FROM expenses WHERE id = ?', [req.params.expenseId]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

app.post('/api/expenses/import/parse', (req, res) => {
  expensePdfUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr.message });
        return;
      }
      const user = await requireUser(req);
      const files = req.files ?? [];
      if (!files.length) {
        res.status(400).json({ error: 'upload at least one PDF (field: pdfs)' });
        return;
      }

      const categories = await listUserCategories(user.id);
      const names = categories.map((c) => c.name);
      const allowed = names.length ? names : DEFAULT_CATEGORIES.map((c) => c.name);

      const result = await parseExpensePdfFiles(files, allowed);
      res.json({
        ...result,
        categories: allowed,
      });
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'parse failed',
      });
    }
  });
});

app.post('/api/expenses/import/commit', async (req, res) => {
  try {
    const user = await requireUser(req);
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: 'items array required' });
      return;
    }

    const categories = await listUserCategories(user.id);
    const names = categories.map((c) => c.name);
    const allowed = names.length ? names : DEFAULT_CATEGORIES.map((c) => c.name);

    const result = await commitExpenseImport(
      pool,
      user,
      items,
      allowed,
      ensureParticipantForUser,
    );
    res.json(result);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'import failed',
    });
  }
});

async function requirePurchaseOwner(userId, purchaseId) {
  return resourceOwnedByHousehold(pool, userId, 'purchases', purchaseId);
}

function parseInterestRate(raw, installmentCount) {
  if (installmentCount <= 1) return null;
  if (raw == null || raw === '') return 0;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    const err = new Error('interest rate must be between 0 and 100');
    err.status = 400;
    throw err;
  }
  return Math.round(rate * 100) / 100;
}

function parseInterestRatePeriod(raw, installmentCount) {
  if (installmentCount <= 1) return null;
  const period = raw === 'monthly' || raw === 'annual' ? raw : 'annual';
  if (raw != null && raw !== '' && period !== raw) {
    const err = new Error('interest rate period must be monthly or annual');
    err.status = 400;
    throw err;
  }
  return period;
}

app.get('/api/purchases', async (req, res) => {
  try {
    const user = await requireUser(req);
    const userIds = await getHouseholdUserIds(pool, user.id);
    const placeholders = userIds.map(() => '?').join(', ');
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let sql = `SELECT * FROM purchases WHERE user_id IN (${placeholders})`;
    const params = [...userIds];
    if (q) {
      sql += ' AND (name LIKE ? OR store LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY purchase_date DESC, created_at DESC';
    const [rows] = await pool.query(sql, params);
    const purchases = await Promise.all(
      rows.map((row) => loadPurchaseDto(pool, row)),
    );
    res.json(purchases);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.get('/api/purchases/:purchaseId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requirePurchaseOwner(user.id, req.params.purchaseId);
    res.json(await loadPurchaseDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'get failed',
    });
  }
});

app.post(
  '/api/purchases',
  async (req, res, next) => {
    try {
      req.user = await requireUser(req);
      req.purchaseId = randomUUID();
      next();
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'auth failed',
      });
    }
  },
  (req, res, next) => {
    receiptsUpload(req, res, (err) => {
      if (err) {
        res.status(400).json({
          error: err.message || 'invalid receipt file',
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const user = req.user;
      const name = req.body?.name?.trim();
      const amount = Number(req.body?.amount);
      const store = req.body?.store?.trim() || null;
      const purchaseDateRaw = req.body?.purchaseDate;
      const warrantyRaw = req.body?.warrantyExpiresAt;
      const installmentCount = Math.max(
        1,
        parseInt(String(req.body?.installmentCount ?? '1'), 10) || 1,
      );
      const interestRate = parseInterestRate(
        req.body?.interestRate ?? req.body?.monthlyInterestRate,
        installmentCount,
      );
      const interestRatePeriod = parseInterestRatePeriod(
        req.body?.interestRatePeriod,
        installmentCount,
      );
      const files = req.files ?? [];

      const cleanupFiles = () =>
        cleanupUploadedFiles(uploadsRoot, user.id, files);

      if (!name || !Number.isFinite(amount) || amount <= 0) {
        cleanupFiles();
        res.status(400).json({ error: 'name and positive amount required' });
        return;
      }

      const purchaseDate = purchaseDateRaw
        ? new Date(purchaseDateRaw)
        : new Date();
      if (Number.isNaN(purchaseDate.getTime())) {
        cleanupFiles();
        res.status(400).json({ error: 'invalid purchase date' });
        return;
      }

      let warrantyExpiresAt = null;
      if (warrantyRaw) {
        warrantyExpiresAt = new Date(warrantyRaw);
        if (Number.isNaN(warrantyExpiresAt.getTime())) {
          cleanupFiles();
          res.status(400).json({ error: 'invalid warranty date' });
          return;
        }
      }

      const purchaseId = req.purchaseId;
      const now = new Date();

      await pool.query(
        `INSERT INTO purchases
         (id, user_id, name, amount, store, purchase_date, warranty_expires_at,
          installment_count, monthly_interest_rate, interest_rate_period, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          purchaseId,
          user.id,
          name,
          amount,
          store,
          purchaseDate,
          warrantyExpiresAt,
          installmentCount,
          interestRate,
          interestRatePeriod ?? 'annual',
          now,
        ],
      );

      if (files.length) {
        await insertPurchaseReceipts(pool, purchaseId, files, now);
      }

      await createInstallments(
        pool,
        user,
        purchaseId,
        amount,
        installmentCount,
        purchaseDate,
        interestRate ?? 0,
        interestRatePeriod ?? 'annual',
        installmentDeps(),
      );

      const [rows] = await pool.query('SELECT * FROM purchases WHERE id = ?', [
        purchaseId,
      ]);
      res.status(201).json(await loadPurchaseDto(pool, rows[0]));
    } catch (error) {
      cleanupUploadedFiles(uploadsRoot, req.user.id, req.files ?? []);
      console.error(error);
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'create failed',
      });
    }
  },
);

app.patch('/api/purchases/:purchaseId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requirePurchaseOwner(user.id, req.params.purchaseId);

    const name = req.body?.name?.trim();
    const amount =
      req.body?.amount != null ? Number(req.body.amount) : Number(row.amount);
    const store =
      req.body?.store !== undefined
        ? req.body.store?.trim() || null
        : row.store;
    const purchaseDateRaw = req.body?.purchaseDate;
    const warrantyRaw = req.body?.warrantyExpiresAt;
    const installmentCount =
      req.body?.installmentCount != null
        ? Math.max(1, parseInt(String(req.body.installmentCount), 10) || 1)
        : row.installment_count;
    const interestRate =
      req.body?.interestRate !== undefined ||
      req.body?.monthlyInterestRate !== undefined
        ? parseInterestRate(
            req.body?.interestRate ?? req.body?.monthlyInterestRate,
            installmentCount,
          )
        : row.monthly_interest_rate != null
          ? Number(row.monthly_interest_rate)
          : 0;
    const interestRatePeriod =
      req.body?.interestRatePeriod !== undefined
        ? parseInterestRatePeriod(req.body.interestRatePeriod, installmentCount)
        : row.interest_rate_period ?? 'monthly';

    if (name !== undefined && !name) {
      res.status(400).json({ error: 'name cannot be empty' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'positive amount required' });
      return;
    }

    const purchaseDate = purchaseDateRaw
      ? new Date(purchaseDateRaw)
      : new Date(row.purchase_date);
    if (Number.isNaN(purchaseDate.getTime())) {
      res.status(400).json({ error: 'invalid purchase date' });
      return;
    }

    let warrantyExpiresAt = row.warranty_expires_at;
    if (warrantyRaw !== undefined) {
      if (!warrantyRaw) {
        warrantyExpiresAt = null;
      } else {
        warrantyExpiresAt = new Date(warrantyRaw);
        if (Number.isNaN(warrantyExpiresAt.getTime())) {
          res.status(400).json({ error: 'invalid warranty date' });
          return;
        }
      }
    }

    await pool.query(
      `UPDATE purchases
       SET name = ?, amount = ?, store = ?, purchase_date = ?,
           warranty_expires_at = ?, installment_count = ?, monthly_interest_rate = ?,
           interest_rate_period = ?
       WHERE id = ?`,
      [
        name ?? row.name,
        amount,
        store,
        purchaseDate,
        warrantyExpiresAt,
        installmentCount,
        interestRate,
        interestRatePeriod ?? 'annual',
        req.params.purchaseId,
      ],
    );

    const prevRate =
      row.monthly_interest_rate != null ? Number(row.monthly_interest_rate) : 0;
    const prevPeriod = row.interest_rate_period ?? 'monthly';
    const scheduleChanged =
      amount !== Number(row.amount) ||
      installmentCount !== row.installment_count ||
      purchaseDate.getTime() !== new Date(row.purchase_date).getTime() ||
      (installmentCount > 1 &&
        (interestRate !== prevRate || interestRatePeriod !== prevPeriod));

    if (scheduleChanged) {
      await rebuildInstallments(
        pool,
        user,
        req.params.purchaseId,
        amount,
        installmentCount,
        purchaseDate,
        interestRate ?? 0,
        interestRatePeriod ?? 'annual',
        installmentDeps(),
      );
    } else if (installmentCount <= 1 && row.installment_count > 1) {
      await pool.query(
        'DELETE FROM purchase_installments WHERE purchase_id = ?',
        [req.params.purchaseId],
      );
    }

    const [updated] = await pool.query('SELECT * FROM purchases WHERE id = ?', [
      req.params.purchaseId,
    ]);
    res.json(await loadPurchaseDto(pool, updated[0]));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.post(
  '/api/purchases/:purchaseId/receipts',
  async (req, res, next) => {
    try {
      req.user = await requireUser(req);
      await requirePurchaseOwner(req.user.id, req.params.purchaseId);
      next();
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'auth failed',
      });
    }
  },
  (req, res, next) => {
    receiptsUpload(req, res, (err) => {
      if (err) {
        res.status(400).json({
          error: err.message || 'invalid receipt file',
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const files = req.files ?? [];
      if (!files.length) {
        res.status(400).json({ error: 'at least one receipt file required' });
        return;
      }
      const now = new Date();
      await insertPurchaseReceipts(
        pool,
        req.params.purchaseId,
        files,
        now,
      );
      const row = await requirePurchaseOwner(
        req.user.id,
        req.params.purchaseId,
      );
      res.status(201).json(await loadPurchaseDto(pool, row));
    } catch (error) {
      cleanupUploadedFiles(uploadsRoot, req.user.id, req.files ?? []);
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'upload failed',
      });
    }
  },
);

async function sendReceiptFile(req, res, receiptRow, userId) {
  const full = receiptPath(uploadsRoot, userId, receiptRow.stored_filename);
  if (!existsSync(full)) {
    res.status(404).json({ error: 'receipt file missing' });
    return;
  }
  const filename = receiptRow.original_name || 'receipt';
  const download = req.query.download === '1';
  res.setHeader(
    'Content-Type',
    receiptRow.mime_type || 'application/octet-stream',
  );
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
  );
  res.sendFile(full);
}

app.get(
  '/api/purchases/:purchaseId/receipts/:receiptId',
  async (req, res) => {
    try {
      const user = await requireUser(req);
      const receiptRow = await requirePurchaseReceipt(
        pool,
        user.id,
        req.params.purchaseId,
        req.params.receiptId,
      );
      await sendReceiptFile(req, res, receiptRow, user.id);
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'receipt failed',
      });
    }
  },
);

app.get('/api/purchases/:purchaseId/receipt', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requirePurchaseOwner(user.id, req.params.purchaseId);
    const [rows] = await pool.query(
      `SELECT * FROM purchase_receipts
       WHERE purchase_id = ?
       ORDER BY created_at
       LIMIT 1`,
      [req.params.purchaseId],
    );
    if (!rows.length) {
      res.status(404).json({ error: 'no receipt' });
      return;
    }
    await sendReceiptFile(req, res, rows[0], user.id);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'receipt failed',
    });
  }
});

app.delete(
  '/api/purchases/:purchaseId/receipts/:receiptId',
  async (req, res) => {
    try {
      const user = await requireUser(req);
      const receiptRow = await requirePurchaseReceipt(
        pool,
        user.id,
        req.params.purchaseId,
        req.params.receiptId,
      );
      deleteReceiptFile(uploadsRoot, user.id, receiptRow.stored_filename);
      await pool.query('DELETE FROM purchase_receipts WHERE id = ?', [
        req.params.receiptId,
      ]);
      res.status(204).end();
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'delete failed',
      });
    }
  },
);

app.delete('/api/purchases/:purchaseId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requirePurchaseOwner(user.id, req.params.purchaseId);
    await deleteAllPurchaseReceiptFiles(
      pool,
      uploadsRoot,
      user.id,
      req.params.purchaseId,
    );
    await pool.query('DELETE FROM purchases WHERE id = ?', [
      req.params.purchaseId,
    ]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Credits ---

async function requireCreditOwner(userId, creditId) {
  return resourceOwnedByHousehold(pool, userId, 'credits', creditId);
}

app.get('/api/credits', async (req, res) => {
  try {
    const user = await requireUser(req);
    const userIds = await getHouseholdUserIds(pool, user.id);
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT * FROM credits WHERE user_id IN (${placeholders}) ORDER BY start_date DESC, created_at DESC`,
      userIds,
    );
    const credits = await Promise.all(
      rows.map((row) => loadCreditDto(pool, row)),
    );
    res.json(credits);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.get('/api/credits/:creditId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requireCreditOwner(user.id, req.params.creditId);
    res.json(await loadCreditDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'get failed',
    });
  }
});

app.post('/api/credits', async (req, res) => {
  try {
    const user = await requireUser(req);
    const name = req.body?.name?.trim();
    const lender = req.body?.lender?.trim() || null;
    const principal = Number(req.body?.principal);
    const interestRate = parseCreditInterestRate(req.body?.interestRate);
    const interestRatePeriod = parseCreditInterestRatePeriod(
      req.body?.interestRatePeriod,
    );
    const termMonths = Math.max(
      1,
      parseInt(String(req.body?.termMonths ?? '1'), 10) || 1,
    );
    const paymentDay = parsePaymentDay(req.body?.paymentDay);
    const startDateRaw = req.body?.startDate;

    if (!name || !Number.isFinite(principal) || principal <= 0) {
      res.status(400).json({ error: 'name and positive principal required' });
      return;
    }

    const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
    if (Number.isNaN(startDate.getTime())) {
      res.status(400).json({ error: 'invalid start date' });
      return;
    }

    const creditId = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO credits
       (id, user_id, name, lender, principal, interest_rate, interest_rate_period,
        term_months, payment_day, start_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        creditId,
        user.id,
        name,
        lender,
        principal,
        interestRate,
        interestRatePeriod,
        termMonths,
        paymentDay,
        startDate,
        now,
      ],
    );

    await createCreditPayments(
      pool,
      user,
      creditId,
      principal,
      termMonths,
      startDate,
      interestRate,
      interestRatePeriod,
      installmentDeps(),
    );

    const [rows] = await pool.query('SELECT * FROM credits WHERE id = ?', [
      creditId,
    ]);
    res.status(201).json(await loadCreditDto(pool, rows[0]));
  } catch (error) {
    console.error(error);
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.post('/api/credits/import/parse', (req, res) => {
  loanImportUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr.message });
        return;
      }
      const user = await requireUser(req);
      const files = req.files ?? [];
      if (!files.length) {
        res.status(400).json({ error: 'upload a PDF or photo (field: files)' });
        return;
      }

      const result = await parseLoanImportFiles(files);
      res.json(result);
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'parse failed',
      });
    }
  });
});

app.post('/api/credits/import/commit', async (req, res) => {
  try {
    const user = await requireUser(req);
    const body = req.body ?? {};
    const result = await commitLoanImport(pool, user, body, installmentDeps());
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'import failed',
    });
  }
});

app.patch('/api/credits/:creditId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requireCreditOwner(user.id, req.params.creditId);

    const name = req.body?.name?.trim();
    const lender =
      req.body?.lender !== undefined ? req.body.lender?.trim() || null : row.lender;
    const principal =
      req.body?.principal != null ? Number(req.body.principal) : Number(row.principal);
    const interestRate =
      req.body?.interestRate !== undefined
        ? parseCreditInterestRate(req.body.interestRate)
        : Number(row.interest_rate);
    const interestRatePeriod =
      req.body?.interestRatePeriod !== undefined
        ? parseCreditInterestRatePeriod(req.body.interestRatePeriod)
        : row.interest_rate_period ?? 'annual';
    const termMonths =
      req.body?.termMonths != null
        ? Math.max(1, parseInt(String(req.body.termMonths), 10) || 1)
        : row.term_months;
    const paymentDay =
      req.body?.paymentDay !== undefined
        ? parsePaymentDay(req.body.paymentDay)
        : row.payment_day;
    const startDateRaw = req.body?.startDate;

    if (name !== undefined && !name) {
      res.status(400).json({ error: 'name cannot be empty' });
      return;
    }
    if (!Number.isFinite(principal) || principal <= 0) {
      res.status(400).json({ error: 'positive principal required' });
      return;
    }

    const startDate = startDateRaw
      ? new Date(startDateRaw)
      : new Date(row.start_date);
    if (Number.isNaN(startDate.getTime())) {
      res.status(400).json({ error: 'invalid start date' });
      return;
    }

    await pool.query(
      `UPDATE credits
       SET name = ?, lender = ?, principal = ?, interest_rate = ?,
           interest_rate_period = ?, term_months = ?, payment_day = ?, start_date = ?
       WHERE id = ?`,
      [
        name ?? row.name,
        lender,
        principal,
        interestRate,
        interestRatePeriod,
        termMonths,
        paymentDay,
        startDate,
        req.params.creditId,
      ],
    );

    const scheduleChanged =
      principal !== Number(row.principal) ||
      termMonths !== row.term_months ||
      startDate.getTime() !== new Date(row.start_date).getTime() ||
      interestRate !== Number(row.interest_rate) ||
      interestRatePeriod !== (row.interest_rate_period ?? 'annual');

    if (scheduleChanged) {
      await rebuildCreditPayments(
        pool,
        user,
        req.params.creditId,
        principal,
        termMonths,
        startDate,
        interestRate,
        interestRatePeriod,
        installmentDeps(),
      );
    }

    const [updated] = await pool.query('SELECT * FROM credits WHERE id = ?', [
      req.params.creditId,
    ]);
    res.json(await loadCreditDto(pool, updated[0]));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/credits/:creditId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireCreditOwner(user.id, req.params.creditId);
    await pool.query('DELETE FROM credits WHERE id = ?', [req.params.creditId]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

// --- Insurances ---

async function requireInsuranceOwner(userId, insuranceId) {
  return resourceOwnedByHousehold(pool, userId, 'insurances', insuranceId);
}

async function parseInsuranceInput(body, userId) {
  const company = String(body?.company ?? '').trim();
  const monthlyAmount = Number(body?.monthlyAmount);
  const subjectType = parseSubjectType(body?.subjectType);
  const subjectUserId = body?.subjectUserId
    ? String(body.subjectUserId)
    : null;
  const subjectPurchaseId = body?.subjectPurchaseId
    ? String(body.subjectPurchaseId)
    : null;
  const subjectLabel = body?.subjectLabel
    ? String(body.subjectLabel).trim()
    : null;
  const paymentDay = parseInsurancePaymentDay(body?.paymentDay);
  const startDateRaw = body?.startDate;
  const endDateRaw = body?.endDate;

  if (!company) {
    const err = new Error('insurance company required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
    const err = new Error('positive monthly amount required');
    err.status = 400;
    throw err;
  }

  const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    const err = new Error('invalid start date');
    err.status = 400;
    throw err;
  }

  let endDate = null;
  if (endDateRaw) {
    endDate = new Date(endDateRaw);
    if (Number.isNaN(endDate.getTime())) {
      const err = new Error('invalid end date');
      err.status = 400;
      throw err;
    }
    if (endDate.getTime() < startDate.getTime()) {
      const err = new Error('end date must be after start date');
      err.status = 400;
      throw err;
    }
  }

  const subjectDisplay = await validateInsuranceSubject(
    pool,
    userId,
    subjectType,
    subjectUserId,
    subjectPurchaseId,
    subjectLabel,
  );

  const name =
    String(body?.name ?? '').trim() || `${company} — ${subjectDisplay}`;

  const scheduleMonths = countScheduleMonths(startDate, endDate);

  return {
    name,
    company,
    monthlyAmount: Math.round(monthlyAmount * 100) / 100,
    subjectType,
    subjectUserId: subjectType === 'person' ? subjectUserId : null,
    subjectPurchaseId: subjectType === 'purchase' ? subjectPurchaseId : null,
    subjectLabel:
      subjectType === 'other' ? subjectLabel : null,
    paymentDay,
    startDate,
    endDate,
    scheduleMonths,
  };
}

async function sendContractFile(req, res, contractRow, userId) {
  const full = receiptPath(uploadsRoot, userId, contractRow.stored_filename);
  if (!existsSync(full)) {
    res.status(404).json({ error: 'contract file missing' });
    return;
  }
  const filename = contractRow.original_name || 'contract';
  const download = req.query.download === '1';
  res.setHeader(
    'Content-Type',
    contractRow.mime_type || 'application/octet-stream',
  );
  if (download) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/"/g, '')}"`,
    );
  }
  res.sendFile(full);
}

app.get('/api/insurances', async (req, res) => {
  try {
    const user = await requireUser(req);
    const userIds = await getHouseholdUserIds(pool, user.id);
    const placeholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT i.*,
              u.display_name AS person_name, u.email AS person_email,
              p.name AS purchase_name, p.store AS purchase_store
       FROM insurances i
       LEFT JOIN users u ON u.id = i.subject_user_id
       LEFT JOIN purchases p ON p.id = i.subject_purchase_id
       WHERE i.user_id IN (${placeholders})
       ORDER BY i.start_date DESC, i.created_at DESC`,
      userIds,
    );
    const insurances = await Promise.all(
      rows.map((row) => loadInsuranceDto(pool, row)),
    );
    res.json(insurances);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.get('/api/insurances/:insuranceId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireInsuranceOwner(user.id, req.params.insuranceId);
    const row = await fetchInsuranceRow(pool, req.params.insuranceId);
    if (!row) {
      res.status(404).json({ error: 'insurance not found' });
      return;
    }
    res.json(await loadInsuranceDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'get failed',
    });
  }
});

app.post('/api/insurances', async (req, res) => {
  try {
    const user = await requireUser(req);
    const input = await parseInsuranceInput(req.body, user.id);
    const insuranceId = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO insurances
       (id, user_id, name, company, monthly_amount, subject_type,
        subject_user_id, subject_purchase_id, subject_label,
        payment_day, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insuranceId,
        user.id,
        input.name,
        input.company,
        input.monthlyAmount,
        input.subjectType,
        input.subjectUserId,
        input.subjectPurchaseId,
        input.subjectLabel,
        input.paymentDay,
        input.startDate,
        input.endDate,
        now,
      ],
    );

    await createInsurancePayments(
      pool,
      user,
      insuranceId,
      input.monthlyAmount,
      input.scheduleMonths,
      input.startDate,
      installmentDeps(),
    );

    const row = await fetchInsuranceRow(pool, insuranceId);
    res.status(201).json(await loadInsuranceDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.patch('/api/insurances/:insuranceId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await requireInsuranceOwner(user.id, req.params.insuranceId);
    const input = await parseInsuranceInput(req.body, user.id);

    await pool.query(
      `UPDATE insurances
       SET name = ?, company = ?, monthly_amount = ?, subject_type = ?,
           subject_user_id = ?, subject_purchase_id = ?, subject_label = ?,
           payment_day = ?, start_date = ?, end_date = ?
       WHERE id = ?`,
      [
        input.name,
        input.company,
        input.monthlyAmount,
        input.subjectType,
        input.subjectUserId,
        input.subjectPurchaseId,
        input.subjectLabel,
        input.paymentDay,
        input.startDate,
        input.endDate,
        req.params.insuranceId,
      ],
    );

    await rebuildInsurancePayments(
      pool,
      user,
      req.params.insuranceId,
      input.monthlyAmount,
      input.scheduleMonths,
      input.startDate,
      installmentDeps(),
    );

    const row = await fetchInsuranceRow(pool, req.params.insuranceId);
    res.json(await loadInsuranceDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'update failed',
    });
  }
});

app.delete('/api/insurances/:insuranceId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requireInsuranceOwner(user.id, req.params.insuranceId);
    await deleteInsuranceFiles(pool, uploadsRoot, row.user_id, row.id);
    await pool.query('DELETE FROM insurances WHERE id = ?', [
      req.params.insuranceId,
    ]);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

app.post(
  '/api/insurances/:insuranceId/contracts',
  (req, res, next) => {
    contractsUpload(req, res, (err) => {
      if (err) {
        res.status(400).json({
          error: err.message || 'invalid contract file',
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const user = await requireUser(req);
      const row = await requireInsuranceOwner(user.id, req.params.insuranceId);
      if (!req.files?.length) {
        res.status(400).json({ error: 'at least one contract file required' });
        return;
      }
      await insertInsuranceContracts(
        pool,
        req.params.insuranceId,
        req.files,
      );
      const updated = await fetchInsuranceRow(pool, row.id);
      res.status(201).json(await loadInsuranceDto(pool, updated));
    } catch (error) {
      cleanupUploadedContractFiles(uploadsRoot, req.user?.id, req.files ?? []);
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'upload failed',
      });
    }
  },
);

app.get(
  '/api/insurances/:insuranceId/contracts/:contractId',
  async (req, res) => {
    try {
      const user = await requireUser(req);
      const row = await requireInsuranceOwner(user.id, req.params.insuranceId);
      const contractRow = await requireInsuranceContract(
        pool,
        user.id,
        req.params.insuranceId,
        req.params.contractId,
      );
      await sendContractFile(req, res, contractRow, row.user_id);
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'contract failed',
      });
    }
  },
);

app.delete(
  '/api/insurances/:insuranceId/contracts/:contractId',
  async (req, res) => {
    try {
      const user = await requireUser(req);
      const row = await requireInsuranceOwner(user.id, req.params.insuranceId);
      const contractRow = await requireInsuranceContract(
        pool,
        user.id,
        req.params.insuranceId,
        req.params.contractId,
      );
      deleteReceiptFile(uploadsRoot, row.user_id, contractRow.stored_filename);
      await pool.query('DELETE FROM insurance_contracts WHERE id = ?', [
        req.params.contractId,
      ]);
      res.status(204).end();
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'delete failed',
      });
    }
  },
);

// --- Household ---

app.get('/api/household/members', async (req, res) => {
  try {
    const user = await requireUser(req);
    const members = await listHouseholdMembers(pool, user.id);
    res.json(members);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/household/members', async (req, res) => {
  try {
    const user = await requireUser(req);
    const email = String(req.body?.email ?? '').trim();
    const member = await inviteHouseholdMember(pool, user.id, email);
    res.status(201).json(member);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'invite failed',
    });
  }
});

app.delete('/api/household/members/:userId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await removeHouseholdMember(pool, user.id, req.params.userId);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'remove failed',
    });
  }
});

// --- Demo reset ---

// --- AI insights ---

app.get('/api/ai/insights-status', async (req, res) => {
  try {
    await requireUser(req);
    const cfg = getAiInsightsConfig();
    const available = await checkAiInsightsAvailable();
    res.json({ ...cfg, available });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'status failed',
    });
  }
});

app.post('/api/ai/spending-insights', async (req, res) => {
  try {
    await requireUser(req);
    const body = req.body ?? {};
    if (!body.groupName || !Array.isArray(body.expenses)) {
      res.status(400).json({ error: 'invalid insights payload' });
      return;
    }
    const text = await analyzeSpending(body);
    res.json({ text });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'analysis failed',
    });
  }
});

// --- Products & catalog ---

app.get('/api/products/search', async (req, res) => {
  try {
    await requireUser(req);
    const q = String(req.query.q ?? '');
    const results = await searchProducts(pool, q);
    res.json(results);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'search failed',
    });
  }
});

app.get('/api/products/lookup', async (req, res) => {
  try {
    await requireUser(req);
    const barcode = String(req.query.barcode ?? '').trim();
    if (!barcode) {
      res.status(400).json({ error: 'barcode is required' });
      return;
    }
    const product = await lookupProduct(pool, barcode);
    if (!product) {
      res.status(404).json({ error: 'product not found' });
      return;
    }
    res.json(product);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'lookup failed',
    });
  }
});

app.get('/api/products/:barcode/prices', async (req, res) => {
  try {
    await requireUser(req);
    const prices = await getProductPrices(pool, req.params.barcode);
    res.json(prices);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'prices failed',
    });
  }
});

app.get('/api/products/favorites', async (req, res) => {
  try {
    const user = await requireUser(req);
    const favorites = await getFavoriteProducts(pool, user.id);
    res.json(favorites);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.post('/api/products/favorites/:barcode', async (req, res) => {
  try {
    const user = await requireUser(req);
    const nickname = req.body?.nickname?.trim() || undefined;
    const fav = await addFavorite(pool, user.id, req.params.barcode, nickname);
    res.status(201).json(fav);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'add failed',
    });
  }
});

app.delete('/api/products/favorites/:barcode', async (req, res) => {
  try {
    const user = await requireUser(req);
    await removeFavorite(pool, user.id, req.params.barcode);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'remove failed',
    });
  }
});

app.get('/api/products/sync-status', async (req, res) => {
  try {
    await requireUser(req);
    const status = await getPriceSyncStatus(pool);
    res.json({ ...status, running: status.running || isPriceSyncRunning() });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'status failed',
    });
  }
});

// --- Shopping trips ---

app.get('/api/shopping-trips', async (req, res) => {
  try {
    const user = await requireUser(req);
    const groupId = req.query.groupId
      ? String(req.query.groupId)
      : undefined;
    const trips = await listShoppingTrips(pool, user.id, groupId);
    res.json(trips);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'list failed',
    });
  }
});

app.get('/api/shopping-trips/:tripId', async (req, res) => {
  try {
    const user = await requireUser(req);
    const row = await requireTripOwner(pool, user.id, req.params.tripId);
    res.json(await loadTripDto(pool, row));
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'get failed',
    });
  }
});

app.post('/api/shopping-trips', async (req, res) => {
  try {
    const user = await requireUser(req);
    const trip = await createShoppingTrip(
      pool,
      user,
      req.body,
      [],
      uploadsRoot,
      installmentDeps(),
    );
    res.status(201).json(trip);
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'create failed',
    });
  }
});

app.post(
  '/api/shopping-trips/parse-receipt',
  async (req, res, next) => {
    try {
      req.user = await requireUser(req);
      next();
    } catch (error) {
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'auth failed',
      });
    }
  },
  (req, res, next) => {
    tripReceiptUpload(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'receipt file is required' });
        return;
      }
      const full = tripReceiptPath(
        uploadsRoot,
        req.user.id,
        req.file.filename,
      );
      const draft = await parseReceiptImage(
        pool,
        full,
        req.file.mimetype,
      );
      deleteTripReceiptFile(uploadsRoot, req.user.id, req.file.filename);
      res.json(draft);
    } catch (error) {
      if (req.file) {
        deleteTripReceiptFile(uploadsRoot, req.user.id, req.file.filename);
      }
      res.status(error.status ?? 500).json({
        error: error instanceof Error ? error.message : 'parse failed',
      });
    }
  },
);

app.delete('/api/shopping-trips/:tripId', async (req, res) => {
  try {
    const user = await requireUser(req);
    await deleteShoppingTrip(pool, user.id, req.params.tripId, uploadsRoot);
    res.status(204).end();
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'delete failed',
    });
  }
});

app.post('/api/users/me/reset-demo', async (req, res) => {
  try {
    const user = await requireUser(req);
    const [owned] = await pool.query(
      'SELECT id FROM `groups` WHERE created_by = ?',
      [user.id],
    );

    for (const row of owned) {
      await pool.query('DELETE FROM `groups` WHERE id = ?', [row.id]);
    }

    await pool.query('UPDATE users SET created_at = ? WHERE id = ?', [
      new Date(),
      user.id,
    ]);

    res.json({ ok: true });
  } catch (error) {
    res.status(error.status ?? 500).json({
      error: error instanceof Error ? error.message : 'reset failed',
    });
  }
});

async function start() {
  try {
    await initSchema(pool);
    console.log('MySQL schema ready');
  } catch (error) {
    console.error('Failed to init MySQL schema:', error.message);
    console.error(
      'Ensure MySQL is running and MYSQL_* env vars are set (see .env.example).',
    );
    process.exit(1);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Budget API listening on http://0.0.0.0:${port}`);
    console.log(`  database: ${process.env.MYSQL_DATABASE ?? 'budgeted'}`);
    startPriceSyncScheduler(pool);
  });
}

start();
