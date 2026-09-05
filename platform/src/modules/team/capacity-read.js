// ── قراءة الطاقة والتسكين لمجموعة موارد على مدى أشهر — المصدر الواحد لكل الشاشات ──────────
//
// «واجهة الويب والتصدير وMCP تستهلك الخدمات نفسها. لا توجد معادلة ثانية داخل card أو ملف CSV
//  أو أداة AI تختلف عن المصدر» — الموجّه §12.1. الحساب نفسه في capacity-model.js (صرف)، وهذا
// الملف يجمع له مدخلاته من القاعدة: صفوف الموظفين، إصدارات الطاقة، التسكينات (بكل سنوات
// المدى)، وطلبات التسكين المعلَّقة كطبقة عرضٍ مستقلة. استعلامٌ واحد لكل جدول لا لكل شخص.
//
// أسماء الأعمال تُقرأ هنا لمن يقرأ المورد (قاعدة access.js ②) — بلا مال: لا قيمة عقدٍ ولا
// ميزانية تخرج من هذه القراءة مهما كان القارئ.
import { createHash } from 'node:crypto';
import { all } from '../../core/db/index.js';
import { monthFigures, periodFigures, monthsBetween, monthPctOf } from './capacity-model.js';
import { workBucketLabel } from '../../web/i18n/glossary.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');

/** تسميةُ وجهة العمل بلا مال: مشروع/بند داخلي/فرصة. */
export function targetLabelOf(row, projects) {
  if (row.project_id) {
    const p = projects.get(row.project_id);
    return { kind: 'project', id: row.project_id, label: p?.name_ar || row.project_name || 'مشروع',
      status: p?.status || null, code: p?.code || null };
  }
  if (row.work_bucket) return { kind: 'bucket', id: row.work_bucket, label: workBucketLabel(row.work_bucket), status: null, code: null };
  return { kind: 'other', id: null, label: row.project_name || '—', status: null, code: null };
}

/** قابل للفوترة؟ العمود إن كُتب، وإلا يُشتق: مشروعٌ غير داخلي = نعم، بندٌ داخلي = لا. */
export function billableOf(row, projects) {
  if (row.billable != null) return Number(row.billable) === 1;
  if (!row.project_id) return false;
  const p = projects.get(row.project_id);
  return !!p && String(p.kind || 'external') !== 'internal';
}

/**
 * يحمّل سياق مجموعة موارد على مدى أشهر: الموظفون، إصدارات الطاقة، التسكينات، المشاريع
 * المسمّاة (بلا مال)، والطلبات المعلَّقة. المدى مفاتيح `YYYY-MM` (بدايةً ونهاية).
 */
export async function loadCapacityContext(employeeIds, fromKey, toKey) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  const months = monthsBetween(fromKey, toKey);
  const years = [...new Set(months.map((m) => m.year))];
  const ctx = { ids, months, years, emps: new Map(), versions: new Map(), allocs: new Map(), projects: new Map(), pending: new Map() };
  if (!ids.length || !months.length) return ctx;
  const [emps, versions, allocs, pending] = await Promise.all([
    all(`SELECT * FROM employee WHERE id IN (${ph(ids)})`, ids),
    all(`SELECT employee_id, effective_from, capacity_pct FROM capacity_version WHERE employee_id IN (${ph(ids)}) ORDER BY effective_from`, ids),
    all(`SELECT a.id, a.employee_id, a.project_id, a.project_name, a.work_bucket, a.type, a.monthly_json, a.year, a.status, a.billable, a.sector_id
           FROM allocation a
          WHERE a.deleted_at IS NULL AND a.employee_id IN (${ph(ids)}) AND a.year IN (${ph(years)})`, [...ids, ...years]),
    all(`SELECT id, employee_id, kind, target_kind, target_id, allocation_id, year, months_json, alloc_status, billable, status, requested_by, need_id
           FROM allocation_request
          WHERE deleted_at IS NULL AND status = 'pending' AND employee_id IN (${ph(ids)}) AND year IN (${ph(years)})`, [...ids, ...years]),
  ]);
  for (const e of emps) ctx.emps.set(e.id, e);
  for (const v of versions) { if (!ctx.versions.has(v.employee_id)) ctx.versions.set(v.employee_id, []); ctx.versions.get(v.employee_id).push(v); }
  for (const a of allocs) { if (!ctx.allocs.has(a.employee_id)) ctx.allocs.set(a.employee_id, []); ctx.allocs.get(a.employee_id).push(a); }
  for (const r of pending) { if (!ctx.pending.has(r.employee_id)) ctx.pending.set(r.employee_id, []); ctx.pending.get(r.employee_id).push(r); }
  const pids = [...new Set(allocs.map((a) => a.project_id).filter(Boolean)
    .concat(pending.filter((r) => r.target_kind === 'project').map((r) => r.target_id)))];
  if (pids.length) {
    // أسماء وحالات ورموز فقط — لا قيمة ولا ميزانية ولا هامش (قاعدة ②).
    for (const p of await all(`SELECT id, name_ar, code, status, kind, client_id, sector_id, department_id, financial_code
        FROM project WHERE id IN (${ph(pids)})`, pids)) ctx.projects.set(p.id, p);
  }
  return ctx;
}

