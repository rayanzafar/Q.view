// ── طلب التسكين: تنفيذُه، وتسويةُ قرار مدير المورد عليه ──────────────────────────────────
//
// «الطلب المعلق لا يغيّر التسكين المؤكد» (الموجّه §5). فالطلب صفٌّ مستقل يحمل التغيير كاملاً
// (042: المورد، الوجهة، الأشهر ونسبها، النوع، التصنيف، وبصمة الخطة وقت المعاينة)، ولا يمسّ
// `allocation` إلا من هنا: عند التطبيق المباشر لمن يملك أمر المورد، أو عند اعتماد مديره عبر
// محرّك الاعتماد الموجَّه (022). والتنفيذ نفسه يمرّ **بكتّاب التسكين القائمين** حرفياً
// (pmo/projects.js) بصلاحية من ينفّذ لا بصلاحية من طلب: معتمِدٌ لا يملك تنفيذ الكتابة لا
// يُنفَّذ باسمه شيء — يُعاد الطلب بسببٍ مكتوب يقرؤه صاحبه.
//
// وموضع هذا الملف كموضع staffing-settle.js: المحرّك عامٌّ لا يعرف التسكين، ويحمّل هذا المُسوّي
// تحميلاً كسولاً (engine.js) — فلا يستورد هذا الملفُ المحرّكَ أبداً، وإلا دارت الدورة.
//
// ── ما يُعاد فحصه عند الاعتماد، داخل المعاملة (T20) ─────────────────────────────────────
//   ① البصمة: تسكينات المورد في السنة كما كانت وقت المعاينة. اختلفت ⇒ «تغيّرت الخطة منذ
//      المعاينة» ويُعاد الطلب — معاينةٌ قديمة لا تكفي لاعتماد حجزٍ جديد (§6.5).
//   ② الارتباط: شهرٌ خارج فترة ارتباط المورد لا يُؤكَّد فيه تسكينٌ مؤكد (T11). المبدئي يمرّ.
//   ③ الوجهة والتسكين المعدَّل ما زالا قائمين.
import { all, get, update, run } from '../../core/db/index.js';
import { nowIso } from '../../core/util/ids.js';
import { audit } from '../../core/audit/index.js';
import { HttpError, conflict } from '../../core/http/errors.js';
import { resolveUserFromSession } from '../../core/http/context.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { assignEmployee, assignInternalWork, setAllocationMonths, unassignEmployee } from '../pmo/projects.js';
import { notify } from '../notifications/notify.js';
import { workBucketLabel } from '../../web/i18n/glossary.js';
import { loadCapacityContext, figuresFromContext, allocationFingerprint } from './capacity-read.js';
import { capacityForMonth, monthKey, FULL } from './capacity-model.js';

// ── تسمياتٌ عربية محلية (المعجم لا يُمَسّ) ─────────────────────────────────────────────
export const REQUEST_STATUS_AR = Object.freeze({
  draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمَد', returned: 'مُعاد للتعديل',
  rejected: 'مرفوض', withdrawn: 'مسحوب', applied: 'مطبَّق',
});
export const REQUEST_KIND_AR = Object.freeze({ new: 'تسكين جديد', adjust: 'تعديل تسكين', remove: 'إزالة تسكين' });
export const ALLOC_STATUS_AR = Object.freeze({ confirmed: 'مؤكد', tentative: 'مبدئي', pending: 'بانتظار الاعتماد' });
export const PLAN_CHANGED_AR = 'تغيّرت الخطة منذ المعاينة';
export const PLAN_CHANGED_ACTION_AR = `${PLAN_CHANGED_AR} — أعد المعاينة ثم أرسل الطلب من جديد`;
export const NO_MANAGER_NOTE_AR = 'لا مدير مسجَّل لإدارة المورد — يبقى الطلب معلَّقاً حتى يقرّره من يملك أمر المورد (قائد القطاع أو مدير النظام)';
export const monthLabelAr = (year, month) => `${MONTHS_AR[Number(month) - 1] || month} ${year}`;

const N = (v) => Number(v) || 0;

// ── قراءة الطلب المخزَّن ────────────────────────────────────────────────────────────────
export function parseMonthsJson(s) {
  let o = s;
  if (typeof o === 'string') { try { o = JSON.parse(o || '{}'); } catch { o = {}; } }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}
