// PMO governance depth — risks / issues / decisions / change requests / milestones per project.
// Read = whoever may read the project; write = whoever may UPDATE the project (the project's PM
// via project-scope grants, sector update rights, operations, admin). Every write audited.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
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

// ── المخرجات: السجل السادس، وأول مسار في المنتج كله يكتبها بعد إنشاء المشروع ───────────────
// قبل هذه الإضافة كان جدول المخرجات يُكتب من موضعين لا ثالث لهما: نموذج استلام العقد لحظة
// إنشاء المشروع، وتحويلها آلياً إلى «مُفوتر» عند إصدار المستخلص. فلا سبيل لأحد بعد ذلك أن
// يضيف مخرَجاً ولا أن يقول «سُلِّم» أو «قُبل» — بينما المستخلص يُبنى على هذه الحالة بالذات
// (finance: المؤهَّل للفوترة = مُسلَّم أو مقبول)، وتغذية «يحتاج انتباهك» تُنبِّه على مخرجات
// شهور سابقة عالقة. أي أن المنصة كانت تطالب بعمل لا يملك أحد أداةً لإنجازه.
//
// **حدّ الملكية بين الإنسان والنظام** (قرار صريح، لا تساهل):
//   • بيد الإنسان: قيد الإعداد · مُسلَّم · مقبول · مرفوض — قرارات تسليم وقبول يعرفها الفريق.
//   • بيد النظام وحده: مُفوتر (يُضبط عند إصدار المستخلص) ومدفوع (يتبع التحصيل). ضبطُهما يدوياً
//     يفصل الرقم عن الفاتورة فتصبح المطالبة المالية بلا سند.
//   • والمخرَج الذي بلغ إحداهما لا تُغيَّر حالته ولا يُحذف يدوياً — وإلا أمكن «فكّ» فاتورة صادرة
//     من شاشة مشروع.
const DLV_SYSTEM_STATUSES = ['INVOICED', 'PAID'];
const DLV_MANUAL_STATUSES = ['PENDING', 'DELIVERED', 'ACCEPTED', 'REJECTED'];
export const DELIVERABLE_MANUAL_STATUSES = DLV_MANUAL_STATUSES;
export const DELIVERABLE_SYSTEM_STATUSES = DLV_SYSTEM_STATUSES;

// شهر الاستحقاق يصل كنص «YYYY-MM» من قائمة واحدة، فلا يُخمَّن شهرٌ بلا سنة ولا سنةٌ بلا شهر.
function periodParts(period) {
  const v = String(period == null ? '' : period).trim();
  if (!v) return { month: null, year: null };
  return { year: Number(v.slice(0, 4)), month: Number(v.slice(5, 7)) };
}
// القيمة غير المتفق عليها تُخزَّن **فراغاً** لا صفراً: الصفر رقمٌ يُجمع في المطالبات ويُقرأ
// «بلا قيمة»، والفراغ يُعرض «غير محدَّدة» فيُطالَب به.
function deliverableAmount(d) {
  const raw = d.amount_sar;
  if (raw == null || String(raw).trim() === '') return null;
  return toHalalas(Number(raw));
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
  deliverable: {
    table: 'deliverable', prefix: 'dlv',
    statuses: [...DLV_MANUAL_STATUSES, ...DLV_SYSTEM_STATUSES],
    titleCol: 'name_ar',
    titleError: 'اسم المخرج مطلوب',
    withSector: true,
    validate(d) {
      if ('amount_sar' in d && d.amount_sar != null && String(d.amount_sar).trim() !== '') {
        const n = Number(d.amount_sar);
        if (!Number.isFinite(n) || n < 0) throw badRequest('قيمة المخرج تُكتب رقماً بالريال — أو تُترك فارغة إن لم تُتفق بعد');
        if (n > 1e10) throw badRequest('قيمة المخرج أكبر من المعقول — راجع الرقم قبل الحفظ');
      }
      if ('period' in d && d.period != null && String(d.period).trim() !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.period)))
        throw badRequest('اختر شهر الاستحقاق من القائمة');
      if ('status' in d && d.status && DLV_SYSTEM_STATUSES.includes(d.status))
        throw badRequest('«مُفوتر» و«مدفوع» تُضبطان تلقائياً عند إصدار المستخلص وتحصيله — اختر: قيد الإعداد أو مُسلَّم أو مقبول أو مرفوض');
    },
    guardWrite(d, row) {
      if ('status' in d && row && DLV_SYSTEM_STATUSES.includes(row.status))
        throw badRequest(row.status === 'PAID'
          ? 'هذا المخرج محصَّل — تغيير حالته من هنا يفصل الرقم عن الفاتورة. عالِج الأمر من صفحة المالية'
          : 'صدر بهذا المخرج مستخلص — تغيير حالته من هنا يفصل الرقم عن الفاتورة. عالِج الأمر من صفحة المالية');
    },
    guardDelete(row) {
      if (DLV_SYSTEM_STATUSES.includes(row.status))
        throw badRequest('لا يُحذف مخرَج صدر به مستخلص أو تحصيل — ألغِ الفاتورة أولاً من صفحة المالية');
    },
    createRow(d) {
      const per = periodParts(d.period);
      const st = d.status || 'PENDING';
      const now = nowIso();
      return {
        name_ar: d.name_ar || d.title, amount_halalas: deliverableAmount(d),
        month: per.month, year: per.year, status: st, notes: d.notes || null,
        delivered_at: st === 'DELIVERED' || st === 'ACCEPTED' ? now : null,
        accepted_at: st === 'ACCEPTED' ? now : null,
      };
    },
    patchRow(d, row) {
      const patch = {};
      if ('name_ar' in d || 'title' in d) patch.name_ar = d.name_ar || d.title || null;
      if ('notes' in d) patch.notes = d.notes || null;
      if ('amount_sar' in d) patch.amount_halalas = deliverableAmount(d);
      if ('period' in d) { const per = periodParts(d.period); patch.month = per.month; patch.year = per.year; }
      if ('status' in d) {
        // تواريخ التسليم والقبول موجودة في البنية منذ اليوم الأول ولم يكتبها شيء قط — تُكتب هنا
        // لحظة الانتقال، لأنها ما سيحتاجه أي تقرير أو خلاف لاحق («متى سُلِّم؟ ومتى قُبل؟»).
        const now = nowIso();
        patch.status = d.status;
        if (d.status === 'DELIVERED') { patch.delivered_at = row.delivered_at || now; patch.accepted_at = null; }
        else if (d.status === 'ACCEPTED') { patch.delivered_at = row.delivered_at || now; patch.accepted_at = row.accepted_at || now; }
        else if (d.status === 'REJECTED') { patch.accepted_at = null; }
        else if (d.status === 'PENDING') { patch.delivered_at = null; patch.accepted_at = null; }
        patch.updated_at = now;
      }
      return patch;
    },
  },
  milestone: {
    table: 'milestone', prefix: 'mls',
    statuses: ['PENDING', 'MET', 'MISSED'],
    titleCol: 'name_ar',
    titleError: 'اسم المعلم مطلوب',
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
  deliverable: 'ORDER BY (year IS NULL), year, (month IS NULL), month, created_at',
};

