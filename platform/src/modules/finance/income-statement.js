// ── قائمة الدخل للقطاع: تسعة سطور بترتيبٍ ثابت لا يتغيّر بتغيّر البيانات ────────────────────
//
// السطور هي لغة المالك في قراءة الربح: إيرادٌ، ثم ستة بنود كلفة، ثم «تكلفة الإيراد» مجموعةً،
// ثم «مجمل الربح (الخسارة)». الترتيب جزءٌ من المعنى (الأعلى إيرادٌ والأسفل نتيجة)، ولذلك
// `PL_LINES` مجمَّدة: الشاشة تقرأ منها ولا تعيد ترتيبها، والمرحلة الثانية تملأ القيم لا الأسماء.
//
// ── المرحلة الأولى: الإيراد حقيقي، والكلفة **غير مُدخَلة** ─────────────────────────────────
// لا مصدرَ معتمداً بعدُ يُنسِب الصرف إلى هذه السطور الستة بعينها (جدول المصروفات يخلط أنواعاً
// لا تطابقها، وبنود الكلفة بلا تصنيفٍ مُلزم). فالقيمة تعود **فارغة** لا صفراً: الصفر ادّعاءُ
// علمٍ بأن الكلفة معدومة، وهو أسوأ من الاعتراف بأنها لم تُدخَل — ولأن صفراً واحداً في سطرٍ
// يُنتج «مجمل ربحٍ» يساوي الإيراد كاملاً، وهو رقمٌ يُبنى عليه قرار.
// ورياضيات الجمع والطرح مكتوبةٌ كاملةً خلف فحص الفراغ، فالمرحلة الثانية توصِّل البيانات وحدها
// (`loadCostActuals` / `loadCostPlans`) ولا تمسّ حساباً.
//
// ── الخطة للقطاع كلّه ────────────────────────────────────────────────────────────────────
// المستهدف يُعتمد على مستوى القطاع (سنوياً وموزَّعاً على الأشهر)، فلا يوجد مستهدفٌ لمشروعٍ أو
// عميلٍ أو إدارة. وحين يقصّ القارئ الشاشة على أحدها تعود أعمدة الخطة فارغةً مع ملاحظةٍ تقول
// السبب — بدل قسمةِ مستهدف القطاع على مقصوصٍ منه فتخرج نسبة تحقّقٍ موهومة.
import { all, get } from '../../core/db/index.js';
import { can, canSeeSensitive } from '../../core/rbac/index.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { projectYearClause } from '../pmo/projects.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { audit } from '../../core/audit/index.js';
import { netSum } from './vat.js';
import { projectScopeSql } from '../../core/reports/metrics.js';
import { monthlyRevenueTargets, annualSectorTarget, targetYear } from '../org/sector-targets.js';
import { periodBounds } from '../../core/reports/changes.js';
import { MONTHS_AR, QUARTERS_AR } from '../../core/i18n/time.js';
import { buildExport } from '../io/xlsx.js';
import { G } from '../../web/i18n/glossary.js';

// صيغة الإيراد الصافي من مصدرها الواحد (ترحيلة ٠١٩) — لا نسخة ثانية هنا.
const NET_REVENUE = netSum('rl.amount_halalas', 'rl.net_amount_halalas');

/** سطور قائمة الدخل بترتيبها المعتمد. المصطلحات الإنجليزية متّفقٌ عليها مع المالك حرفاً. */
export const PL_LINES = Object.freeze([
  { key: 'revenue', ar: 'الإيراد', en: 'Revenue', kind: 'revenue' },
  { key: 'op_salaries', ar: 'رواتب التشغيل', en: 'Operation Salaries', kind: 'cost' },
  { key: 'consultant_fees', ar: 'أتعاب المستشارين', en: 'Consultant Fees', kind: 'cost' },
  { key: 'contracting', ar: 'مصاريف التعاقد', en: 'Contracting Expenses', kind: 'cost' },
  { key: 'licenses', ar: 'التراخيص', en: 'Licenses', kind: 'cost' },
  { key: 'rent', ar: 'الإيجار', en: 'Rent', kind: 'cost' },
  { key: 'other_opex', ar: 'مصاريف تشغيلية أخرى', en: 'Other Operation Expenses', kind: 'cost' },
  { key: 'cost_of_revenue', ar: 'تكلفة الإيراد', en: 'Cost of Revenue', kind: 'subtotal' },
  { key: 'gross_profit', ar: 'مجمل الربح (الخسارة)', en: 'Gross Profit (Loss)', kind: 'result' },
].map((l) => Object.freeze(l)));

