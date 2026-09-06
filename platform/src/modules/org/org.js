// Organization service — flexible hierarchy editable from the UI (NOT hard-coded):
// Company → Sector → Department → Unit → Team → Position → Employee.
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can, effectiveScope, redact } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { departmentScope, departmentInSql } from '../../core/rbac/departments.js';
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
// المعرّف يظهر في الروابط، واللون يُحقن في خاصية التنسيق (style) في كل لوحة — فكلاهما مُقيَّد
// بشكلٍ صارم عند الكتابة: المعرّف حروفٌ وأرقامٌ وشرطة فقط، واللون رمزٌ ست‑عشري لا نصٌّ حر.
const SECTOR_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
function normHexColor(v) {
  if (v == null || v === '') return '#2563eb';
  const s = String(v).trim();
  if (!HEX_COLOR_RE.test(s)) throw badRequest('اللون يجب أن يكون رمزاً لونياً صحيحاً مثل #2563eb');
  return s;
}
// المستهدفات المالية بالريال: فراغٌ = صفر، لكن نصاً غير رقمي لا يمرّ بصمت فيصير NaN (فراغٌ على
// SQLite، عطلٌ على Postgres) — بل يُردّ بخطأٍ عربيٍّ واضح.
function normTargetHalalas(v) {
  if (v == null || String(v).trim() === '') return 0;
  const h = toHalalas(v);
  if (!Number.isFinite(h) || h < 0) throw badRequest('اكتب المستهدف بالريال رقماً موجباً');
  return h;
}
function rejectLegacyTargets(data) {
  if (['target_sales_sar', 'target_revenue_sar', 'target_margin_pct'].some((k) => k in data && data[k] !== '' && data[k] != null && Number(data[k]) !== 0))
    throw badRequest('حدّد السنة من صفحة مستهدفات القطاع؛ لا يمكن حفظ مستهدف بلا سنة');
}
export async function createSector(ctx, data) {
  rejectLegacyTargets(data);
  requireAdminSectors(ctx.user);
  if (!data.id || !data.name_ar) throw badRequest('المعرّف والاسم مطلوبان');
  if (!SECTOR_ID_RE.test(String(data.id))) throw badRequest('المعرّف يقبل الحروف والأرقام والشرطة فقط');
  if (await get('SELECT id FROM sector WHERE id = ?', [data.id])) throw badRequest('المعرّف مستخدم');
  // النوع يُذكر صراحةً أو يُفهم قطاع تسليم — والفارق يظهر مباشرة في كل مقارنة، فيُسجَّل في التدقيق.
  const kind = normSectorKind(data.kind);
  await insert('sector', { id: data.id, name_ar: data.name_ar, name_en: data.name_en || null, color: normHexColor(data.color),
    kind, target_sales_halalas: normTargetHalalas(data.target_sales_sar), target_revenue_halalas: normTargetHalalas(data.target_revenue_sar),
    target_margin_pct: data.target_margin_pct || 0, active: 1, is_placeholder: data.placeholder ? 1 : 0,
    sort_order: data.sort_order || 99, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'sector', resourceId: data.id, sectorId: data.id, detail: { kind } });
  return await get('SELECT * FROM sector WHERE id = ?', [data.id]);
}
export async function updateSector(ctx, sectorId, data) {
  if (['target_sales_sar', 'target_revenue_sar', 'target_margin_pct'].some((k) => k in data))
    throw badRequest('عدّل المستهدف من صفحة مستهدفات القطاع بعد تحديد السنة');
  requireAdminSectors(ctx.user);
  const s = await get('SELECT * FROM sector WHERE id = ?', [sectorId]);
  if (!s) throw notFound('القطاع غير موجود');
  const patch = {};
  for (const k of ['name_ar', 'name_en', 'color', 'active', 'is_placeholder', 'sort_order', 'lead_user_id']) if (k in data) patch[k] = data[k];
  if ('color' in patch) patch.color = normHexColor(patch.color);
  for (const [k, col] of [['target_sales_sar', 'target_sales_halalas'], ['target_revenue_sar', 'target_revenue_halalas']]) if (k in data) patch[col] = normTargetHalalas(data[k]);
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
  // ختم الراتب كان بلا جانب كتابة عند الإنشاء. التعديل والنقل كلاهما يشترط صلاحية قراءة الراتب،
  // أمّا الإنشاء فكان يكتب ما يُرسَل بلا فحص — فيستطيع من لا يملك رؤية الراتب أن **يحدّده**، ثم
  // لا يقدر على قراءة ما كتب. ثبت عملياً: قائد قطاع بلا صلاحية الراتب أنشأ موظفاً براتب فحُفِظ.
  // ومن يكتب رقماً لا يراه أحد غيره يفتح باباً للتلاعب بلا أثر مرئي. البوابة هنا هي بوابة التعديل نفسها.
  const maySetSalary = can(ctx.user, 'read', 'salary');
  // وغياب الراتب ليس صفراً: التحويل كان يجعل «لم يُدخَل» و«بلا أجر» شيئاً واحداً إلى الأبد، فلا
  // يُعرف أنقصٌ في البيانات هو أم واقع. الفراغ يبقى فراغاً حتى يُدخِله من يملك ذلك.
  const salaryHalalas = maySetSalary && data.salary_sar != null && String(data.salary_sar).trim() !== ''
    ? toHalalas(data.salary_sar) : null;
  await insert('employee', { id: eid, name_ar: data.name_ar, name_en: data.name_en || null, sector_id: data.sector_id || null,
    department_id: data.department_id || null, unit_id: data.unit_id || null, position_id: data.position_id || null,
    job_title: data.job_title || null, hire_date: normHireDate(data.hire_date), salary_halalas: salaryHalalas,
    employment_type: data.employment_type || 'أساسي', status: 'نشط', active: 1, created_at: nowIso(), created_by: ctx.user.id });
  await audit(ctx, { action: 'create', resource: 'employee', resourceId: eid, sectorId: data.sector_id });
  return redact(ctx.user, 'employee', await get('SELECT * FROM employee WHERE id = ?', [eid]));
}
export async function moveEmployee(ctx, employeeId, data) {
  const e = await get('SELECT * FROM employee WHERE id = ? AND deleted_at IS NULL', [employeeId]);
  if (!e) throw notFound('الموظف غير موجود');
  if (!can(ctx.user, 'update', 'employee', e)) throw forbidden('نقل الموظف يتطلب صلاحية إدارية على قطاعه');
  const patch = { updated_at: nowIso() };
  for (const k of ['sector_id', 'department_id', 'unit_id', 'position_id', 'job_title', 'line_manager_id']) if (k in data) patch[k] = data[k];

  // ── بوابة القطاع الهدف ──
  // كان الفحص على قطاع الموظف **الحالي** وحده: من يملك «تعديل موظف» بنطاق قطاعه يستطيع أن
  // يدفع أحد أهله إلى أي قطاع آخر — فيظهر في كشف ذلك القطاع وطاقته وتسكينه بلا أن يملك أحدٌ
  // هناك قراراً في ذلك. (الاتجاه المعاكس كان مغلقاً أصلاً، فكانت ثغرةَ دفعٍ باتجاه واحد.)
  // الشرط نفسه المطبَّق في updateEmployee — مصدرٌ واحد للقاعدة لا بابان يفترقان.
  if (patch.sector_id && patch.sector_id !== e.sector_id
    && !can(ctx.user, 'update', 'employee', { sector_id: patch.sector_id })) {
    throw forbidden('لا تملك صلاحية على القطاع الهدف');
  }
  await assertDepartmentInSector(patch, e);
  // salary edits require salary-read gate (HR/admin) — reuse sensitive gate
  if ('salary_sar' in data && can(ctx.user, 'read', 'salary')) patch.salary_halalas = toHalalas(data.salary_sar);
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: { moved: true } });
  return redact(ctx.user, 'employee', await get('SELECT * FROM employee WHERE id = ?', [employeeId]));
}

