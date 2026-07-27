// الإسناد الإداري — نسبة العمل (مشروع / فرصة / تسكين) إلى **إدارة** داخل قطاعه.
//
// المشكلة التي تغلقها هذه الخدمة: الجداول التشغيلية كانت تحمل القطاع فقط، فتتكدّس مئات الفرص على
// «قطاع الحلول» ككتلة واحدة بينما جزء كبير منها يخص إدارة بعينها («إدارة المدن الذكية» مثلاً)،
// فتبقى الإدارات في الهيكل بلا عمل ولا يملك مديرها إجابة على سؤال «ما الذي تحت يدي؟».
// الترحيلة 007 أضافت العمود؛ هنا مسار الكتابة الوحيد إليه وقراءاته.
//
// ثلاث قواعد تحكم كل ما تحته:
//   ١) نوع العمل يأتي من قائمة بيضاء مجمَّدة (مشروع/فرصة/تسكين)، وكل جملة SQL نصّ ثابت — لا يُبنى
//      اسم جدول من مدخل مستخدم أبداً.
//   ٢) الإدارة يجب أن تكون داخل قطاع الصف نفسه. الإسناد عبر القطاعات ممنوع: هو أسرع طريق لأرقام
//      لا تتطابق مع نفسها (قطاع يعرض عملاً تحسبه إدارة قطاع آخر).
//   ٣) الصلاحية تُفحص بتمرير **الصف نفسه** إلى can(): استدعاء can(user, action, resource) بلا هدف
//      يُرجع صحيحاً لمجرد وجود أي منح مطابق مهما كان نطاقه (انظر core/rbac/index.js) — أي أن قائد
//      قطاع كان سيسند فرص قطاع آخر. لا استدعاء بلا هدف في هذا الملف.
import { all, get, update, tx } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';

// ─────────────────────────── القائمة البيضاء لأنواع العمل ───────────────────────────
// stamps: هل يحمل الجدول عمودَي updated_at/updated_by؟ (allocation لا يحملهما — لا نكتب عموداً غير موجود)
const KINDS = {
  project: { resource: 'project', label: 'المشروع', labelPlural: 'المشاريع', titleCol: 'name_ar', stamps: true },
  opportunity: { resource: 'opportunity', label: 'الفرصة', labelPlural: 'الفرص', titleCol: 'title_ar', stamps: true },
  allocation: { resource: 'allocation', label: 'التسكين', labelPlural: 'التسكينات', titleCol: 'project_name', stamps: false },
};
export const WORK_KINDS = Object.keys(KINDS);
export const BULK_LIMIT = 200;      // سقف الدفعة الواحدة
export const LIST_LIMIT_DEFAULT = 100;
export const LIST_LIMIT_MAX = 500;

// Object.hasOwn لا Object.hasOwnProperty ولا KINDS[k] المباشر: 'constructor'/'toString' تعطي كائناً
// حقيقياً من سلسلة النماذج فيمر نوع غير موجود ويصل اسم جدول undefined إلى الاستعلام.
function kindOf(kind) {
  const k = String(kind == null ? '' : kind).trim();
  if (!Object.hasOwn(KINDS, k)) throw badRequest('نوع العمل غير معروف — الإسناد متاح على المشاريع أو الفرص أو التسكينات فقط');
  return { kind: k, ...KINDS[k] };
}

// جُمل ثابتة لكل نوع (لا تركيب نصّي لأي اسم جدول). المفتاح مُتحقَّق منه قبل الوصول إليها.
const FIND_SQL = {
  project: 'SELECT * FROM project WHERE id = ? AND deleted_at IS NULL',
  opportunity: 'SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL',
  allocation: 'SELECT * FROM allocation WHERE id = ? AND deleted_at IS NULL',
};
const UPDATE_TABLE = { project: 'project', opportunity: 'opportunity', allocation: 'allocation' };

const rowTitle = (cfg, row) =>
  row[cfg.titleCol] || row.name_ar || row.title_ar || row.project_name || row.person_name_ar || row.code || 'سجل بلا اسم';
const num = (v) => (Number(v) || 0);
const q = (s) => `«${s}»`;                       // اقتباس عربي موحّد داخل الرسائل
async function sectorLabel(sectorId) {
  if (!sectorId) return 'بلا قطاع';
  const s = await get('SELECT name_ar FROM sector WHERE id = ?', [sectorId]);
  return q(s && s.name_ar ? s.name_ar : sectorId);
}

