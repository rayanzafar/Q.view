// Idempotent, crash-proof staging bootstrap. Loads legacy business data (sanitized demo snapshot
// when the sensitive one is absent) + demo accounts on the FIRST boot only. NEVER throws: if data
// files are missing or a load fails, it logs and still seeds demo accounts so the server can start.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from '../src/core/db/index.js';
import { ROOT } from '../src/core/config.js';

function hasData() {
  try { return (get('SELECT COUNT(*) n FROM project WHERE deleted_at IS NULL')?.n || 0) > 0; }
  catch { return false; }
}
const dataFile =
  existsSync(resolve(ROOT, 'seed/legacy-state.snapshot.json')) ? 'snapshot' :
  existsSync(resolve(ROOT, 'seed/legacy-state.demo.json')) ? 'demo' : null;

console.log(`▶ staging bootstrap — hasData=${hasData()} dataFile=${dataFile || 'NONE'}`);

if (hasData()) {
  console.log('✓ staging: business data already present — skipping load (volume persisted)');
} else {
  if (dataFile) {
    try {
      const { migrateLegacy } = await import('./migrate-legacy.js');
      migrateLegacy();
      console.log(`✓ staging: business data loaded from ${dataFile}`);
    } catch (e) {
      console.error('⚠ staging: legacy data load failed —', e.message);
    }
  } else {
    console.log('⚠ staging: no data snapshot in image — seeding demo accounts only');
  }
  try {
    const { seed } = await import('./seed.js');
    seed();
    console.log('✓ staging: demo accounts + persona pipelines seeded');
  } catch (e) {
    console.error('⚠ staging: demo seed failed —', e.message);
  }
}
console.log('▶ staging bootstrap done — starting server');