const COST_KEYS = Object.freeze(PL_LINES.filter((l) => l.kind === 'cost').map((l) => l.key));

// ── حسابٌ لا يخترع رقماً ────────────────────────────────────────────────────────────────────
// كل دالةٍ هنا تُعيد `null` متى غاب أحد طرفيها، والقسمة على صفرٍ غيابٌ لا لانهاية.
const sumOrNull = (vals) => (vals.some((v) => v == null) ? null : vals.reduce((a, b) => a + b, 0));
const diffOrNull = (a, b) => ((a == null || b == null) ? null : a - b);
const ratioPct = (num, den) => ((num == null || !den) ? null : Math.round((num / den) * 100));

/**
 * لون الانحراف: موجبٌ في الإيراد والنتيجة خيرٌ، وموجبٌ في الكلفة شرٌّ — والصفر لا لون له.
 * دالةٌ خالصة كي تقرأها الشاشة والاختبار من مصدرٍ واحد.
 * @returns {'good'|'bad'|'neutral'}
 */
export function varianceTone(kind, variancePct) {
  if (variancePct == null || !Number.isFinite(variancePct) || variancePct === 0) return 'neutral';
  const over = variancePct > 0;
  if (kind === 'revenue' || kind === 'result') return over ? 'good' : 'bad';
  if (kind === 'cost' || kind === 'subtotal') return over ? 'bad' : 'good';
  return 'neutral';
}

