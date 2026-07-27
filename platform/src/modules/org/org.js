// Organization service — flexible hierarchy editable from the UI (NOT hard-coded):
// Company → Sector → Department → Unit → Team → Position → Employee.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';
import { DELIVERY_KIND, SUPPORT_KIND, SECTOR_KINDS, isDelivery, isSupportUnit, DELIVERY_SECTOR_SQL }
  from '../../core/org/kind.js';

const requireAdminSectors = (user) => { if (!can(user, 'admin', 'sector') && user.role_id !== 'admin' && !can(user, 'create', 'sector')) throw forbidden('إدارة الهيكل تتطلب صلاحية إدارية'); };

// إنشاء/حذف قطاع قرار بنية شركة ⟵ إداري فقط. أما الإدارات والوحدات **داخل قطاع** فملكية صريحة
// عبر منح `department/admin`: بنطاق «قطاع» لقائد القطاع (قطاعه وحده)، وبنطاق «شركة» لمن يعلوه في
// التسلسل الهرمي (مكتب الرئيس التنفيذي) فيدير هيكل أي قطاع — قرار صريح من المالك.
// نُمذِج الملكية صراحةً بدل استعارة صلاحية «تعديل موظف» كبديل: البديل كان يمنح قائد القطاع
// ويحرم مكتب الرئيس التنفيذي، وهو عكس التسلسل الهرمي تماماً.
const canManageSectorOrg = (user, sectorId) =>
  user.role_id === 'admin' || can(user, 'admin', 'department', { sector_id: sectorId });
const requireSectorOrg = (user, sectorId) => {
  if (!canManageSectorOrg(user, sectorId)) throw forbidden('تعديل هيكل هذا القطاع يتطلب صلاحية إدارته');
};

// ── منع تكرار الأسماء (قرار صريح من المالك: «ما ينفع يكون في أسماء مكررة») ──
// المقارنة على اسم مطبَّع لا على النص الحرفي، وإلا مرّ «محمد  علي» و«محمّد علي» كاسمين مختلفين
// بينما هما نفس الشخص: تُوحَّد المسافات، ويُحذف التطويل والتشكيل، وتُوحَّد صور الألف والياء والتاء.
export function normName(s) {
  return String(s == null ? '' : s)
    .replace(/[ـً-ْٰ]/g, '')      // تطويل + تشكيل
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ ⟵ ا
    .replace(/ى/g, 'ي')                      // ى ⟵ ي
    .replace(/ة/g, 'ه')                      // ة ⟵ ه
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
// يرفع خطأً عربياً واضحاً عند وجود صف حيّ بنفس الاسم المطبَّع. excludeId يسمح بحفظ السجل نفسه.
async function assertNameFree({ table, nameAr, scopeCol = null, scopeVal = null, excludeId = null, label }) {
  const want = normName(nameAr);
  if (!want) return;
  const where = ['deleted_at IS NULL'];
  const params = [];
  if (scopeCol && scopeVal != null) { where.push(`${scopeCol} = ?`); params.push(scopeVal); }
  const rows = await all(`SELECT id, name_ar FROM ${table} WHERE ${where.join(' AND ')}`, params);
  const clash = rows.find((r) => r.id !== excludeId && normName(r.name_ar) === want);
  if (clash) throw badRequest(`${label} «${String(nameAr).trim()}» مستخدم بالفعل — اختر اسماً مختلفاً أو عدّل السجل القائم`);
}

// تواريخ الخدمة تُخزَّن نصاً بصيغة سنة-شهر-يوم (ISO) قابلاً للنقل بين المحرّكين والمقارنة نصياً.
// فارغ ⟵ غير معروف (null). نتحقق من الصيغة ومن كونه تاريخاً حقيقياً كي لا نُدخل قيمة لا تُقرأ
// لاحقاً في التقارير. مُحقِّق واحد لطرفَي الخدمة (تعيين/انتهاء) — لا نسخة ثانية تفترق قواعدها.
function normServiceDate(v, label, sample) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
    throw badRequest(`${label} غير صحيح — أدخله بصيغة سنة-شهر-يوم مثل ${sample}`);
  return s;
}
const normHireDate = (v) => normServiceDate(v, 'تاريخ التعيين', '2024-03-01');
// تاريخ انتهاء الخدمة (المغادرة): فارغ ⟵ ما زال على رأس العمل، لا «تاريخ مجهول».
const normEndDate = (v) => normServiceDate(v, 'تاريخ انتهاء الخدمة', '2026-06-30');
const todayIso = () => nowIso().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// نوع الوحدة التنظيمية: قطاع تسليم أم وحدة مساندة (الترحيلة 009)
// التعريف كاملاً — بما فيه سبب سكناه في النواة — في src/core/org/kind.js: أول قارئ للتمييز هو
// مقارنة القطاعات في core/reports، والنواة لا تستورد من الوحدات. يُعاد تصديره هنا كما هو حتى
// يبقى `import { isDelivery } from '.../modules/org/org.js'` عاملاً بلا تغيير في أي ملف قائم.
// ─────────────────────────────────────────────────────────────────────────────
export { DELIVERY_KIND, SUPPORT_KIND, SECTOR_KINDS, isDelivery, isSupportUnit, DELIVERY_SECTOR_SQL };

