import type { FavoriteProduct, Product, ProductPrice } from '../types';

export function cheapestPrice(prices: ProductPrice[]): ProductPrice | null {
  if (!prices.length) return null;
  return prices.reduce((best, p) => (p.price < best.price ? p : best));
}

export function chainLabel(price: ProductPrice): string {
  if (price.storeName) return `${price.chainName} · ${price.storeName}`;
  return price.chainName;
}

export function minPriceSummary(product: Product): string | null {
  const best = cheapestPrice(product.prices);
  if (!best) return product.minPrice != null ? String(product.minPrice) : null;
  return `${best.price}`;
}

export function collectChainNames(favorites: FavoriteProduct[]): string[] {
  const names = new Set<string>();
  for (const f of favorites) {
    for (const p of f.product.prices) {
      names.add(p.chainName);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'he'));
}

export function priceAtChain(
  product: Product,
  chainName: string,
): ProductPrice | undefined {
  return product.prices.find((p) => p.chainName === chainName);
}

export interface FavoriteCompareRow {
  barcode: string;
  label: string;
  pricesByChain: Map<string, ProductPrice>;
  cheapest: ProductPrice | null;
}

export function buildFavoriteCompareRows(
  favorites: FavoriteProduct[],
  chainNames: string[],
): FavoriteCompareRow[] {
  return favorites.map((f) => {
    const pricesByChain = new Map<string, ProductPrice>();
    for (const name of chainNames) {
      const p = priceAtChain(f.product, name);
      if (p) pricesByChain.set(name, p);
    }
    return {
      barcode: f.barcode,
      label: f.nickname ?? f.product.nameHe,
      pricesByChain,
      cheapest: cheapestPrice(f.product.prices),
    };
  });
}

/** Per-chain totals if user buys all favorites at one store. */
export function basketTotalsByChain(
  favorites: FavoriteProduct[],
  chainNames: string[],
): { chainName: string; total: number; missing: number }[] {
  return chainNames.map((chainName) => {
    let total = 0;
    let missing = 0;
    for (const f of favorites) {
      const p = priceAtChain(f.product, chainName);
      if (p) total += p.price;
      else missing += 1;
    }
    return {
      chainName,
      total: Math.round(total * 100) / 100,
      missing,
    };
  }).sort((a, b) => a.total - b.total);
}
