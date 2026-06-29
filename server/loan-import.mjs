import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { extractPdfText } from './expense-import.mjs';
import { generateAiText } from './llm.mjs';
import { parseDocumentWithVision, transcribeDocumentWithVision } from './receipt-ocr.mjs';
import { ensureGroupForUserMonth } from './purchases.mjs';
import { loadCreditDto } from './credits.mjs';

const skillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'loan-import.md',
);

const ocrSkillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'loan-import-ocr.md',
);

const LOAN_ROW_RE =
  /^(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/;

const LOAN_ROW_FLEX =
  /(?:^|\s)(\d{1,3})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;

function parseAmount(raw) {
  const s = String(raw).replace(/,/g, '').trim();
  if (!s) return NaN;
  return Number(s.startsWith('.') ? `0${s}` : s);
}

function parseIsoDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const candidate = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }
  return null;
}

function isValidCalendarDate(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function formatIsoFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function resolvePaymentAmount(amountRaw, principalRaw, interestRaw) {
  const principal = parseAmount(principalRaw);
  const interest = parseAmount(interestRaw);
  if (Number.isFinite(principal) && Number.isFinite(interest) && principal > 0 && interest >= 0) {
    return Math.round((principal + interest) * 100) / 100;
  }
  const amount = parseAmount(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return NaN;
  if (amount > 5000) return NaN;
  return amount;
}

function scheduleQualityWarnings(schedule) {
  const warnings = [];
  const payments = schedule?.payments ?? [];
  if (!payments.length) return ['No payments detected'];

  const amounts = payments.map((p) => p.amount).filter((a) => a > 0);
  const median = amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)] ?? 0;
  if (median > 4000 || median < 100) {
    warnings.push(
      'Payment amounts look unusual — try a sharper photo, PDF export, or set RECEIPT_OCR_PROVIDER=gemini for better table reading',
    );
  }
  if (payments.length < 6) {
    warnings.push(
      `Only ${payments.length} payments found — full Cal schedules usually have 24–36 rows; scroll/zoom so the whole table is visible`,
    );
  }
  const invalidDates = payments.filter((p) => !isValidCalendarDate(p.date)).length;
  if (invalidDates > 0) {
    warnings.push(`${invalidDates} payment dates were repaired from payment numbers`);
  }
  return warnings;
}

function repairScheduleDates(payments) {
  if (!payments.length) return payments;
  const sorted = [...payments].sort((a, b) => a.paymentNumber - b.paymentNumber);
  const anchor = sorted.find((p) => isValidCalendarDate(p.date));
  if (!anchor) return sorted;

  const [y, m, d] = anchor.date.split('-').map(Number);
  return sorted.map((p) => {
    const delta = p.paymentNumber - anchor.paymentNumber;
    const repaired = new Date(y, m - 1 + delta, d);
    const iso = formatIsoFromParts(
      repaired.getFullYear(),
      repaired.getMonth() + 1,
      repaired.getDate(),
    );
    return {
      ...p,
      date: iso,
      month: repaired.getMonth() + 1,
      year: repaired.getFullYear(),
    };
  });
}

function syncMonthYear(p) {
  if (!isValidCalendarDate(p.date)) return p;
  const [y, m] = p.date.split('-').map(Number);
  return { ...p, month: m, year: y };
}

function monthYearFromIso(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { month: m, year: y };
}

function loadSkill() {
  try {
    return readFileSync(skillPath, 'utf8');
  } catch {
    return 'Extract loan amortization schedule as JSON with name, lender, principal, payments[].';
  }
}

function loadOcrSkill() {
  try {
    return readFileSync(ocrSkillPath, 'utf8');
  } catch {
    return 'Transcribe loan table rows: number, DD/MM/YYYY, amount, principal, interest, balance.';
  }
}

function rowToPayment(m, sourceFile) {
  const date = parseIsoDate(m[2]);
  const amount = resolvePaymentAmount(m[3], m[4], m[5]);
  if (!date || !Number.isFinite(amount) || amount <= 0) return null;
  const { month, year } = monthYearFromIso(date);
  return {
    paymentNumber: Number(m[1]),
    date,
    month,
    year,
    amount: Math.round(amount * 100) / 100,
    principal: Math.round(parseAmount(m[4]) * 100) / 100,
    interest: Math.round(parseAmount(m[5]) * 100) / 100,
    balance: Math.round(parseAmount(m[6]) * 100) / 100,
    sourceFile,
  };
}

function finalizeSchedule(schedule) {
  if (!schedule?.payments?.length) return schedule;
  const repaired = repairScheduleDates(schedule.payments)
    .map(syncMonthYear)
    .filter((p) => isValidCalendarDate(p.date));
  schedule.payments = repaired.map((p) => ({
    ...p,
    id: p.id ?? randomUUID(),
    selected: p.selected !== false,
  }));
  schedule.termMonths = schedule.payments.length;
  const first = schedule.payments[0];
  if (first) {
    schedule.paymentDay = Math.min(28, Math.max(1, Number(first.date.split('-')[2]) || 10));
    schedule.startDate = first.date;
  }
  return schedule;
}