// يقبل الفراغ (⟵ قطاع تسليم) ويرفض أي قيمة أخرى برسالة تقول الخيارين المتاحين بلا مصطلحات.
export function normSectorKind(v) {
  if (v == null || String(v).trim() === '') return DELIVERY_KIND;
  const k = String(v).trim().toLowerCase();
  if (!SECTOR_KINDS.includes(k))
    throw badRequest('نوع الوحدة غير معروف — اختر «قطاع تسليم» لأحد قطاعات التسليم الأربعة، أو «وحدة مساندة» لوحدة على مستوى الشركة');
  return k;
}

// قائمة قطاعات التسليم وحدها — المصدر الواحد لكل شاشة تقول «قطاع»: مقارنة القطاعات، محوّل
// القطاع، تقسيم خط الفرص، أهداف المبيعات. وحدات المساندة لا تظهر فيها إطلاقاً.
// تُعيد الوصف التنظيمي فقط بلا أي هدف مالي، فلا تحتاج بوابة صلاحية: الأسماء والألوان معلومة
// عامة داخل المنصة، أما الأهداف فتُقرأ من orgTree ببوابتها القائمة.
export async function listDeliverySectors(opts = {}) {
  return await all(
    `SELECT id, name_ar, name_en, color, sort_order, active, kind FROM sector
      WHERE deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ${opts.activeOnly ? 'AND active = 1' : ''}
      ORDER BY sort_order, name_ar`);
}

// بطاقة تعريف القطاع لمن **يعمل داخله** لا لمن يقوده: اسمه ومن يقوده — لا أهداف ولا أرقام
// ولا موظفين. المساهم الفردي يحتاج أن يعرف أين يقف وإلى من يعود، وهذا كل ما يحتاجه.
// عمداً بلا حارس صلاحية: لا شيء هنا يتجاوز ما يعرفه أي زميل في القطاع نفسه.
export async function sectorIdentity(sectorId) {
  if (!sectorId) return null;
  return await get(
    `SELECT s.id, s.name_ar, s.color, s.kind, u.name_ar AS lead_name
       FROM sector s
       LEFT JOIN app_user u ON u.id = s.lead_user_id AND u.active = 1 AND u.deleted_at IS NULL
      WHERE s.id = ? AND s.deleted_at IS NULL`, [sectorId]) || null;
}

export async function orgTree(user) {
  // Gate: the org hierarchy (and its financial targets) must not be readable by any authenticated user.
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee') && !can(user, 'create', 'sector'))
    throw forbidden('عرض الهيكل التنظيمي يتطلب صلاحية إدارية');
  const seeTargets = user.scope === 'company'; // sector financial targets are company-level info
  // شجرة الهيكل تعرض **كل** الوحدات: قطاعات التسليم ووحدات المساندة معاً — بلا ترشيح نوع عمداً.
  // هي الشاشة التي تُدار منها وحدة المساندة أصلاً، وترشيحها هنا يُخفي موظفيها عن المنصة كلها.
  // (الترشيح مكانه شاشات «القطاع»: المقارنات والمحوّلات والأهداف — لا هنا.)
  const sectors = await all('SELECT * FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  return await Promise.all(sectors.map(async (s) => ({
    ...s,
    ...(seeTargets ? {} : { target_sales_halalas: null, target_revenue_halalas: null, target_margin_pct: null }),
    departments: await Promise.all((await all('SELECT * FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [s.id])).map(async (d) => ({
      ...d,
      units: await all('SELECT * FROM org_unit WHERE department_id = ? AND deleted_at IS NULL ORDER BY name_ar', [d.id]),
      employees: (await get('SELECT COUNT(*) n FROM employee WHERE department_id = ? AND deleted_at IS NULL', [d.id])).n,
    }))),
    employees: (await get('SELECT COUNT(*) n FROM employee WHERE sector_id = ? AND deleted_at IS NULL', [s.id])).n,
  })));
}