/** أشهر الطلب [{ month, pct }] بترتيبٍ زمني — النسبة عددٌ صحيح من طاقة المورد. */
export function requestMonths(req) {
  return Object.entries(parseMonthsJson(req?.months_json))
    .map(([m, p]) => ({ month: Number(m), pct: Math.round(N(p)) }))
    .filter((x) => Number.isInteger(x.month) && x.month >= 1 && x.month <= 12)
    .sort((a, b) => a.month - b.month);
}
/** خريطة `YYYY-MM ⇒ pct` للعرض. */
export function requestMonthsMap(req) {
  return Object.fromEntries(requestMonths(req).map((x) => [monthKey(Number(req.year), x.month), x.pct]));
}
/** اسم الوجهة بلا مال: مشروعٌ باسمه أو بندٌ داخلي بتسميته. */
export function targetLabelFor(req, projects = null) {
  if (req.target_kind === 'bucket') return workBucketLabel(req.target_id) || req.target_id;
  return projects?.get?.(req.target_id)?.name_ar || req.project_name || 'مشروع';
}
export const monthsTextAr = (year, months) => months.filter((x) => x.pct > 0)
  .map((x) => `${monthLabelAr(year, x.month)} ${x.pct}%`).join('، ');

// ── التغيير كطبقة معاينة فوق بنود الشهر (capacity-read.figuresFromContext overrides) ─────
/**
 * يعيد دالة `(year, month, items) ⇒ items` تطبّق التغيير على بنود الشهر كما لو حُفظ:
 * «جديد» يضيف بنداً بحالته (مؤكد/مبدئي)، و«تعديل» يستبدل نسبة التسكين المعدَّل في الأشهر
 * المسمّاة وحدها (T14)، و«إزالة» يسقطه. والطلب نفسه — إن كان معلَّقاً — يُستبعد من طبقة
 * «المعلَّق» كي لا يُعدّ مرتين (`excludeRequestId`).
 * @param {{kind:string, allocationId?:string|null, target:{kind:string,id:string}, year:number,
 *   months:Array<{month:number,pct:number}>, allocStatus?:string, billable?:boolean|null, label:string,
 *   excludeRequestId?:string|null}} change — `billable` فارغٌ يعني: للجديد يُشتق من الوجهة، وللتعديل يبقى كما هو.
 */
export function changeOverride({ kind, allocationId = null, target, year, months, allocStatus = 'confirmed', billable = null, label, excludeRequestId = null }) {
  const byMonth = new Map((months || []).map((x) => [Number(x.month), Math.round(N(x.pct))]));
  const derivedBillable = target?.kind === 'project';
  return (y, m, items) => {
    const out = excludeRequestId ? items.filter((it) => it.requestId !== excludeRequestId) : items;
    if (y !== year || !byMonth.has(m)) return out;
    const pct = byMonth.get(m);
    if (kind === 'new') {
      if (pct <= 0) return out;
      return [...out, { key: 'preview', kind: target.kind, targetId: target.id, label, pct, status: allocStatus,
        billable: billable == null ? derivedBillable : !!billable }];
    }
    const cur = out.find((it) => it.allocationId === allocationId) || null;
    const rest = out.filter((it) => it.allocationId !== allocationId);
    if (kind === 'remove' || pct <= 0) return rest;
    return [...rest, { key: allocationId, allocationId, kind: target.kind, targetId: target.id, label: cur?.label || label, pct,
      status: allocStatus || cur?.status || 'confirmed',
      billable: billable == null ? (cur ? !!cur.billable : derivedBillable) : !!billable }];
  };
}

/** سطر أثرٍ لشهرٍ واحد: قبل/بعد على طبقة التغيير — والمقام صفرٌ حالةٌ لا رقم (خارج الارتباط). */
export function effectRow(b, a, { touched = true, layer = 'confirmedPct' } = {}) {
  const out = b.state === 'out';
  return {
    key: b.key, label_ar: monthLabelAr(b.year, b.month), touched,
    state: a.state,
    current: b.confirmedPct, currentTentative: b.tentativePct, pendingPct: a.pendingPct,
    added: out ? null : Math.round(N(a[layer]) - N(b[layer])),
    after: a.confirmedPct, afterTentative: a.tentativePct,
    availableAfter: a.availablePct, overAfter: a.overPct,
    conflict: !out && N(a.confirmedPct) > FULL,
    potentialOver: !out && !!a.potentialOver,
    outOfEngagement: out && touched,
  };
}

