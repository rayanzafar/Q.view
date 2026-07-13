// Build a SQL WHERE fragment that limits rows to the user's data scope for (resource, action).
// Returns { clause, params }. Applied to list queries so scoping is enforced in the DB, not the app.
import { effectiveScope } from './index.js';

export function scopeFilter(user, resource, action = 'read', opts = {}) {
  const scope = effectiveScope(user, action, resource);
  const sectorCol = opts.sectorCol || 'sector_id';
  const ownerCol = opts.ownerCol || 'owner_user_id';
  if (!scope) return { clause: '1=0', params: [] }; // no permission → no rows
  switch (scope) {
    case 'company':
      return { clause: '1=1', params: [] };
    case 'sector':
      return { clause: `${sectorCol} = ?`, params: [user.sector_id] };
    case 'department':
      // KNOWN LIMITATION: operational tables (project/task/…) carry no department_id yet, so a
      // department grant currently resolves to the whole sector. This fails OPEN (broader read,
      // never a crash). Tightening requires adding department linkage to those tables — tracked
      // in docs/OPEN-DECISIONS.md. Callers may pass opts.deptCol to refine once the column exists.
      return opts.deptCol && user.department_id
        ? { clause: `${opts.deptCol} = ?`, params: [user.department_id] }
        : { clause: `${sectorCol} = ?`, params: [user.sector_id] };
    case 'project': {
      const ids = [...(user.projectIds || [])];
      if (!ids.length) return { clause: '1=0', params: [] };
      // The project table itself keys on `id`; child tables (task/deliverable/…) key on `project_id`.
      const col = opts.projectCol || (resource === 'project' ? 'id' : 'project_id');
      return { clause: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
    }
    case 'team':
    case 'own':
      return { clause: `${ownerCol} = ?`, params: [user.id] };
    default:
      return { clause: '1=0', params: [] };
  }
}