// ── Sector CRUD ──
export async function createSector(ctx, data) {
  requireAdminSectors(ctx.user);
  if (!data.id || !data.name_ar) throw badRequest('المعرّف والاسم مطلوبان');
  if (await get('SELECT id FROM sector WHERE id = ?', [data.id])) throw badRequest('المعرّف مستخدم');
  // النوع يُذكر صراحةً أو يُفهم قطاع تسليم — والفارق يظهر مباشرة في كل مقارنة، فيُسجَّل في التدقيق.
  const kind = normSectorKind(data.kind);
  await insert('sector', { id: data.id, name_ar: data.name_ar, name_en: data.name_en || null, color: data.color || '#2563eb',
    kind, target_sales_halalas: toHalalas(data.target_sales_sar), target_revenue_halalas: toHalalas(data.target_revenue_sar),
    target_margin_pct: data.target_margin_pct || 0, active: 1, is_placeholder: data.placeholder ? 1 : 0,
    sort_order: data.sort_order || 99, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'sector', resourceId: data.id, sectorId: data.id, detail: { kind } });
  return await get('SELECT * FROM sector WHERE id = ?', [data.id]);
}
export async function updateSector(ctx, sectorId, data) {
  requireAdminSectors(ctx.user);
  const s = await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) throw notFound('القطاع غير موجود');
  const patch = {};
  for (const k of ['name_ar', 'name_en', 'color', 'active', 'is_placeholder', 'sort_order', 'lead_user_id']) if (k in data) patch[k] = data[k];
  for (const [k, col] of [['target_sales_sar', 'target_sales_halalas'], ['target_revenue_sar', 'target_revenue_halalas']]) if (k in data) patch[col] = toHalalas(data[k]);
  if ('target_margin_pct' in data) patch.target_margin_pct = data.target_margin_pct;
  if ('kind' in data) {
    const kind = normSectorKind(data.kind);
    // تحويل قطاع تسليم إلى وحدة مساندة يُخرجه من كل مقارنة مبيعات ومن محوّل القطاع في اللحظة
    // نفسها، فيختفي عمله من شاشات المالك بلا رسالة تفسّر الاختفاء. مسموح ما دام القطاع فارغاً
    // (تصحيح إنشاء خاطئ)، وممنوع ما دام يحمل عملاً — والرسالة تقول ماذا يُنقل أولاً.
    if (kind === SUPPORT_KIND && isDelivery(s)) {
      const load = await get(
        `SELECT (SELECT COUNT(*) FROM project     WHERE sector_id = ? AND deleted_at IS NULL) AS projects,
                (SELECT COUNT(*) FROM opportunity WHERE sector_id = ? AND deleted_at IS NULL) AS opportunities`,
        [sectorId, sectorId]);
      const carried = [
        Number(load.projects) ? `${load.projects} مشروعاً` : null,
        Number(load.opportunities) ? `${load.opportunities} فرصة` : null,
      ].filter(Boolean);
      if (carried.length)
        throw badRequest(`لا يمكن تحويل «${s.name_ar}» إلى وحدة مساندة وفيه ${carried.join(' و')} — وحدة المساندة لا تدخل في مقارنات القطاعات، فانقل هذه الأعمال إلى قطاع تسليم آخر أولاً`);
    }
    patch.kind = kind;
  }
  patch.updated_at = nowIso(); patch.updated_by = ctx.user.id;
  await update('sector', sectorId, patch);
  await audit(ctx, { action: 'update', resource: 'sector', resourceId: sectorId, sectorId, detail: patch });
  return await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
}

// ── Department CRUD ──
export async function createDepartment(ctx, data) {
  if (!data.sector_id || !data.name_ar) throw badRequest('القطاع والاسم مطلوبان');
  requireSectorOrg(ctx.user, data.sector_id);
  if (!(await get('SELECT id FROM sector WHERE id = ?', [data.sector_id]))) throw badRequest('قطاع غير معروف');
  await assertNameFree({ table: 'department', nameAr: data.name_ar, scopeCol: 'sector_id', scopeVal: data.sector_id, label: 'اسم الإدارة' });
  const did = id('dep');
  await insert('department', { id: did, sector_id: data.sector_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'department', resourceId: did, sectorId: data.sector_id });
  return await get('SELECT * FROM department WHERE id = ?', [did]);
}

// تعديل إدارة: إعادة تسمية، تعيين مسؤول، أو **نقلها إلى قطاع آخر**. لم تكن هناك أي خدمة تعديل
// أو حذف للإدارات إطلاقاً — إنشاء فقط بلا رجعة. النقل بين قطاعين يتطلب صلاحية على الطرفين معاً.
export async function updateDepartment(ctx, depId, data = {}) {
  const d = await get('SELECT * FROM department WHERE id = ? AND deleted_at IS NULL', [depId]);
  if (!d) throw notFound('الإدارة غير موجودة');
  requireSectorOrg(ctx.user, d.sector_id);
  const patch = {};
  if ('sector_id' in data && data.sector_id && data.sector_id !== d.sector_id) {
    if (!(await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [data.sector_id]))) throw badRequest('قطاع غير معروف');
    requireSectorOrg(ctx.user, data.sector_id); // النقل يحتاج صلاحية على القطاع المستقبِل أيضاً
    patch.sector_id = data.sector_id;
  }
  if ('name_ar' in data && data.name_ar) {
    await assertNameFree({ table: 'department', nameAr: data.name_ar, scopeCol: 'sector_id',
      scopeVal: patch.sector_id || d.sector_id, excludeId: depId, label: 'اسم الإدارة' });
    patch.name_ar = data.name_ar;
  }
  for (const k of ['name_en', 'manager_user_id']) if (k in data) patch[k] = data[k] || null;
  if ('active' in data) patch.active = data.active ? 1 : 0;
  if (!Object.keys(patch).length) return d;
  patch.updated_at = nowIso();
  await update('department', depId, patch);
  await audit(ctx, { action: 'update', resource: 'department', resourceId: depId, sectorId: patch.sector_id || d.sector_id, detail: patch });
  return await get('SELECT * FROM department WHERE id = ?', [depId]);
}