/** أثر طلبٍ مخزَّن على أشهره: قبل (الحال الآن) وبعد (لو طُبِّق) — للمعاينة في S16 وللأثر المحفوظ. */
export async function effectOf(req) {
  const months = requestMonths(req);
  if (!months.length) return [];
  const year = Number(req.year);
  const from = monthKey(year, months[0].month); const to = monthKey(year, months[months.length - 1].month);
  const ctx = await loadCapacityContext([req.employee_id], from, to);
  if (req.target_kind === 'project' && !ctx.projects.has(req.target_id)) {
    const p = await get('SELECT id, name_ar, code, status, kind FROM project WHERE id = ?', [req.target_id]);
    if (p) ctx.projects.set(p.id, p);
  }
  const target = { kind: req.target_kind, id: req.target_id };
  const label = targetLabelFor(req, ctx.projects);
  const billable = req.billable != null ? Number(req.billable) === 1
    : (req.kind === 'new' ? (req.target_kind === 'project'
      ? String(ctx.projects.get(req.target_id)?.kind || 'external') !== 'internal' : false) : null);
  const before = figuresFromContext(ctx, { includePending: true }).get(req.employee_id);
  const after = figuresFromContext(ctx, {
    includePending: true,
    overrides: new Map([[req.employee_id, changeOverride({ kind: req.kind, allocationId: req.allocation_id || null, target, year,
      months, allocStatus: req.alloc_status || 'confirmed', billable, label, excludeRequestId: req.id })]]),
  }).get(req.employee_id);
  if (!before || !after) return [];
  const touched = new Set(months.map((x) => x.month));
  const layer = req.alloc_status === 'tentative' ? 'tentativePct' : 'confirmedPct';
  return before.months.map((b, i) => effectRow(b, after.months[i], { touched: touched.has(b.month), layer }));
}

// ── إعادة الفحص قبل التنفيذ ─────────────────────────────────────────────────────────────
/**
 * هل ما زال الطلب قابلاً للتنفيذ كما عُوين؟ يعيد `{ ok }` أو `{ ok:false, reason_ar, code }`.
 * لا يرمي: القرار «يُعاد الطلب» لا «فشل النداء» — فالسبب يُكتب على الطلب ويقرؤه صاحبه.
 */
export async function revalidateRequest(req) {
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [req.employee_id]);
  if (!emp) return { ok: false, code: 'no_resource', reason_ar: 'المورد لم يعد موجوداً — أُزيل سجله قبل القرار' };
  const year = Number(req.year);
  const fingerprint = await allocationFingerprint(emp.id, year);
  if (req.expected_fingerprint && fingerprint !== req.expected_fingerprint) {
    return { ok: false, code: 'plan_changed', reason_ar: PLAN_CHANGED_ACTION_AR };
  }
  const months = requestMonths(req);
  if (req.kind !== 'new') {
    const a = await get('SELECT id FROM allocation WHERE id = ? AND deleted_at IS NULL', [req.allocation_id]);
    if (!a) return { ok: false, code: 'no_allocation', reason_ar: 'التسكين المطلوب تعديله لم يعد موجوداً — أُزيل قبل القرار' };
  } else if (req.target_kind === 'project') {
    const p = await get('SELECT id, status FROM project WHERE id = ? AND deleted_at IS NULL', [req.target_id]);
    if (!p) return { ok: false, code: 'no_project', reason_ar: 'المشروع المطلوب التسكين عليه لم يعد موجوداً' };
  }
  if (req.kind !== 'remove' && String(req.alloc_status || 'confirmed') !== 'tentative') {
    const versions = await all('SELECT effective_from, capacity_pct FROM capacity_version WHERE employee_id = ? ORDER BY effective_from', [emp.id]);
    const out = months.filter((x) => x.pct > 0 && capacityForMonth(emp, year, x.month, versions).state === 'out')
      .map((x) => monthLabelAr(year, x.month));
    if (out.length) {
      return { ok: false, code: 'out_of_engagement',
        reason_ar: `${out.join('، ')} خارج فترة ارتباط «${emp.name_ar}» — لا يُؤكَّد تسكين خارج الارتباط؛ اجعله مبدئياً أو عدّل الأشهر` };
    }
  }
  return { ok: true, emp, fingerprint, months };
}

// ── التنفيذ عبر الكتّاب القائمين ────────────────────────────────────────────────────────
/**
 * يطبّق الطلب بصلاحية `ctx.user` عبر projects.js (لا كاتبَ ثانياً للتسكين)، ثم يكتب الحالة
 * والتصنيف اللذين لا يعرفهما الكاتبان (042). يعيد معرّف التسكين المتأثر.
 */