// خريطة المسار العام ⟵ نوع السجل. تُصدَّر كي يشتقّ منها المُوجِّه مساراته بدل نسخة ثانية
// تُنسى عند إضافة نوع جديد (وهو ما حدث فعلاً: النوع يُضاف هنا فلا يصله مسار).
export const GOVERNANCE_PLURALS = {
  risks: 'risk', issues: 'issue', decisions: 'decision', changes: 'change',
  milestones: 'milestone', deliverables: 'deliverable',
};

// العنوان يُقرأ من العمود الذي يخصّ كل نوع (title أو name_ar) — لا شرط على اسم النوع.
const titleOf = (cfg, d) => String((cfg.titleCol === 'name_ar' ? (d.name_ar ?? d.title) : d.title) ?? '').trim();
const hasTitle = (cfg, d) => (cfg.titleCol === 'name_ar' ? ('name_ar' in d || 'title' in d) : ('title' in d));

export async function listItems(user, projectId, kind) {
  const cfg = kindCfg(kind);
  await readableProject(user, projectId);
  return await all(`SELECT * FROM ${cfg.table} WHERE project_id = ? AND deleted_at IS NULL ${ORDER[kind]}`, [projectId]);
}

// Composite payload for the project page: the governance registers + write flag in one call.
export async function projectGovernance(user, projectId) {
  const p = await readableProject(user, projectId);
  const kinds = ['risk', 'issue', 'decision', 'change', 'milestone', 'deliverable'];
  const [risks, issues, decisions, changes, milestones, deliverables] = await Promise.all(
    kinds.map((k) => all(`SELECT * FROM ${KINDS[k].table} WHERE project_id = ? AND deleted_at IS NULL ${ORDER[k]}`, [projectId])));
  return { projectId: p.id, canEdit: can(user, 'update', 'project', asTarget(p)), risks, issues, decisions, changes, milestones, deliverables };
}

export async function createItem(ctx, projectId, kind, data = {}) {
  const cfg = kindCfg(kind);
  const p = await readableProject(ctx.user, projectId);
  requireWrite(ctx.user, p);
  const title = titleOf(cfg, data);
  if (!title) throw badRequest(cfg.titleError || 'العنوان مطلوب');
  cfg.validate(data);
  if (cfg.statuses && 'status' in data && data.status && !cfg.statuses.includes(data.status)) throw badRequest('الحالة غير صحيحة');
  await checkOwner(data);
  const rid = id(cfg.prefix);
  const row = cfg.createRow({ ...data, title, name_ar: cfg.titleCol === 'name_ar' ? title : undefined });
  await insert(cfg.table, { id: rid, project_id: p.id, ...(kind === 'risk' || cfg.withSector ? { sector_id: p.sector_id } : {}), ...row, created_at: nowIso() });
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
  if (cfg.guardWrite) cfg.guardWrite(data, row); // حدود ما يملكه الإنسان مقابل ما يملكه النظام
  if ('status' in data) {
    if (!cfg.statuses) throw badRequest('هذا السجل بلا حالة قابلة للتغيير');
    if (!cfg.statuses.includes(data.status)) throw badRequest('الحالة غير صحيحة');
  }
  if (hasTitle(cfg, data) && !titleOf(cfg, data)) throw badRequest(cfg.titleError || 'العنوان مطلوب');
  await checkOwner(data);
  const patch = cfg.patchRow(data, row);
  if (!Object.keys(patch).length) throw badRequest('لا تغييرات لتطبيقها');
  await update(cfg.table, itemId, patch);
  await audit(ctx, { action: 'update', resource: cfg.table, resourceId: itemId, sectorId: p.sector_id, detail: Object.keys(patch) });
  return await get(`SELECT * FROM ${cfg.table} WHERE id = ?`, [itemId]);
}

export async function deleteItem(ctx, kind, itemId) {
  const { cfg, row, p } = await writableItem(ctx.user, kind, itemId);
  if (cfg.guardDelete) cfg.guardDelete(row);
  await update(cfg.table, itemId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: cfg.table, resourceId: itemId, sectorId: p.sector_id });
  return { ok: true };
}
