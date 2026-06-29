import React, { useMemo } from 'react';
import { ShoppingBag, Trophy } from 'lucide-react';
import type { FavoriteProduct } from '../types';
import { formatCurrency } from '../utils/format';
import {
  basketTotalsByChain,
  buildFavoriteCompareRows,
  collectChainNames,
} from '../lib/productPricing';

export default function FavoritesPriceCompare({
  favorites,
}: {
  favorites: FavoriteProduct[];
}) {
  const chainNames = useMemo(
    () => collectChainNames(favorites),
    [favorites],
  );
  const rows = useMemo(
    () => buildFavoriteCompareRows(favorites, chainNames),
    [favorites, chainNames],
  );
  const basketTotals = useMemo(
    () => basketTotalsByChain(favorites, chainNames),
    [favorites, chainNames],
  );

  if (favorites.length === 0 || chainNames.length === 0) return null;

  const bestBasket = basketTotals[0];

  return (
    <div className="space-y-4 p-3 sm:p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
      <div className="flex items-start gap-2">
        <ShoppingBag className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="font-bold text-zinc-900 dark:text-white text-sm sm:text-base">
            Price comparison by chain
          </h3>
          {bestBasket && bestBasket.missing === 0 && (
            <p className="text-xs sm:text-sm text-indigo-600 dark:text-indigo-400 mt-0.5">
              Full favorites basket is cheapest at{' '}
              <strong>{bestBasket.chainName}</strong> —{' '}
              {formatCurrency(bestBasket.total)}
            </p>
          )}
          {bestBasket && bestBasket.missing > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5">
              Not every item is available at all chains — see table below
            </p>
          )}
        </div>
      </div>

      {basketTotals.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {basketTotals.map((b, i) => (
            <div
              key={b.chainName}
              className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold ${
                i === 0 && b.missing === 0
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {i === 0 && b.missing === 0 && (
                <Trophy className="w-3 h-3 inline mr-1 -mt-0.5" />
              )}
              {b.chainName}: {formatCurrency(b.total)}
              {b.missing > 0 ? ` (${b.missing} missing)` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto -mx-1 pb-1">
        <table className="w-full text-[11px] sm:text-xs border-collapse min-w-[280px]">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-white/10">
              <th className="py-2 pr-2 font-bold sticky left-0 bg-indigo-500/5 dark:bg-zinc-900/95 z-10">
                Product
              </th>
              {chainNames.map((name) => (
                <th key={name} className="py-2 px-2 font-bold whitespace-nowrap">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.barcode}
                className="border-b border-zinc-100 dark:border-white/5"
              >
                <td className="py-2 pr-2 font-medium text-zinc-800 dark:text-zinc-200 max-w-[100px] sm:max-w-[140px] truncate sticky left-0 bg-indigo-500/5 dark:bg-zinc-900/95 z-10">
                  {row.label}
                </td>
                {chainNames.map((name) => {
                  const pr = row.pricesByChain.get(name);
                  const isCheapest =
                    pr &&
                    row.cheapest &&
                    pr.chainId === row.cheapest.chainId &&
                    pr.price === row.cheapest.price;
                  return (
                    <td key={name} className="py-2 px-2 whitespace-nowrap">
                      {pr ? (
                        <span
                          className={
                            isCheapest
                              ? 'font-black text-emerald-600'
                              : 'text-zinc-600 dark:text-zinc-400'
                          }
                        >
                          {formatCurrency(pr.price)}
                        </span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-600">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