export async function applyRequest(ctx, req) {
  const months = requestMonths(req);
  const year = Number(req.year);
  const sectorId = req.sector_id || null;
  if (req.kind === 'new') {
    const positive = Object.fromEntries(months.filter((x) => x.pct > 0).map((x) => [x.month, x.pct]));
    let allocationId;
    if (req.target_kind === 'project') {
      await assignEmployee(ctx, req.target_id, { employeeId: req.employee_id, type: 'member', year, months: positive });
      allocationId = (await get('SELECT id FROM allocation WHERE project_id = ? AND employee_id = ? AND year = ? AND deleted_at IS NULL',
        [req.target_id, req.employee_id, year]))?.id || null;
    } else {
      allocationId = (await assignInternalWork(ctx, { employeeId: req.employee_id, bucket: req.target_id, year, months: positive })).id;
    }
    const status = req.alloc_status === 'tentative' ? 'tentative' : 'confirmed';
    const billable = req.billable == null ? null : Number(req.billable);
    await update('allocation', allocationId, { status, billable });
    await audit(ctx, { action: 'update', resource: 'allocation', resourceId: allocationId, sectorId,
      detail: { status, billable, allocation_request: req.id } });
    return allocationId;
  }
  if (req.kind === 'adjust') {
    if (months.length) await setAllocationMonths(ctx, req.allocation_id, Object.fromEntries(months.map((x) => [x.month, x.pct])));
    const patch = {};
    if (req.alloc_status) patch.status = req.alloc_status === 'tentative' ? 'tentative' : 'confirmed';
    if (req.billable != null) patch.billable = Number(req.billable);
    if (Object.keys(patch).length) {
      await update('allocation', req.allocation_id, patch);
      await audit(ctx, { action: 'update', resource: 'allocation', resourceId: req.allocation_id, sectorId,
        detail: { ...patch, allocation_request: req.id } });
    }
    return req.allocation_id;
  }
  if (req.kind === 'remove') {
    await unassignEmployee(ctx, req.allocation_id);
    return req.allocation_id;
  }
  throw new HttpError(400, 'bad_request', 'نوع الطلب غير معروف — أعد إنشاءه من الشاشة');
}

// ── إغلاق الطلب بحالته وأثره ────────────────────────────────────────────────────────────
const AUDIT_ACTION = { applied: 'apply', returned: 'return', rejected: 'reject', withdrawn: 'withdraw', pending: 'submit' };
/**
 * يكتب الحالة النهائية على الطلب (ومن قرّر ومتى والسبب) ويسجّل الأثر. يعيد الصف بعد التحديث.
 * @param {object} patchIn { status, reason?, decision_note?, applied_allocation_id?, note? }
 * @param {object} detail تفاصيل إضافية لسطر التدقيق (مثل الأثر قبل/بعد عند التطبيق)
 */
export async function finishRequest(ctx, req, patchIn, detail = {}) {
  const now = nowIso();
  const { status } = patchIn;
  const patch = { status, updated_at: now };
  if (!['draft', 'pending'].includes(status)) { patch.decided_by = ctx?.user?.id || null; patch.decided_at = now; }
  for (const k of ['reason', 'decision_note', 'applied_allocation_id', 'note']) if (patchIn[k] !== undefined) patch[k] = patchIn[k];
  // تحديثٌ مشروط بالحالة التي قُرئت: قراران متزامنان (أو نقرة مكررة سبقت حارس الواجهة) لا يفوزان
  // معاً — الثاني يجد الصف قد انتقل فيُقرّ بالتعارض بدل أن يكتب «معاد» فوق «مطبَّق».
  const cols = Object.keys(patch);
  const r = await run(`UPDATE allocation_request SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND status = ? AND deleted_at IS NULL`,
    [...cols.map((c) => patch[c]), req.id, req.status]);
  if (!r.changes) throw conflict('تغيّرت حالة الطلب منذ فتحه — حدّث الصفحة لترى قراره الحالي');
  // طلبٌ مرتبط باحتياج: حالة الاحتياج المخزَّنة تتبع القرار (استيرادٌ كسول — الاحتياجات تستورد
  // التسكين الذي يستورد هذا الملف، فالاستيراد الساكن هنا يغلق حلقة).
  if (req.need_id && !['draft', 'pending'].includes(status)) {
    const { refreshNeedStatus } = await import('./needs.js');
    await refreshNeedStatus(req.need_id, ctx);
  }
  await audit(ctx, { action: AUDIT_ACTION[status] || 'update', resource: 'allocation_request', resourceId: req.id,
    sectorId: req.sector_id || null,
    detail: { from: req.status, to: status, employee: req.employee_id, kind: req.kind, target: { kind: req.target_kind, id: req.target_id },
      year: Number(req.year), months: parseMonthsJson(req.months_json), alloc_status: req.alloc_status,
      ...(patchIn.reason ? { reason: patchIn.reason } : {}), ...detail } });
  return { ...req, ...patch };
}

