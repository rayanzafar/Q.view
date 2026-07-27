// CRM — Opportunities service. Scope-filtered lists, redacted reads, audited writes,
// stage-history tracking, and Go/No-Go via the workflow engine.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { can, redact, redactList } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { isSupportUnit } from '../../core/org/kind.js';
import { getTeam } from './oppteam.js';

// Stage-rot thresholds (benchmarks §1 — Pipedrive rotting): an OPEN opportunity sitting in a stage
// longer than its threshold (days) is flagged متوقفة. Stages absent from the map (won/lost/on-hold)
// never rot. Exported so views and tests share one source of truth.
export const ROT_THRESHOLDS = { LEAD: 14, QUALIFIED: 14, PROPOSAL: 21, NEGOTIATION: 30 };

// Whole days spent in the current stage, measured from stage_changed_at (fallback: created_at)
// to `today` (a bound YYYY-MM-DD string — never SQL date functions; portable + deterministic).
export function stageAgeDays(row, today) {
  const ref = String(row.stage_changed_at || row.created_at || '').slice(0, 10);
  const t = Date.parse(String(today).slice(0, 10) + 'T00:00:00Z');
  const r = Date.parse(ref + 'T00:00:00Z');
  if (!Number.isFinite(t) || !Number.isFinite(r)) return null;
  return Math.max(0, Math.floor((t - r) / 86400000));
}

// Attach the pipeline-discipline flags to a raw opportunity row (pure; today = 'YYYY-MM-DD').
function withDiscipline(row, today) {
  const age = stageAgeDays(row, today);
  const th = ROT_THRESHOLDS[row.stage_id];
  return {
    ...row,
    stage_age_days: age,
    rot: !!(th && age != null && age > th),
    no_next_action: !(row.next_action && String(row.next_action).trim()),
  };
}

// opts.today ('YYYY-MM-DD') pins the stage-age clock for deterministic tests; defaults to now.
export async function listOpportunities(user, filters = {}, opts = {}) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const where = [f.clause];
  const params = [...f.params];
  where.push('deleted_at IS NULL');
  if (filters.stage) { where.push('stage_id = ?'); params.push(filters.stage); }
  if (filters.sector) { where.push('sector_id = ?'); params.push(filters.sector); }
  const rows = await all(
    `SELECT * FROM opportunity WHERE ${where.join(' AND ')} ORDER BY value_halalas DESC LIMIT 500`, params);
  const today = String(opts.today || nowIso().slice(0, 10)).slice(0, 10);
  return redactList(user, 'opportunity', rows).map((r) => withDiscipline(r, today));
}

export async function getOpportunity(user, oppId) {
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'read', 'opportunity', row)) throw forbidden();
  return redact(user, 'opportunity', row);
}

export async function createOpportunity(ctx, data) {
  const user = ctx.user;
  if (!can(user, 'create', 'opportunity')) throw forbidden();
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'opportunity', { sector_id: sectorId })) throw forbidden('خارج نطاق قطاعك');
  if (!data.title_ar) throw badRequest('عنوان الفرصة مطلوب');
  // نفس حارس النقل، على باب الإنشاء: الفرصة تُنسب إلى قطاع تسليم لا إلى وحدة مساندة. الباب هنا
  // أخطر من باب النقل لأنه يُفتح ضمناً — القطاع الافتراضي هو قطاع المنشئ، فعضو «الخدمات المشتركة»
  // أو رئيس تطوير الأعمال يُنشئ فرصةً فتُولَد خارج كل مقارنة بلا أن يطلب ذلك أحد ولا أن يظهر خطأ.
  // إغلاق باب النقل وحده يترك المال يتسرّب من الباب الآخر.
  const sec = sectorId ? await get('SELECT id, name_ar, kind FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]) : null;
  if (!sec) throw badRequest('حدّد القطاع المسؤول عن الفرصة');
  if (isSupportUnit(sec))
    throw badRequest(`«${sec.name_ar}» وحدة مساندة على مستوى الشركة وليست قطاع تسليم — الفرصة تُنسب إلى قطاع تسليم. اختر قطاعاً من القائمة.`);
  const oid = id('opp');
  const now = nowIso();
  await insert('opportunity', {
    id: oid, code: data.code || null, title_ar: data.title_ar,
    client_id: data.client_id || null, sector_id: sectorId,
    owner_user_id: data.owner_user_id || user.id, stage_id: data.stage_id || 'LEAD',
    win_pct: data.win_pct ?? null, value_halalas: toHalalas(data.value_sar),
    priority: data.priority || null, year: data.year || new Date().getUTCFullYear(),
    source: data.source || 'manual', next_action: data.next_action || null, notes: data.notes || null,
    exclude_from_sales: data.exclude_from_sales ? 1 : 0, stage_changed_at: now,
    created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'opportunity', resourceId: oid, sectorId });
  return await getOpportunity(user, oid);
}

export async function updateOpportunity(ctx, oppId, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const patch = {};
  for (const k of ['title_ar', 'client_id', 'priority', 'next_action', 'notes', 'win_pct']) {
    if (k in data) patch[k] = data[k];
  }
  if ('value_sar' in data) patch.value_halalas = toHalalas(data.value_sar);
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('opportunity', oppId, patch);
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: row.sector_id, detail: patch });
  return await getOpportunity(user, oppId);
}

