import { randomBytes } from 'node:crypto';

// Prefixed, sortable-ish unique id. Not a UUID but collision-safe for this scale.
export function id(prefix) {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

// Money helpers: SAR <-> halalas (integer minor units).
export const toHalalas = (sar) => Math.round(Number(sar || 0) * 100);
export const toSar = (halalas) => Math.round(Number(halalas || 0)) / 100;
export const fmtSar = (halalas, locale = 'ar-SA') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(toSar(halalas));
