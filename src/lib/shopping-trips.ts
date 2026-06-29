import type { ReceiptParseDraft, ShoppingTrip, ShoppingTripItem } from '../types';
import { apiFetch, apiUploadForm } from './api';

export async function fetchShoppingTrips(groupId?: string): Promise<ShoppingTrip[]> {
  const params = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
  return apiFetch(`/shopping-trips${params}`);
}

export async function createShoppingTrip(body: {
  groupId?: string;
  storeName?: string;
  chainId?: string;
  tripDate?: string;
  source?: 'scan' | 'receipt' | 'manual';
  totalAmount?: number;
  items: ShoppingTripItem[];
}): Promise<ShoppingTrip> {
  return apiFetch('/shopping-trips', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function parseReceipt(file: File): Promise<ReceiptParseDraft> {
  const form = new FormData();
  form.append('receipt', file);
  return apiUploadForm('/shopping-trips/parse-receipt', form);
}

export async function deleteShoppingTrip(tripId: string): Promise<void> {
  await apiFetch(`/shopping-trips/${tripId}`, { method: 'DELETE' });
}

export function subscribeToShoppingTrips(
  onData: (trips: ShoppingTrip[]) => void,
  onError: (err: Error) => void,
  groupId?: string,
  intervalMs = 8000,
) {
  let active = true;
  const load = async () => {
    try {
      const data = await fetchShoppingTrips(groupId);
      if (active) onData(data);
    } catch (e) {
      if (active) onError(e instanceof Error ? e : new Error(String(e)));
    }
  };
  load();
  const id = window.setInterval(load, intervalMs);
  return () => {
    active = false;
    window.clearInterval(id);
  };
}