// أشهر الفترة: أعدادٌ صحيحة ١..١٢ بلا تكرار ومرتَّبة. غياب القائمة = السنة كاملة، أما قائمةٌ
// كلها خارج المدى فخطأُ طلبٍ يُقال صراحةً لا يُصحَّح صامتاً.
function normalizeMonths(months) {
  const given = Array.isArray(months) ? months : [];
  const set = new Set();
  for (const m of given) {
    const n = Number(m);
    if (Number.isInteger(n) && n >= 1 && n <= 12) set.add(n);
  }
  if (!set.size) {
    if (given.length) throw badRequest('حدّد أشهر الفترة بأرقام من ١ إلى ١٢');
    for (let m = 1; m <= 12; m++) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}

// ── الإيراد المحقّق: صافٍ، مقصوصٌ بالقطاع والسنة والأشهر، ثم بالإدارة/العميل/المشروع ──────
// الإدارة والعميل يُنسبان عبر مشروع البند (قاعدة `projectScopeSql` نفسها التي تستعملها الشاشة،
// فلا رقمان لسؤالٍ واحد)، والمشروع شرطٌ مباشر على البند لأن عموده فيه. وبندٌ بلا شهر يسقط من
// أي نافذة أشهر — كما في `windowRevenue` حرفاً.
async function revenueActual(sectorId, year, months, scope) {
  if (!months.length) return 0;
  // `projectCol: null` صراحةً: المشروع يُقصّ هنا بشرطٍ مكتوبٍ بيدنا على بند الإيراد نفسه
  // (`rl.project_id = ?` أدناه)، فلو تُرك العمود لقيمته الافتراضية (`p.id`) لتكرّر الشرط مرتين.
  const sc = projectScopeSql('p', { dept: scope.dept ?? null, client: scope.client ?? null }, { projectCol: null });
  const params = [sectorId, year, ...months, ...sc.args];
  let projClause = '';
  if (scope.project) { projClause = ' AND rl.project_id = ?'; params.push(scope.project); }
  const r = await get(`SELECT ${NET_REVENUE} v FROM revenue_line rl
      ${sc.active ? 'LEFT JOIN project p ON p.id = rl.project_id' : ''}
      WHERE rl.sector_id = ? AND rl.year = ? AND rl.month IN (${months.map(() => '?').join(',')})${sc.clause}${projClause}`,
  params);
  return r?.v || 0;
}

/**
 * كلفة السطور الستة فعلياً — المرحلة الأولى: لا مصدر معتمد، فكل سطرٍ فارغ (وليس صفراً).
 * الشكل المتفق عليه مع المرحلة الثانية: `{ [key]: { period, ytd } }` بالهللة أو `null`.
 */
async function loadCostActuals(_sectorId, _year, _months, _scope) {
  return Object.fromEntries(COST_KEYS.map((k) => [k, { period: null, ytd: null }]));
}

/**
 * خطة السطور الستة — المرحلة الأولى: لا خطة كلفةٍ معتمدة، فكل سطرٍ فارغ.
 * الشكل: `{ [key]: { fy, period } }` بالهللة أو `null`.
 */
async function loadCostPlans(_sectorId, _year, _months, _scope) {
  return Object.fromEntries(COST_KEYS.map((k) => [k, { fy: null, period: null }]));
}

/**
 * قائمة دخل قطاعٍ لسنةٍ وفترةٍ من أشهرها.
 *
 * @param {object} user   قارئ الطلب (يُفحص قبل أي حساب)
 * @param {string} sectorId
 * @param {object} opts
 * @param {number} opts.year
 * @param {number[]} opts.months   أشهر الفترة المختارة (فارغة = السنة كاملة)
 * @param {{dept?: string|null, client?: string|null, project?: string|null}} [opts.scope]
 * @param {{loadCostActuals?: Function, loadCostPlans?: Function}} [opts._loaders]
 *        حقنُ مُحمِّلَي الكلفة — للاختبار وللمرحلة الثانية، لا لمسار التشغيل.
 * @returns {Promise<object>} { sector_id, year, months, rows, gross_profit_pct, notes }
 */
export async function sectorIncomeStatement(user, sectorId, { year, months, scope = {}, _loaders = {} } = {}) {
  // ── البوابات أولاً، قبل أي رقم ────────────────────────────────────────────────────────
  // بلا قارئٍ لا قائمة: الغياب رفضٌ صريح لا حالةٌ «يمرّ لأن الشرط لم يتحقق».
  if (!user) throw forbidden('قائمة الدخل تُقرأ بحسابٍ مسجَّل الدخول');
  // من نطاقه دون الشركة يقرأ قطاعه وحده — القاعدة نفسها التي تحرس لوحة القطاع.
  if (user.scope !== 'company' && user.sector_id !== sectorId) throw forbidden('هذا القطاع خارج نطاقك');
  const target = { sector_id: sectorId };
  const canRevenue = can(user, 'read', 'revenue_line', target);
  const canPlan = can(user, 'read', 'budget', target);
  const canCost = canSeeSensitive(user, 'cost');
  const canMargin = canSeeSensitive(user, 'margin');
  // ── بابان معاً لكل ما يقع تحت سطر الإيراد ───────────────────────────────────────────
  // القائمة مترابطةٌ حسابياً: من يقرأ الإيراد وسطورَ الكلفة يبلغ «مجمل الربح» بطرحةٍ واحدة
  // (إيرادٌ ناقص «تكلفة الإيراد»، أو ناقص مجموع السطور الستة بيده). فحجبُ سطر النتيجة وحده
  // حجبُ اسمٍ لا رقم. ولذلك تتبع سطورُ الكلفة كلُّها ومجموعُها والنتيجةُ ونسبتُها بابَي
  // الكلفة والهامش **معاً** — تُفتح القائمة كاملةً تحت الإيراد أو لا يُسلَّم منها شيء.
  const canCostLines = canCost && canMargin;
  // و«مجمل الربح» ونسبته فوق ذلك يلزمهما بابُ الإيراد: بلا إيرادٍ تبقى النتيجة فارغةً أبداً،
  // وصفٌّ فارغٌ دائماً يُقرأ «لا يوجد» بينما الحقيقة «طرفُه الأعلى محجوب» — فحذفه أصدق.
  const canGP = canCostLines && canRevenue;

  const y = targetYear(year ?? config.fiscalYear);
  const periodMonths = normalizeMonths(months);
  // «حتى تاريخه» = من يناير إلى آخر شهرٍ في الفترة المختارة — لا إلى اليوم، فالفترة هي العدسة.
  const ytdMonths = Array.from({ length: Math.max(...periodMonths) }, (_, i) => i + 1);
  const sc = { dept: scope.dept ?? null, client: scope.client ?? null, project: scope.project ?? null };
  // أي قصٍّ — ولو كان «بلا إدارة» — يجعل المعروض جزءاً من القطاع، والمستهدف للقطاع كلّه.
  const scoped = !!(sc.project || sc.client || sc.dept);
  const notes = [];

  // ── الإيراد: خطةً ومحقَّقاً ───────────────────────────────────────────────────────────
  const rev = { fy_plan: null, period_plan: null, ytd_actual: null, period_actual: null };
  if (canRevenue) {
    rev.period_actual = await revenueActual(sectorId, y, periodMonths, sc);
    rev.ytd_actual = await revenueActual(sectorId, y, ytdMonths, sc);
  }
  if (canPlan) {
    if (scoped) {
      notes.push('plan_is_sector_wide');
    } else {
      const monthly = await monthlyRevenueTargets(sectorId, y);
      if (monthly) {
        rev.fy_plan = monthly.reduce((a, v) => a + (v || 0), 0);
        rev.period_plan = periodMonths.reduce((a, m) => a + (monthly[m - 1] || 0), 0);
      } else {
        // بلا توزيعٍ شهري معتمد: المستهدف السنوي وحده يُقرأ، والفترة تبقى فارغة — توزيعٌ
        // متساوٍ مفترض كان سيُنتج انحرافاً عن خطةٍ لم يعتمدها أحد.
        const annual = await annualSectorTarget(sectorId, y);
        rev.fy_plan = annual.budget?.target_revenue_halalas ?? null;
        notes.push(rev.fy_plan == null ? 'no_target_recorded' : 'no_monthly_plan');
      }
    }
  }

  // ── الكلفة: المحمِّلان (فارغان في المرحلة الأولى، ويُحقنان في الاختبار) ────────────────
  const actualsOf = _loaders.loadCostActuals || loadCostActuals;
  const plansOf = _loaders.loadCostPlans || loadCostPlans;
  const costActuals = canCostLines ? await actualsOf(sectorId, y, periodMonths, sc) : {};
  const costPlans = (canCostLines && canPlan && !scoped) ? await plansOf(sectorId, y, periodMonths, sc) : {};
  const values = { revenue: rev };
  for (const k of COST_KEYS) {
    const a = costActuals[k] || {};
    const p = costPlans[k] || {};
    values[k] = {
      fy_plan: p.fy ?? null,
      period_plan: p.period ?? null,
      ytd_actual: a.ytd ?? null,
      period_actual: a.period ?? null,
    };
  }

  // ── المجاميع والنتيجة: الرياضيات كاملةً، خلف فحص الفراغ ───────────────────────────────
  // سطرٌ واحد فارغ يُفرِّغ المجموع كلَّه: مجموعُ ما بعضه مجهول مجهول.
  const costCol = (field) => sumOrNull(COST_KEYS.map((k) => values[k][field]));
  values.cost_of_revenue = {
    fy_plan: costCol('fy_plan'),
    period_plan: costCol('period_plan'),
    ytd_actual: costCol('ytd_actual'),
    period_actual: costCol('period_actual'),
  };
  values.gross_profit = {
    fy_plan: diffOrNull(rev.fy_plan, values.cost_of_revenue.fy_plan),
    period_plan: diffOrNull(rev.period_plan, values.cost_of_revenue.period_plan),
    ytd_actual: diffOrNull(rev.ytd_actual, values.cost_of_revenue.ytd_actual),
    period_actual: diffOrNull(rev.period_actual, values.cost_of_revenue.period_actual),
  };

  // ── الصفوف: ما لا يراه القارئ يُحذف من القائمة، ولا يُعرض فارغاً ────────────────────────
  // صفٌّ فارغ في شاشةٍ مالية يُقرأ «لا يوجد»، والحقيقة «لا تملك رؤيته» — فالحذف أصدق.
  const visible = (line) => {
    if (line.key === 'revenue') return canRevenue;
    if (line.kind === 'cost' || line.key === 'cost_of_revenue') return canCostLines;
    return canGP; // gross_profit
  };
  const rows = PL_LINES.filter(visible).map((line) => {
    const v = values[line.key];
    const entered = v.ytd_actual != null || v.period_actual != null;
    const variancePct = ratioPct(diffOrNull(v.period_actual, v.period_plan), v.period_plan);
    return {
      key: line.key,
      ar: line.ar,
      en: line.en,
      kind: line.kind,
      fy_plan_halalas: v.fy_plan,
      ytd_actual_halalas: v.ytd_actual,
      attainment_pct: ratioPct(v.ytd_actual, v.fy_plan),
      period_plan_halalas: v.period_plan,
      period_actual_halalas: v.period_actual,
      variance_pct: variancePct,
      state: entered ? 'ok' : 'not_entered',
    };
  });

  // نسبة مجمل الربح: نتيجةٌ على إيرادها في العمود نفسه — فتتبع سطرَها حرفاً (الكلفة والهامش
  // والإيراد الثلاثة معاً)، ولا تُكتب نسبةٌ لسطرٍ لا يُعرض.
  const gp = values.gross_profit;
  const gross_profit_pct = {
    fy_plan: canGP ? ratioPct(gp.fy_plan, rev.fy_plan) : null,
    period_plan: canGP ? ratioPct(gp.period_plan, rev.period_plan) : null,
    period_actual: canGP ? ratioPct(gp.period_actual, rev.period_actual) : null,
  };

  return { sector_id: sectorId, year: y, months: periodMonths, rows, gross_profit_pct, notes };
}

// ── قارئُ المرشِّحات الواحد: الشاشة والملف والورقة تقرأ منه، فلا ثلاثُ قراءاتٍ تفترق ────────
// ما يصل من العنوان نصٌّ محرَّر، فلا يمرّ منه معرِّفٌ إلى الحساب قبل أن يُوجَد فعلاً داخل هذا
// القطاع: إدارةٌ من إداراته، وعميلٌ له أثرٌ فيه، ومشروعٌ من مشاريعه. وما لم يُوجَد **يُهمَل**
// (كما تفعل شاشة القطاع) لا يُرفَض في وجه القارئ — رابطٌ قديمٌ لإدارةٍ حُذفت يعرض القطاع كله
// لا صفحةَ خطأ. أما القطاعُ نفسه فلا يُهمَل: من طلب قطاعاً خارج نطاقه يُقال له ذلك صراحةً.
const NO_DEPT = 'none';

/** اسم الفترة بلسان القارئ — الحالةُ المحلَّلة كاملةً، لا (نوعٌ + رقم). */
function periodLabelAr(period) {
  if (period.kind === 'q') return QUARTERS_AR[period.index - 1] || G.fullYear;
  if (period.kind === 'm') return MONTHS_AR[period.index - 1] || G.fullYear;
  // «من بداية السنة» في سنةٍ منقضية تتّسع إلى شهورها الاثني عشر كلِّها — فاسمها حينئذٍ «السنة
  // كاملة» لا «من بداية السنة»: الأرقام أرقامُ السنة كاملةً، والاسم يجب أن يقولها كما هي.
  if (period.kind === 'ytd') return (period.months || []).length >= 12 ? G.fullYear : G.ytd;
  if (period.kind === 'range') {
    const first = period.months[0];
    const last = period.months[period.months.length - 1];
    return `من ${MONTHS_AR[first - 1]} إلى ${MONTHS_AR[last - 1]}`;
  }
  return G.fullYear;
}

/**
 * يحلّ القطاع والسنة والفترة والمقصوص من عنوان الطلب، ثم يبني قائمة الدخل عليها.
 *
 * @param {object} user
 * @param {object} query  { sector?, year?, p?, dept?, client?, project? }
 * @returns {Promise<{statement: object, sector: object, year: number, period: object,
 *                    scope: object, labels: object}>}
 */
export async function statementFromQuery(user, query = {}) {
  // بلا قارئٍ لا قائمة — الرفض صريحٌ أولاً، لا شرطاً يمرّ بغياب طرفه.
  if (!user) throw forbidden('قائمة الدخل تُقرأ بحسابٍ مسجَّل الدخول');
  const asked = String(query.sector || '').trim();
  // ── القطاع: من قائمة الشاشة نفسها ────────────────────────────────────────────────────
  // محوّل «مركز القطاع» لا يقبل إلا قطاعات التسليم (`DELIVERY_SECTOR_SQL`)، ووحدةُ المساندة
  // لا مركزَ قيادةٍ تجاريّاً لها. فما لا يقبله المحوّل لا يُقبل هنا: وإلا خرج بالملفّ والورقة
  // قطاعٌ لا سبيل إلى فتحه على الشاشة، فاختلف الملفُّ عمّا يراه القارئ.
  // ويبقى استثناءُ الشاشة نفسه: قطاعُ القارئ هو قطاعُه ولو كان وحدةَ مساندة — الشاشة تفتحه
  // له من `user.sector_id` بلا مرورٍ بالمحوّل، فتفتحه هذه القراءة له أيضاً.
  const deliverySectors = await all(`SELECT id FROM sector
     WHERE active = 1 AND deleted_at IS NULL AND ${DELIVERY_SECTOR_SQL} ORDER BY sort_order`);
  const own = user.sector_id || null;
  const accepted = asked && (deliverySectors.some((s) => s.id === asked) || asked === own) ? asked : null;
  const sectorId = accepted || own || (user.scope === 'company' ? (deliverySectors[0]?.id || null) : null);
  if (!sectorId) throw badRequest('لا يوجد قطاع مرتبط بحسابك — اطلب من مدير النظام ربطك بقطاع');
  // البوابة قبل أي استعلام: فلا يُستدلّ بوجود إدارةٍ أو عميلٍ على ما في قطاعٍ خارج النطاق.
  if (user.scope !== 'company' && user.sector_id !== sectorId) throw forbidden('هذا القطاع خارج نطاقك');
  const sector = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [sectorId]);
  if (!sector) throw notFound('لا يوجد قطاع بهذا الاسم');

  const year = targetYear(Number(query.year) || config.fiscalYear);
  const period = periodBounds(query.p, year, new Date());

  // ── المقصوص: إدارةٌ («بلا إدارة» خيارٌ صريح) وعميلٌ ومشروع ─────────────────────────────
  const askedDept = String(query.dept || '').trim();
  let dept = null;
  let deptName = '';
  if (askedDept === NO_DEPT) { dept = NO_DEPT; deptName = G.withoutDepartment; }
  else if (askedDept) {
    const d = await get('SELECT id, name_ar FROM department WHERE id = ? AND sector_id = ? AND deleted_at IS NULL',
      [askedDept, sectorId]);
    if (d) { dept = d.id; deptName = d.name_ar || ''; }
  }
  const askedClient = String(query.client || '').trim();
  let client = null;
  let clientName = '';
  if (askedClient) {
    // عميلٌ له أثرٌ في هذا القطاع (فرصةٌ أو مشروع) — لا أيُّ عميلٍ في الشركة.
    const c = await get(`SELECT c.id, c.name_ar FROM client c
       WHERE c.id = ? AND c.deleted_at IS NULL AND (
         EXISTS(SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.sector_id = ? AND o.deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM project pr WHERE pr.client_id = c.id AND pr.sector_id = ? AND pr.deleted_at IS NULL))`,
    [askedClient, sectorId, sectorId]);
    if (c) { client = c.id; clientName = c.name_ar || ''; }
  }
  // المشروع: بعدسة السنة المعروضة نفسها (`projectYearClause` — قاعدة «مشروع السنة» الواحدة)
  // ومقصوصاً بما اختير قبله إدارةً وعميلاً، حرفاً بحرف كقائمة المشاريع على الشاشة. ومشروعٌ لا
  // تعرضه الشاشة في هذه السنة تحت هذين المرشِّحين لا يُقصّ به ملفٌّ ولا ورقة — وإلا كان رابطٌ
  // محرَّرٌ باليد يفتح قصّاً لا وجود له على الشاشة، فاختلف المطبوع عن المقروء.
  const askedProject = String(query.project || '').trim();
  let project = null;
  let projectName = '';
  if (askedProject) {
    const pyc = projectYearClause(year);
    const deptCond = dept === NO_DEPT ? ' AND department_id IS NULL' : dept ? ' AND department_id = ?' : '';
    const p = await get(`SELECT id, name_ar FROM project
       WHERE id = ? AND sector_id = ? AND deleted_at IS NULL AND ${pyc.clause}${deptCond}${client ? ' AND client_id = ?' : ''}`,
    [askedProject, sectorId, ...pyc.params, ...(dept && dept !== NO_DEPT ? [dept] : []), ...(client ? [client] : [])]);
    if (p) { project = p.id; projectName = p.name_ar || ''; }
  }

  const scope = { dept, client, project };
  const statement = await sectorIncomeStatement(user, sectorId, { year, months: period.months, scope });
  const filters = [
    deptName ? `${G.departmentWord}: ${deptName}` : '',
    clientName ? `${G.client}: ${clientName}` : '',
    projectName ? `${G.project}: ${projectName}` : '',
  ].filter(Boolean);
  const labels = {
    sector: sector.name_ar || '',
    period: periodLabelAr(period),
    dept: deptName,
    client: clientName,
    project: projectName,
    filters,
  };
  return { statement, sector, year, period, scope, labels };
}

