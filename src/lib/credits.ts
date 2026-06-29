import type { Credit, InterestRatePeriod } from '../types';
import { apiFetch } from './api';

const POLL_INTERVAL_MS = 5000;

export interface CreditFormInput {
  name: string;
  lender?: string;
  principal: number;
  interestRate: number;
  interestRatePeriod: InterestRatePeriod;
  termMonths: number;
  paymentDay: number;
  startDate: string;
}

export async function listCredits(): Promise<Credit[]> {
  return apiFetch<Credit[]>('/credits');
}

export async function getCredit(id: string): Promise<Credit> {
  return apiFetch<Credit>(`/credits/${encodeURIComponent(id)}`);
}

export async function createCredit(input: CreditFormInput): Promise<Credit> {
  return apiFetch<Credit>('/credits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCredit(
  id: string,
  input: CreditFormInput,
): Promise<Credit> {
  return apiFetch<Credit>(`/credits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteCredit(id: string): Promise<void> {
  await apiFetch(`/credits/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function subscribeToCredits(
  onUpdate: (credits: Credit[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const tick = () => {
    void listCredits()
      .then(onUpdate)
      .catch((error) => onError?.(error));
  };
  tick();
  const id = window.setInterval(tick, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}

export { interestRateLabel } from './purchases';