// قيمة الإدارة القادمة من الطلب: نص فارغ ⟵ «بلا إدارة» (إلغاء الإسناد، وهو إجراء مشروع).
// غياب المفتاح كلياً خطأ مقصود: إلغاء إسناد صحيح بالصمت خسارة بيانات، خصوصاً في الدفعات.
function readDepartmentArg(args) {
  const hasCamel = Object.hasOwn(args, 'departmentId');
  const hasSnake = Object.hasOwn(args, 'department_id');
  if (!hasCamel && !hasSnake) throw badRequest('حدّد الإدارة المراد الإسناد إليها، أو اتركها فارغة لإلغاء الإسناد');
  const raw = hasCamel ? args.departmentId : args.department_id;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

// فحص النطاق على قطاع بعينه للقراءة. لا نمرّر هدفاً ناقص المفتاح إلى can(): scopeReaches تُمرّر أي
// هدف لا يحمل مفتاح نطاقها (مثل {sector_id} أمام نطاق «مشروع») مروراً فارغاً، فتنفتح القائمة لمن
// لا يملك رؤية قطاعية أصلاً. لذلك نقرأ النطاق الفعّال ونقرّر عليه صراحةً.
function sectorReadable(user, resource, sectorId) {
  if (!user) return false;
  const scope = effectiveScope(user, 'read', resource);
  if (!scope) return false;
  if (scope === 'company') return true;
  if (scope === 'sector' || scope === 'department')
    return user.scope === 'company' || (!!user.sector_id && user.sector_id === sectorId);
  return false; // project | team | own ⟵ لا رؤية على مستوى القطاع
}

async function loadSector(sectorId) {
  const s = String(sectorId == null ? '' : sectorId).trim();
  if (!s) throw badRequest('حدّد القطاع أولاً — الإسناد وتوزيعه يُقرآن داخل قطاع واحد');
  const row = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [s]);
  if (!row) throw notFound('القطاع غير موجود — اختر قطاعاً من القائمة');
  return row;
}

// ═══════════════════════════════ الكتابة ═══════════════════════════════

/**
 * إسناد صف عمل واحد إلى إدارة (أو إلغاء إسناده بتمرير قيمة فارغة).
 * @param {{user:object, ip?:string}} ctx
 * @param {{kind:'project'|'opportunity'|'allocation', id:string, departmentId?:string|null, department_id?:string|null}} args
 */
export async function setWorkDepartment(ctx, args = {}) {
  const user = ctx && ctx.user;
  const cfg = kindOf(args.kind);
  const rowId = args.id == null ? '' : String(args.id).trim();
  if (!rowId) throw badRequest(`حدّد ${cfg.label} المراد إسناده إلى إدارة`);
  const departmentId = readDepartmentArg(args);

  const row = await get(FIND_SQL[cfg.kind], [rowId]);
  if (!row) throw notFound(`${cfg.label} غير موجود أو محذوف — حدّث الصفحة ثم أعد المحاولة`);
  const title = q(rowTitle(cfg, row));

  // الصلاحية على الصف نفسه (قطاعه/مشروعه/مالكه)، لا على النوع مجرّداً.
  if (!can(user, 'update', cfg.resource, row))
    throw forbidden(`لا تملك صلاحية تعديل ${cfg.label} ${title} — اطلب الإسناد من مسؤول القطاع`);

  let dep = null;
  if (departmentId) {
    dep = await get('SELECT id, sector_id, name_ar FROM department WHERE id = ? AND deleted_at IS NULL', [departmentId]);
    if (!dep) throw badRequest('الإدارة المختارة غير موجودة أو محذوفة — اختر إدارة من القائمة');
    // صف بلا قطاع لا يمكن إسناده: الإدارة تتبع قطاعاً، وإسناده يعني تغيير قطاعه ضمناً وهو قرار آخر.
    if (!row.sector_id)
      throw badRequest(`${cfg.label} ${title} لا يتبع أي قطاع — حدّد قطاعه أولاً ثم أسنده إلى إدارة داخله`);
    if (dep.sector_id !== row.sector_id) {
      const [depSec, rowSec] = await Promise.all([sectorLabel(dep.sector_id), sectorLabel(row.sector_id)]);
      throw badRequest(`الإدارة ${q(dep.name_ar)} تتبع ${depSec} بينما ${cfg.label} ${title} يتبع ${rowSec}`
        + ` — اختر إدارة داخل ${rowSec}، أو انقل ${cfg.label} إلى ${depSec} أولاً`);
    }
  }

  const before = row.department_id || null;
  // لا كتابة ولا سطر تدقيق لتغيير لم يحدث (إعادة إرسال نفس الدفعة لا تُغرق سجل التدقيق).
  if (before === departmentId)
    return { ok: true, kind: cfg.kind, id: rowId, department_id: departmentId,
      department_name_ar: dep ? dep.name_ar : null, sector_id: row.sector_id || null, changed: false };

  const patch = { department_id: departmentId };
  if (cfg.stamps) { patch.updated_at = nowIso(); patch.updated_by = (user && user.id) || null; }
  await tx(async () => {
    await update(UPDATE_TABLE[cfg.kind], rowId, patch);
    await audit(ctx, {
      action: 'update', resource: cfg.resource, resourceId: rowId, sectorId: row.sector_id || null,
      detail: { field: 'department_id', from: before, to: departmentId,
        to_department_name_ar: dep ? dep.name_ar : null, title: rowTitle(cfg, row) },
    });
  });
  return { ok: true, kind: cfg.kind, id: rowId, department_id: departmentId,
    department_name_ar: dep ? dep.name_ar : null, sector_id: row.sector_id || null, changed: true };
}