// الإدارة تسكن قطاعاً بعينه، فموظفٌ قطاعه «أ» وإدارته تحت «ب» سجلٌّ يناقض نفسه: تعدّه شجرة
// الهيكل في «ب» ويعدّه كشف القطاع في «أ»، فيُقرأ الرقمان مختلفين ولا أحد يعرف أيّهما الصحيح.
// يُفحص الطرفان **بعد الدمج** لا المُرسل وحده — تغييرُ القطاع وحده فوق إدارةٍ قديمة يُنتج
// التناقض نفسه بلا أن يذكر الطلب إدارةً إطلاقاً.
async function assertDepartmentInSector(patch, current) {
  const depId = 'department_id' in patch ? patch.department_id : current.department_id;
  const secId = 'sector_id' in patch ? patch.sector_id : current.sector_id;
  if (!depId) return;
  const dep = await get('SELECT id, sector_id, name_ar FROM department WHERE id = ? AND deleted_at IS NULL', [depId]);
  if (!dep) throw badRequest('الإدارة المختارة غير موجودة');
  if (secId && dep.sector_id !== secId) {
    throw badRequest(`إدارة «${dep.name_ar}» ليست تحت القطاع المختار — اختر إدارةً من القطاع نفسه أو انقله بلا إدارة`);
  }
}

