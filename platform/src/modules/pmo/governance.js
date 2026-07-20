// PMO governance depth — risks / issues / decisions / change requests / milestones per project.
// Read = whoever may read the project; write = whoever may UPDATE the project (the project's PM
// via project-scope grants, sector update rights, operations, admin). Every write audited.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

const LEVELS = ['low', 'med', 'high'];
const normLevel = (v) => (v === 'medium' ? 'med' : v); // legacy rows store 'medium'
const isLevel = (v) => LEVELS.includes(normLevel(v));

// Derived exposure (احتمال × أثر) — Arabic because it is a display-only derived field.
function exposureOf(probability, impact) {
  const score = { low: 1, med: 2, high: 3 };
  const p = score[normLevel(probability)], i = score[normLevel(impact)];
  if (!p || !i) return null;
  const x = p * i;
  return x >= 6 ? 'مرتفع' : x >= 3 ? 'متوسط' : 'منخفض';
}

// One config per governed table: id prefix, allowed enums, field mapping for create/patch.
const KINDS = {
  risk: {
    table: 'risk', prefix: 'rsk',
    statuses: ['OPEN', 'MITIGATING', 'CLOSED'],
    validate(d) {
      if ('probability' in d && d.probability != null && d.probability !== '' && !isLevel(d.probability)) throw badRequest('احتمال الخطر يجب أن يكون: منخفض أو متوسط أو مرتفع');
      if ('impact' in d && d.impact != null && d.impact !== '' && !isLevel(d.impact)) throw badRequest('أثر الخطر يجب أن يكون: منخفض أو متوسط أو مرتفع');
    },
    createRow(d) {
      return { title: d.title, probability: d.probability ? normLevel(d.probability) : null, impact: d.impact ? normLevel(d.impact) : null,
        exposure: exposureOf(d.probability, d.impact), mitigation: d.mitigation || null,
        owner_user_id: d.owner_user_id || null, status: d.status || 'OPEN' };
    },
    patchRow(d, row) {
      const patch = {};
      for (const k of ['title', 'mitigation', 'owner_user_id']) if (k in d) patch[k] = d[k] || null;
      for (const k of ['probability', 'impact']) if (k in d) patch[k] = d[k] ? normLevel(d[k]) : null;
      if ('status' in d) patch.status = d.status;
      if ('probability' in d || 'impact' in d)
        patch.exposure = exposureOf('probability' in patch ? patch.probability : row.probability,
          'impact' in patch ? patch.impact : row.impact);
      return patch;
    },
  },
  issue: {
    table: 'issue', prefix: 'iss',
    statuses: ['OPEN', 'CLOSED'],
    validate(d) {
      if ('severity' in d && d.severity != null && d.severity !== '' && !isLevel(d.severity)) throw badRequest('شدة المعوق يجب أن تكون: منخفضة أو متوسطة أو مرتفعة');
    },
    createRow(d) {
      return { title: d.title, severity: d.severity ? normLevel(d.severity) : null, status: d.status || 'OPEN',
        owner_user_id: d.owner_user_id || null, opened_at: nowIso(), closed_at: d.status === 'CLOSED' ? nowIso() : null };
    },
    patchRow(d) {
      const patch = {};
      for (const k of ['title', 'owner_user_id']) if (k in d) patch[k] = d[k] || null;
      if ('severity' in d) patch.severity = d.severity ? normLevel(d.severity) : null;
      if ('status' in d) { patch.status = d.status; patch.closed_at = d.status === 'CLOSED' ? nowIso() : null; }
      return patch;
    },
  },
  decision: {
    table: 'decision', prefix: 'dec',
    statuses: null,
    validate() {},
    createRow(d) {
      return { title: d.title, detail: d.detail || null, decided_by: d.decided_by || null,
        decided_at: d.decided_at || nowIso().slice(0, 10) };
    },
    patchRow(d) {
      const patch = {};
      for (const k of ['title', 'detail', 'decided_by', 'decided_at']) if (k in d) patch[k] = d[k] || null;
      return patch;
    },
  },
  change: {
    table: 'change_request', prefix: 'chg',
    statuses: ['REQUESTED', 'APPROVED', 'REJECTED'],
    validate() {},
    createRow(d) { return { title: d.title, impact: d.impact || null, status: d.status || 'REQUESTED' }; },
    patchRow(d) {
      const patch = {};
      for (const k of ['title', 'impact']) if (k in d) patch[k] = d[k] || null;
      if ('status' in d) patch.status = d.status;
      return patch;
    },
  },
  milestone: {
    table: 'milestone', prefix: 'mls',
    statuses: ['PENDING', 'MET', 'MISSED'],
    titleCol: 'name_ar',
    validate() {},
    createRow(d) { return { name_ar: d.name_ar || d.title, due_date: d.due_date || null, status: d.status || 'PENDING' }; },
    patchRow(d) {
      const patch = {};
      if ('name_ar' in d || 'title' in d) patch.name_ar = d.name_ar || d.title || null;
      if ('due_date' in d) patch.due_date = d.due_date || null;
      if ('status' in d) patch.status = d.status;
      return patch;
    },
  },
};

function kindCfg(kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw notFound('نوع سجل الحوكمة غير معروف');
  return cfg;
}