/**
 * إسناد دفعة (حتى BULK_LIMIT صفاً) إلى الإدارة نفسها. كل عنصر يمر بنفس تحققات setWorkDepartment
 * ونفس سطر التدقيق — لا مسار جانبي مختصر. الفشل الجزئي لا يُلغي ما نجح: كل صف معاملة مستقلة،
 * والنتيجة تُرجع سبب كل إخفاق بالعربية كي تُعرض بجانب الصف لا كرسالة عامة.
 */
export async function bulkSetWorkDepartment(ctx, args = {}) {
  const cfg = kindOf(args.kind);                 // نوع خاطئ ⟵ فشل واحد مبكر، لا مئتا فشل متطابق
  const departmentId = readDepartmentArg(args);
  const raw = Array.isArray(args.ids) ? args.ids : [];
  const ids = [];
  for (const v of raw) {
    const s = v == null ? '' : String(v).trim();
    if (s && !ids.includes(s)) ids.push(s);      // تكرار المعرّف في نفس الدفعة لا يُحتسب مرتين
  }
  if (!ids.length) throw badRequest(`اختر ${cfg.labelPlural} المراد إسنادها — لم يصلنا أي عنصر`);
  if (ids.length > BULK_LIMIT)
    throw badRequest(`لا يمكن إسناد أكثر من ${BULK_LIMIT} عنصراً في مرة واحدة — قسّم الاختيار إلى دفعات أصغر`);

  const failed = [];
  let updated = 0, changed = 0, unchanged = 0;
  for (const rowId of ids) {
    try {
      const r = await setWorkDepartment(ctx, { kind: cfg.kind, id: rowId, departmentId });
      updated++;
      if (r.changed) changed++; else unchanged++;
    } catch (e) {
      failed.push({ id: rowId, reason: (e && e.message) || 'تعذّر الإسناد', code: (e && e.code) || 'error' });
    }
  }
  // updated = ما بلغ الحالة المطلوبة (منه changed كتابة فعلية وunchanged كان مُسنداً سلفاً)
  return { kind: cfg.kind, department_id: departmentId, requested: ids.length, updated, changed, unchanged, failed };
}

// ═══════════════════════════════ القراءة ═══════════════════════════════