// ── نقل مجموعة في خطوة واحدة ──
// «لازم سهل نقل الموظفين من الإدارات او الى قطاعات اخرى» — بلسان المالك. ونقلُ واحدٍ في كل مرة
// من نافذة تعديله ليس «سهلاً» حين تُعاد هيكلة إدارة بأكملها: اثنا عشر فتحاً وإغلاقاً.
//
// لا مسار مختصر: كل موظف يمرّ بـmoveEmployee نفسه بفحصه وسطر تدقيقه — الدفعة توفّر النقرات
// لا التحققات. وتُلفّ في معاملة واحدة: نقلٌ نصفُه نجح ونصفُه سقط يترك الإدارة مشطورة بلا أن
// يعرف أحد أين وقف.
export async function moveEmployees(ctx, data = {}) {
  const ids = [...new Set((Array.isArray(data.employeeIds) ? data.employeeIds : []).map(String).filter(Boolean))];
  if (!ids.length) throw badRequest('اختر موظفاً واحداً على الأقل لنقله');
  if (ids.length > 200) throw badRequest('الدفعة الواحدة حتى ٢٠٠ موظف — قسّمها على دفعات');
  const target = {};
  if ('sector_id' in data) target.sector_id = data.sector_id || null;
  // «بلا إدارة» خيارٌ مقصود لا قيمة غائبة: من يُنقل إلى قطاع بلا إدارات يجب أن يمكن وضعه فيه.
  if ('department_id' in data) target.department_id = data.department_id || null;
  if (!Object.keys(target).length) throw badRequest('حدّد القطاع أو الإدارة التي تنقلهم إليها');
  const moved = [];
  await tx(async () => {
    for (const id of ids) moved.push(await moveEmployee(ctx, id, target));
  });
  return { moved: moved.length, employees: moved };
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
  if (linkTouched && Object.keys(patch).length === 1) return redact(ctx.user, 'employee', await get('SELECT * FROM employee WHERE id = ?', [employeeId]));
  await update('employee', employeeId, patch);
  await audit(ctx, { action: 'update', resource: 'employee', resourceId: employeeId, sectorId: patch.sector_id || e.sector_id, detail: Object.keys(patch) });
  return redact(ctx.user, 'employee', await get('SELECT * FROM employee WHERE id = ?', [employeeId]));
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
  // الربط عمودان لا عمود: `app_user.employee_id` و`employee.user_id`. فإن كتب أحدهما وسقط
  // الآخر صار «ربطاً نصفياً» — والحساب يقول إنه مربوط بينما سجلّ الموظف لا يعرفه، فيظهر الموظف
  // بلا ملفٍّ ولا تسكين وإن كان الحساب يشير إليه. وردُّ «مربوط مسبقاً» هنا كان يمنع الإصلاح
  // بالضبط حين يكون الإصلاح مطلوباً: يخبر المشغّل أن الربط سليم والنصف الآخر غائب. فلا يُردّ
  // إلا إن **اتفق العمودان**؛ وإلا يمضي إلى المعاملة أدناه فتكتبهما معاً وتُغلق النصف الناقص.
  if (acc.employee_id === employeeId && emp.user_id === userId)
    throw badRequest(`${emp.name_ar} مربوط بهذا الحساب مسبقاً — لا حاجة لإعادة الربط`);
  // وحين يشير الحساب إلى **موظف آخر** يبقى الردّ كما هو. أما إشارته إلى موظفنا هذا مع نصفٍ
  // ناقص فتمرّ إلى المعاملة أدناه: هي الإكمال نفسه، تكتب العمودين معاً.
  if (acc.employee_id && acc.employee_id !== employeeId) {
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

// ─────────────────────────────────────────────────────────────────────────────
// نطاق الأشخاص — الحدّ الذي ينتهي عنده كشف الفريق لكل قارئ
// كانت كل شاشة أشخاص ترشّح بالقطاع وحده، وعمود `employee.department_id` لا يُستعمل مرشِّحاً في
// أي مكان. الأثر المباشر: «مدير الإدارة» كل منحه بنطاق «إدارة» (core/rbac/matrix.js) ومع ذلك
// يفتح «الفريق» أو «التسكين» فيرى موظفي القطاع كلهم بإداراته الأخرى.
// السؤال هنا **نطاقي لا وجودي**: can(...) بلا هدف يعيد «صحيح» لمجرد وجود المنح مهما كان نطاقه،
// فنقرأ أوسع نطاق يملكه القارئ فعلاً (effectiveScope) ونترجمه إلى شرط داخل الاستعلام نفسه —
// لا تصفية بعد القراءة.
// ثلاث قواعد لا رابع لها:
//   • «شركة»: كما كان — يختار قطاعاً أو يرى الجميع.
//   • «قطاع» وما دونه: كما كان — محبوس في قطاعه.
//   • «إدارة»: يُضاف شرط الإدارة **فوق** شرط القطاع، فالتضييق يزيد ولا ينقص أبداً.
// وفشل آمن لا مفتوح: من نطاقه «إدارة» وحسابه غير مربوط بسجل موظف فإدارته مجهولة — والمجهول
// يعني كشفاً فارغاً بحالته المصمَّمة، لا اتساعاً صامتاً إلى القطاع كله.
// نطاق قراءة الأشخاص — مصدر واحد تستهلكه كل سطوح الناس: كشف الفريق، وحالة ربط الحسابات،
// **وتصدير الموظفين**. تصديره ليس تجميلاً: أي سطح يعيد اشتقاق النطاق بنفسه ينحرف عن البقية،
// وقد انحرف التصدير فعلاً فوقف عند القطاع بينما الشاشات تضيّق إلى الإدارة.
// تحديث: «إدارته» صارت **مجموعة إداراته** — انتماؤه ومعه كل إدارة يقودها. العمود المفرد
// `employee.department_id` لا يسع مديراً يقود إدارتين، وهو حالٌ قائم في الشركة اليوم لا فرضٌ
// نظري. فكان يفتح «الفريق» فيرى نصف من يقود، ويطلب كشفاً باسم من غاب فلا يجده في المنصة أصلاً.
// وحدّ الفراغ كما هو: لا انتماء ولا قيادة ⟵ `blind` ⟵ كشف فارغ، لا القطاع كله.
export function peopleScope(user, requestedSector = null) {
  const sector = user.scope === 'company' ? (requestedSector || null) : (user.sector_id || null);
  const byDepartment = effectiveScope(user, 'read', 'employee') === 'department';
  const departments = byDepartment ? departmentScope(user) : [];
  return {
    sector, departments,
    // مفرد باقٍ للتوافق مع من يقرأ «إدارته» عرضاً لا ترشيحاً — والترشيح يقرأ `departments`.
    department: departments.length === 1 ? departments[0] : null,
    blind: byDepartment && !departments.length,
  };
}

// لوحة حالة الربط لصفحة «الفريق»: من مربوط بمن، كم موظفاً نشطاً بلا حساب، وقائمة الحسابات
// غير المربوطة (تُعرض فقط لمن يملك الربط). نطاق الموظفين = نفس نطاق كشف الفريق تماماً —
// من المصدر نفسه (peopleScope)، وإلا افترق جدول الأشخاص عن عمود «حساب الدخول» في الصفحة ذاتها.
export async function identityLinks(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('عرض ارتباط الحسابات يتطلب صلاحية عرض الفريق');
  const { sector: sec, departments: deps, blind } = peopleScope(user, opts.sector);
  const where = ['e.deleted_at IS NULL'];
  const params = [];
  if (sec) { where.push('e.sector_id = ?'); params.push(sec); }
  if (deps.length) {
    const inDeps = departmentInSql('e.department_id', deps);
    where.push(inDeps.clause);
    params.push(...inDeps.params);
  }
  const rows = blind ? [] : await all(`SELECT e.id employee_id, e.active, u.id user_id, u.username, u.name_ar user_name_ar, u.role_id
     FROM employee e LEFT JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL
     WHERE ${where.join(' AND ')}
     ORDER BY e.id, u.id`, params);
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
// نطاق الأشخاص كله من peopleScope أعلاه: القطاع كما كان، والإدارة شرطٌ إضافي لمن نطاقه «إدارة».
export async function staffingRoster(user, opts = {}) {
  if (user.role_id !== 'admin' && !can(user, 'read', 'employee')) throw forbidden('عرض الفريق يتطلب صلاحية');
  const year = Number(opts.year) || new Date().getUTCFullYear();
  const { sector: sec, departments: deps, blind } = peopleScope(user, opts.sector);
  const empWhere = ['deleted_at IS NULL'];
  const empParams = [];
  if (sec) { empWhere.push('sector_id = ?'); empParams.push(sec); }
  if (deps.length) {
    const inDeps = departmentInSql('department_id', deps);
    empWhere.push(inDeps.clause);
    empParams.push(...inDeps.params);
  }
  // مرشِّح الإدارة (v5.26) يضيّق داخل النطاق المحلول ولا يوسّعه أبداً: قارئٌ بنطاق إداراتٍ
  // لا يمرّر إلا إحداها، وقارئُ قطاعٍ/شركةٍ تُقبل إدارته إن كانت من قطاع الكشف — وما سوى
  // ذلك يُتجاهل بصمت (فاشل-مغلقاً: رابطٌ معطوب يعرض نطاقه المعتاد لا أكثر ولا خطأً).
  let effectiveDept = null;
  const wantDept = String(opts.department || '').trim();
  if (wantDept && !blind) {
    if (deps.length) {
      if (deps.includes(wantDept)) effectiveDept = wantDept;
    } else {
      const dRow = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [wantDept]);
      if (dRow && (!sec || dRow.sector_id === sec)) effectiveDept = wantDept;
    }
    if (effectiveDept) { empWhere.push('department_id = ?'); empParams.push(effectiveDept); }
  }
  const emps = blind ? []
    : await all(`SELECT * FROM employee WHERE ${empWhere.join(' AND ')} ORDER BY name_ar`, empParams);
  // التسكينات تُقرأ بمفتاح الموظف ثم تُوزَّع على الكشف؛ فمن خرج من الكشف لا يُقرأ له سطر أصلاً.
  const allocs = blind ? []
    : await all(`SELECT a.id, a.employee_id, a.project_id, a.project_name, a.type, a.work_bucket, a.monthly_json, p.name_ar proj_name, p.status proj_status
     FROM allocation a LEFT JOIN project p ON p.id = a.project_id
     WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IS NOT NULL ${sec ? 'AND a.sector_id = ?' : ''}`, sec ? [year, sec] : [year]);
  const byEmp = {};
  for (const a of allocs) (byEmp[a.employee_id] ||= []).push(a);
  // اسمُ المشروع في الكشف صفٌّ لا رقم — يُقصّ على نطاق قراءة القارئ للمشاريع (v5.9) كما قُصّ عنوانُ
  // الفرصة أدناه: نسبةُ التسكين تبقى (رقمٌ للجميع، فالحِمل حقُّ المدير أن يراه)، أما اسمُ مشروعٍ من
  // إدارةٍ (أو قطاعٍ) خارج نطاقه فيُطوى ومعه معرّفُه — فلا يُعرَض اسمُه من باب الكشف كما لا يظهر في
  // قائمته ولا يُفتح صفّياً. (كان موظفٌ في إدارة القارئ سُكِّن على مشروع إدارةٍ شقيقة يُسرِّب اسمَه
  // ومعرّفَه عبر الكشف — بابٌ خلفيّ لِما أُغلق في القائمة والصفّ.)
  let visibleAllocProjects = null; // null = لا قصّ (نطاقٌ شركيّ: الكلّ ظاهر بلا استعلام)
  const allocPids = [...new Set(allocs.map((a) => a.project_id).filter(Boolean))];
  if (allocPids.length) {
    // `memberCol` (v5.27): المشروع الذي **تشارك** فيه إدارةُ القارئ يظهر باسمه لا مطوياً —
    // «التسكين يطلع فيها بشكل صحيح لأنه مشترك بين إدارتين». نفس فرع projectReachClause
    // الذي يفتح قائمةَ المشاريع يفتح اسمَها في الكشف: مصدرُ حقيقةٍ واحد لا بابٌ خلفيّ.
    const pScope = scopeFilter(user, 'project', 'read',
      { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id', memberCol: 'id' });
    if (pScope.clause !== '1=1') {
      visibleAllocProjects = new Set((await all(
        `SELECT id FROM project WHERE deleted_at IS NULL AND id IN (${allocPids.map(() => '?').join(',')}) AND (${pScope.clause})`,
        [...allocPids, ...pScope.params])).map((r) => r.id));
    }
  }
  const projInReach = (pid) => !pid || visibleAllocProjects === null || visibleAllocProjects.has(pid);
  // Opportunity soft load: open-opportunity team memberships with an allocation % — demand that
  // hasn't converted to a project yet, so it weighs on "now" only (not the yearly plan).
  // ونطاقُ قراءة الفرص للقارئ يقصّ الصفوف: عنوانُ فرصةٍ من قطاعٍ أو إدارةٍ لا يراها في قائمة
  // الفرص لا يظهر هنا من باب الكشف — مصدرُ حقيقةٍ واحد لا بابٌ خلفيّ. (كان يُقرأ عنوانُ كل فرصةٍ
  // مفتوحةٍ سُكِّن عليها موظفٌ ولو عبر القطاع، فتتسرّب أسماء صفقاتٍ خارج نطاق القارئ.)
  const oppScope = scopeFilter(user, 'opportunity', 'read', {
    sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id',
    deptCol: 'o.department_id', grantCol: 'o.department_id', memberCol: 'o.id',
  });
  const oppRows = blind ? [] : await all(`SELECT m.id membership_id, m.employee_id, m.allocation_pct, m.role_in_group, o.id opp_id, o.title_ar
     FROM membership m JOIN opportunity o ON o.id = m.group_id LEFT JOIN stage st ON st.id = o.stage_id
     WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND m.allocation_pct > 0
       AND COALESCE(m.status, 'ACTIVE') <> 'PENDING'
       AND o.deleted_at IS NULL AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0
       AND (${oppScope.clause})`, oppScope.params);
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
      // مشروعٌ خارج نطاق القارئ: يبقى الحِملُ (mj) ويُطوى الاسمُ والمعرّف — رقمٌ بلا اسم.
      // والطيّ يُسمّى «مشروع خارج نطاقك» لا شرطةً صمّاء (v5.27): شرطةٌ بلا تفسير قرأها
      // المالك عطباً — «تطلع بالشرطات، مو واضح المشروع، شي غريب» — والاسم الصريح يقول
      // إنها حالةٌ مقصودة (خصوصية v5.9) لا بياناتٍ مفقودة. المعرّف يبقى مطوياً كما كان.
      const inReach = projInReach(a.project_id);
      return { allocId: a.id, projectId: inReach ? a.project_id : null,
        name: inReach ? (a.proj_name || a.project_name || '—') : 'مشروع خارج نطاقك',
        bucket: a.work_bucket || null,
        type: a.type || 'member', status: inReach ? a.proj_status : null, months: mj };
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
      status: e.status, active: e.active, sector_id: e.sector_id, department_id: e.department_id,
      hire_date: e.hire_date, end_date: e.end_date, capacity_pct: e.capacity_pct ?? null,
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
  return { year, sector: sec, department: effectiveDept, currentMonth: nowM, roster, summary };
}
