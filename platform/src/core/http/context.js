// Per-request context: resolves the session → user with scope sets used by RBAC.
import { get, all } from '../db/index.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from './errors.js';
import { can } from '../rbac/index.js';
import { nowIso } from '../util/ids.js';

export async function resolveUser(sessionId) {
  if (!sessionId) return null;
  const s = await get('SELECT * FROM session WHERE id = ? AND revoked_at IS NULL', [sessionId]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = await get('SELECT * FROM app_user WHERE id = ? AND active = 1 AND deleted_at IS NULL', [s.user_id]);
  if (!u) return null;
  // project scope: projects the user owns or is a member of (via employee membership)
  const projectIds = new Set((await all('SELECT id FROM project WHERE owner_user_id = ?', [u.id])).map((r) => r.id));
  if (u.employee_id) {
    for (const m of await all(
      "SELECT group_id FROM membership WHERE employee_id = ? AND group_kind = 'project' AND deleted_at IS NULL",
      [u.employee_id]
    )) projectIds.add(m.group_id);
  }
  // department_id lives on `employee`, not `app_user` (which has no such column) — resolve it via
  // the employee link so department-scoped grants (e.g. department_manager) are checkable at all;
  // previously always null here, which made scopeReaches()'s 'department' case vacuously true.
  const emp = u.employee_id ? await get('SELECT department_id FROM employee WHERE id = ?', [u.employee_id]) : null;
  return {
    id: u.id,
    username: u.username,
    role_id: u.role_id,
    sector_id: u.sector_id,
    department_id: emp?.department_id || null,
    scope: u.scope,
    employee_id: u.employee_id,
    name_ar: u.name_ar,
    name_en: u.name_en,
    projectIds,
    teamIds: new Set(),
  };
}

// Express middleware factories
export function attachContext() {
  return async (req, res, next) => {
    try {
      const sid = req.cookies?.[config.sessionCookie];
      req.ctx = { user: await resolveUser(sid), ip: req.ip, sessionId: sid };
      next();
    } catch (e) { next(e); }
  };
}

export function requireAuth() {
  return (req, res, next) => {
    if (!req.ctx?.user) return next(unauthorized());
    next();
  };
}

// Guard a route by (resource, action). Row-level scope is enforced inside handlers
// via can(user, action, resource, targetRow) when a specific record is touched.
export function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.ctx?.user) return next(unauthorized());
    if (!can(req.ctx.user, action, resource)) return next(forbidden());
    next();
  };
}
