// Per-request context: resolves the session → user with scope sets used by RBAC.
import { get, all } from '../db/index.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from './errors.js';
import { can } from '../rbac/index.js';
import { nowIso } from '../util/ids.js';

export function resolveUser(sessionId) {
  if (!sessionId) return null;
  const s = get('SELECT * FROM session WHERE id = ? AND revoked_at IS NULL', [sessionId]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = get('SELECT * FROM app_user WHERE id = ? AND active = 1 AND deleted_at IS NULL', [s.user_id]);
  if (!u) return null;
  // project scope: projects the user owns or is a member of (via employee membership)
  const projectIds = new Set(all('SELECT id FROM project WHERE owner_user_id = ?', [u.id]).map((r) => r.id));
  if (u.employee_id) {
    for (const m of all(
      "SELECT group_id FROM membership WHERE employee_id = ? AND group_kind = 'project' AND deleted_at IS NULL",
      [u.employee_id]
    )) projectIds.add(m.group_id);
  }
  return {
    id: u.id,
    username: u.username,
    role_id: u.role_id,
    sector_id: u.sector_id,
    department_id: u.department_id || null,
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
  return (req, res, next) => {
    const sid = req.cookies?.[config.sessionCookie];
    req.ctx = { user: resolveUser(sid), ip: req.ip, sessionId: sid };
    next();
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