// حذف ناعم للإدارة — يُرفض ما دام أحد يتبعها، كي لا يختفي موظفون من الشجرة بصمت.
export async function deleteDepartment(ctx, depId) {
  const d = await get('SELECT * FROM department WHERE id = ? AND deleted_at IS NULL', [depId]);
  if (!d) throw notFound('الإدارة غير موجودة');
  requireSectorOrg(ctx.user, d.sector_id);
  const emps = (await get('SELECT COUNT(*) n FROM employee WHERE department_id = ? AND deleted_at IS NULL', [depId])).n;
  if (emps) throw badRequest(`لا يمكن حذف الإدارة وبها ${emps} موظفاً — انقلهم إلى إدارة أخرى أولاً`);
  const units = (await get('SELECT COUNT(*) n FROM org_unit WHERE department_id = ? AND deleted_at IS NULL', [depId])).n;
  if (units) throw badRequest(`لا يمكن حذف الإدارة وبها ${units} وحدة — احذف الوحدات أولاً`);
  // العمل المنسوب إلى الإدارة يمنع حذفها أيضاً. بلا هذا الفحص يبقى المشروع أو الفرصة حاملاً
  // إدارةً محذوفة: فلا يظهر في تجميع أي إدارة، ولا يعود إلى صندوق «بلا إدارة» (لأن حقله ليس
  // فارغاً) — فيختفي من الشاشتين معاً بصمت. الحذف الناعم للإدارة لا يُنظّف أثرها من العمل.
  const work = await get(
    `SELECT (SELECT COUNT(*) FROM project     WHERE department_id = ? AND deleted_at IS NULL) AS projects,
            (SELECT COUNT(*) FROM opportunity WHERE department_id = ? AND deleted_at IS NULL) AS opportunities,
            (SELECT COUNT(*) FROM allocation  WHERE department_id = ? AND deleted_at IS NULL) AS allocations`,
    [depId, depId, depId],
  );
  const attached = [
    Number(work.projects) ? `${work.projects} مشروعاً` : null,
    Number(work.opportunities) ? `${work.opportunities} فرصة` : null,
    Number(work.allocations) ? `${work.allocations} سطر تسكين` : null,
  ].filter(Boolean);
  if (attached.length)
    throw badRequest(`لا يمكن حذف الإدارة ومنسوب إليها ${attached.join(' و')} — انقل هذه الأعمال إلى إدارة أخرى أو ألغِ نسبتها أولاً`);
  await update('department', depId, { deleted_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'department', resourceId: depId, sectorId: d.sector_id });
  return { ok: true };
}

// ── Unit / Team / Position ──
export async function createUnit(ctx, data) {
  if (!data.department_id || !data.name_ar) throw badRequest('الإدارة والاسم مطلوبان');
  const dep = await get('SELECT * FROM department WHERE id = ? AND deleted_at IS NULL', [data.department_id]);
  if (!dep) throw badRequest('إدارة غير معروفة');
  requireSectorOrg(ctx.user, dep.sector_id);
  await assertNameFree({ table: 'org_unit', nameAr: data.name_ar, scopeCol: 'department_id', scopeVal: data.department_id, label: 'اسم الوحدة' });
  const uid = id('unit');
  await insert('org_unit', { id: uid, department_id: data.department_id, name_ar: data.name_ar, name_en: data.name_en || null,
    manager_user_id: data.manager_user_id || null, active: 1, created_at: nowIso() });
  await audit(ctx, { action: 'create', resource: 'unit', resourceId: uid });
  return await get('SELECT * FROM org_unit WHERE id = ?', [uid]);
}

// ── Employee create/update + MOVE (reassign sector/department) ──
export async function createEmployee(ctx, data) {
  if (!can(ctx.user, 'create', 'employee', { sector_id: data.sector_id })) throw forbidden('إضافة موظف تتطلب صلاحية إدارة الفريق على هذا القطاع');
  if (!data.name_ar) throw badRequest('اسم الموظف مطلوب');
  // اسم الموظف فريد على مستوى الشركة كلها لا القطاع: تكراره يجعل التسكين والمهام والتقارير
  // تشير إلى شخص لا يُعرف أيّهما هو (قرار صريح من المالك).
  await assertNameFree({ table: 'employee', nameAr: data.name_ar, label: 'اسم الموظف' });
  const eid = id('emp');
  await insert('employee', { id: eid, name_ar: data.name_ar, name_en: data.name_en || null, sector_id: data.sector_id || null,
    department_id: data.department_id || null, unit_id: data.unit_id || null, position_id: data.position_id || null,
    job_title: data.job_title || null, hire_date: normHireDate(data.hire_date), salary_halalas: toHalalas(data.salary_sar),
    employment_type: data.employment_type || 'أساسي', status: 'نشط', active: 1, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'employee', resourceId: eid, sectorId: data.sector_id });
  return await get('SELECT * FROM employee WHERE id = ?', [eid]);
}
export async function moveEmployee(ctx, employeeId, data) {
  const e = await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden();
  const patch = { updated_at: nowIso() };
  for (const k of ['sector_id', 'department_id', 'unit_id', 'position_id', 'job_title', 'line_manager_id']) if (k in data) patch[k] = data[k];
  // salary edits require salary-read gate (HR/admin) — reuse sensitive gate
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: { moved: true } });
  return await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
}

