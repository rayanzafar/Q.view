// Older user-based links resolve to the same employee profile used by the team directory.
import { all } from '../../core/db/index.js';
import { badRequest } from '../../core/http/errors.js';
import { personDossier } from '../pmo/tasks.js';
import { loadReadableResource } from './access.js';

export async function personProfileLink(user, personId, opts = {}) {
  const rows = await all(`SELECT e.id FROM employee e JOIN app_user u
    ON (u.employee_id = e.id OR e.user_id = u.id)
    WHERE u.id = ? AND u.deleted_at IS NULL AND e.deleted_at IS NULL
    ORDER BY e.id`, [String(personId || '')]);
  if (!rows.length) {
    // Preserve the account-only workflow, with its existing per-person permission gate.
    await personDossier(user, personId);
    return null;
  }
  for (const row of rows) await loadReadableResource(user, row.id);
  if (rows.length !== 1) throw badRequest('الحساب مرتبط بأكثر من موظف — صحّح الربط من المستخدمين والصلاحيات');
  const q = new URLSearchParams();
  for (const key of ['year', 'month', 'tab']) {
    if (typeof opts[key] === 'string') q.set(key, opts[key]);
  }
  const suffix = q.toString();
  return `/app/team/resources/${encodeURIComponent(rows[0].id)}${suffix ? '?' + suffix : ''}`;
}
