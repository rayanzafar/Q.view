// Password hashing via scrypt (built-in node:crypto) — no native dependency.
// Format: scrypt$N$saltHex$hashHex. (ADR-0001: bcrypt cost 12 is the documented
// production target; scrypt with strong params is used here to avoid native builds.)
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 32;

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plain), salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, nStr, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(plain), salt, expected.length, { N: Number(nStr), r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Strong random temp password (admin-generated).
export function genTempPassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}
