import type { Purchase, PurchaseReceipt, InterestRatePeriod } from '../types';
import { apiFetch, apiUploadForm, fetchAuthenticatedBlob } from './api';

const POLL_INTERVAL_MS = 5000;

export async function listPurchases(query?: string): Promise<Purchase[]> {
  const q = query?.trim();
  const path = q
    ? `/purchases?q=${encodeURIComponent(q)}`
    : '/purchases';
  return apiFetch<Purchase[]>(path);
}

export async function getPurchase(id: string): Promise<Purchase> {
  return apiFetch<Purchase>(`/purchases/${encodeURIComponent(id)}`);
}

export interface PurchaseFormInput {
  name: string;
  amount: number;
  store?: string;
  purchaseDate: string;
  warrantyExpiresAt?: string;
  installmentCount: number;
  interestRate?: number;
  interestRatePeriod?: InterestRatePeriod;
  receipts?: File[];
}

export async function createPurchase(
  input: PurchaseFormInput,
): Promise<Purchase> {
  const form = buildPurchaseForm(input);
  return apiUploadForm<Purchase>('/purchases', form);
}

export async function updatePurchase(
  id: string,
  input: Omit<PurchaseFormInput, 'receipts'>,
): Promise<Purchase> {
  return apiFetch<Purchase>(`/purchases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: input.name,
      amount: input.amount,
      store: input.store ?? '',
      purchaseDate: input.purchaseDate,
      warrantyExpiresAt: input.warrantyExpiresAt ?? '',
      installmentCount: input.installmentCount,
      interestRate: input.installmentCount > 1 ? (input.interestRate ?? 0) : '',
      interestRatePeriod:
        input.installmentCount > 1 ? (input.interestRatePeriod ?? 'annual') : '',
    }),
  });
}

export async function addPurchaseReceipts(
  purchaseId: string,
  receipts: File[],
): Promise<Purchase> {
  const form = new FormData();
  for (const file of receipts) {
    form.append('receipts', file);
  }
  return apiUploadForm<Purchase>(
    `/purchases/${encodeURIComponent(purchaseId)}/receipts`,
    form,
  );
}

function buildPurchaseForm(input: PurchaseFormInput): FormData {
  const form = new FormData();
  form.append('name', input.name);
  form.append('amount', String(input.amount));
  if (input.store) form.append('store', input.store);
  form.append('purchaseDate', input.purchaseDate);
  if (input.warrantyExpiresAt) {
    form.append('warrantyExpiresAt', input.warrantyExpiresAt);
  }
  form.append('installmentCount', String(input.installmentCount));
  if (input.installmentCount > 1) {
    form.append('interestRate', String(input.interestRate ?? 0));
    form.append('interestRatePeriod', input.interestRatePeriod ?? 'annual');
  }
  for (const file of input.receipts ?? []) {
    form.append('receipts', file);
  }
  return form;
}

export async function deletePurchase(id: string): Promise<void> {
  await apiFetch(`/purchases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function deletePurchaseReceipt(
  purchaseId: string,
  receiptId: string,
): Promise<void> {
  await apiFetch(
    `/purchases/${encodeURIComponent(purchaseId)}/receipts/${encodeURIComponent(receiptId)}`,
    { method: 'DELETE' },
  );
}

export async function fetchReceiptBlob(
  purchaseId: string,
  receiptId: string,
  download = false,
): Promise<{ blob: Blob; filename?: string }> {
  const suffix = download ? '?download=1' : '';
  return fetchAuthenticatedBlob(
    `/purchases/${encodeURIComponent(purchaseId)}/receipts/${encodeURIComponent(receiptId)}${suffix}`,
  );
}

export function subscribeToPurchases(
  onUpdate: (purchases: Purchase[]) => void,
  onError?: (error: unknown) => void,
  query?: string,
): () => void {
  const tick = () => {
    void listPurchases(query)
      .then(onUpdate)
      .catch((error) => onError?.(error));
  };
  tick();
  const id = window.setInterval(tick, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}

export function interestRateLabel(period: InterestRatePeriod): string {
  return period === 'annual'
    ? 'Annual rate (ribit shnatit)'
    : 'Monthly rate';
}

export function warrantyStatus(
  warrantyExpiresAt?: string,
): 'none' | 'active' | 'expiring' | 'expired' {
  if (!warrantyExpiresAt) return 'none';
  const expires = new Date(warrantyExpiresAt);
  const now = new Date();
  if (expires.getTime() < now.getTime()) return 'expired';
  const daysLeft = (expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 30) return 'expiring';
  return 'active';
}

export function receiptLabel(receipt: PurchaseReceipt, index: number): string {
  return receipt.originalName || `Receipt ${index + 1}`;
}