// ── ملفُّ Excel: الأرقام أرقامٌ لا نصوص، والفارغ يبقى فارغاً ─────────────────────────────
// من يفتح الملف يجمع ويطرح فيه، فالمبالغ تُكتب بالريال عدداً (لا نصّاً ولا هللةً)، والكلفة
// **بالسالب** كي يصحّ جمعُ العمود إلى مجمل الربح بلا أن يعكس أحدٌ إشارةً بيده. وما لم يُسجَّل
// يبقى خليّةً فارغة: صفرٌ هناك ادّعاءُ علمٍ بأن الكلفة معدومة.
const EXPORT_COLUMNS = Object.freeze([
  { key: 'ar', labelAr: G.lineItem },
  { key: 'en', labelAr: G.englishTerm },
  { key: 'fy_plan', labelAr: G.fyPlan },
  { key: 'attainment', labelAr: G.attainment },
  { key: 'period_plan', labelAr: G.periodPlan },
  { key: 'period_actual', labelAr: G.periodActual },
  { key: 'variance', labelAr: G.deviation },
]);

/** شرحُ الملاحظة بالعربية — مفتاحُها داخليّ، ونصُّها وحده ما يُقرأ. */
export const NOTE_AR = Object.freeze({
  plan_is_sector_wide: G.planIsSectorWide,
  no_monthly_plan: G.noMonthlyPlanNote,
  no_target_recorded: G.noTargetRecordedNote,
});
export const noteText = (key) => NOTE_AR[String(key || '')] || '';

