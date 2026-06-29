import type { FavoriteProduct, Product } from '../types';
import { apiFetch } from './api';

export async function searchProducts(q: string): Promise<Product[]> {
  const params = new URLSearchParams({ q });
  return apiFetch(`/products/search?${params}`);
}

export async function lookupProduct(barcode: string): Promise<Product> {
  const params = new URLSearchParams({ barcode });
  return apiFetch(`/products/lookup?${params}`);
}

export async function fetchFavorites(): Promise<FavoriteProduct[]> {
  return apiFetch('/products/favorites');
}

export async function addFavorite(
  barcode: string,
  nickname?: string,
): Promise<{ barcode: string; nickname?: string; createdAt: string }> {
  return apiFetch(`/products/favorites/${encodeURIComponent(barcode)}`, {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

export async function removeFavorite(barcode: string): Promise<void> {
  await apiFetch(`/products/favorites/${encodeURIComponent(barcode)}`, {
    method: 'DELETE',
  });
}

export async function fetchPriceSyncStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  lastSuccessAt: string | null;
  productCount: number;
  priceCount: number;
}> {
  return apiFetch('/products/sync-status');
}

export function subscribeToFavorites(
  onData: (items: FavoriteProduct[]) => void,
  onError: (err: Error) => void,
  intervalMs = 15000,
) {
  let active = true;
  const load = async () => {
    try {
      const data = await fetchFavorites();
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
