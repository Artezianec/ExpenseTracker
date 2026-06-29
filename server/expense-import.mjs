import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { generateAiText } from './llm.mjs';
import { ensureGroupForUserMonth } from './purchases.mjs';

const skillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'expense-import.md',
);

const reconcileSkillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'expense-import-reconcile.md',
);

function llmEnrichEnabled() {
  return process.env.EXPENSE_IMPORT_LLM_ENRICH !== 'false';
}

function llmGapFillAlways() {
  return process.env.EXPENSE_IMPORT_LLM_ALWAYS === 'true';
}

const INCOME_BANK_ACTIONS =
  /משכורת|העברה מ|הפקדה|interest credit|credit transfer/i;

const CATEGORY_BY_KEYWORD = [
  [/מים|water/i, 'Utilities'],
  [/חשמל|electric/i, 'Utilities'],
  [/ארנונה|arnona|היטל שמירה/i, 'Rent'],
  [/גז|gas/i, 'Utilities'],
  [/בריאות|health|קופת|שרותי בריאות/i, 'Health'],
  [/רכב|כאל רכב|car|fuel|דלק/i, 'Transport'],
  [/ביטוח|insurance/i, 'Health'],
  [/שכ[\"']?ד|rent|משכנ/i, 'Rent'],
  [/ויזה|visa|shopping|קניה|ני"ע/i, 'Shopping'],
  [/מסעד|food|super|market|מכול/i, 'Food'],
  [/הלו|loan|קרן|ריבית/i, 'Other'],
];

const BANK_LINE_RE =
  /^(\d{2}\/\d{2}\/\d{4})\t(.+?)\t([\d,]*\.\d{2})\t/;

export async function extractPdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

function parseAmount(raw) {
  const s = String(raw).replace(/,/g, '').trim();
  if (!s) return NaN;
  return Number(s.startsWith('.') ? `0${s}` : s);
}

function parseIsoDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const monthNames = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const en = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (en) {
    const m = monthNames[en[2].toLowerCase()];
    if (m) return `${en[3]}-${String(m).padStart(2, '0')}-${en[1].padStart(2, '0')}`;
  }
  const dmyDot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmyDot) {
    return `${dmyDot[3]}-${dmyDot[2].padStart(2, '0')}-${dmyDot[1].padStart(2, '0')}`;
  }
  return null;
}

function monthYearFromIso(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { month: m, year: y };
}

function normalizeCategory(name, allowed) {
  const set = new Set(allowed);
  if (set.has(name)) return name;
  for (const [re, cat] of CATEGORY_BY_KEYWORD) {
    if (re.test(name) && set.has(cat)) return cat;
  }
  return set.has('Other') ? 'Other' : allowed[0] ?? 'Other';
}

function suggestCategory(description, paymentType, allowed) {
  const hay = `${paymentType ?? ''} ${description ?? ''}`;
  for (const [re, cat] of CATEGORY_BY_KEYWORD) {
    if (re.test(hay) && allowed.includes(cat)) return cat;
  }
  return allowed.includes('Other') ? 'Other' : allowed[0];
}

function itemRow(fields) {
  const date = parseIsoDate(fields.date);
  const amount = parseAmount(fields.amount);
  if (!date || !Number.isFinite(amount) || amount <= 0) return null;
  const { month, year } = monthYearFromIso(date);
  return {
    id: randomUUID(),
    date,
    month,
    year,
    amount: Math.round(amount * 100) / 100,
    description: String(fields.description ?? 'Expense').slice(0, 500),
    category: fields.category,
    sourceFile: fields.sourceFile,
    sourceParser: fields.sourceParser ?? 'rules',
    confidence: fields.confidence ?? 'high',
    selected: true,
    aiReviewed: fields.aiReviewed ?? false,
  };
}

export function mergeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = [
      item.sourceFile,
      item.date,
      item.amount,
      item.description,
      item.sourceParser,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function scanBankLines(text) {
  const lines = text.split(/\r?\n/);
  const debits = [];
  const credits = [];
  const unparsed = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BANK_LINE_RE);
    if (!m) continue;
    const marker = lines[i + 1]?.trim();
    const action = m[2].trim();
    const amount = parseAmount(m[3]);
    const entry = { date: m[1], action, amount, line: i + 1 };

    if (marker === '1' || INCOME_BANK_ACTIONS.test(action)) {
      credits.push({ ...entry, reason: 'credit_or_income' });
      continue;
    }
    if (marker !== '2') {
      unparsed.push({ ...entry, reason: `unknown_marker:${marker ?? 'none'}` });
      continue;
    }
    debits.push(entry);
  }
  return { debits, credits, unparsed };
}