// دلو أرقام إدارة واحدة. حقول الفرص على ثلاث طبقات مقصودة:
//   • opportunities / opportunity_value_halalas / opportunity_weighted_halalas ⟵ الإجمالي كما هو
//     (كل فرص السنة مهما كانت حالتها). يبقى كما كان لأن شاشة «العمل غير المُسنَد» تقيس به حجم
//     المعلَّق، وحجم المعلَّق فعلاً يشمل المحسوم.
//   • open / won / lost ⟵ الأرقام القابلة للمقارنة. «المكسوبة» هنا بنفس تعريف مبيعات القطاع
//     حرفياً (مرحلة فائزة + غير مستبعدة من المبيعات + سنة الفرصة = السنة المطلوبة)، فرقم الإدارة
//     يُجمع مع أخواته فيطابق «مبيعات القطاع» بلا فرق.
//   • other ⟵ البقية كي تُصالح الطبقتان: مكسوبة مستبعدة بعلم، أو مكسوبة بلا سنة، أو بلا مرحلة.
//     الثابت المحفوظ: open + won + lost + other = الإجمالي، عدداً وقيمةً.
const emptyBucket = () => ({
  employees: 0, projects: 0, project_value_halalas: 0,
  opportunities: 0, opportunity_value_halalas: 0, opportunity_weighted_halalas: 0,
  opportunities_open: 0, opportunity_open_value_halalas: 0, opportunity_open_weighted_halalas: 0,
  opportunities_won: 0, opportunity_won_value_halalas: 0,
  opportunities_lost: 0, opportunity_lost_value_halalas: 0,
  opportunities_other: 0, opportunity_other_value_halalas: 0,
  allocations: 0,
});

/**
 * توزيع عمل القطاع على إداراته + دلو «غير مُسند» منفصل.
 * استعلام مُجمَّع واحد لكل مقياس (لا حلقة لكل إدارة)، والدمج في الذاكرة.
 * لا يكشف أي حقل حسّاس (لا راتب ولا تكلفة ولا هامش) — قيم عقود وفرص إجمالية فقط، لذا لا حجب حقول.
 * قيم الفرص تعود مفصولة بحالة الحسم (مفتوحة/مكسوبة/خاسرة/أخرى) إلى جانب الإجمالي — انظر emptyBucket:
 * «المكسوبة» وحدها هي القابلة للمقارنة بمبيعات القطاع، وهي بنفس تعريفها حرفياً.
 * @param {object} user
 * @param {{sectorId:string, year?:number|string}} opts
 */