function normalizeSchedule(raw, sourceFile) {
  const payments = [];
  for (const p of raw.payments ?? []) {
    const amount = resolvePaymentAmount(p.amount, p.principal, p.interest);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const date = parseIsoDate(p.date);
    const paymentNumber = Number(p.paymentNumber) || payments.length + 1;
    const monthYear = date ? monthYearFromIso(date) : { month: 0, year: 0 };
    payments.push({
      id: randomUUID(),
      paymentNumber,
      date: date ?? null,
      month: monthYear.month,
      year: monthYear.year,
      amount: Math.round(amount * 100) / 100,
      principal: Number.isFinite(parseAmount(p.principal))
        ? Math.round(parseAmount(p.principal) * 100) / 100
        : undefined,
      interest: Number.isFinite(parseAmount(p.interest))
        ? Math.round(parseAmount(p.interest) * 100) / 100
        : undefined,
      balance: Number.isFinite(parseAmount(p.balance))
        ? Math.round(parseAmount(p.balance) * 100) / 100
        : undefined,
      sourceFile,
      selected: true,
    });
  }
  payments.sort((a, b) => a.paymentNumber - b.paymentNumber);

  let principal = parseAmount(raw.principal);
  if (!Number.isFinite(principal) || principal <= 0) {
    const withBalance = payments.find((p) => p.balance != null && p.principal != null);
    if (withBalance) {
      principal = Math.round((withBalance.balance + withBalance.principal) * 100) / 100;
    } else {
      principal = payments.reduce((s, p) => s + (p.principal ?? 0), 0);
    }
  }

  const first = payments[0];
  const paymentDay = first ? Number(first.date.split('-')[2]) : 10;

  return finalizeSchedule({
    name: String(raw.name ?? 'Imported loan').slice(0, 255),
    lender: raw.lender ? String(raw.lender).slice(0, 255) : undefined,
    principal: Math.round(principal * 100) / 100,
    termMonths: payments.length,
    paymentDay: Math.min(28, Math.max(1, paymentDay)),
    startDate: first?.date ?? new Date().toISOString().slice(0, 10),
    payments,
    sourceFile,
  });
}

export function parseLoanScheduleRules(text, sourceFile) {
  const byNumber = new Map();
  for (const line of text.split(/\r?\n/)) {
    LOAN_ROW_FLEX.lastIndex = 0;
    for (const m of line.matchAll(LOAN_ROW_FLEX)) {
      const row = rowToPayment(m, sourceFile);
      if (!row) continue;
      byNumber.set(row.paymentNumber, row);
    }
    const strict = line.match(LOAN_ROW_RE);
    if (strict) {
      const row = rowToPayment(strict, sourceFile);
      if (row) byNumber.set(row.paymentNumber, row);
    }
  }
  const payments = [...byNumber.values()].sort((a, b) => a.paymentNumber - b.paymentNumber);
  if (!payments.length) return null;

  const lender = /cal|כאל|credit cards/i.test(text) ? 'Cal' : undefined;
  return finalizeSchedule(
    normalizeSchedule(
      {
        name: lender ? 'Cal loan' : 'Imported loan',
        lender,
        principal: payments[0].balance + payments[0].principal,
        payments,
      },
      sourceFile,
    ),
  );
}