export function parsePaybillConfirmations(text, sourceFile, allowedCategories) {
  const items = [];
  const seen = new Set();
  const add = (fields) => {
    const row = itemRow({ ...fields, sourceFile, sourceParser: 'paybill' });
    if (!row) return;
    const k = `${row.date}|${row.amount}|${row.description}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push(row);
  };

  for (const block of text.split(/(?=From: ServiceMail)/i)) {
    if (!/From: ServiceMail/i.test(block)) continue;
    const amountMatch = block.match(/:לתשלום סכום\s*([\d.]+)/);
    const dateMatch =
      block.match(/:תשלום תאריך\s*(\d{2}\/\d{2}\/\d{4})/) ??
      block.match(/Date:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    const typeMatch = block.match(/: ?תשלום סוג\s*([^\n]+)/);
    const vendorMatch = block.match(/: ?לרשות שולם\s*([^\n]+)/);
    if (!amountMatch || !dateMatch) continue;
    const paymentType = typeMatch?.[1]?.trim() ?? 'Payment';
    const vendor = vendorMatch?.[1]?.trim() ?? '';
    add({
      date: dateMatch[1],
      amount: amountMatch[1],
      description: vendor ? `${paymentType} — ${vendor}` : paymentType,
      category: suggestCategory(vendor || paymentType, paymentType, allowedCategories),
      confidence: 'high',
    });
  }

  if (items.length === 0) {
    for (const am of text.matchAll(/:לתשלום סכום\s*([\d.]+)/g)) {
      const chunk = text.slice(Math.max(0, am.index - 800), am.index + 200);
      const dateMatch =
        chunk.match(/:תשלום תאריך\s*(\d{2}\/\d{2}\/\d{4})/) ??
        chunk.match(/Date:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
      if (!dateMatch) continue;
      const typeMatch = chunk.match(/: ?תשלום סוג\s*([^\n]+)/);
      const vendorMatch = chunk.match(/: ?לרשות שולם\s*([^\n]+)/);
      const paymentType = typeMatch?.[1]?.trim() ?? 'Payment';
      const vendor = vendorMatch?.[1]?.trim() ?? '';
      add({
        date: dateMatch[1],
        amount: am[1],
        description: vendor ? `${paymentType} — ${vendor}` : paymentType,
        category: suggestCategory(vendor || paymentType, paymentType, allowedCategories),
        confidence: 'medium',
      });
    }
  }
  return items;
}

export function parseIecElectricity(text, sourceFile, allowedCategories) {
  const items = [];
  for (const page of text.split(/(?=-- \d+ of \d+ --)/)) {
    if (!/חברת החשמל|iec\.co\.il/i.test(page)) continue;
    const amountMatch = page.match(/סה"כ לתשלום[^0-9]*([\d.]+)/);
    const dateMatch =
      page.match(/תאריך תשלום[^\d]*(\d{2}\.\d{2}\.\d{4})/) ??
      page.match(/(\d{2}\.\d{2}\.\d{4})\s+כרטיס/);
    if (!amountMatch) continue;
    const row = itemRow({
      date: dateMatch?.[1] ?? page.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1],
      amount: amountMatch[1],
      description: 'Electricity — Israel Electric Company',
      category: suggestCategory('חשמל', 'חשמל', allowedCategories),
      sourceFile,
      sourceParser: 'electricity',
      confidence: 'high',
    });
    if (row) items.push(row);
  }
  return items;
}

export function parseArnonaReceipts(text, sourceFile, allowedCategories) {
  const items = [];
  const arnonaLineRe = /ארנונה[\s\t]+\d+[\s\t]+([\d.]+)[\s\t]+/;
  const levyLineRe = /ה\.שמירה[\s\t]+\d+[\s\t]+([\d.]+)[\s\t]+/;

  for (const page of text.split(/(?=קבלה למשלם)/)) {
    if (!page.includes('קבלה למשלם')) continue;
    const payDate =
      page.match(/([\d.]+)\s+(\d{2}\/\d{2}\/\d{4})\s+8898/)?.[2] ??
      page.match(/(\d{2}\/\d{2}\/\d{4})\s+8898/)?.[1];

    let foundLine = false;
    for (const line of page.split(/\r?\n/)) {
      const arnonaMatch = line.match(arnonaLineRe);
      if (arnonaMatch) {
        foundLine = true;
        const row = itemRow({
          date: payDate,
          amount: arnonaMatch[1],
          description: 'Arnona — municipal tax',
          category: suggestCategory('ארנונה', 'ארנונה', allowedCategories),
          sourceFile,
          sourceParser: 'arnona',
          confidence: 'high',
        });
        if (row) items.push(row);
        continue;
      }
      const levyMatch = line.match(levyLineRe);
      if (levyMatch) {
        foundLine = true;
        const row = itemRow({
          date: payDate,
          amount: levyMatch[1],
          description: 'Security levy — Arnona',
          category: suggestCategory('ארנונה', 'היטל שמירה', allowedCategories),
          sourceFile,
          sourceParser: 'arnona',
          confidence: 'high',
        });
        if (row) items.push(row);
      }
    }

    if (!foundLine) {
      const totalMatch = page.match(/([\d.]+)\s+סה"כ לתשלום/);
      if (totalMatch) {
        const row = itemRow({
          date: payDate,
          amount: totalMatch[1],
          description: 'Arnona / municipal tax',
          category: suggestCategory('ארנונה', 'ארנונה', allowedCategories),
          sourceFile,
          sourceParser: 'arnona',
          confidence: 'medium',
        });
        if (row) items.push(row);
      }
    }
  }
  return items;
}

export function parseBankDebits(text, sourceFile, allowedCategories) {
  return scanBankLines(text).debits
    .map((d) =>
      itemRow({
        date: d.date,
        amount: d.amount,
        description: d.action,
        category: suggestCategory(d.action, d.action, allowedCategories),
        sourceFile,
        sourceParser: 'bank',
        confidence: 'high',
      }),
    )
    .filter(Boolean);
}

export function parseAllRuleBased(text, sourceFile, allowedCategories) {
  return mergeItems([
    ...parsePaybillConfirmations(text, sourceFile, allowedCategories),
    ...parseIecElectricity(text, sourceFile, allowedCategories),
    ...parseArnonaReceipts(text, sourceFile, allowedCategories),
    ...parseBankDebits(text, sourceFile, allowedCategories),
  ]);
}

export function auditPdfCoverage(text, fileName, items) {
  const bank = scanBankLines(text);
  const signals = {
    paybillPayments: (text.match(/:לתשלום סכום/g) || []).length,
    iecPayments: 0,
    arnonaReceipts: (text.match(/קבלה למשלם/g) || []).length,
    bankDebitLines: bank.debits.length,
    bankCreditLines: bank.credits.length,
    bankUnparsedLines: bank.unparsed.length,
  };
  if (/iec\.co\.il|חברת החשמל/i.test(text)) {
    const iecPages = text
      .split(/(?=-- \d+ of \d+ --)/)
      .filter((p) => /iec\.co\.il|חברת החשמל/i.test(p));
    signals.iecPayments = iecPages.length;
  }

  const parsedByParser = {};
  for (const it of items) {
    parsedByParser[it.sourceParser] = (parsedByParser[it.sourceParser] ?? 0) + 1;
  }

  const gaps = [];
  if (signals.paybillPayments > (parsedByParser.paybill ?? 0)) {
    gaps.push({ type: 'paybill', expected: signals.paybillPayments, parsed: parsedByParser.paybill ?? 0 });
  } else if ((parsedByParser.paybill ?? 0) > signals.paybillPayments && signals.paybillPayments > 0) {
    gaps.push({
      type: 'paybill_over',
      expected: signals.paybillPayments,
      parsed: parsedByParser.paybill ?? 0,
    });
  }
  if (signals.iecPayments > (parsedByParser.electricity ?? 0)) {
    gaps.push({ type: 'electricity', expected: signals.iecPayments, parsed: parsedByParser.electricity ?? 0 });
  }
  if (signals.arnonaReceipts > 0 && (parsedByParser.arnona ?? 0) === 0) {
    gaps.push({ type: 'arnona', expected: signals.arnonaReceipts, parsed: parsedByParser.arnona ?? 0 });
  }
  if (signals.bankDebitLines > (parsedByParser.bank ?? 0)) {
    gaps.push({ type: 'bank_debits', expected: signals.bankDebitLines, parsed: parsedByParser.bank ?? 0 });
  }
  if (bank.unparsed.length > 0) {
    gaps.push({
      type: 'bank_unparsed',
      expected: bank.unparsed.length,
      parsed: 0,
      samples: bank.unparsed.slice(0, 5),
    });
  }

  return {
    fileName,
    signals,
    parsedByParser,
    gaps,
    skippedCredits: bank.credits.length,
    complete: gaps.length === 0,
  };
}

function itemKey(it) {
  return `${it.date}|${it.amount}|${it.description.slice(0, 60)}`;
}

async function parseWithLlm(text, sourceFile, allowedCategories, existingItems, fillGapsOnly) {
  let skill = '';
  try {
    skill = readFileSync(skillPath, 'utf8').replace('{{CATEGORIES}}', allowedCategories.join(', '));
  } catch {
    skill = `Extract expenses JSON. Categories: ${allowedCategories.join(', ')}`;
  }

  const existingKeys = new Set(existingItems.map(itemKey));
  const maxLen = 10000;
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));

  const all = [];
  const maxChunks = Math.min(chunks.length, 24);
  for (let ci = 0; ci < maxChunks; ci++) {
    const alreadyNote =
      fillGapsOnly && existingItems.length
        ? `\nALREADY EXTRACTED (do NOT duplicate):\n${existingItems.slice(0, 100).map((i) => `- ${i.date} ${i.amount} ${i.description}`).join('\n')}\n`
        : '';
    const prompt = `${skill}
${fillGapsOnly ? 'Extract ONLY missing expense/debit rows not in the list.' : 'Extract ALL expense/debit rows.'}
${alreadyNote}
File: ${sourceFile} chunk ${ci + 1}/${maxChunks}

${chunks[ci]}`;

    try {
      const raw = await generateAiText(prompt);
      const jsonMatch = raw.match(/\{[\s\S]*"items"[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      for (const it of parsed.items ?? []) {
        const row = itemRow({
          date: it.date,
          amount: it.amount,
          description: String(it.description ?? 'Expense'),
          category: normalizeCategory(String(it.category ?? 'Other'), allowedCategories),
          sourceFile,
          sourceParser: 'llm',
          confidence: 'medium',
        });
        if (!row || existingKeys.has(itemKey(row))) continue;
        existingKeys.add(itemKey(row));
        all.push(row);
      }
    } catch {
      /* next chunk */
    }
  }
  return all;
}

function parseLlmJson(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*"items"[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function applyEnrichPatch(existing, patch, allowedCategories) {
  const date = parseIsoDate(patch.date) ?? existing.date;
  let amount = existing.amount;
  if (patch.amount != null) {
    const patched = parseAmount(patch.amount);
    if (Number.isFinite(patched) && patched > 0) {
      const ratio = patched / existing.amount;
      const keepParserAmount =
        existing.confidence === 'high' &&
        existing.amount >= 20 &&
        (ratio < 0.5 || ratio > 2);
      amount = keepParserAmount ? existing.amount : patched;
    }
  }
  if (!Number.isFinite(amount) || amount <= 0) return existing;
  const { month, year } = monthYearFromIso(date);
  return {
    ...existing,
    date,
    month,
    year,
    amount: Math.round(amount * 100) / 100,
    description: String(patch.description ?? existing.description).slice(0, 500),
    category: normalizeCategory(String(patch.category ?? existing.category), allowedCategories),
    aiReviewed: true,
    confidence: existing.confidence === 'high' ? 'high' : 'medium',
  };
}

export async function enrichItemsWithLlm(items, allowedCategories) {
  if (!llmEnrichEnabled() || !items.length) return items;

  let skill = '';
  try {
    skill = readFileSync(reconcileSkillPath, 'utf8').replace(
      '{{CATEGORIES}}',
      allowedCategories.join(', '),
    );
  } catch {
    skill = `Reconcile expenses for DB. Categories: ${allowedCategories.join(', ')}. Same ids, same count.`;
  }

  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  const batchSize = 35;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const input = {
      items: batch.map((it) => ({
        id: it.id,
        date: it.date,
        amount: it.amount,
        description: it.description,
        category: it.category,
        sourceFile: it.sourceFile,
      })),
    };

    const prompt = `${skill}

Batch ${Math.floor(i / batchSize) + 1} — reconcile these ${batch.length} rows:

${JSON.stringify(input)}`;

    try {
      const raw = await generateAiText(prompt);
      const parsed = parseLlmJson(raw);
      if (!parsed?.items?.length) continue;

      for (const patch of parsed.items) {
        const existing = byId.get(patch.id);
        if (!existing) continue;
        byId.set(patch.id, applyEnrichPatch(existing, patch, allowedCategories));
      }
    } catch {
      /* keep rule-based rows for this batch */
    }
  }

  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function parseExpensePdf(buffer, fileName, allowedCategories) {
  const text = await extractPdfText(buffer);
  if (!text.trim()) {
    return { items: [], warnings: [`${fileName}: no extractable text`], audit: null };
  }

  let items = parseAllRuleBased(text, fileName, allowedCategories);
  let audit = auditPdfCoverage(text, fileName, items);

  if (audit.gaps.length > 0 || llmGapFillAlways() || (text.length > 500 && !items.length)) {
    const llmItems = await parseWithLlm(text, fileName, allowedCategories, items, items.length > 0);
    items = mergeItems([...items, ...llmItems]);
    audit = auditPdfCoverage(text, fileName, items);
  }

  const warnings = [];
  if (!items.length) warnings.push(`${fileName}: no expenses detected`);
  if (audit.skippedCredits > 0) {
    warnings.push(`${fileName}: ${audit.skippedCredits} income/credit bank lines skipped (not expenses)`);
  }
  for (const g of audit.gaps) {
    if (g.type === 'bank_unparsed') {
      warnings.push(`${fileName}: ${g.expected} bank lines could not be parsed automatically`);
    } else if (g.expected > g.parsed) {
      warnings.push(`${fileName}: ${g.type} expected ~${g.expected}, got ${g.parsed}`);
    } else if (g.parsed > g.expected) {
      warnings.push(`${fileName}: ${g.type} parsed ${g.parsed} but only ~${g.expected} payment tags in PDF`);
    }
  }

  return { items, warnings, audit, charCount: text.length };
}

export async function parseExpensePdfFiles(files, allowedCategories) {
  const allItems = [];
  const warnings = [];
  const filesSummary = [];
  const audits = [];

  for (const file of files) {
    const { items, warnings: w, audit } = await parseExpensePdf(file.buffer, file.originalname, allowedCategories);
    allItems.push(...items);
    warnings.push(...w);
    if (audit) audits.push(audit);
    filesSummary.push({
      name: file.originalname,
      count: items.length,
      complete: audit?.complete ?? false,
      skippedCredits: audit?.skippedCredits ?? 0,
    });
  }

  const merged = mergeItems(allItems).sort((a, b) => a.date.localeCompare(b.date));
  const enriched = await enrichItemsWithLlm(merged, allowedCategories);

  return {
    items: enriched,
    warnings,
    filesSummary,
    audits,
    allComplete: audits.every((a) => a.complete),
    aiEnriched: llmEnrichEnabled(),
    aiReviewedCount: enriched.filter((i) => i.aiReviewed).length,
    byMonth: allItems.reduce((acc, it) => {
      const k = `${it.year}-${String(it.month).padStart(2, '0')}`;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

export async function commitExpenseImport(pool, user, items, allowedCategories, ensureParticipantForUser) {
  const deps = { ensureParticipantForUser };
  let created = 0;
  let skipped = 0;
  const groupCache = new Map();

  const selected = items.filter((item) => item.selected !== false);
  const needsReview = selected.some((i) => !i.aiReviewed);
  const prepared =
    needsReview && llmEnrichEnabled()
      ? await enrichItemsWithLlm(selected, allowedCategories)
      : selected;
  const preparedById = new Map(prepared.map((i) => [i.id, i]));

  for (const item of items) {
    if (item.selected === false) {
      skipped += 1;
      continue;
    }
    const row = preparedById.get(item.id) ?? item;
    const cacheKey = `${row.year}-${row.month}`;
    let groupId = groupCache.get(cacheKey);
    if (!groupId) {
      groupId = await ensureGroupForUserMonth(pool, user, row.month, row.year, deps);
      groupCache.set(cacheKey, groupId);
    }
    await pool.query(
      `INSERT INTO expenses (id, group_id, amount, description, category, paid_by, expense_date, created_at, split_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'equal')`,
      [
        randomUUID(),
        groupId,
        row.amount,
        row.description,
        normalizeCategory(row.category, allowedCategories),
        user.id,
        new Date(row.date),
        new Date(),
      ],
    );
    created += 1;
  }
  return { created, skipped, months: [...groupCache.keys()] };
}