export async function departmentRollup(user, opts = {}) {
  const sector = await loadSector(opts.sectorId != null ? opts.sectorId : opts.sector);
  // البوابة: من يرى هيكل هذا القطاع أو عمله على مستوى القطاع. الأرقام هنا أعداد وقيم إجمالية،
  // ومن لا يملك رؤية قطاعية (مدير مشروع، موظف) لا يفتح له التوزيع.
  const gate = ['department', 'employee', 'project', 'opportunity'].some((r) => sectorReadable(user, r, sector.id));
  if (!gate) throw forbidden('عرض توزيع العمل على إدارات هذا القطاع يتطلب صلاحية عليه — راجع مدير النظام');

  const year = Number(opts.year) || new Date().getUTCFullYear();
  const yearText = String(year);

  const departments = await all(
    'SELECT id, name_ar, active FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [sector.id]);

  // الموظفون: عدد رؤوس «الآن» (لا بُعد سنة للتوظيف في هذا العرض).
  const empRows = await all(
    `SELECT department_id, COUNT(*) AS n FROM employee
      WHERE sector_id = ? AND deleted_at IS NULL
      GROUP BY department_id`, [sector.id]);
  // المشاريع: ما كان قائماً خلال السنة (تقاطع لا تاريخ بدء فقط) — ومجهول التواريخ يُحتسب دائماً
  // كي لا يختفي عمل من شاشة الإسناد بسبب حقل ناقص. substr بدل دوال التواريخ (محمول بين المحرّكين).
  const projRows = await all(
    `SELECT department_id, COUNT(*) AS n, COALESCE(SUM(contract_value_halalas), 0) AS v
       FROM project
      WHERE sector_id = ? AND deleted_at IS NULL
        AND (start_date IS NULL OR substr(start_date, 1, 4) <= CAST(? AS TEXT))
        AND (end_date   IS NULL OR substr(end_date,   1, 4) >= CAST(? AS TEXT))
      GROUP BY department_id`, [sector.id, yearText, yearText]);
  // الفرص: سنة الفرصة، ومجهول السنة يظهر دائماً (نفس المبدأ). المرجّح = القيمة × احتمال الفوز.
  //
  // الحسم يُفصَل هنا ولا يُجمَع: قيمة واحدة تخلط المكسوبة بالخاسرة بالمفتوحة لا تُقارَن بأي رقم آخر
  // في المنصّة، ومديرٌ يضعها بجانب «مبيعات القطاع» يقرأ فرقاً ليس فرقاً. لذلك:
  //   المفتوحة = لا فائزة ولا خاسرة (خط الأنابيب، ومنه المرجّح وحده يعني شيئاً).
  //   المكسوبة = نفس شرط المبيعات في تقارير الشركة حرفاً بحرف: مرحلة فائزة + exclude_from_sales = 0
  //              + سنة الفرصة = السنة المطلوبة (والسنة المجهولة لا تدخل المبيعات هناك، فلا تدخل هنا).
  //   الخاسرة = مرحلة خاسرة (وغير فائزة، فمرحلة موسومة بالاثنين — خطأ بيانات — تُحسب مكسوبة مرة واحدة
  //             فقط كي تبقى الدلاء غير متداخلة).
  // LEFT JOIN لا INNER: فرصة بلا مرحلة معروفة يجب أن تبقى في الإجمالي والعدد، لا أن تختفي بصمت.
  const oppRows = await all(
    `SELECT o.department_id, COUNT(*) AS n, COALESCE(SUM(o.value_halalas), 0) AS v,
            COALESCE(SUM(o.value_halalas * COALESCE(o.win_pct, 0) / 100.0), 0) AS w,
            COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0 THEN 1 ELSE 0 END), 0) AS open_n,
            COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0 THEN o.value_halalas ELSE 0 END), 0) AS open_v,
            COALESCE(SUM(CASE WHEN st.is_won = 0 AND st.is_lost = 0
                              THEN o.value_halalas * COALESCE(o.win_pct, 0) / 100.0 ELSE 0 END), 0) AS open_w,
            COALESCE(SUM(CASE WHEN st.is_won = 1 AND o.exclude_from_sales = 0 AND o.year = ? THEN 1 ELSE 0 END), 0) AS won_n,
            COALESCE(SUM(CASE WHEN st.is_won = 1 AND o.exclude_from_sales = 0 AND o.year = ?
                              THEN o.value_halalas ELSE 0 END), 0) AS won_v,
            COALESCE(SUM(CASE WHEN st.is_lost = 1 AND st.is_won = 0 THEN 1 ELSE 0 END), 0) AS lost_n,
            COALESCE(SUM(CASE WHEN st.is_lost = 1 AND st.is_won = 0 THEN o.value_halalas ELSE 0 END), 0) AS lost_v
       FROM opportunity o LEFT JOIN stage st ON st.id = o.stage_id
      WHERE o.sector_id = ? AND o.deleted_at IS NULL AND (o.year = ? OR o.year IS NULL)
      GROUP BY o.department_id`, [year, year, sector.id, year]);
  const allocRows = await all(
    `SELECT department_id, COUNT(*) AS n FROM allocation
      WHERE sector_id = ? AND deleted_at IS NULL AND (year = ? OR year IS NULL)
      GROUP BY department_id`, [sector.id, year]);

  const byDep = new Map(departments.map((d) => [d.id, emptyBucket()]));
  const unassigned = emptyBucket();   // داخل القطاع وبلا إدارة ⟵ ما يحتاج قراراً
  const orphaned = emptyBucket();     // إدارته محذوفة أو تتبع قطاعاً آخر ⟵ كي تتطابق الإجماليات
  const bucketFor = (depId) => (depId == null ? unassigned : (byDep.get(depId) || orphaned));

  for (const r of empRows) bucketFor(r.department_id).employees += num(r.n);
  for (const r of projRows) {
    const b = bucketFor(r.department_id);
    b.projects += num(r.n);
    b.project_value_halalas += num(r.v);
  }
  for (const r of oppRows) {
    const b = bucketFor(r.department_id);
    b.opportunities += num(r.n);
    b.opportunity_value_halalas += num(r.v);
    b.opportunity_weighted_halalas += Math.round(num(r.w));
    b.opportunities_open += num(r.open_n);
    b.opportunity_open_value_halalas += num(r.open_v);
    b.opportunity_open_weighted_halalas += Math.round(num(r.open_w));
    b.opportunities_won += num(r.won_n);
    b.opportunity_won_value_halalas += num(r.won_v);
    b.opportunities_lost += num(r.lost_n);
    b.opportunity_lost_value_halalas += num(r.lost_v);
    // «أخرى» بقيّةً لا باستعلام: الطرح يضمن المصالحة مهما كانت البيانات (الدلاء الثلاثة غير متداخلة).
    b.opportunities_other += num(r.n) - num(r.open_n) - num(r.won_n) - num(r.lost_n);
    b.opportunity_other_value_halalas += num(r.v) - num(r.open_v) - num(r.won_v) - num(r.lost_v);
  }
  for (const r of allocRows) bucketFor(r.department_id).allocations += num(r.n);

  const totals = emptyBucket();
  for (const b of [...byDep.values(), unassigned, orphaned])
    for (const k of Object.keys(totals)) totals[k] += b[k];

  return {
    sector: { id: sector.id, name_ar: sector.name_ar },
    year,
    departments: departments.map((d) => ({ id: d.id, name_ar: d.name_ar, active: d.active, ...byDep.get(d.id) })),
    unassigned,
    orphaned,
    totals,
  };
}

// جُمل ثابتة لكشف «غير المُسند» — كل نوع بأعمدته الطبيعية، والتوحيد يتم في JS.
const UNASSIGNED_SQL = {
  project: `SELECT p.id, p.code, p.name_ar AS title, p.contract_value_halalas AS value_halalas,
       p.owner_user_id, u.name_ar AS owner_name_ar, p.status, p.created_at, p.sector_id
     FROM project p LEFT JOIN app_user u ON u.id = p.owner_user_id
    WHERE p.sector_id = ? AND p.department_id IS NULL AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  opportunity: `SELECT o.id, o.code, o.title_ar AS title, o.value_halalas,
       o.owner_user_id, u.name_ar AS owner_name_ar, o.stage_id, st.name_ar AS stage_name_ar,
       o.win_pct, o.year, o.created_at, o.sector_id
     FROM opportunity o
     LEFT JOIN app_user u ON u.id = o.owner_user_id
     LEFT JOIN stage st ON st.id = o.stage_id
    WHERE o.sector_id = ? AND o.department_id IS NULL AND o.deleted_at IS NULL
    ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
  allocation: `SELECT a.id, COALESCE(p.name_ar, a.project_name) AS title, a.project_id,
       a.employee_id, COALESCE(e.name_ar, a.person_name_ar) AS owner_name_ar, a.type, a.year, a.created_at, a.sector_id
     FROM allocation a
     LEFT JOIN project p ON p.id = a.project_id
     LEFT JOIN employee e ON e.id = a.employee_id
    WHERE a.sector_id = ? AND a.department_id IS NULL AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
};

// صف موحّد للواجهة مهما كان النوع (القيم غير المتاحة null لا مفقودة).
function normalizeWorkRow(kind, r) {
  const base = {
    kind, id: r.id, code: r.code || null, title: r.title || null,
    value_halalas: r.value_halalas == null ? null : num(r.value_halalas),
    owner_user_id: r.owner_user_id || null, owner_name_ar: r.owner_name_ar || null,
    sector_id: r.sector_id || null, created_at: r.created_at || null,
  };
  if (kind === 'opportunity') {
    return { ...base, stage_id: r.stage_id || null, stage_name_ar: r.stage_name_ar || null,
      win_pct: r.win_pct == null ? null : num(r.win_pct), year: r.year == null ? null : num(r.year) };
  }
  if (kind === 'project') return { ...base, status: r.status || null };
  return { ...base, project_id: r.project_id || null, employee_id: r.employee_id || null,
    type: r.type || null, year: r.year == null ? null : num(r.year) };
}

/**
 * كشف العمل غير المُسند داخل قطاع — الشاشة التي يُصلَح منها التكدّس («فرص كثيرة مسكّنة في الحلول»).
 * @param {object} user
 * @param {{sectorId:string, kind?:string, limit?:number|string}} opts
 */
export async function unassignedWork(user, opts = {}) {
  const cfg = kindOf(opts.kind == null || opts.kind === '' ? 'opportunity' : opts.kind);
  const sector = await loadSector(opts.sectorId != null ? opts.sectorId : opts.sector);
  if (!sectorReadable(user, cfg.resource, sector.id))
    throw forbidden(`عرض ${cfg.labelPlural} غير المُسندة في هذا القطاع يتطلب صلاحية عليه — راجع مدير النظام`);

  const asked = Number(opts.limit);
  const limit = Number.isFinite(asked) && asked > 0
    ? Math.min(LIST_LIMIT_MAX, Math.trunc(asked))
    : LIST_LIMIT_DEFAULT;

  const rows = await all(UNASSIGNED_SQL[cfg.kind], [sector.id, limit]);
  return {
    sector: { id: sector.id, name_ar: sector.name_ar },
    kind: cfg.kind, limit, count: rows.length,
    rows: rows.map((r) => normalizeWorkRow(cfg.kind, r)),
  };
}
