import { getAccessToken, ApiError } from './api';

const API_BASE = (import.meta.env.VITE_BUDGET_API_URL ?? '/api').replace(
  /\/$/,
  '',
);

export interface ImportExpenseItem {
  id: string;
  date: string;
  month: number;
  year: number;
  amount: number;
  description: string;
  category: string;
  sourceFile: string;
  sourceParser?: string;
  confidence: 'high' | 'medium' | 'low';
  selected: boolean;
  aiReviewed?: boolean;
}

export interface ImportFileAudit {
  fileName: string;
  signals: {
    paybillPayments: number;
    iecPayments: number;
    arnonaReceipts: number;
    bankDebitLines: number;
    bankCreditLines: number;
    bankUnparsedLines: number;
  };
  parsedByParser: Record<string, number>;
  gaps: Array<{ type: string; expected: number; parsed: number }>;
  skippedCredits: number;
  complete: boolean;
}

export interface ParseImportResult {
  items: ImportExpenseItem[];
  warnings: string[];
  filesSummary: {
    name: string;
    count: number;
    complete: boolean;
    skippedCredits: number;
  }[];
  audits?: ImportFileAudit[];
  allComplete?: boolean;
  aiEnriched?: boolean;
  aiReviewedCount?: number;
  byMonth: Record<string, number>;
  categories: string[];
}

async function parseError(res: Response): Promise<string> {
  const payload = await res.json().catch(() => ({}));
  return typeof payload.error === 'string' ? payload.error : res.statusText;
}

export async function parseExpensePdfs(
  files: File[],
): Promise<ParseImportResult> {
  const form = new FormData();
  for (const f of files) {
    form.append('pdfs', f);
  }

  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/expenses/import/parse`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }
  return res.json();
}

export async function commitExpenseImport(
  items: ImportExpenseItem[],
): Promise<{ created: number; skipped: number; months: string[] }> {
  const { apiFetch } = await import('./api');
  return apiFetch('/expenses/import/commit', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