// General attribute edit (name / job / type / status / active / service dates + salary when the
// caller may read it). Same gate for every field — no widened permission for the departure date.
// A sector manager editing across sectors is blocked by the sector-scoped 'update employee' grant.
export async function updateEmployee(ctx, employeeId, data) {
  const e = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden('تعديل الموظف يتطلب صلاحية إدارية على قطاعه');
  // ربط/فك ربط حساب الدخول يمر عبر خدمته المخصصة أدناه (تحققاتها وتدقيقها الخاص)، كي يبقى
  // مسار كتابة الهوية واحداً مهما كان الباب الذي دخل منه الطلب.
  let linkTouched = false;
  if ('link_user_id' in data) {
    if (data.link_user_id) await linkUserToEmployee(ctx, { employeeId, userId: data.link_user_id });
    else await unlinkUserFromEmployee(ctx, { employeeId });
    linkTouched = true;
  }
  // إعادة التسمية تخضع لقاعدة عدم التكرار نفسها — وإلا التُفّ عليها بإنشاء باسم مؤقت ثم تعديله.
  if ('name_ar' in data && data.name_ar) {
    await assertNameFree({ table: 'employee', nameAr: data.name_ar, excludeId: employeeId, label: 'اسم الموظف' });
  }
  const patch = { updated_at: nowIso() };
  for (const k of ['name_ar', 'name_en', 'job_title', 'employment_type', 'status', 'sector_id', 'department_id', 'position_id']) if (k in data) patch[k] = data[k];
  if ('hire_date' in data) patch.hire_date = normHireDate(data.hire_date);
  if ('end_date' in data) patch.end_date = normEndDate(data.end_date);
  // اتساق طرفَي الخدمة: لا تسبق المغادرة التعيين. المقارنة على القيمتين **الفعليتين بعد الحفظ**
  // لا على المُرسل وحده، وإلا مرّ تعديل تاريخ التعيين وحده فوق مغادرة مسجَّلة سلفاً فبقي السجل
  // متناقضاً. المقارنة نصية وهي صحيحة تماماً لصيغة سنة-شهر-يوم (ISO).
  if ('hire_date' in patch || 'end_date' in patch) {
    const hire = 'hire_date' in patch ? patch.hire_date : e.hire_date;
    const end = 'end_date' in patch ? patch.end_date : e.end_date;
    if (hire && end && end < hire)
      throw badRequest(`تاريخ انتهاء الخدمة ${end} أسبق من تاريخ التعيين ${hire} — صحّح أحد التاريخين ثم احفظ`);
  }
  if ('active' in data) patch.active = data.active ? 1 : 0;
  // ── قرار: تاريخ مغادرة **ماضٍ** يُنزل «نشط» إلى صفر ضمن العملية نفسها ──
  // البديل (ترك «نشط» كما هو وانتظار خطوة ثانية من المسؤول) يُنتج حالة يراها الجميع ولا يصدّقها
  // أحد: شخص تاريخ مغادرته أمس وما زال محسوباً في طاقة الفريق وفي كشف الإشغال — وهي بالضبط
  // الكذبة التي جاء هذا الحقل ليغلقها. والاشتقاق هنا متوقَّع لا خفي، بأربعة قيود:
  //   (١) الاختيار الصريح يفوز دائماً: إن ذكر الطلب «نشط» صراحةً احترمناه كما هو بلا تدخّل.
  //   (٢) لا ينطبق على تاريخ مستقبلي: من مغادرته الشهر القادم ما زال على رأس العمل اليوم.
  //   (٣) مسح تاريخ المغادرة لا يُعيد التنشيط تلقائياً: إعادة موظف للعمل قرار بشري صريح،
  //       والتنشيط الصامت أخطر من التعطيل الصامت.
  //   (٤) العمود يظهر في سطر التدقيق ضمن الأعمدة المعدَّلة، فيرى المراجع أن «نشط» تغيّر هنا.
  else if (patch.end_date && patch.end_date <= todayIso() && e.active !== 0) patch.active = 0;
  // moving to another sector requires update rights on the TARGET sector too
  if (patch.sector_id && patch.sector_id !== e.sector_id && !can(ctx.user, 'update', 'employee', { sector_id: patch.sector_id })) throw forbidden('لا تملك صلاحية على القطاع الهدف');
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  // طلب ربط فقط ⟵ لا نكتب تعديلاً فارغاً على الموظف ولا سطر تدقيق مكرراً
  if (linkTouched && Object.keys(patch).length === 1) return await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: Object.keys(patch) });
  return await get('SELECT * FROM employee WHERE id = ?', [employeeId]);
}

