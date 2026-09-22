// ── حمولة «مركز القطاع»: قراءةٌ واحدةٌ مُرشَّحةٌ بالصلاحية تُبنى عليها الشاشة والملفّ ────────
//
// الشاشة الجديدة (P1) تُرسَم في المتصفّح من حمولةٍ واحدة، وملفُّ Excel يقرأ الحمولة **ذاتها**
// (`command-center-export.js`). فالقرار الأمني يُتَّخذ هنا مرةً واحدة، ولا يُعاد في كل سطحٍ
// يعرض الرقم — ولا يُنسى في أحدها.
//
// ── ثلاث قواعد تحكم كل حقلٍ في هذا الملفّ ───────────────────────────────────────────────
// ① **الحجب بالغياب لا بقيمةٍ فارغة.** من لا يقرأ الكلفة لا تصله سطورُها **أصلاً**: لا مفتاح
//    `recon`، ولا `margin_pct`، ولا `act.con/ctr/lic`. قيمةٌ فارغة تُقرأ «لا يوجد صرف»، وهي
//    كذبة؛ وغيابُ المفتاح يُقرأ «ليس في حمولتك»، وهو الصدق. وهو أيضاً ما يجعل تسريب الرقم
//    مستحيلاً بالبناء: ما لم يُقرأ من القاعدة لا يُسلسَل في JSON مهما أخطأت الشاشة بعده.
// ② **الفراغ ليس صفراً.** شهرٌ بلا صفٍّ يعود `null`، وصفٌّ مسجَّلٌ بصفرٍ يعود `0`. وصفرٌ واحد
//    في سطر كلفةٍ يُنتج «مجمل ربحٍ» يساوي الإيراد كاملاً — رقمٌ يُبنى عليه قرار.
// ③ **لا بوابة تُعاد كتابتها هنا.** رؤيةُ السطور وحسابُ مجاميعها من `sectorIncomeStatement`
//    حرفاً: هي مصدرُ «أيُّ سطرٍ يُعرض لمن»، وهذه الوحدة تُلبس صفوفَها اثني عشر شهراً. ونسخةٌ
//    ثانية من قاعدة الرؤية كانت ستفترق عنها عند أول تعديل.
//
// ولا شيء يُسجَّل في السجلّات من هنا: الحمولة قراءةٌ لا كتابة، وسطرُ سجلٍّ لكل فتح شاشةٍ ضجيجٌ
// يُغرق أثرَ التصدير الحقيقي (والتصدير وحده هو ما يُدقَّق، في `command-center-export.js`).
import { all, get } from '../../core/db/index.js';
import { can, canSeeSensitive } from '../../core/rbac/index.js';
import { DELIVERY_SECTOR_SQL, isSupportUnit } from '../../core/org/kind.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { nowIso } from '../../core/util/ids.js';
import { netSum } from './vat.js';
import { dlvYearSqlFor } from './recognition.js';
import { PL_LINES, COST_KEYS, sectorIncomeStatement } from './income-statement.js';
import { monthlyPlLines, closedThrough, reconcile } from './pl-lines.js';
import { monthlyRevenueTargets, annualSectorTarget, targetYear } from '../org/sector-targets.js';
import { projectYearClause } from '../pmo/projects.js';
import { revenueOutlook, sectorStaffing } from '../../core/reports/metrics.js';
import { completenessScore } from '../../core/reports/completeness.js';
import { attentionFeed } from '../../core/reports/attention.js';
import { changesSince, periodBounds } from '../../core/reports/changes.js';
import { sectorTeamDetail } from '../pmo/capacity.js';

/** فرصةٌ بلا حركةٍ منذ هذا العدد من الأيام تُوسَم «راكدة» — رقمٌ واحدٌ لا يُنسخ في الشاشة. */
export const STALLED_DAYS = 60;

/** سقفُ «ما تغيّر» في الحمولة: تغذيةُ قراءةٍ لا سجلٌّ كامل. */
const CHANGES_CAP = 50;

/** سقفُ قائمة المشاريع — كسقف `listProjects` حرفاً، فلا تختلف الشاشتان في حدّهما. */
const PROJECT_CAP = 500;

const NET_REVENUE = netSum('rl.amount_halalas', 'rl.net_amount_halalas');
const EXPENSE_NET = 'COALESCE(net_amount_halalas, amount_halalas)';

const m12 = () => Array(12).fill(null);
const monthIndex = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 12 ? n - 1 : -1; };

