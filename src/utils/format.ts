const LOCALE = 'he-IL';

export const CURRENCY_SYMBOL = '₪';

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/** DD/MM/YYYY — e.g. 29/06/2026 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatMonthShort(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(date);
}

export function formatMonthYearFromParts(month: number, year: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
}

export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(
    new Date(2024, i, 1),
  ),
}));

export function yearOptions(count = 5): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: count * 2 + 1 }, (_, i) => current - count + i);
}