// Soft-delete (offboarding): mark the staff record removed without erasing history. Reversible by
// clearing deleted_at. Rosters and the org tree already filter deleted_at IS NULL, so the person
// drops off the team page immediately. Delete is HR/admin only (matrix), NOT sector managers.
export async function softDeleteEmployee(ctx, employeeId) {
  const e = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود أو محذوف سابقاً');
  if (!can(ctx.user, 'delete', 'employee', e)) throw forbidden('حذف موظف يتطلب صلاحية الموارد البشرية');
  await update('employee', employeeId, { deleted_at: nowIso(), active: 0, updated_at: nowIso() });
  await audit(ctx, { action: 'delete', resource: 'employee', resourceId: employeeId, sectorId: e.sector_id, detail: { name_ar: e.name_ar } });
  return { ok: true, id: employeeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// الهوية: ربط سجل الموظف بحساب الدخول
// العمود app_user.employee_id قائم منذ أول إصدار، لكن لم يكن في المنصة كلها مسار يكتبه — فبقي
// فارغاً لكل الحسابات. الأثر مباشر وليس تجميلياً: عضوية المشاريع ومعرّف الإدارة يُستنتجان من هذا
// الرابط، فمن لا رابط له لا تُحسب له عضوية مشروع ولا إدارة، وتظهر قوائم مدير المشروع فارغة،
// ويبقى نطاقا «الإدارة» و«الفريق» في الصلاحيات معطّلين. الخدمتان التاليتان هما مسار الكتابة
// الوحيد لهذا الرابط: تحقق كامل من الطرفين، منع الازدواج، وتدقيق على الطرفين معاً.
// ─────────────────────────────────────────────────────────────────────────────
const accountLabel = (u) => u.name_ar || u.username || 'حساب بلا اسم';
// الصلاحية: من يملك تعديل هذا الموظف يملك ربطه بحسابه (نفس بوابة تعديل بيانات الموظف).
function requireEmployeeUpdate(user, emp, verb) {
  if (!can(user, 'update', 'employee', emp))
    throw forbidden(`${verb} يتطلب صلاحية تعديل بيانات الموظف على قطاعه — راجع مدير النظام`);
}
async function employeeForLink(employeeId) {
  if (!employeeId) throw badRequest('اختر الموظف المراد ربطه بحساب دخول');
  const emp = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!emp) throw notFound('الموظف غير موجود أو محذوف — حدّث الصفحة ثم أعد المحاولة');
  return emp;
}

// يربط حساب دخول واحداً بموظف واحد. علاقة واحد-لواحد: لا حسابان لموظف، ولا موظفان لحساب.
export async function linkUserToEmployee(ctx, data = {}) {
  const employeeId = data.employeeId || data.employee_id || null;
  const userId = data.userId || data.user_id || null;
  const emp = await employeeForLink(employeeId);
  requireEmployeeUpdate(ctx.user, emp, 'ربط الموظف بحساب دخول');
  if (!userId) throw badRequest('اختر حساب الدخول الذي يخص هذا الموظف');
  const acc = await get('SELECT * FROM app_user WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!acc) throw notFound('حساب الدخول غير موجود أو محذوف — اختر حساباً آخر من القائمة');
  // الطرف الثاني (الحساب) يخضع لنطاق الرابِط أيضاً: قائد القطاع يربط حسابات قطاعه فقط، وإلا
  // لأمكنه تغيير ما يراه شخص من قطاع آخر بربط حسابه بموظف عنده. نطاق الشركة (الموارد البشرية
  // ومدير النظام) غير مقيَّد. هذا مطابق تماماً لما تعرضه القائمة في الواجهة.
  const companyWide = ctx.user.scope === 'company' || ctx.user.role_id === 'admin';
  if (!companyWide && (acc.sector_id || null) !== (ctx.user.sector_id || null))
    throw forbidden(`حساب ${accountLabel(acc)} خارج نطاق قطاعك — اطلب من الموارد البشرية ربطه`);
  // هل الموظف محجوز لحساب آخر؟
  const taken = await get(
    'SELECT id, username, name_ar FROM app_user WHERE employee_id = ? AND deleted_at IS NULL AND id <> ? LIMIT 1',
    [employeeId, userId]);
  if (taken) throw badRequest(`${emp.name_ar} مربوط بحساب ${accountLabel(taken)} — فُكّ الربط الحالي أولاً ثم أعد المحاولة`);
  if (acc.employee_id === employeeId) throw badRequest(`${emp.name_ar} مربوط بهذا الحساب مسبقاً — لا حاجة لإعادة الربط`);
  if (acc.employee_id) {
    const other = await get('SELECT name_ar FROM employee WHERE id = ?', [acc.employee_id]);
    throw badRequest(`حساب ${accountLabel(acc)} مربوط بالموظف ${other ? other.name_ar : 'موظف آخر'} — فُكّ ربطه أولاً ثم أعد المحاولة`);
  }
  const at = nowIso();
  await tx(async () => {
    await update('app_user', userId, { employee_id: employeeId, updated_at: at, updated_by: ctx.user.id });
    // الطرف المقابل في سجل الموظف يبقى متسقاً مع الحساب (عمود قائم، لا يحتاج أي تعديل للبنية)
    await update('employee', employeeId, { user_id: userId, updated_at: at });
    await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: emp.sector_id,
      detail: { linked_user_id: userId, username: acc.username || null } });
    await audit(ctx, { action: 'update', resource: 'app_user', resourceId: userId, sectorId: emp.sector_id,
      detail: { linked_employee_id: employeeId, employee_name_ar: emp.name_ar } });
  });
  return { ok: true, employee_id: employeeId, employee_name_ar: emp.name_ar,
    user_id: userId, username: acc.username || null, user_name_ar: acc.name_ar || null };
}

