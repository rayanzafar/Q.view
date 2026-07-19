// Immutable audit trail. Every write/approve/login/export should call audit().
import { insert } from '../db/index.js';
import { id, nowIso } from '../util/ids.js';

export async function audit(ctx, { action, resource, resourceId, sectorId, detail }) {
  await insert('audit_log', {
    id: id('aud'),
    at: nowIso(),
    user_id: ctx?.user?.id || null,
    username: ctx?.user?.username || null,
    role_id: ctx?.user?.role_id || null,
    action,
    resource: resource || null,
    resource_id: resourceId || null,
    sector_id: sectorId || null,
    detail_json: detail ? JSON.stringify(detail) : null,
    ip: ctx?.ip || null,
  });
}
