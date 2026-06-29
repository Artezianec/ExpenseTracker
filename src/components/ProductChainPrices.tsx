import React from 'react';
import { Trophy } from 'lucide-react';
import type { Product, ProductPrice } from '../types';
import { formatCurrency } from '../utils/format';
import { chainLabel, cheapestPrice } from '../lib/productPricing';

export function ProductChainPrices({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const best = cheapestPrice(product.prices);

  if (!product.prices.length) {
    if (product.minPrice != null) {
      return (
        <p className="text-sm text-emerald-600 font-bold mt-1">
          {formatCurrency(product.minPrice)}
        </p>
      );
    }
    return null;
  }

  if (compact) {
    return (
      <div className="mt-1 space-y-0.5">
        {best && (
          <p className="text-sm text-emerald-600 font-bold">
            from {formatCurrency(best.price)} · {chainLabel(best)}
          </p>
        )}
        {product.prices.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {product.prices.map((pr) => (
              <ChainPriceBadge
                key={`${pr.chainId}-${pr.storeId ?? 'c'}`}
                price={pr}
                isCheapest={best?.chainId === pr.chainId && best.price === pr.price}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {product.prices.map((pr) => {
        const isCheapest =
          best?.chainId === pr.chainId && best.price === pr.price;
        return (
          <div
            key={`${pr.chainId}-${pr.storeId ?? 'c'}`}
            className={`flex justify-between text-xs rounded-lg px-2 py-1 ${
              isCheapest
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold'
                : 'text-zinc-500'
            }`}
          >
            <span className="flex items-center gap-1">
              {isCheapest && <Trophy className="w-3 h-3" />}
              {chainLabel(pr)}
            </span>
            <span>{formatCurrency(pr.price)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChainPriceBadge({
  price,
  isCheapest,
}: {
  price: ProductPrice;
  isCheapest: boolean;
}) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
        isCheapest
          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
          : 'bg-zinc-200/80 dark:bg-white/10 text-zinc-600 dark:text-zinc-400'
      }`}
    >
      {price.chainName} {formatCurrency(price.price)}
    </span>
  );
}