// يفك الربط. يقبل employeeId (الشائع من صفحة «الفريق») أو userId مباشرة.
export async function unlinkUserFromEmployee(ctx, data = {}) {
  let employeeId = data.employeeId || data.employee_id || null;
  let userId = data.userId || data.user_id || null;
  if (!employeeId && !userId) throw badRequest('حدّد الموظف أو الحساب المراد فك ربطه');
  if (!employeeId) {
    const acc0 = await get('SELECT employee_id FROM app_user WHERE id = ? AND deleted_at IS NULL', [userId]);
    if (!acc0) throw notFound('حساب الدخول غير موجود أو محذوف');
    if (!acc0.employee_id) throw badRequest('هذا الحساب غير مربوط بأي موظف — لا شيء لفكّه');
    employeeId = acc0.employee_id;
  }
  const emp = await employeeForLink(employeeId);
  requireEmployeeUpdate(ctx.user, emp, 'فك ربط الموظف بحساب الدخول');
  const acc = await get(
    `SELECT id, username, name_ar FROM app_user WHERE employee_id = ? AND deleted_at IS NULL ${userId ? 'AND id = ?' : ''} LIMIT 1`,
    userId ? [employeeId, userId] : [employeeId]);
  if (!acc) throw badRequest(`${emp.name_ar} غير مربوط بأي حساب دخول — لا شيء لفكّه`);
  const at = nowIso();
  await tx(async () => {
    await update('app_user', acc.id, { employee_id: null, updated_at: at, updated_by: ctx.user.id });
    await update('employee', employeeId, { user_id: null, updated_at: at });
    await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: emp.sector_id,
      detail: { unlinked_user_id: acc.id, username: acc.username || null } });
    await audit(ctx, { action: 'update', resource: 'app_user', resourceId: acc.id, sectorId: emp.sector_id,
      detail: { unlinked_employee_id: employeeId, employee_name_ar: emp.name_ar } });
  });
  return { ok: true, employee_id: employeeId, employee_name_ar: emp.name_ar, user_id: acc.id };
}

// لوحة حالة الربط لصفحة «الفريق»: من مربوط بمن، كم موظفاً نشطاً بلا حساب، وقائمة الحسابات
// غير المربوطة (تُعرض فقط لمن يملك الربط). نطاق الموظفين = نفس نطاق كشف الفريق تماماً.
export async function identityLinks(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('عرض ارتباط الحسابات يتطلب صلاحية عرض الفريق');
  const sec = user.scope === 'company' ? (opts.sector || null) : (user.sector_id || null);
  const rows = await all(`SELECT e.id employee_id, e.active, u.id user_id, u.username, u.name_ar user_name_ar, u.role_id
     FROM employee e LEFT JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL
     WHERE e.deleted_at IS NULL ${sec ? 'AND e.sector_id = ?' : ''}
     ORDER BY e.id, u.id`, sec ? [sec] : []);
  const byEmployee = {};
  let linked = 0, unlinked = 0;
  for (const r of rows) {
    if (r.employee_id in byEmployee) continue; // أول حساب فقط — الازدواج ممنوع أصلاً في الربط
    byEmployee[r.employee_id] = r.user_id
      ? { user_id: r.user_id, username: r.username || null, name_ar: r.user_name_ar || null, role_id: r.role_id || null }
      : null;
    if (r.user_id) linked++;
    else if (r.active !== 0) unlinked++; // غير النشط لا يحتاج حساباً — لا يُحسب في التنبيه
  }
  // الحسابات المتاحة للربط: نطاق الشركة يرى الجميع، ونطاق القطاع يرى حسابات قطاعه فقط
  // (دليل المستخدمين الكامل شاشة إدارية، لا يُفتح ضمناً من صفحة الفريق).
  const canLink = can(user, 'update', 'employee');
  let freeAccounts = [];
  if (canLink) {
    const base = `SELECT id, username, name_ar, role_id, sector_id FROM app_user
       WHERE deleted_at IS NULL AND active = 1 AND employee_id IS NULL`;
    if (user.scope === 'company') freeAccounts = await all(`${base} ORDER BY name_ar, username`);
    else if (user.sector_id) freeAccounts = await all(`${base} AND sector_id = ? ORDER BY name_ar, username`, [user.sector_id]);
  }
  return { byEmployee, freeAccounts, linkedCount: linked, unlinkedCount: unlinked, canLink };
}

