import { randomUUID } from 'node:crypto';
import {
  addCalendarMonths,
  computeInstallmentAmounts,
  effectiveMonthlyRateDecimal,
  ensureGroupForUserMonth,
} from './purchases.mjs';

export function computeCreditPaymentAmounts(
  principal,
  termMonths,
  ratePercent = 0,
  ratePeriod = 'annual',
) {
  const count = Math.max(1, termMonths);
  if (count === 1) {
    const rate = effectiveMonthlyRateDecimal(ratePercent, ratePeriod);
    if (rate === 0) return [Math.round(principal * 100) / 100];
    return [Math.round(principal * (1 + rate) * 100) / 100];
  }
  return computeInstallmentAmounts(principal, count, ratePercent, ratePeriod);
}

export function parseInterestRate(raw) {
  if (raw == null || raw === '') return 0;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    const err = new Error('interest rate must be between 0 and 100');
    err.status = 400;
    throw err;
  }
  return Math.round(rate * 100) / 100;
}

export function parseInterestRatePeriod(raw) {
  if (raw === 'monthly' || raw === 'annual') return raw;
  if (raw != null && raw !== '') {
    const err = new Error('interest rate period must be monthly or annual');
    err.status = 400;
    throw err;
  }
  return 'annual';
}

export function parsePaymentDay(raw) {
  const day = raw != null && raw !== '' ? parseInt(String(raw), 10) : 10;
  if (!Number.isFinite(day) || day < 1 || day > 28) {
    const err = new Error('payment day must be between 1 and 28');
    err.status = 400;
    throw err;
  }
  return day;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

export function rowToCredit(row, payments = []) {
  const principal = Number(row.principal);
  const totalScheduled = payments.reduce((sum, p) => sum + p.amount, 0);
  const roundedTotal =
    payments.length > 0 ? Math.round(totalScheduled * 100) / 100 : undefined;

  return {
    id: row.id,
    name: row.name,
    lender: row.lender ?? undefined,
    principal,
    interestRate: Number(row.interest_rate),
    interestRatePeriod: row.interest_rate_period ?? 'annual',
    termMonths: row.term_months,
    paymentDay: row.payment_day,
    startDate: toIso(row.start_date),
    createdAt: toIso(row.created_at),
    payments,
    ...(roundedTotal != null
      ? {
          totalScheduled: roundedTotal,
          totalInterest: Math.round((roundedTotal - principal) * 100) / 100,
          monthlyPayment:
            payments.length > 0
              ? Math.round((roundedTotal / payments.length) * 100) / 100
              : undefined,
        }
      : {}),
  };
}

export async function getCreditPayments(pool, creditId) {
  const [rows] = await pool.query(
    `SELECT id, group_id AS groupId, payment_number AS paymentNumber,
            amount, month, year
     FROM credit_payments
     WHERE credit_id = ?
     ORDER BY payment_number`,
    [creditId],
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

export async function loadCreditDto(pool, row) {
  const payments = await getCreditPayments(pool, row.id);
  return rowToCredit(row, payments);
}

export async function createCreditPayments(
  pool,
  user,
  creditId,
  principal,
  termMonths,
  startDate,
  interestRate,
  interestRatePeriod,
  deps,
) {
  const baseMonth = startDate.getMonth() + 1;
  const baseYear = startDate.getFullYear();
  const paymentAmounts = computeCreditPaymentAmounts(
    principal,
    termMonths,
    interestRate,
    interestRatePeriod,
  );
  const created = [];

  for (let i = 1; i <= termMonths; i += 1) {
    const { month, year } = addCalendarMonths(baseYear, baseMonth, i);
    const groupId = await ensureGroupForUserMonth(pool, user, month, year, deps);
    const amount = paymentAmounts[i - 1];
    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO credit_payments
       (id, credit_id, group_id, payment_number, amount, month, year)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, creditId, groupId, i, amount, month, year],
    );
    created.push({
      id: paymentId,
      groupId,
      paymentNumber: i,
      amount,
      month,
      year,
    });
  }

  return created;
}

export async function rebuildCreditPayments(
  pool,
  user,
  creditId,
  principal,
  termMonths,
  startDate,
  interestRate,
  interestRatePeriod,
  deps,
) {
  await pool.query('DELETE FROM credit_payments WHERE credit_id = ?', [creditId]);
  return createCreditPayments(
    pool,
    user,
    creditId,
    principal,
    termMonths,
    startDate,
    interestRate,
    interestRatePeriod,
    deps,
  );
}

export async function createCreditFromImportSchedule(
  pool,
  user,
  meta,
  schedulePayments,
  deps,
) {
  const creditId = randomUUID();
  const now = new Date();
  const termMonths = schedulePayments.length;

  await pool.query(
    `INSERT INTO credits
     (id, user_id, name, lender, principal, interest_rate, interest_rate_period,
      term_months, payment_day, start_date, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 'annual', ?, ?, ?, ?)`,
    [
      creditId,
      user.id,
      meta.name,
      meta.lender ?? null,
      meta.principal,
      termMonths,
      meta.paymentDay,
      meta.startDate,
      now,
    ],
  );

  const created = [];
  for (const p of schedulePayments) {
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
      [paymentId, creditId, groupId, p.paymentNumber, p.amount, p.month, p.year],
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
  return { creditId, payments: created };
}

import { getHouseholdUserIds } from './household.mjs';

export async function getGroupCreditPayments(pool, groupId, userId) {
  const userIds = await getHouseholdUserIds(pool, userId);
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT cp.id, cp.credit_id AS creditId, cp.amount,
            cp.payment_number AS paymentNumber, cp.month, cp.year,
            c.name AS creditName, c.lender, c.payment_day AS paymentDay
     FROM credit_payments cp
     INNER JOIN credits c ON c.id = cp.credit_id
     WHERE cp.group_id = ? AND c.user_id IN (${placeholders})
     ORDER BY cp.payment_number`,
    [groupId, ...userIds],
  );
  return rows.map((r) => ({
    id: r.id,
    creditId: r.creditId,
    creditName: r.creditName,
    lender: r.lender ?? undefined,
    amount: Number(r.amount),
    paymentNumber: r.paymentNumber,
    paymentDay: r.paymentDay,
    month: r.month,
    year: r.year,
  }));
}