// The bare project row lacks a project_id column, which lets project-scoped grants fall through
// scopeReaches() open. Passing project_id explicitly makes membership the deciding check for
// project-scoped roles (consultant/PM) while sector/company scopes stay untouched.
const asTarget = (p) => ({ ...p, project_id: p.id });
async function readableProject(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', asTarget(p))) throw forbidden('هذا المشروع خارج نطاق صلاحياتك');
  return p;
}
function requireWrite(user, project) {
  if (!can(user, 'update', 'project', asTarget(project))) throw forbidden('تعديل سجلات الحوكمة يتطلب صلاحية إدارة المشروع');
}
async function checkOwner(d) {
  if (d.owner_user_id && !(await get('SELECT id FROM app_user WHERE id = ? AND deleted_at IS NULL', [d.owner_user_id])))
    throw badRequest('المستخدم المالك غير موجود');
}

const ORDER = {
  risk: 'ORDER BY (status = \'CLOSED\'), created_at DESC',
  issue: 'ORDER BY (status = \'CLOSED\'), opened_at DESC',
  decision: 'ORDER BY decided_at DESC, created_at DESC',
  change: 'ORDER BY created_at DESC',
  milestone: 'ORDER BY (due_date IS NULL), due_date, created_at',
};

export async function listItems(user, projectId, kind) {
  const cfg = kindCfg(kind);
  await readableProject(user, projectId);
  return await all(`SELECT * FROM ${cfg.table} WHERE project_id = ? AND deleted_at IS NULL ${ORDER[kind]}`, [projectId]);
}

// Composite payload for the project page: the five registers + write flag in one call.
export async function projectGovernance(user, projectId) {
  const p = await readableProject(user, projectId);
  const [risks, issues, decisions, changes, milestones] = await Promise.all(
    ['risk', 'issue', 'decision', 'change', 'milestone'].map((k) =>
      all(`SELECT * FROM ${KINDS[k].table} WHERE project_id = ? AND deleted_at IS NULL ${ORDER[k]}`, [projectId])));
  return { projectId: p.id, canEdit: can(user, 'update', 'project', asTarget(p)), risks, issues, decisions, changes, milestones };
}

export async function createItem(ctx, projectId, kind, data = {}) {
  const cfg = kindCfg(kind);
  const p = await readableProject(ctx.user, projectId);
  requireWrite(ctx.user, p);
  const title = String((kind === 'milestone' ? (data.name_ar ?? data.title) : data.title) ?? '').trim();
  if (!title) throw badRequest(kind === 'milestone' ? 'اسم المعلم مطلوب' : 'العنوان مطلوب');
  cfg.validate(data);
  if (cfg.statuses && 'status' in data && data.status && !cfg.statuses.includes(data.status)) throw badRequest('الحالة غير صحيحة');
  await checkOwner(data);
  const rid = id(cfg.prefix);
  const row = cfg.createRow({ ...data, title, name_ar: kind === 'milestone' ? title : undefined });
  await insert(cfg.table, { id: rid, project_id: p.id, ...(kind === 'risk' ? { sector_id: p.sector_id } : {}), ...row, created_at: nowIso() });
  await audit(ctx, { action: 'create', resource: cfg.table, resourceId: rid, sectorId: p.sector_id, detail: { title } });
  return await get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [rid]);
}

async function writableItem(user, kind, itemId) {
  const cfg = kindCfg(kind);
  const row = await get(`SELECT * FROM ${cfg.table} WHERE id = ? AND deleted_at IS NULL`, [itemId]);
  if (!row) throw notFound('السجل غير موجود');
  const p = row.project_id ? await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [row.project_id]) : null;
  if (!p) throw notFound('المشروع غير موجود');
  requireWrite(user, p); // row-level sector/PM guard (IDOR)
  return { cfg, row, p };
}

export async function updateItem(ctx, kind, itemId, data = {}) {
  const { cfg, row, p } = await writableItem(ctx.user, kind, itemId);
  cfg.validate(data);
  if ('status' in data) {
    if (!cfg.statuses) throw badRequest('هذا السجل بلا حالة قابلة للتغيير');
    if (!cfg.statuses.includes(data.status)) throw badRequest('الحالة غير صحيحة');
  }
  if ((kind === 'milestone' ? 'name_ar' in data || 'title' in data : 'title' in data)
      && !String((kind === 'milestone' ? (data.name_ar || data.title) : data.title) || '').trim())
    throw badRequest(kind === 'milestone' ? 'اسم المعلم مطلوب' : 'العنوان مطلوب');
  await checkOwner(data);
  const patch = cfg.patchRow(data, row);
  if (!Object.keys(patch).length) throw badRequest('لا تغييرات لتطبيقها');
  await update(cfg.table, itemId, patch);
  await audit(ctx, { action: 'update', resource: cfg.table, resourceId: itemId, sectorId: p.sector_id, detail: Object.keys(patch) });
  return await get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [itemId]);
}

export async function deleteItem(ctx, kind, itemId) {
  const { cfg, p } = await writableItem(ctx.user, kind, itemId);
  await update(cfg.table, itemId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: cfg.table, resourceId: itemId, sectorId: p.sector_id });
  return { ok: true };
}