// ريالٌ عدداً: الهللة تُقسَم على مئة، والكلفة تُقلَب إشارتها، والفراغ فراغ.
const sarCell = (halalas, kind) => {
  if (halalas == null) return '';
  const sar = Math.round(halalas) / 100;
  return (kind === 'cost' || kind === 'subtotal') ? -Math.abs(sar) : sar;
};
const pctCell = (v) => (v == null ? '' : v);

/**
 * قائمة دخل القطاع ملفَّ Excel — الأعمدة السبعة نفسها التي على الورقة، والصفوف صفوفَها.
 * بابان لا واحد: صلاحية تصدير التقارير هنا، وبوابات القطاع والكلفة والهامش داخل الخدمة.
 */
export async function exportIncomeStatement(ctx, query = {}) {
  const user = ctx?.user;
  if (!can(user, 'export', 'report')) throw forbidden('تصدير التقارير خارج صلاحياتك');
  const { statement, sector, year, period, scope, labels } = await statementFromQuery(user, query);

  const head = [
    { ar: `${G.incomeStatement} — ${labels.sector}` },
    { ar: `${G.periodWord}: ${labels.period} ${year}` },
  ];
  if (labels.filters.length) head.push({ ar: labels.filters.join(' · ') });
  head.push({ ar: '' });

  const body = statement.rows.map((r) => ({
    ar: r.ar,
    en: r.en,
    fy_plan: sarCell(r.fy_plan_halalas, r.kind),
    attainment: pctCell(r.attainment_pct),
    period_plan: sarCell(r.period_plan_halalas, r.kind),
    // ما لم يُسجَّل يبقى خليّةً **فارغة** لا كلمةً ولا صفراً: من يفتح الملفّ يجمع عموده،
    // وخليّةٌ فارغة تسقط من الجمع بينما الصفر يدخله، والكلمةُ تكسر نوع العمود.
    period_actual: sarCell(r.period_actual_halalas, r.kind),
    variance: pctCell(r.variance_pct),
  }));
  // نسبةُ مجمل الربح تتبع سطرَها: إن حُذف السطر لغياب بابَي الكلفة والهامش فلا نسبة تُكتب.
  if (statement.rows.some((r) => r.key === 'gross_profit')) {
    const gp = statement.gross_profit_pct || {};
    body.push({
      ar: G.grossProfitPct,
      // بلا مصطلحٍ إنجليزي: ورقةُ الأعمال المتَّفق عليها مع المالك لا تحمل سطراً بهذا الاسم
      // أصلاً (سطورها التسعة وحدها لها مصطلحاتها)، و«Gross Profit %» كان اختراعاً لا مصدرَ له.
      en: '',
      fy_plan: pctCell(gp.fy_plan),
      attainment: '',
      period_plan: pctCell(gp.period_plan),
      period_actual: pctCell(gp.period_actual),
      variance: '',
    });
  }
  const tail = [{ ar: '' }, { ar: G.revenueVsSalesExplain }];
  for (const n of statement.notes || []) { const t = noteText(n); if (t) tail.push({ ar: t }); }

  const out = buildExport({
    columns: EXPORT_COLUMNS,
    rows: [...head, ...body, ...tail],
    format: 'xlsx',
    sheetName: G.incomeStatement,
    rtl: true,
  });
  await audit(ctx, {
    action: 'export',
    resource: 'report',
    resourceId: `income-statement:${sector.id}`,
    sectorId: sector.id,
    detail: { year, period: period.key, scope, rows: statement.rows.length },
  });
  return {
    buffer: out.buffer,
    mime: out.mime,
    fileName: `${G.incomeStatement} ${labels.sector} ${year}.xlsx`.trim(),
  };
}