/** سياقُ كتابةٍ باسم المعتمِد: نفس شكل مستخدم الجلسة (نطاقاته ومجموعاته) لا صفَّ حسابٍ خام. */
export async function systemCtxFor(actorUserId) {
  const user = actorUserId ? await resolveUserFromSession({ user_id: actorUserId }) : null;
  return { user, ip: 'approval' };
}

async function tellRequester(req, title, body) {
  if (!req.requested_by) return;
  await notify(req.requested_by, { kind: 'approval', title, body: body || '', ref_resource: 'allocation_request', ref_id: req.id });
}

/**
 * أثرُ قرار مدير المورد على طلب التسكين — يناديه محرّك الاعتماد داخل معاملته.
 * @param {object} reqRow صفّ طلب الاعتماد (resource_id = معرّف طلب التسكين)
 * @param {boolean} approved اعتُمد أم رُدّ
 * @param {string|null} actorUserId المعتمِد — يُنفَّذ الطلب بصلاحيته هو لا بصلاحية الطالب
 */
// يعيد للمحرّك `{ outcome }`: 'applied' | 'rejected' | 'returned' (مع `reason`) | null حين لا شيء
// يُبتّ فيه — فيغلق المحرّك الطلبَ على حقيقته (الإعادة تُغلَق مرفوضةً لا «اعتُمد طلبك»).
export async function settleAllocationRequest(reqRow, approved, actorUserId = null) {
  if (!reqRow || reqRow.resource !== 'allocation_request' || !reqRow.resource_id) return null;
  const req = await get('SELECT * FROM allocation_request WHERE id = ? AND deleted_at IS NULL', [reqRow.resource_id]);
  // قُرِّر من مساره (decideRequest) أو سُحب قبل البتّ — لا شيء يُبتّ فيه مرتين.
  if (!req || req.status !== 'pending') return null;
  const ctx = await systemCtxFor(actorUserId);
  if (!approved) {
    const last = await get('SELECT comment FROM approval_action WHERE request_id = ? ORDER BY acted_at DESC, id DESC LIMIT 1', [reqRow.id]);
    const reason = last?.comment || null;
    await finishRequest(ctx, req, { status: 'rejected', reason, decision_note: reason }, { via: 'approval_engine' });
    return { outcome: 'rejected', reason };
  }
  if (!ctx.user) {
    const reason = 'حساب المعتمِد غير نشط — يقرّره من يملك أمر المورد';
    await finishRequest(ctx, req, { status: 'returned', reason }, { via: 'approval_engine', code: 'no_actor' });
    await tellRequester(req, 'أُعيد طلب التسكين', reason);
    return { outcome: 'returned', reason };
  }
  const check = await revalidateRequest(req);
  if (!check.ok) {
    await finishRequest(ctx, req, { status: 'returned', reason: check.reason_ar }, { via: 'approval_engine', code: check.code });
    await tellRequester(req, 'أُعيد طلب التسكين', check.reason_ar);
    return { outcome: 'returned', reason: check.reason_ar };
  }
  const effect = await effectOf(req);
  let allocationId;
  try {
    allocationId = await applyRequest(ctx, req);
  } catch (e) {
    // رفضُ الكاتب (صلاحية أو قاعدة عمل) قرارٌ يُكتب على الطلب لا عطبٌ يُخفي القرار كله؛
    // وما سواه عطبٌ حقيقي يُرفع ليتراجع المحرّك بمعاملته.
    if (e instanceof HttpError && e.status < 500) {
      const reason = `تعذّر تنفيذ الطلب بصلاحية المعتمِد: ${e.message}`;
      await finishRequest(ctx, req, { status: 'returned', reason }, { via: 'approval_engine', code: 'writer_refused' });
      await tellRequester(req, 'أُعيد طلب التسكين', reason);
      return { outcome: 'returned', reason };
    }
    throw e;
  }
  await finishRequest(ctx, req, { status: 'applied', applied_allocation_id: allocationId }, { via: 'approval_engine', effect });
  return { outcome: 'applied', allocationId };
}