// ── حسابٌ لا يخترع رقماً (نفس قواعد `income-statement.js`) ───────────────────────────────
/** مجموعٌ يتوقف عند أول فراغ: مجموعُ ما بعضه مجهول مجهول. */
const sumStrict = (vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, b) => a + b, 0));
/** مجموعُ ما حضر: الغيابُ الكامل فراغ، وحضورُ واحدٍ يُجمع ما حضر. */
const sumPresent = (vals) => {
  const seen = vals.filter((v) => v != null);
  return seen.length ? seen.reduce((a, b) => a + b, 0) : null;
};
const diffStrict = (a, b) => ((a == null || b == null) ? null : a - b);
const pairwise = (a, b, fn) => Array.from({ length: 12 }, (_, i) => fn(a?.[i] ?? null, b?.[i] ?? null));

/**
 * القطاع من الطلب — القاعدةُ الواحدة التي تحرس قائمة الدخل وملفَّ المركز والمسار معاً.
 *
 * قطاعات التسليم وحدها تُقبل من العنوان (وحدةُ المساندة لا مركزَ قيادةٍ تجاريّاً لها)، وقطاعُ
 * القارئ يُقبل دائماً ولو كان وحدةَ مساندة — كما تفتحه له الشاشة من `user.sector_id`. ومن
 * نطاقه دون الشركة لا يفتح قطاعاً سواه. والبوابة **قبل** أي استعلامِ حمولة، فلا يُستدلّ بوجود
 * رقمٍ على ما في قطاعٍ خارج النطاق.
 *
 * وفرقٌ واحد عن قارئ قائمة الدخل مقصود: اسمُ قطاعٍ **لا وجود له** يُردّ «لا يوجد قطاع بهذا
 * الاسم» ولا يسقط صامتاً إلى قطاع القارئ. لأن المعرّف هنا يأتي من **مسار** الطلب
 * (`/api/sectors/:id/…`) لا من مرشِّحٍ اختياري: رابطٌ مكسور يجب أن يُقال إنه مكسور، لا أن
 * يُسلّم صاحبَه أرقامَ قطاعٍ آخر وهو يحسبها أرقامَ ما طلب.
 *
 * @param {object} user
 * @param {{sector?: string}} [query]
 * @returns {Promise<{id: string, name_ar: string}>}
 */
