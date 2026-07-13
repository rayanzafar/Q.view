// CRM — Opportunities service. Scope-filtered lists, redacted reads, audited writes,
// stage-history tracking, and Go/No-Go via the workflow engine.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

export function listOpportunities(user, filters = {}) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const where = [f.clause];
  const params = [...f.params];
  where.push('deleted_at IS NULL');
  if (filters.stage) { where.push('stage_id = ?'); params.push(filters.stage); }
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  const rows = all(
    `SELECT * FROM opportunity WHERE ${where.join(' AND ')} ORDER BY value_halalas DESC LIMIT 500`, params);
  return redactList(user, 'opportunity', rows);
}

export function getOpportunity(user, oppId) {
  const row = get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'read', 'opportunity', row)) throw forbidden();
  return redact(user, 'opportunity', row);
}

export function createOpportunity(ctx, data) {
  const user = ctx.user;
  if (!can(user, 'create', 'opportunity')) throw forbidden();
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'opportunity', { sector_id: sectorId })) throw forbidden('خارج نطاق قطاعك');
  if (!data.title_ar) throw badRequest('عنوان الفرصة مطلوب');
  const oid = id('opp');
  const now = nowIso();
  insert('opportunity', {
    id: oid, code: data.code || null, title_ar: data.title_ar,
    client_id: data.client_id || null, sector_id: sectorId,
    owner_user_id: data.owner_user_id || user.id, stage_id: data.stage_id || 'LEAD',
    win_pct: data.win_pct ?? null, value_halalas: toHalalas(data.value_sar),
    priority: data.priority || null, year: data.year || new Date().getUTCFullYear(),
    source: data.source || 'manual', next_action: data.next_action || null, notes: data.notes || null,
    exclude_from_sales: data.exclude_from_sales ? 1 : 0, stage_changed_at: now,
    created_at: now, created_by: user.id,
  });
  audit(ctx, { action: 'create', resource: 'opportunity', resourceId: oid, sectorId });
  return getOpportunity(user, oid);
}

export function updateOpportunity(ctx, oppId, data) {
  const user = ctx.user;
  const row = get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const patch = {};
  for (const k of ['title_ar', 'client_id', 'priority', 'next_action', 'notes', 'win_pct']) {
    if (k in data) patch[k] = data[k];
  }
  if ('value_sar' in data) patch.value_halalas = toHalalas(data.value_sar);
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  update('opportunity', oppId, patch);
  audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: row.sector_id, detail: patch });
  return getOpportunity(user, oppId);
}

export function moveStage(ctx, oppId, toStage, note) {
  const user = ctx.user;
  const row = get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const stage = get('SELECT * FROM stage WHERE id = ?', [toStage]);
  if (!stage) throw badRequest('مرحلة غير معروفة');
  const now = nowIso();
  update('opportunity', oppId, {
    stage_id: toStage, win_pct: stage.default_win_pct, stage_changed_at: now, updated_at: now, updated_by: user.id,
  });
  insert('opportunity_stage_history', {
    id: id('osh'), opportunity_id: oppId, from_stage_id: row.stage_id, to_stage_id: toStage,
    changed_by: user.id, changed_at: now, note: note || null,
  });
  audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: row.sector_id,
    detail: { stage: `${row.stage_id}→${toStage}` } });
  return getOpportunity(user, oppId);
}

// Rich detail for the opportunity drawer: names + stage history + the stage ladder.
export function opportunityDetail(user, oppId) {
  const opp = getOpportunity(user, oppId); // scope + redact + notFound/forbidden
  const client = opp.client_id ? (get('SELECT name_ar FROM client WHERE id=?', [opp.client_id])?.name_ar || null) : null;
  const ownerRow = opp.owner_user_id ? get('SELECT name_ar, username FROM app_user WHERE id=?', [opp.owner_user_id]) : null;
  const history = all(`SELECT h.to_stage_id, h.from_stage_id, h.changed_at, h.note, u.name_ar owner_name, u.username
     FROM opportunity_stage_history h LEFT JOIN app_user u ON u.id=h.changed_by
     WHERE h.opportunity_id=? ORDER BY h.changed_at DESC LIMIT 25`, [oppId]);
  const stages = all('SELECT id, name_ar, color FROM stage ORDER BY sort_order');
  const canEdit = can(user, 'update', 'opportunity', opp);
  return { opp, client, owner: ownerRow ? (ownerRow.name_ar || ownerRow.username) : null, history, stages, canEdit };
}

// Pipeline aggregation for dashboards (respects scope).
export function pipelineSummary(user) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const rows = all(
    `SELECT stage_id, COUNT(*) n, COALESCE(SUM(value_halalas),0) val
     FROM opportunity WHERE ${f.clause} AND deleted_at IS NULL GROUP BY stage_id`, f.params);
  const stages = all('SELECT * FROM stage ORDER BY sort_order');
  const byStage = Object.fromEntries(rows.map((r) => [r.stage_id, r]));
  return stages.map((s) => ({
    stage: s.id, name_ar: s.name_ar, color: s.color,
    count: byStage[s.id]?.n || 0, value_halalas: byStage[s.id]?.val || 0,
  }));
}