// Staffing roster v3 — PLANNED utilization from the allocation model (scoped) PLUS opportunity
// soft load (membership group_kind='opportunity' with allocation_pct on an OPEN opportunity,
// counted against the CURRENT month only, labeled 'فرصة'). Company users may pass a sector
// filter; sector-scoped users are locked to their own sector.
// opts.month (1–12) overrides the "current month" for deterministic tests/renders.
export async function staffingRoster(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('عرض الفريق يتطلب صلاحية');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const sec = user.scope === 'company' ? (opts.sector || null) : (user.sector_id || null);
  const emps = await all(`SELECT * FROM employee WHERE deleted_at IS NULL ${sec ? 'AND sector_id = ?' : ''} ORDER BY name_ar`, sec ? [sec] : []);
  const allocs = await all(`SELECT a.id, a.employee_id, a.project_id, a.project_name, a.type, a.monthly_json, p.name_ar proj_name, p.status proj_status
     FROM allocation a LEFT JOIN project p ON p.id = a.project_id
     WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IS NOT NULL ${sec ? 'AND a.sector_id = ?' : ''}`, sec ? [year, sec] : [year]);
  const byEmp = {};
  for (const a of allocs) (byEmp[a.employee_id] ||= []).push(a);
  // Opportunity soft load: open-opportunity team memberships with an allocation % — demand that
  // hasn't converted to a project yet, so it weighs on "now" only (not the yearly plan).
  const oppRows = await all(`SELECT m.id membership_id, m.employee_id, m.allocation_pct, m.role_in_group, o.id opp_id, o.title_ar
     FROM membership m JOIN opportunity o ON o.id = m.group_id LEFT JOIN stage st ON st.id = o.stage_id
     WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND m.allocation_pct > 0
       AND o.deleted_at IS NULL AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0`);
  const oppByEmp = {};
  for (const r of oppRows) (oppByEmp[r.employee_id] ||= []).push(r);
  // "current month": explicit override wins (determinism); otherwise the live month when viewing
  // the live year — a past/future year has no meaningful "now".
  const mOverride = Number(opts.month);
  const nowM = Number.isInteger(mOverride) && mOverride >= 1 && mOverride <= 12
    ? mOverride
    : (year === new Date().getUTCFullYear() ? (new Date().getUTCMonth() + 1) : 0);
  const roster = emps.map((e) => {
    const mine = byEmp[e.id] || [];
    const monthLoad = Array(12).fill(0);
    const projects = mine.map((a) => {
      let mj = {}; try { mj = JSON.parse(a.monthly_json || '{}'); } catch { mj = {}; }
      for (const [m, f] of Object.entries(mj)) { const i = Number(m) - 1; if (i >= 0 && i < 12) monthLoad[i] += Number(f) || 0; }
      return { allocId: a.id, projectId: a.project_id, name: a.proj_name || a.project_name || '—', type: a.type || 'member', status: a.proj_status, months: mj };
    });
    const opportunities = (oppByEmp[e.id] || []).map((r) => ({
      membershipId: r.membership_id, opportunityId: r.opp_id, name: r.title_ar || '—',
      pct: Math.round(Number(r.allocation_pct) || 0), role: r.role_in_group || 'member', label: 'فرصة',
    }));
    const oppLoadPct = opportunities.reduce((a, o) => a + o.pct, 0);
    // prev-month util from PROJECT plan only (soft load applies to the current month by definition)
    const prevMonthUtil = nowM >= 2 ? Math.round(monthLoad[nowM - 2] * 100) : 0;
    if (nowM && oppLoadPct) monthLoad[nowM - 1] += oppLoadPct / 100; // soft load lands on "now"
    const months = monthLoad.map((f) => Math.round(f * 100));
    const annualUtil = Math.round(months.reduce((a, b) => a + b, 0) / 12); // % of annual capacity used
    const currentUtil = nowM ? months[nowM - 1] : 0;                        // this month's load (incl. soft)
    const monthDelta = nowM ? currentUtil - prevMonthUtil : 0;              // vs last month's planned load
    const staffedMonths = months.filter((m) => m > 0).length;
    const intensity = staffedMonths ? Math.round(months.filter((m) => m > 0).reduce((a, b) => a + b, 0) / staffedMonths) : 0; // avg load WHEN staffed
    return { id: e.id, name_ar: e.name_ar, name_en: e.name_en, job_title: e.job_title, employment_type: e.employment_type,
      // طرفا الخدمة معاً: بلا تاريخ المغادرة يبقى «غير نشط» في الكشف بلا إجابة على «متى غادر»
      status: e.status, active: e.active, sector_id: e.sector_id, hire_date: e.hire_date, end_date: e.end_date,
      // QH-1: الراتب حقل حساس — يُسلسَل فقط لمن يملك صلاحية قراءته (HR/admin)، في الواجهة والـAPI معاً
      ...(can(user, 'read', 'salary') ? { salary_halalas: e.salary_halalas } : {}),
      months, annualUtil, currentUtil, prevMonthUtil, monthDelta, oppLoadPct, staffedMonths, intensity, peak: Math.max(0, ...months),
      overMonths: months.filter((m) => m > 100).length, projects, projectCount: projects.length, opportunities };
  });
  // Order by who is busiest NOW, then by annual load, then name — so managers see live staffing first.
  roster.sort((a, b) => (b.currentUtil - a.currentUtil) || (b.annualUtil - a.annualUtil) || String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
  // Decision-story summary: capacity vs assigned NOW + who needs a staffing decision.
  const active = roster.filter((e) => e.active !== 0);
  const summary = {
    capacityFte: active.length,
    assignedNowFte: Math.round(active.reduce((a, e) => a + e.currentUtil, 0)) / 100, // Σ current fractions
    benchNow: active.filter((e) => e.currentUtil === 0).length,
    overloadedNow: active.filter((e) => e.currentUtil > 110).length,
    underusedNow: active.filter((e) => e.currentUtil > 0 && e.currentUtil < 40).length,
  };
  return { year, sector: sec, currentMonth: nowM, roster, summary };
}