export async function resolveCommandCenterSector(user, query = {}) {
  if (!user) throw forbidden('مركز القطاع يُقرأ بحسابٍ مسجَّل الدخول');
  const asked = String(query?.sector || '').trim();
  if (asked) {
    const row = await get('SELECT id FROM sector WHERE id = ? AND deleted_at IS NULL', [asked]);
    // اسمٌ لا وجود له: من نطاقه الشركة يُقال له «مكسور» — رابطُه يفتح كل قطاعٍ أصلاً فلا خبر
    // في الجواب. ومن دون ذلك يُردّ بالرفض نفسه الذي يُردّ به عن قطاعٍ قائمٍ خارج نطاقه، فلا
    // يفرّق جوابُ المنصة بين «غير موجود» و«موجودٌ وليس لك» — وإلا صار تخمينُ المعرّفات كشفاً.
    if (!row) throw user.scope === 'company' ? notFound('لا يوجد قطاع بهذا الاسم') : forbidden('هذا القطاع خارج نطاقك');
  }
  const deliverySectors = await all(`SELECT id FROM sector
     WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const own = user.sector_id || null;
  const accepted = asked && (deliverySectors.some((s) => s.id === asked) || asked === own || user.scope === 'company')
    ? asked : null;
  const sectorId = accepted || own || (user.scope === 'company' ? (deliverySectors[0]?.id || null) : null);
  if (!sectorId) throw badRequest('لا يوجد قطاع مرتبط بحسابك — اطلب من مدير النظام ربطك بقطاع');
  if (user.scope !== 'company' && user.sector_id !== sectorId) throw forbidden('هذا القطاع خارج نطاقك');
  const sector = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sector) throw notFound('لا يوجد قطاع بهذا الاسم');
  return sector;
}

/**
 * أشهرُ الفترة من عنوان الطلب — قارئٌ واحدٌ تقرأ منه الشاشة والملفّ والورقة، فلا ثلاثُ
 * قراءاتٍ تفترق عند أول لسانٍ جديد.
 *
 * لسانان لا واحد:
 *   • `p=` للفترات المسمّاة (سنةٌ، ربعٌ، شهرٌ، من بداية السنة، مدى) — بقاعدة `periodBounds`
 *     نفسها التي يقرأ بها باقي المنصة، فلا تعريفَ ثانٍ لـ«من بداية السنة».
 *   • `months=1,3,5` لاختيارٍ **غير متتالٍ** لا يصفه اسمُ فترة: القارئ يسحب أشهراً بعينها
 *     على الشريط، ومدىً واحدٌ لا يعبّر عنها. والمدى المتتالي يبقى على `p=` كما كان.
 * و`months=` يعلو على `p=` حين يُرسلان معاً: الأخصُّ يفوز، فلا يُقرأ اختيارُ القارئ باسمٍ
 * عامٍّ يخالفه. وغيابُهما معاً = السنة كاملة. وقائمةٌ كلها خارج المدى خطأُ طلبٍ يُقال صراحةً
 * لا يُصحَّح صامتاً إلى سنةٍ كاملة يظنّها القارئ اختيارَه.
 *
 * @param {{p?: string, months?: string|number[]}} [query]
 * @param {number} year
 * @param {Date} [now]
 * @returns {number[]} أشهرٌ من ١ إلى ١٢، مرتَّبةً بلا تكرار
 */
export function monthsFromQuery(query = {}, year, now = new Date()) {
  const given = query?.months;
  const raw = Array.isArray(given) ? given : String(given ?? '').split(',');
  const asked = Array.isArray(given) || String(given ?? '').trim() !== '';
  if (asked) {
    const set = new Set();
    for (const part of raw) {
      const n = Number(String(part).trim());
      if (Number.isInteger(n) && n >= 1 && n <= 12) set.add(n);
    }
    if (set.size) return [...set].sort((a, b) => a - b);
    throw badRequest('حدّد أشهر الفترة بأرقام من ١ إلى ١٢');
  }
  const p = String(query?.p ?? '').trim();
  if (p) return periodBounds(p, targetYear(year), now).months;
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

// ── استعلاماتٌ مجمَّعة: سؤالٌ واحدٌ لكل قسمٍ من الشاشة، لا سؤالٌ لكل صف ────────────────────

/** الإيراد المحقَّق صافياً: مشروعاً بمشروع وشهراً بشهر. */
const revenueByProjectMonth = (sectorId, year) => all(
  `SELECT rl.project_id pid, rl.month m, ${NET_REVENUE} v FROM revenue_line rl
     WHERE rl.sector_id = ? AND rl.year = ? AND rl.month IS NOT NULL
     GROUP BY rl.project_id, rl.month`, [sectorId, year]);

/** الإيراد المحقَّق صافياً شهراً بشهر للقطاع كلّه — بما فيه ما لا مشروعَ له. */
const revenueByMonth = (sectorId, year) => all(
  `SELECT rl.month m, ${NET_REVENUE} v FROM revenue_line rl
     WHERE rl.sector_id = ? AND rl.year = ? AND rl.month IS NOT NULL GROUP BY rl.month`, [sectorId, year]);

/** ما اعترفت به المنصة إيراداً لكل مشروعٍ منذ أول يوم — أساسُ «المتبقي من العقد». */
const revenueByProjectAllYears = (sectorId) => all(
  `SELECT rl.project_id pid, ${NET_REVENUE} v FROM revenue_line rl
     WHERE rl.sector_id = ? AND rl.project_id IS NOT NULL GROUP BY rl.project_id`, [sectorId]);

/**
 * ما سجّله أهلُ المشاريع في سند صرفاً: المصروف المعتمد أو المدفوع صافياً، وبنودُ الكلفة —
 * مصنَّفاً بالسطر وبالشهر. نفسُ تعريف `sectorCosts` حرفاً (وهو ما تقرؤه المطابقة أيضاً)،
 * مضافاً إليه التصنيف الذي فتحته الترحيلة ٠٥٠.
 *
 * و`sectorCosts(…, { byCategory: true })` (وحدة العمل D3) لا تُغني عنه: هي تُجمّع بالتصنيف
 * **مجاميعَ سنةٍ أو نافذة** بلا بُعد الشهر، والشاشة هنا تحتاج شهراً بشهرٍ لكل سطر. فالبُعدان
 * معاً (تصنيفٌ × شهر) يُقرآن هنا في استعلامٍ واحد بدل اثني عشر نداءً لنافذةٍ بشهر.
 */
const sanadCostByMonthCategory = (sectorId, year) => all(
  `SELECT t.m m, t.category category, COALESCE(SUM(t.v), 0) v FROM (
       SELECT incurred_month m, category, ${EXPENSE_NET} v FROM expense
         WHERE sector_id = ? AND incurred_year = ? AND status IN ('APPROVED','PAID') AND deleted_at IS NULL
       UNION ALL
       SELECT month m, category, amount_halalas v FROM cost_line
         WHERE sector_id = ? AND year = ?
     ) t GROUP BY t.m, t.category`, [sectorId, year, sectorId, year]);

/**
 * صرفُ سند على كل مشروعٍ بتصنيفه **وشهره** — «أتعاب المستشارين» و«التعاقد» و«التراخيص»
 * للمشروع الواحد اثني عشر شقّاً. والشهر بُعدٌ لازم لا زينة: الشاشة تقصّ على أشهرٍ مختارة
 * (ولو غير متتالية) في المتصفّح، ومجموعُ سنةٍ واحد لا يُقصّ.
 */
const expenseByProjectCategory = (sectorId, year) => all(
  `SELECT project_id pid, category category, incurred_month m, COALESCE(SUM(${EXPENSE_NET}), 0) v FROM expense
     WHERE sector_id = ? AND incurred_year = ? AND status IN ('APPROVED','PAID') AND deleted_at IS NULL
       AND project_id IS NOT NULL
     GROUP BY project_id, category, incurred_month`, [sectorId, year]);

/**
 * المسلَّم غير المفوتَر لكل مشروع — صافياً، بقاعدة `unbilledDelivered` حرفاً (حالةُ المخرَج،
 * ومبلغٌ موجب، وبلا ختمِ فوترةٍ ولا سطرِ فاتورةٍ حيّة)، مجمَّعاً بالمشروع بدل القطاع.
 */
const unbilledByProject = (sectorId, year) => all(
  `SELECT d.project_id pid,
      COALESCE(SUM(CAST(COALESCE(d.amount_halalas,0) AS BIGINT) * 100 / 115), 0) nv
     FROM deliverable d LEFT JOIN project p ON p.id = d.project_id
     WHERE d.deleted_at IS NULL AND COALESCE(d.sector_id, p.sector_id) = ?
       AND ${dlvYearSqlFor('d')} = ?
       AND d.status IN ('DELIVERED','ACCEPTED') AND COALESCE(d.amount_halalas,0) > 0
       AND NOT (d.invoiced_at IS NOT NULL OR EXISTS (SELECT 1 FROM invoice_line il
           JOIN invoice i ON i.id = il.invoice_id
           WHERE il.deliverable_id = d.id AND i.deleted_at IS NULL AND i.status <> 'CANCELLED'))
     GROUP BY d.project_id`, [sectorId, year]);

/** آخر ما كتبته المالية في سطور هذا القطاع — ختمُ الوقت واسمُ صاحبه، بلا أي مبلغ. */
const lastFinanceUpload = (sectorId, year) => get(
  `SELECT COALESCE(p.updated_at, p.created_at) at, COALESCE(u.name_ar, u.username) by_name
     FROM pl_line_amount p LEFT JOIN app_user u ON u.id = COALESCE(p.updated_by, p.created_by)
     WHERE p.sector_id = ? AND p.year = ?
     ORDER BY COALESCE(p.updated_at, p.created_at) DESC LIMIT 1`, [sectorId, year]);

/** الفرص المفتوحة: ما لم يُكسب ولم يُخسر، في السنة المعروضة أو بلا سنة. */
const openOpportunities = (sectorId, year) => all(
  `SELECT o.id, o.title_ar, o.client_id, o.stage_id, o.win_pct, o.value_halalas,
      o.stage_changed_at, o.submission_due, o.year, o.created_at, o.updated_at
     FROM opportunity o JOIN stage st ON st.id = o.stage_id
     WHERE o.sector_id = ? AND o.deleted_at IS NULL AND st.is_won = 0 AND st.is_lost = 0
       AND (o.year = ? OR o.year IS NULL)
     ORDER BY o.value_halalas DESC`, [sectorId, year]);

/** العملاء الذين لهم أثرٌ في القطاع: مشاريعُهم عدداً، وما لهم من فرصٍ مفتوحةٍ قيمةً. */
const sectorClientRows = (sectorId) => all(
  `SELECT c.id, c.name_ar,
      (SELECT COUNT(*) FROM project p WHERE p.client_id = c.id AND p.sector_id = ? AND p.deleted_at IS NULL) projects,
      (SELECT COALESCE(SUM(o.value_halalas),0) FROM opportunity o JOIN stage st ON st.id = o.stage_id
         WHERE o.client_id = c.id AND o.sector_id = ? AND o.deleted_at IS NULL
           AND st.is_won = 0 AND st.is_lost = 0) prospect
     FROM client c WHERE c.deleted_at IS NULL
       AND (EXISTS(SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.sector_id = ? AND o.deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM project p WHERE p.client_id = c.id AND p.sector_id = ? AND p.deleted_at IS NULL))
     ORDER BY c.name_ar`, [sectorId, sectorId, sectorId, sectorId]);

/** مشاريع القطاع بعدسة السنة المعروضة — قاعدةُ «مشروع السنة» الواحدة. */
function sectorProjects(sectorId, year) {
  const yc = projectYearClause(year, 'p.');
  const clause = yc ? ` AND ${yc.clause}` : '';
  return all(`SELECT p.id, p.name_ar, p.code, p.client_id, p.department_id, p.rag, p.status,
      p.contract_value_halalas, p.margin_pct, p.start_date, p.end_date
     FROM project p WHERE p.sector_id = ? AND p.deleted_at IS NULL AND p.status != 'CANCELLED'${clause}
     ORDER BY p.name_ar LIMIT ${PROJECT_CAP}`, [sectorId, ...(yc ? yc.params : [])]);
}

/** آخر صرفٍ سجّله أهلُ المشاريع في سند — ختمُ وقتٍ وحده، بلا مبلغٍ ولا بندٍ ولا مشروع. */
const lastSanadExpense = (sectorId, year) => get(
  `SELECT MAX(created_at) at FROM expense
     WHERE sector_id = ? AND incurred_year = ? AND status IN ('APPROVED','PAID') AND deleted_at IS NULL`,
  [sectorId, year]);

/**
 * حمولةُ مركز القطاع كاملةً — مُرشَّحةً بصلاحية القارئ، بالهللة، واثني عشر شهراً حيث يلزم
 * (الفهرس صفرٌ = يناير، و`null` = لم يُسجَّل).
 *
 * @param {object} user
 * @param {string} sectorId
 * @param {{year?: number|string}} [opts]
 * @returns {Promise<object>}
 */
export async function buildCommandCenterDataset(user, sectorId, { year } = {}) {
  // ── البوابات أولاً، قبل أي رقم ────────────────────────────────────────────────────────
  if (!user) throw forbidden('مركز القطاع يُقرأ بحسابٍ مسجَّل الدخول');
  if (user.scope !== 'company' && user.sector_id !== sectorId) throw forbidden('هذا القطاع خارج نطاقك');
  const sector = await get('SELECT id, name_ar, name_en, kind FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sector) throw notFound('لا يوجد قطاع بهذا الاسم');
  // وحدة المساندة تحمل أشخاصاً وكلفةً لا أهدافاً (قرارُ المالك في `core/org/kind.js`، ونفسُ ما
  // تفعله `sectorDashboard`): هدفٌ سُجِّل عليها سهواً لا يصير مستهدفاً تُقاس عليه نسبةُ إنجاز.
  const supportUnit = isSupportUnit(sector);

  const target = { sector_id: sectorId };
  const canRevenue = can(user, 'read', 'revenue_line', target);
  const canPlan = can(user, 'read', 'budget', target);
  // بابان معاً لكل ما يقع تحت سطر الإيراد — نفسُ قاعدة `sectorIncomeStatement` حرفاً.
  const canCostLines = canSeeSensitive(user, 'cost') && canSeeSensitive(user, 'margin');
  const canMargin = canSeeSensitive(user, 'margin');
  const canProjects = can(user, 'read', 'project', target);
  const canOpps = can(user, 'read', 'opportunity', target);

  const y = targetYear(year ?? config.fiscalYear);
  const nowIsoStamp = nowIso();
  const today = new Date();
  const todayIso = nowIsoStamp.slice(0, 10);
  const notes = [];

  // ── استعلامٌ واحدٌ متوازٍ: كل قسمٍ من الشاشة سؤالٌ واحد، وما أُغلق بابُه لا يُسأل أصلاً ──
  const [
    statement, monthly, closed, upload, lastExpense, monthlyTarget, annual, outlook, staffing, completeness,
    projects, revProjMonth, revMonth, revAllYears, unbilled, prjExpense, sanadCost,
    clients, depts, opps, stages, recon, attention, changes, team,
  ] = await Promise.all([
    // الرؤيةُ والمجاميع من مصدرهما الواحد — بلا حقنٍ: `_loaders` بابُ اختبارٍ لا بابُ تشغيل،
    // ومسارُ التشغيل يقرأ كلفتَه من `pl-lines.js` بنفسه. وفترةُ الحمولة السنةُ كاملةً دائماً:
    // القصُّ على أشهرٍ يقع في المتصفّح من المصفوفات الاثنتي عشرة، لا بطلبٍ جديد لكل نقرة.
    sectorIncomeStatement(user, sectorId, { year: y, months: [] }),
    monthlyPlLines(sectorId, y),
    closedThrough(sectorId, y),
    lastFinanceUpload(sectorId, y),
    lastSanadExpense(sectorId, y),
    canPlan ? monthlyRevenueTargets(sectorId, y) : null,
    canPlan ? annualSectorTarget(sectorId, y) : null,
    canRevenue ? revenueOutlook(sectorId, y, today) : null,
    sectorStaffing(sectorId, y),
    completenessScore(user, sectorId, { year: y }),
    canProjects ? sectorProjects(sectorId, y) : [],
    canRevenue ? revenueByProjectMonth(sectorId, y) : [],
    canRevenue ? revenueByMonth(sectorId, y) : [],
    canRevenue ? revenueByProjectAllYears(sectorId) : [],
    canProjects ? unbilledByProject(sectorId, y) : [],
    canCostLines ? expenseByProjectCategory(sectorId, y) : [],
    canCostLines ? sanadCostByMonthCategory(sectorId, y) : [],
    sectorClientRows(sectorId),
    all('SELECT id, name_ar FROM department WHERE sector_id = ? AND deleted_at IS NULL ORDER BY name_ar', [sectorId]),
    canOpps ? openOpportunities(sectorId, y) : [],
    canOpps ? all('SELECT id, name_ar, color, default_win_pct, sort_order, is_won, is_lost FROM stage ORDER BY sort_order') : [],
    canCostLines ? reconcile(sectorId, y) : null,
    attentionFeed(user, sectorId, { year: y, today: todayIso }).catch(() => []),
    changesSince(user, sectorId, `${y}-01-01`, nowIsoStamp).catch(() => ({ items: [], counts: {} })),
    sectorTeamDetail(user, { sector: sectorId, year: y, todayDate: todayIso }).catch(() => null),
  ]);

  // ── الإيراد شهراً بشهر: سندٌ هو مصدرُه، فعمودُ «سند» وعمودُ «فعلي» فيه واحد ─────────────
  const revFin = m12();
  for (const r of revMonth) { const i = monthIndex(r.m); if (i >= 0) revFin[i] = (revFin[i] ?? 0) + (Number(r.v) || 0); }

  // ── ما سجّله سند من كلفةٍ مصنَّفة: سطراً بسطرٍ وشهراً بشهر ──────────────────────────────
  const sanadByKey = Object.fromEntries(COST_KEYS.map((k) => [k, m12()]));
  for (const r of sanadCost) {
    const i = monthIndex(r.m);
    const k = r.category == null ? '' : String(r.category);
    if (i < 0 || !COST_KEYS.includes(k)) continue;   // بلا شهرٍ أو بلا تصنيفٍ لا يُنسب إلى سطر
    sanadByKey[k][i] = (sanadByKey[k][i] ?? 0) + (Number(r.v) || 0);
  }

  // ── السطور: صفوفُ القائمة كما أذِنت بها البوابات، مُلبَسةً اثني عشر شهراً ────────────────
  // `cor` و`gp` محسوبان لا مقروءان: مجموعُ ما بعضه مجهول مجهول (فراغٌ يمتدّ)، إلا عمودَ سند
  // فالغيابُ فيه «لا صرفَ مسجَّل على هذا السطر» لا «لم يُدخَل» — وسندُ نفسُه دفترُ ما وقع.
  const finOf = (key) => (key === 'rev' ? revFin : (monthly[key]?.actual || m12()));
  const planOf = (key) => (key === 'rev' ? (monthlyTarget ? monthlyTarget.slice(0, 12) : m12()) : (monthly[key]?.plan || m12()));
  const sanadOf = (key) => (key === 'rev' ? revFin.slice() : (sanadByKey[key] || m12()));

  const costFin = COST_KEYS.map((k) => finOf(k));
  const costPlan = COST_KEYS.map((k) => planOf(k));
  const costSanad = COST_KEYS.map((k) => sanadOf(k));
  const corFin = Array.from({ length: 12 }, (_, i) => sumStrict(costFin.map((a) => a[i])));
  const corPlan = Array.from({ length: 12 }, (_, i) => sumStrict(costPlan.map((a) => a[i])));
  const corSanad = Array.from({ length: 12 }, (_, i) => sumPresent(costSanad.map((a) => a[i])));
  const series = {
    cor: { fin: corFin, plan: corPlan, sanad: corSanad },
    gp: {
      fin: pairwise(revFin, corFin, diffStrict),
      plan: pairwise(planOf('rev'), corPlan, diffStrict),
      sanad: pairwise(revFin, corSanad, diffStrict),
    },
  };
  const seriesOf = (key) => series[key] || { fin: finOf(key), plan: planOf(key), sanad: sanadOf(key) };

  const nameByKey = Object.fromEntries(PL_LINES.map((l) => [l.key, l.ar]));
  const lines = statement.rows.map((row) => {
    const s = seriesOf(row.key);
    return {
      id: row.key,
      name: nameByKey[row.key] || row.ar,
      kind: row.kind,
      flag: row.state !== 'ok',
      // الخطة تغيب كلَّها عمّن لا يقرأ المستهدف — غياباً لا أصفاراً.
      ...(canPlan ? { plan: s.plan } : {}),
      fin: s.fin,
      sanad: s.sanad,
    };
  });
  if (!canCostLines) notes.push('costs_hidden');
  if (!canRevenue) notes.push('revenue_hidden');
  if (!canPlan) notes.push('plan_hidden');
  // وملاحظاتُ القائمة نفسها تمرّ كما هي (لا مستهدفَ مسجَّل، لا توزيعَ شهري، الخطة للقطاع
  // كلّه…): مفتاحُها داخليٌّ ونصُّه عند من يعرضه، فلا يُترجم هنا ولا يُعاد اختراعه.
  for (const n of statement.notes || []) if (!notes.includes(n)) notes.push(n);

  // ── المشاريع: ما يراه القارئ منها، بأرقامها التي أذِنت بها بواباتها ──────────────────────
  const revByProject = new Map();
  for (const r of revProjMonth) {
    const i = monthIndex(r.m);
    if (i < 0 || !r.pid) continue;
    if (!revByProject.has(r.pid)) revByProject.set(r.pid, m12());
    const a = revByProject.get(r.pid);
    a[i] = (a[i] ?? 0) + (Number(r.v) || 0);
  }
  const recognizedOf = new Map(revAllYears.filter((r) => r.pid).map((r) => [r.pid, Number(r.v) || 0]));
  const unbilledOf = new Map(unbilled.filter((r) => r.pid).map((r) => [r.pid, Number(r.nv) || 0]));
  // كلفةُ المشروع: تصنيفٌ × شهر. وشهرٌ بلا صرفٍ على البند يبقى فارغاً لا صفراً.
  const expenseOf = new Map();
  for (const r of prjExpense) {
    const i = monthIndex(r.m);
    const k = r.category == null ? '' : String(r.category);
    if (!r.pid || i < 0 || !COST_KEYS.includes(k)) continue;
    if (!expenseOf.has(r.pid)) expenseOf.set(r.pid, {});
    const slot = expenseOf.get(r.pid);
    if (!slot[k]) slot[k] = m12();
    slot[k][i] = (slot[k][i] ?? 0) + (Number(r.v) || 0);
  }
  // شهرُ نهاية المشروع داخل السنة المعروضة — وما انتهى قبلها أو بعدها لا شهرَ له فيها.
  const endMonthIn = (date) => {
    const s = String(date || '');
    if (s.slice(0, 4) !== String(y)) return null;
    const i = monthIndex(s.slice(5, 7));
    return i < 0 ? null : i + 1;
  };
  const projectRows = projects.map((p) => {
    const contract = p.contract_value_halalas == null ? null : Number(p.contract_value_halalas);
    const recognized = recognizedOf.get(p.id) ?? 0;
    const exp = expenseOf.get(p.id) || {};
    return {
      id: p.id,
      name: p.name_ar || '',
      code: p.code || null,
      client_id: p.client_id || null,
      dept_id: p.department_id || null,
      rag: p.rag || null,
      contract,
      // المتبقي من الالتزام: ما تعاقدنا عليه ناقصَ ما اعترفنا به إيراداً منه، ولا ينزل تحت
      // الصفر (عقدٌ تجاوز إيرادُه قيمتَه المسجَّلة خبرُ تسجيلٍ لا دَينٌ سالب).
      remaining: contract == null ? null : Math.max(0, contract - recognized),
      unbilled: unbilledOf.get(p.id) ?? 0,
      start: p.start_date || null,
      end_m: endMonthIn(p.end_date),
      act: {
        rev: canRevenue ? (revByProject.get(p.id) || m12()) : m12(),
        // الكلفةُ على المشروع تسقط كاملةً عمّن لا يقرؤها — غياب مفاتيحَ لا أصفار.
        ...(canCostLines ? { con: exp.con || m12(), ctr: exp.ctr || m12(), lic: exp.lic || m12() } : {}),
      },
      // لا خطة على مستوى المشروع في المنصة: الخطة تُعتمد للقطاع كلّه، فالحقل فارغٌ صراحةً
      // ومعه ملاحظتُه — بدل قسمةِ مستهدف القطاع على واحدٍ من مشاريعه.
      plan: null,
      // الهامش **نسبةٌ مئوية صريحة**: ١٢٫٥ تعني ١٢٫٥٪ — لا كسراً (٠٫١٢٥) ولا هللات. تُقرّب
      // إلى خانةٍ عشرية واحدة حتى لا يبتلع التقريب نصف نقطةٍ من هامشٍ ضيّق، والشاشة تطبعها مرةً
      // واحدة بعد قسمتها على مئة (`prjStats` في `pages/sector.js`).
      ...(canMargin && p.margin_pct != null
        ? { margin_pct: Math.round(Number(p.margin_pct) * 10) / 10 } : {}),
    };
  });
  if (projectRows.length) notes.push('no_project_plan');

  // ── العملاء: حصةُ كلٍّ من إيراد السنة، ومشاريعُه، وما له من فرصٍ مفتوحة ────────────────
  const revByClient = new Map();
  if (canRevenue) {
    const clientOfProject = new Map(projects.map((p) => [p.id, p.client_id || null]));
    for (const [pid, arr] of revByProject) {
      const cid = clientOfProject.get(pid);
      if (!cid) continue;
      const v = arr.reduce((a, b) => a + (b || 0), 0);
      revByClient.set(cid, (revByClient.get(cid) || 0) + v);
    }
  }
  const clientTotal = [...revByClient.values()].reduce((a, b) => a + b, 0);
  const clientRows = clients.map((c) => ({
    id: c.id,
    name: c.name_ar || '',
    ...(canOpps ? { prospect: Number(c.prospect) || 0 } : {}),
    ...(canRevenue ? {
      revenue: revByClient.get(c.id) ?? 0,
      share_pct: clientTotal ? Math.round(((revByClient.get(c.id) || 0) / clientTotal) * 1000) / 10 : null,
    } : {}),
    projects: Number(c.projects) || 0,
  }));

  // ── الفرص: المرحلةُ باسمها، والاحتمال كسراً، والركودُ بقاعدةٍ واحدة ──────────────────────
  const dayMs = 86400000;
  const oppRows = opps.map((o) => {
    const moved = String(o.stage_changed_at || o.updated_at || o.created_at || '').slice(0, 10);
    const idle = moved ? Math.max(0, Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${moved}T00:00:00Z`)) / dayMs)) : null;
    // «شهر الإغلاق المتوقَّع» لا عمودَ له في المنصة: أقربُ ما سُجِّل هو موعدُ تقديم العرض،
    // ويُقرأ منه الشهر متى وقع في السنة المعروضة — وإلا بقي فارغاً ولم يُخترع.
    const close = endMonthIn(o.submission_due);
    return {
      id: o.id,
      name: o.title_ar || '',
      client_id: o.client_id || null,
      stage_key: o.stage_id || null,
      value: o.value_halalas == null ? null : Number(o.value_halalas),
      prob: o.win_pct == null ? null : Number(o.win_pct) / 100,
      close_m: close,
      idle_days: idle,
      stalled: idle != null && idle > STALLED_DAYS,
    };
  });
  const stageRows = stages.map((s) => ({
    key: s.id,
    name: s.name_ar || '',
    color: s.color || null,
    prob: s.default_win_pct == null ? null : Number(s.default_win_pct) / 100,
    sort: Number(s.sort_order) || 0,
  }));

  // ── الفريق والطاقة: وحداتُ دوامٍ كامل، بلا أي قيمةٍ مالية ──────────────────────────────
  // نسبةُ الإشغال في الكشف مئويةٌ للشخص، ووحدةُ الشاشة هنا شخصٌ كامل — فالقسمة على مئة.
  const head = Number(staffing?.headcount) || 0;
  const alloc = Array(12).fill(0);
  for (const e of staffing?.employees || []) {
    for (let i = 0; i < 12; i++) alloc[i] += (Number(e.months?.[i]) || 0) / 100;
  }
  const nowM = Number(staffing?.currentMonth) || 0;
  const staffingOut = {
    head,
    idle: (staffing?.employees || []).filter((e) => !Number(e.current)).length,
    cap: Array.from({ length: 12 }, () => head),
    alloc: alloc.map((v) => Math.round(v * 100) / 100),
    alloc_now: nowM ? Math.round(alloc[nowM - 1] * 100) / 100 : null,
  };

  // ── الخطة: مستهدفُ القطاع، وما أقفلته المالية خطةً لسطر الإيراد، والتوزيع الشهري ────────
  const planOut = canPlan ? {
    sector_target: supportUnit ? null : annual?.budget?.target_revenue_halalas ?? null,
    finance_plan_fy: sumPresent(monthly.rev?.plan || m12()),
    sales_target: supportUnit ? null : annual?.budget?.target_sales_halalas ?? null,
    monthly_target: supportUnit ? m12() : (monthlyTarget ? monthlyTarget.slice(0, 12) : m12()),
  } : null;

  const changeItems = Array.isArray(changes?.items) ? changes.items.slice(0, CHANGES_CAP) : [];

  return {
    meta: {
      // لا عمودَ رمزٍ على القطاع في المخطط — الحقل قائمٌ في الشكل ويبقى فارغاً حتى يوجد.
      sector: { id: sector.id, name_ar: sector.name_ar || '', code: null },
      year: y,
      today: { m: today.getUTCMonth() + 1, d: today.getUTCDate(), iso: todayIso },
      closed_through: closed.month,
      closed_source: closed.source,
      generated_at: nowIsoStamp,
      finance_upload: { at: upload?.at || null, by: upload?.by_name || null },
      sanad_last_expense_at: lastExpense?.at || null,
      completeness_pct: completeness?.score ?? null,
    },
    lines,
    ...(canRevenue ? {
      revenue: {
        by_project_month: [...revByProject].map(([project_id, m]) => ({ project_id, m })),
      },
    } : {}),
    projects: projectRows,
    clients: clientRows,
    depts: depts.map((d) => ({ id: d.id, name: d.name_ar || '' })),
    opps: oppRows,
    stages: stageRows,
    staffing: staffingOut,
    ...(planOut ? { plan: planOut } : {}),
    ...(outlook ? { outlook } : {}),
    ...(recon ? { recon } : {}),
    attention: Array.isArray(attention) ? attention : [],
    changes: { items: changeItems, counts: changes?.counts || {} },
    ...(team ? { team } : {}),
    notes,
  };
}