// نقل الفرصة من قطاع إلى قطاع — يتطلب صلاحية تعديل الفرصة في قطاعها الحالي وصلاحية الإنشاء
// في القطاع الهدف (إعادة إسناد فعلية). يُدقَّق ويُسجَّل في سجل المراحل بملاحظة النقل.
export async function moveSector(ctx, oppId, toSectorId, note) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const target = await get('SELECT id, name_ar, kind FROM sector WHERE id = ? AND active = 1 AND deleted_at IS NULL', [toSectorId]);
  if (!target) throw badRequest('قطاع غير معروف');
  // الوجهة قطاع تسليم لا وحدة مساندة. الواجهة لا تعرض وحدات المساندة في قائمة النقل، والقرار
  // يُحسم هنا أيضاً لا في الشاشة وحدها: الفرصة المنقولة إلى وحدة مساندة تخرج فوراً من مقارنة
  // القطاعات ومن مستهدف المبيعات ومن تغطية خط الفرص — تختفي من شاشات المالك بلا رسالة تقول لماذا.
  if (isSupportUnit(target))
    throw badRequest(`«${target.name_ar}» وحدة مساندة على مستوى الشركة وليست قطاع تسليم — الفرص تُنقل بين قطاعات التسليم فقط. اختر قطاعاً من القائمة.`);
  if (String(row.sector_id) === String(toSectorId)) return await getOpportunity(user, oppId);
  // صلاحية النقل = صلاحية تعديل الفرصة في قطاعها الحالي (فُحصت أعلاه): من يديرها يحق له إعادة
  // إسنادها (تسليمها لقطاع آخر) — والفرصة تخرج من نطاقه بعد النقل. النطاق الشركي ينقل أي فرصة.
  const now = nowIso();
  await update('opportunity', oppId, { sector_id: toSectorId, updated_at: now, updated_by: user.id });
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: toSectorId,
    detail: { moveSector: `${row.sector_id || '—'}→${toSectorId}`, note: note || null } });
  // لا نعيد القراءة عبر getOpportunity: قد تخرج الفرصة من نطاق الناقل بعد النقل فيُرفض قراءته إياها.
  return { ok: true, id: oppId, sector_id: toSectorId, sector_name: target.name_ar, movedFrom: row.sector_id };
}

export async function moveStage(ctx, oppId, toStage, note) {
  const user = ctx.user;
  const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [oppId]);
  if (!row) throw notFound('الفرصة غير موجودة');
  if (!can(user, 'update', 'opportunity', row)) throw forbidden();
  const stage = await get('SELECT * FROM stage WHERE id = ?', [toStage]);
  if (!stage) throw badRequest('مرحلة غير معروفة');
  const now = nowIso();
  await update('opportunity', oppId, {
    stage_id: toStage, win_pct: stage.default_win_pct, stage_changed_at: now, updated_at: now, updated_by: user.id,
  });
  await insert('opportunity_stage_history', {
    id: id('osh'), opportunity_id: oppId, from_stage_id: row.stage_id, to_stage_id: toStage,
    changed_by: user.id, changed_at: now, note: note || null,
  });
  await audit(ctx, { action: 'update', resource: 'opportunity', resourceId: oppId, sectorId: row.sector_id,
    detail: { stage: `${row.stage_id}→${toStage}` } });
  return await getOpportunity(user, oppId);
}

// Rich detail for the opportunity page/drawer: names + stage history + the stage ladder
// (with default win %), the opportunity team, the latest activities, and the discipline flags.
export async function opportunityDetail(user, oppId, opts = {}) {
  const opp = await getOpportunity(user, oppId); // scope + redact + notFound/forbidden
  const client = opp.client_id ? ((await get('SELECT name_ar FROM client WHERE id=?', [opp.client_id]))?.name_ar || null) : null;
  const ownerRow = opp.owner_user_id ? await get('SELECT name_ar, username FROM app_user WHERE id=?', [opp.owner_user_id]) : null;
  const history = await all(`SELECT h.to_stage_id, h.from_stage_id, h.changed_at, h.note, u.name_ar owner_name, u.username
     FROM opportunity_stage_history h LEFT JOIN app_user u ON u.id=h.changed_by
     WHERE h.opportunity_id=? ORDER BY h.changed_at DESC LIMIT 25`, [oppId]);
  const stages = await all('SELECT id, name_ar, color, default_win_pct, sort_order, is_won, is_lost FROM stage ORDER BY sort_order');
  const team = await getTeam(user, oppId);
  const activities = await all(
    `SELECT a.id, a.kind, a.at, a.title, a.detail, a.source,
            COALESCE(a.actor_name, u.name_ar, u.username) AS actor
       FROM crm_activity a LEFT JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.opportunity_id = ? AND a.deleted_at IS NULL
      ORDER BY a.at DESC LIMIT 20`, [oppId]);
  const canEdit = can(user, 'update', 'opportunity', opp);
  const today = String(opts.today || nowIso().slice(0, 10)).slice(0, 10);
  const flags = withDiscipline(opp, today);
  return {
    opp, client, owner: ownerRow ? (ownerRow.name_ar || ownerRow.username) : null,
    history, stages, team, activities, canEdit,
    stage_age_days: flags.stage_age_days, rot: flags.rot, no_next_action: flags.no_next_action,
    weighted_halalas: Math.round((opp.value_halalas || 0) * ((opp.win_pct || 0) / 100)),
  };
}

// Pipeline aggregation for dashboards (respects scope).
export async function pipelineSummary(user) {
  const f = scopeFilter(user, 'opportunity', 'read');
  const rows = await all(
    `SELECT stage_id, COUNT(*) n, COALESCE(SUM(value_halalas),0) val
     FROM opportunity WHERE ${f.clause} AND deleted_at IS NULL GROUP BY stage_id`, f.params);
  const stages = await all('SELECT * FROM stage ORDER BY sort_order');
  const byStage = Object.fromEntries(rows.map((r) => [r.stage_id, r]));
  return stages.map((s) => ({
    stage: s.id, name_ar: s.name_ar, color: s.color,
    count: byStage[s.id]?.n || 0, value_halalas: byStage[s.id]?.val || 0,
  }));
}
