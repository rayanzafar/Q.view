// Idempotent staging bootstrap. On the FIRST boot (empty DB) it loads the legacy business data
// (from the sanitized demo snapshot when the sensitive one is absent) plus the demo accounts.
// On later redeploys it detects existing data and skips, so a persistent volume preserves state.
import { get } from '../src/core/db/index.js';

function hasData() {
  try { return (get('SELECT COUNT(*) n FROM project WHERE deleted_at IS NULL')?.n || 0) > 0; }
  catch { return false; }
}

if (hasData()) {
  console.log('✓ staging: business data already present — skipping load (volume persisted)');
} else {
  console.log('▶ staging: empty DB — loading business data + demo accounts…');
  const { migrateLegacy } = await import('./migrate-legacy.js');
  const { seed } = await import('./seed.js');
  migrateLegacy();
  seed();
  console.log('✓ staging: seeded (business data + demo accounts + persona pipelines)');
}
