// DEV ONLY: back up then rebuild the DB from scratch (schema + rbac + legacy + seed).
// Refuses to run in production.
import { config } from '../src/core/config.js';
import { rmSync } from 'node:fs';

if (config.env === 'production') { console.error('reset is disabled in production'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
try { const { backup } = await import('./backup.js'); backup(stamp); } catch { /* no existing db */ }
for (const suf of ['', '-wal', '-shm']) rmSync(config.dbFile + suf, { force: true });

const { migrate } = await import('./migrate.js'); migrate();
const { seedRbac } = await import('./seed-rbac.js'); seedRbac();
const { migrateLegacy } = await import('./migrate-legacy.js'); migrateLegacy();
const { seed } = await import('./seed.js'); seed();
console.log('✓ reset complete');
