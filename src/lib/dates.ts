import type { DbTimestamp } from '../types';

export function nowIso(): DbTimestamp {
  return new Date().toISOString();
}

export function toDate(value: DbTimestamp): Date {
  return new Date(value);
}

export function dateToIso(date: Date): DbTimestamp {
  return date.toISOString();
}
