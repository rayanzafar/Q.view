// DEV ONLY: back up then rebuild the DB from scratch (schema + rbac + legacy + seed).
// Refuses to run in production.
import { config } from '../src/core/config.js';
import { rmSync } from 'node:fs';

if (config.env === 'production') { console.error('reset is disabled in production'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
try { const { backup } = await import('./backup.js'); backup(stamp); } catch { /* no existing db */ }
for (const suf of ['', '-wal', '-shm']) rmSync(config.dbFile + suf, { force: true });

const { migrate } = await import('./migrate.js'); await migrate();
const { seedRbac } = await import('./seed-rbac.js'); await seedRbac();
const { migrateLegacy } = await import('./migrate-legacy.js'); await migrateLegacy();
const { deriveFinance } = await import('./derive-finance.js'); await deriveFinance();
const { seed } = await import('./seed.js'); await seed();
// صيانة بيانات العملاء: دمج المكررين من اللقطة القديمة + تصنيف الأنواع (idempotent)
const { dedupe, classify } = await import('./unify-clients.js'); await dedupe(); await classify();
console.log('✓ reset complete');
