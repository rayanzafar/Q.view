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
      return { clause: `${sectorCol} = ?`, params: [user.sector_id] }; // dept refinement in-handler
    case 'project': {
      const ids = [...(user.projectIds || [])];
      if (!ids.length) return { clause: '1=0', params: [] };
      return { clause: `${opts.projectCol || 'project_id'} IN (${ids.map(() => '?').join(',')})`, params: ids };
    }
    case 'team':
    case 'own':
      return { clause: `${ownerCol} = ?`, params: [user.id] };
    default:
      return { clause: '1=0', params: [] };
  }
}
