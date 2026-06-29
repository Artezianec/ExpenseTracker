import type { Insurance, InsuranceContract, InsuranceSubjectType } from '../types';
import { apiFetch, apiUploadForm, fetchAuthenticatedBlob } from './api';
import { POLL_INTERVAL_MS } from './budgetDb';

export interface InsuranceFormInput {
  name?: string;
  company: string;
  monthlyAmount: number;
  subjectType: InsuranceSubjectType;
  subjectUserId?: string;
  subjectPurchaseId?: string;
  subjectLabel?: string;
  paymentDay: number;
  startDate: string;
  endDate?: string;
}

export async function listInsurances(): Promise<Insurance[]> {
  return apiFetch<Insurance[]>('/insurances');
}

export async function getInsurance(id: string): Promise<Insurance> {
  return apiFetch<Insurance>(`/insurances/${encodeURIComponent(id)}`);
}

export async function createInsurance(
  input: InsuranceFormInput,
): Promise<Insurance> {
  return apiFetch<Insurance>('/insurances', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateInsurance(
  id: string,
  input: InsuranceFormInput,
): Promise<Insurance> {
  return apiFetch<Insurance>(`/insurances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteInsurance(id: string): Promise<void> {
  await apiFetch(`/insurances/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function addInsuranceContracts(
  insuranceId: string,
  contracts: File[],
): Promise<Insurance> {
  const form = new FormData();
  for (const file of contracts) {
    form.append('contracts', file);
  }
  return apiUploadForm<Insurance>(
    `/insurances/${encodeURIComponent(insuranceId)}/contracts`,
    form,
  );
}

export async function deleteInsuranceContract(
  insuranceId: string,
  contractId: string,
): Promise<void> {
  await apiFetch(
    `/insurances/${encodeURIComponent(insuranceId)}/contracts/${encodeURIComponent(contractId)}`,
    { method: 'DELETE' },
  );
}

export async function fetchContractBlob(
  insuranceId: string,
  contractId: string,
  download = false,
): Promise<{ blob: Blob; filename?: string }> {
  const suffix = download ? '?download=1' : '';
  return fetchAuthenticatedBlob(
    `/insurances/${encodeURIComponent(insuranceId)}/contracts/${encodeURIComponent(contractId)}${suffix}`,
  );
}

export function subscribeToInsurances(
  onUpdate: (items: Insurance[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  let lastSnapshot: string | null = null;
  const tick = () => {
    void listInsurances()
      .then((items) => {
        const snapshot = JSON.stringify(items);
        if (snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
        onUpdate(items);
      })
      .catch((error) => onError?.(error));
  };
  tick();
  const id = window.setInterval(tick, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}

export function contractLabel(
  contract: InsuranceContract,
  index: number,
): string {
  return contract.originalName || `Contract ${index + 1}`;
}

export function subjectTypeLabel(type: InsuranceSubjectType): string {
  if (type === 'person') return 'Person';
  if (type === 'purchase') return 'Product';
  return 'Other';
}