/** بنود شهرٍ واحد لمورد: التسكينات (مؤكد/مبدئي) + الطلبات المعلَّقة الجديدة كطبقة `pending`. */
export function monthItems(ctx, employeeId, year, month, { includePending = true } = {}) {
  const items = [];
  for (const a of ctx.allocs.get(employeeId) || []) {
    if (Number(a.year) !== year) continue;
    const pct = monthPctOf(a.monthly_json, month);
    if (!pct) continue;
    const t = targetLabelOf(a, ctx.projects);
    items.push({ key: a.id, allocationId: a.id, kind: t.kind, targetId: t.id, label: t.label, targetStatus: t.status,
      pct, status: String(a.status || '').toLowerCase() === 'tentative' ? 'tentative' : 'confirmed',
      billable: billableOf(a, ctx.projects), role: a.type || 'member' });
  }
  if (includePending) {
    for (const r of ctx.pending.get(employeeId) || []) {
      if (Number(r.year) !== year || r.kind !== 'new') continue;
      let mj = {}; try { mj = JSON.parse(r.months_json || '{}'); } catch { mj = {}; }
      const pct = Math.round(N(mj[month]));
      if (!pct) continue;
      const label = r.target_kind === 'project' ? (ctx.projects.get(r.target_id)?.name_ar || 'مشروع') : workBucketLabel(r.target_id);
      items.push({ key: 'req:' + r.id, requestId: r.id, kind: r.target_kind, targetId: r.target_id, label, pct,
        status: 'pending', requested: r.alloc_status || 'confirmed', billable: r.billable == null ? r.target_kind === 'project' : Number(r.billable) === 1 });
    }
  }
  return items;
}

/**
 * أرقام كل مورد على كل شهرٍ في المدى + ملخص الفترة. يعيد Map(employeeId ⇒ { emp, months[], period }).
 * `overrides` اختياري: Map(employeeId ⇒ (year, month, items) ⇒ items) لمعاينة تغييرٍ قبل حفظه.
 */
export function figuresFromContext(ctx, { includePending = true, overrides = null } = {}) {
  const out = new Map();
  for (const id of ctx.ids) {
    const emp = ctx.emps.get(id);
    if (!emp) continue;
    const versions = ctx.versions.get(id) || [];
    const months = ctx.months.map(({ year, month }) => {
      let items = monthItems(ctx, id, year, month, { includePending });
      if (overrides && overrides.has(id)) items = overrides.get(id)(year, month, items);
      return monthFigures({ emp, year, month, versions, items });
    });
    out.set(id, { emp, months, period: periodFigures(months) });
  }
  return out;
}

export async function figuresFor(employeeIds, fromKey, toKey, opts = {}) {
  const ctx = await loadCapacityContext(employeeIds, fromKey, toKey);
  return { ctx, figures: figuresFromContext(ctx, opts) };
}

/**
 * بصمة تسكين موردٍ في سنة: تتغيّر إن تغيّر أي سطر (إضافة/تعديل/حذف/حالة). تُحفظ على الطلب
 * وقت المعاينة وتُقارن عند الاعتماد — «معاينة قديمة لا تكفي لاعتماد حجز جديد» (§6.5).
 */
export async function allocationFingerprint(employeeId, year) {
  const rows = await all(`SELECT id, monthly_json, status, billable, project_id, work_bucket FROM allocation
      WHERE employee_id = ? AND year = ? AND deleted_at IS NULL ORDER BY id`, [employeeId, year]);
  const h = createHash('sha1');
  for (const r of rows) h.update([r.id, r.monthly_json || '', r.status || '', r.billable ?? '', r.project_id || '', r.work_bucket || ''].join('|') + '\n');
  return h.digest('hex').slice(0, 16);
}
