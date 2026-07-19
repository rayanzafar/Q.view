// Seed roles + role_permission grants from the canonical matrix. Idempotent.
import { run, get, exec } from '../src/core/db/index.js';
import { ROLE_GRANTS, ROLE_LABELS } from '../src/core/rbac/matrix.js';
import { nowIso } from '../src/core/util/ids.js';

export async function seedRbac() {
  for (const [roleId, grants] of Object.entries(ROLE_GRANTS)) {
    const label = ROLE_LABELS[roleId] || { ar: roleId, en: roleId };
    if (!await get('SELECT id FROM role WHERE id = ?', [roleId])) {
      await run('INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES (?,?,?,1,?)',
        [roleId, label.ar, label.en, nowIso()]);
    }
    // reset grants for system roles to match canonical matrix (admin edits go on custom roles)
    await run('DELETE FROM role_permission WHERE role_id = ?', [roleId]);
    for (const g of grants) {
      await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
        [roleId, g.resource, g.action, g.scope]);
    }
  }
  console.log('✓ RBAC roles + grants seeded');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { close } = await import('../src/core/db/index.js');
  seedRbac().then(() => close()).catch((e) => { console.error('seed-rbac failed:', e); process.exit(1); });
}
