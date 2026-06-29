import { getAccessToken, ApiError, apiFetch } from './api';

const API_BASE = (import.meta.env.VITE_BUDGET_API_URL ?? '/api').replace(
  /\/$/,
  '',
);

export interface LoanImportPayment {
  id: string;
  paymentNumber: number;
  date: string;
  month: number;
  year: number;
  amount: number;
  principal?: number;
  interest?: number;
  balance?: number;
  sourceFile?: string;
  selected: boolean;
}

export interface LoanImportSchedule {
  name: string;
  lender?: string;
  principal: number;
  termMonths: number;
  paymentDay: number;
  startDate: string;
  payments: LoanImportPayment[];
  sourceFile?: string;
}

export interface ParseLoanImportResult {
  schedule: LoanImportSchedule | null;
  warnings: string[];
  byMonth: Record<string, number>;
}

async function parseError(res: Response): Promise<string> {
  const payload = await res.json().catch(() => ({}));
  return typeof payload.error === 'string' ? payload.error : res.statusText;
}

export async function parseLoanScheduleFiles(
  files: File[],
): Promise<ParseLoanImportResult> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }

  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/credits/import/parse`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }
  return res.json();
}

export async function commitLoanImport(payload: {
  name: string;
  lender?: string;
  principal: number;
  paymentDay: number;
  startDate: string;
  payments: LoanImportPayment[];
}): Promise<{ credit: { id: string; name: string }; months: string[] }> {
  return apiFetch('/credits/import/commit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