function parseLlmJson(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*"payments"[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

async function parseWithLlmText(text, sourceFile) {
  const skill = loadSkill();
  const prompt = `${skill}

File: ${sourceFile}

Document text:
${text.slice(0, 50000)}`;

  const raw = await generateAiText(prompt);
  const parsed = parseLlmJson(raw);
  if (!parsed?.payments?.length) return null;
  return finalizeSchedule(normalizeSchedule(parsed, sourceFile));
}

async function transcribeLoanTable(buffer, mimeType, sourceFile) {
  const prompt = `${loadOcrSkill()}\n\nFile: ${sourceFile}`;
  return transcribeDocumentWithVision(buffer, mimeType, prompt);
}

async function parseWithVision(buffer, mimeType, sourceFile) {
  const transcription = await transcribeLoanTable(buffer, mimeType, sourceFile);
  if (transcription) {
    const fromRules = parseLoanScheduleRules(transcription, sourceFile);
    if (fromRules?.payments.length >= 3) return fromRules;
  }

  const skill = loadSkill();
  const parsed = await parseDocumentWithVision(buffer, mimeType, `${skill}\n\nFile: ${sourceFile}`);
  if (!parsed?.payments?.length) {
    if (transcription) {
      const fromText = await parseWithLlmText(transcription, sourceFile);
      if (fromText?.payments.length) return fromText;
    }
    return null;
  }
  return finalizeSchedule(normalizeSchedule(parsed, sourceFile));
}

function isImageFile(file) {
  return (
    file.mimetype?.startsWith('image/') ||
    /\.(jpe?g|png|webp|heic|gif)$/i.test(file.originalname ?? '')
  );
}

function isPdfFile(file) {
  return (
    file.mimetype === 'application/pdf' ||
    file.originalname?.toLowerCase().endsWith('.pdf')
  );
}

export async function parseLoanImportFile(file) {
  const sourceFile = file.originalname ?? 'upload';
  const warnings = [];

  try {
    if (isImageFile(file)) {
      const schedule = await parseWithVision(
        file.buffer,
        file.mimetype || 'image/jpeg',
        sourceFile,
      );
      if (!schedule?.payments.length) {
        return { schedule: null, warnings: [`${sourceFile}: no loan rows detected in image`] };
      }
      return {
        schedule,
        warnings: [...warnings, ...scheduleQualityWarnings(schedule)],
      };
    }

    if (isPdfFile(file)) {
      const text = await extractPdfText(file.buffer);
      let schedule = text.trim() ? parseLoanScheduleRules(text, sourceFile) : null;
      if (!schedule?.payments.length) {
        schedule = await parseWithLlmText(text, sourceFile);
      }
      if (!schedule?.payments.length) {
        warnings.push(`${sourceFile}: no loan schedule found — try a clearer photo/PDF`);
        return { schedule: null, warnings };
      }
      return {
        schedule,
        warnings: [...warnings, ...scheduleQualityWarnings(schedule)],
      };
    }

    warnings.push(`${sourceFile}: unsupported file type (use PDF or image)`);
    return { schedule: null, warnings };
  } catch (error) {
    warnings.push(
      `${sourceFile}: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
    return { schedule: null, warnings };
  }
}

export async function parseLoanImportFiles(files) {
  const warnings = [];
  let schedule = null;

  for (const file of files) {
    const result = await parseLoanImportFile(file);
    warnings.push(...result.warnings);
    if (result.schedule && !schedule) {
      schedule = result.schedule;
    } else if (result.schedule && schedule) {
      warnings.push(
        `${file.originalname}: only the first file is used; upload one schedule at a time`,
      );
    }
  }

  if (!schedule) {
    return { schedule: null, warnings, byMonth: {} };
  }

  const byMonth = schedule.payments.reduce((acc, p) => {
    const k = `${p.year}-${String(p.month).padStart(2, '0')}`;
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return { schedule, warnings, byMonth };
}

export async function commitLoanImport(pool, user, payload, deps) {
  const name = payload?.name?.trim();
  const payments = payload?.payments;
  if (!name || !Array.isArray(payments) || !payments.length) {
    const err = new Error('name and payments required');
    err.status = 400;
    throw err;
  }

  const selected = payments.filter((p) => p.selected !== false);
  if (!selected.length) {
    const err = new Error('select at least one payment');
    err.status = 400;
    throw err;
  }

  const principal = Number(payload.principal);
  if (!Number.isFinite(principal) || principal <= 0) {
    const err = new Error('valid principal required');
    err.status = 400;
    throw err;
  }

  const paymentDay = Math.min(
    28,
    Math.max(1, parseInt(String(payload.paymentDay ?? 10), 10) || 10),
  );
  const startDate = payload.startDate ? new Date(payload.startDate) : new Date();
  if (Number.isNaN(startDate.getTime())) {
    const err = new Error('invalid start date');
    err.status = 400;
    throw err;
  }

  const creditId = randomUUID();
  const now = new Date();
  const lender = payload.lender?.trim() || null;
  const termMonths = selected.length;

  await pool.query(
    `INSERT INTO credits
     (id, user_id, name, lender, principal, interest_rate, interest_rate_period,
      term_months, payment_day, start_date, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 'annual', ?, ?, ?, ?)`,
    [
      creditId,
      user.id,
      name,
      lender,
      principal,
      termMonths,
      paymentDay,
      startDate,
      now,
    ],
  );

  const created = [];
  for (const p of selected.sort((a, b) => a.paymentNumber - b.paymentNumber)) {
    const groupId = await ensureGroupForUserMonth(
      pool,
      user,
      p.month,
      p.year,
      deps,
    );
    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO credit_payments
       (id, credit_id, group_id, payment_number, amount, month, year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId,
        creditId,
        groupId,
        p.paymentNumber,
        p.amount,
        p.month,
        p.year,
      ],
    );
    created.push({
      id: paymentId,
      groupId,
      paymentNumber: p.paymentNumber,
      amount: p.amount,
      month: p.month,
      year: p.year,
    });
  }

  const [rows] = await pool.query('SELECT * FROM credits WHERE id = ?', [creditId]);
  return {
    credit: await loadCreditDto(pool, rows[0]),
    months: [...new Set(created.map((p) => `${p.year}-${String(p.month).padStart(2, '0')}`))],
  };
}
