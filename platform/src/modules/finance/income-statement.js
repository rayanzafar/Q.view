// ── قائمة الدخل للقطاع: تسعة سطور بترتيبٍ ثابت لا يتغيّر بتغيّر البيانات ────────────────────
//
// السطور هي لغة المالك في قراءة الربح: إيرادٌ، ثم ستة بنود كلفة، ثم «تكلفة الإيراد» مجموعةً،
// ثم «مجمل الربح». الترتيب جزءٌ من المعنى (الأعلى إيرادٌ والأسفل نتيجة)، ولذلك
// `PL_LINES` مجمَّدة: الشاشة تقرأ منها ولا تعيد ترتيبها، والمرحلة الثانية تملأ القيم لا الأسماء.
//
// ── الكلفة: ما تعتمده المالية شهراً بشهر، لا ما يُستنتَج ──────────────────────────────────
// سطور الكلفة الستة تُقرأ من `pl_line_amount` عبر `pl-lines.js` (ترحيلة ٠٥٠): ما أدخلته
// المالية لهذا القطاع في هذه السنة. والقاعدة التي تحكم القراءة واحدة: **صفٌّ مُدخَل بصفرٍ
// صفر، وغيابُ الصفّ فراغ** — لا يُحوَّل غيابٌ إلى صفر، لأن صفراً واحداً في سطر كلفةٍ يُنتج
// «مجمل ربحٍ» يساوي الإيراد كاملاً، وهو رقمٌ يُبنى عليه قرار. ورياضيات الجمع والطرح مكتوبةٌ
// كاملةً خلف فحص الفراغ، فسطرٌ واحد لم يُدخَل يُفرِّغ المجموع والنتيجة معاً.
// والحقنُ (`_loaders`) يبقى بابَ الاختبار وحده — لا بابَ تشغيل.
//
// ── الخطة **والكلفة** للقطاع كلّه ────────────────────────────────────────────────────────
// المستهدف يُعتمد على مستوى القطاع (سنوياً وموزَّعاً على الأشهر)، فلا يوجد مستهدفٌ لمشروعٍ أو
// عميلٍ أو إدارة. وكذلك الكلفة: المالية تُقفل سطورها على القطاع، ولا تُنسَب إلى مشروعٍ ولا
// عميلٍ ولا إدارة. فحين يقصّ القارئ الشاشة على أحدها يبقى الإيراد وحده مقصوصاً، وتعود أعمدة
// الخطة والكلفة فارغةً مع ملاحظةٍ تقول السبب — بدل قسمةِ رقم القطاع على مقصوصٍ منه فتخرج
// نسبةٌ موهومة.
import { all, get } from '../../core/db/index.js';
import { can, canSeeSensitive } from '../../core/rbac/index.js';
import { DELIVERY_SECTOR_SQL } from '../../core/org/kind.js';
import { projectYearClause } from '../pmo/projects.js';
import { forbidden, badRequest, notFound } from '../../core/http/errors.js';
import { config } from '../../core/config.js';
import { audit } from '../../core/audit/index.js';
import { netSum } from './vat.js';
import { projectScopeSql, scopeCondSql } from '../../core/reports/metrics.js';
import { monthlyRevenueTargets, annualSectorTarget, targetYear } from '../org/sector-targets.js';
import { periodBounds } from '../../core/reports/changes.js';
// قارئُ أشهر الفترة الواحد (`p=` و`months=`) يسكن مع حمولة المركز — وهذا الملفّ يستعمله ولا
// ينسخه. والاستيراد متبادلٌ بين الملفّين: `monthsFromQuery` تصريحُ دالةٍ مرفوعٌ عند الربط،
// فيصل سليماً في الاتجاهين، ولا يُقرأ منه شيء وقت التحميل.
import { monthsFromQuery } from './command-center.js';
// مُحمِّلا الكلفة من بابهما الواحد (`pl_line_amount`). الاستيراد هنا علويٌّ والاستعمال داخل
// الدالة: الوحدتان تستوردان من بعضهما عمداً (هذه تأخذ القارئَين، وتلك تأخذ أسماء السطور)،
// فلا تُقرأ قيمةُ مستوردٍ في المستوى الأعلى من أيٍّ منهما.
import { loadCostActuals, loadCostPlans, closedThrough } from './pl-lines.js';
import { MONTHS_AR, QUARTERS_AR, QUARTERS_SHORT } from '../../core/i18n/time.js';
import { buildExport } from '../io/xlsx.js';
import { G } from '../../web/i18n/glossary.js';

// صيغة الإيراد الصافي من مصدرها الواحد (ترحيلة ٠١٩) — لا نسخة ثانية هنا.
const NET_REVENUE = netSum('rl.amount_halalas', 'rl.net_amount_halalas');

/**
 * سطور قائمة الدخل بترتيبها المعتمد — وهو ترتيب ورقة المالك نفسها: إيرادٌ، ثم ستة بنود كلفة،
 * ثم مجموعها، ثم النتيجة. المفاتيح قصيرةٌ لأنها تُكتب في القاعدة (`pl_line_amount.line_key`)
 * وفي ملفّ الرفع وفي عنوان الصفحة، فطولُها ضجيجٌ بلا معنى.
 *
 * `ar` وحده ما يُعرض على الشاشة والورقة. و`en` يبقى لورقة العمل (Excel) وحدها: المصطلح
 * الإنجليزي متّفقٌ عليه مع المالك لمن يقرأ الملفّ خارج المنصة، أما الشاشة فعربيةٌ خالصة —
 * وسطرٌ إنجليزيٌّ تحت كل اسمٍ كان يضاعف طول الصف بلا أن يقرأه أحد.
 */
export const PL_LINES = Object.freeze([
  { key: 'rev', ar: 'الإيراد', en: 'Revenue', kind: 'revenue' },
  { key: 'sal', ar: 'رواتب التشغيل', en: 'Operation Salaries', kind: 'cost' },
  { key: 'con', ar: 'أتعاب المستشارين', en: 'Consultant Fees', kind: 'cost' },
  { key: 'ctr', ar: 'مصاريف التعاقد', en: 'Contracting Expenses', kind: 'cost' },
  { key: 'lic', ar: 'التراخيص', en: 'Licenses', kind: 'cost' },
  { key: 'rent', ar: 'الإيجار', en: 'Rent', kind: 'cost' },
  { key: 'oth', ar: 'مصاريف تشغيلية أخرى', en: 'Other Operation Expenses', kind: 'cost' },
  { key: 'cor', ar: 'تكلفة الإيراد', en: 'Cost of Revenue', kind: 'subtotal' },
  { key: 'gp', ar: 'مجمل الربح', en: 'Gross Profit (Loss)', kind: 'result' },
].map((l) => Object.freeze(l)));

/** مفاتيح سطور الكلفة الستة مجمَّدةً — تقرؤها الخدمة والمحوّل وقائمة التصنيف، فلا ثلاثُ نسخ. */
export const COST_KEYS = Object.freeze(PL_LINES.filter((l) => l.kind === 'cost').map((l) => l.key));

/** السطر بمفتاحه: اسمٌ ونوعٌ بلا بحثٍ خطّيّ في كل موضع يحتاجهما. */
export const LINE_BY_KEY = Object.freeze(Object.fromEntries(PL_LINES.map((l) => [l.key, l])));

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
  // المشروع قيمةٌ واحدة أو قائمةٌ اختارها الشريط — القاعدة نفسها التي تقصّ بها بقية الأبعاد.
  const projCond = scopeCondSql('rl.project_id', scope.project);
  const projClause = projCond ? projCond.sql : '';
  if (projCond) params.push(...projCond.args);
  const r = await get(`SELECT ${NET_REVENUE} v FROM revenue_line rl
      ${sc.active ? 'LEFT JOIN project p ON p.id = rl.project_id' : ''}
      WHERE rl.sector_id = ? AND rl.year = ? AND rl.month IN (${months.map(() => '?').join(',')})${sc.clause}${projClause}`,
  params);
  return r?.v || 0;
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
 *        حقنُ مُحمِّلَي الكلفة — للاختبار وحده. مسار التشغيل يقرأ من `pl-lines.js`.
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
  // ── عدسةُ الإقفال: على سطور الكلفة وحدها ──────────────────────────────────────────────
  // الإيراد يُسجَّل في سند يوماً بيوم، فيُجمع على الأشهر المختارة كما اختارها القارئ. أما سطور
  // الكلفة فلا تصير رقماً إلا حين تُقفل المالية شهرها؛ وشهرٌ لم يُقفل بعدُ كلفتُه **غائبة** لا
  // معدومة. فلو جُمعت الكلفة على أشهرٍ مفتوحة لخرج «مجمل ربحٍ» متضخِّمٌ: إيرادُ تسعة أشهر ناقص
  // كلفةَ ثمانية. ولذلك فترةُ الكلفة = المختار ∩ المغلق، وفراغُها يبقى فراغاً يقوله السطر
  // («لم يُسجَّل») — لا صفراً. وهي القاعدةُ نفسها التي تعمل بها الشاشة والورقة والملفّ.
  const closed = await closedThrough(sectorId, y);
  const closedMonth = Number(closed?.month) || 0;
  const costMonths = periodMonths.filter((m) => m <= closedMonth);
  // قائمةٌ أو قيمةٌ واحدة — وفراغُ القائمة ليس قصّاً: يُسوَّى إلى غياب كي لا يُقرأ «مقصوصٌ بلا شيء».
  const oneOrList = (v) => {
    if (Array.isArray(v)) return v.length ? v : null;
    return v ?? null;
  };
  const sc = { dept: oneOrList(scope.dept), client: oneOrList(scope.client), project: oneOrList(scope.project) };
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

  // ── الكلفة: من `pl_line_amount` عبر مُحمِّلَيها (ويُحقنان في الاختبار وحده) ──────────────
  // القراءة بعد البوابات لا قبلها: من لا يملك بابَي الكلفة والهامش لا يُستعلَم لأجله أصلاً،
  // فلا يصير وجودُ الرقم في القاعدة خبراً يُستدلّ عليه بزمن الطلب.
  const actualsOf = _loaders.loadCostActuals || loadCostActuals;
  const plansOf = _loaders.loadCostPlans || loadCostPlans;
  // بلا شهرٍ مغلقٍ في الفترة لا يُستعلَم أصلاً: قائمةٌ فارغةٌ من الأشهر تُقرأ عند المُحمِّلين
  // «السنة كاملة»، فكانت ستُخرج كلفةَ أشهرٍ لم يخترها القارئ.
  const costActuals = (canCostLines && costMonths.length) ? await actualsOf(sectorId, y, costMonths, sc) : {};
  const costPlans = (canCostLines && canPlan && !scoped && costMonths.length)
    ? await plansOf(sectorId, y, costMonths, sc) : {};
  // المقصوص يُقال سببُه: المُحمِّلان يُعيدان فراغاً على أي قصٍّ (الكلفة تُقفل على القطاع)،
  // وصفوفٌ فارغة بلا تعليل تُقرأ «لا كلفة» بينما الحقيقة «الكلفة ليست بهذا المقياس».
  if (canCostLines && scoped) notes.push('costs_are_sector_wide');
  const values = { rev };
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
  values.cor = {
    fy_plan: costCol('fy_plan'),
    period_plan: costCol('period_plan'),
    ytd_actual: costCol('ytd_actual'),
    period_actual: costCol('period_actual'),
  };
  values.gp = {
    fy_plan: diffOrNull(rev.fy_plan, values.cor.fy_plan),
    period_plan: diffOrNull(rev.period_plan, values.cor.period_plan),
    ytd_actual: diffOrNull(rev.ytd_actual, values.cor.ytd_actual),
    period_actual: diffOrNull(rev.period_actual, values.cor.period_actual),
  };

  // ── الصفوف: ما لا يراه القارئ يُحذف من القائمة، ولا يُعرض فارغاً ────────────────────────
  // صفٌّ فارغ في شاشةٍ مالية يُقرأ «لا يوجد»، والحقيقة «لا تملك رؤيته» — فالحذف أصدق.
  const visible = (line) => {
    if (line.key === 'rev') return canRevenue;
    if (line.kind === 'cost' || line.key === 'cor') return canCostLines;
    return canGP; // مجمل الربح
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
  const gp = values.gp;
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

/**
 * فترةٌ مبنيّةٌ على أشهرٍ مختارةٍ واحداً واحداً (`months=1,3,5`) — لغةُ شريط «مركز القطاع»:
 * الشريط يكتب `p=` متى كان المختار مدىً متّصلاً، ويكتب قائمةَ الأشهر متى كان متقطّعاً. وبلا
 * هذا الباب كانت نسخةُ الطباعة وملفُّ Excel يخرجان بالسنة كاملةً بينما القارئ يرى على شاشته
 * ثلاثة أشهر — ورقةٌ تخالف الشاشة التي خرجت منها.
 *
 * **قراءةُ الرابط ليست هنا**: `monthsFromQuery` في `command-center.js` هي القاعدة الواحدة
 * (وهي التي تقرأ `p=` و`months=` وترفض ما خرج عن المدى)، وهذه الدالةُ تُلبس ناتجَها شكلَ
 * الفترة وحده. والحدّان (`sinceIso`/`untilIso`) من أول شهرٍ مختارٍ إلى آخره: هما نافذةُ
 * الأحداث لا مجموعُ الأرقام، والمجموع يتبع `months` وحدها. و`pick` تقول إن الاختيار متقطّع
 * فلا يُسمّى «مدىً».
 */
function periodOfMonths(months, year, now) {
  const first = months[0];
  const last = months[months.length - 1];
  const base = periodBounds(first === last ? `m${first}` : `m${first}-m${last}`, year, now);
  return months.length === last - first + 1 ? { ...base, months } : { ...base, months, pick: true };
}

/** اسم الفترة بلسان القارئ — الحالةُ المحلَّلة كاملةً، لا (نوعٌ + رقم). */
function periodLabelAr(period) {
  // اختيارٌ متقطّع يُسمّى بأشهره نفسها: «يناير ومارس ومايو» — تسميتُه «من يناير إلى مايو»
  // تنسب إلى الرقم شهرين لم يدخلا فيه.
  if (period.pick) return (period.months || []).map((m) => MONTHS_AR[m - 1]).join(' و');
  if (period.kind === 'q') return QUARTERS_AR[period.index - 1] || G.fullYear;
  if (period.kind === 'm') return MONTHS_AR[period.index - 1] || G.fullYear;
  // «من بداية السنة» في سنةٍ منقضية تتّسع إلى شهورها الاثني عشر كلِّها — فاسمها حينئذٍ «السنة
  // كاملة» لا «من بداية السنة»: الأرقام أرقامُ السنة كاملةً، والاسم يجب أن يقولها كما هي.
  if (period.kind === 'ytd') return (period.months || []).length >= 12 ? G.fullYear : G.ytd;
  if (period.kind === 'range') {
    // مدى أرباعٍ يُسمّى بالأرباع كما على الشاشة — ورأسُ الملفّ والورقة يقرأ ما يقرؤه القارئ
    // حرفاً. وتسميتُه بشهرَيه («من يناير إلى سبتمبر») كانت ستجعل الورقة تخالف الشاشة اسماً.
    if (period.unit === 'q') return `من ${QUARTERS_AR[period.qFrom - 1]} إلى ${QUARTERS_SHORT[period.qTo - 1]}`;
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
  const now = new Date();
  // اختيارُ الأشهر الصريح يتقدّم على مفتاح الفترة: هو ما كتبه الشريط حين لم يكن المختار مدىً.
  // والقراءةُ من `monthsFromQuery` نفسها التي تقرأ لحمولة الشاشة ولملفّ المركز — قاعدةٌ واحدة
  // لا ثلاث، فلا تخرج الورقة بفترةٍ تخالف ما على الشاشة.
  const period = String(query.months ?? '').trim()
    ? periodOfMonths(monthsFromQuery(query, year, now), year, now)
    : periodBounds(query.p, year, now);

  // ── المقصوص: إدارةٌ («بلا إدارة» خيارٌ صريح) وعميلٌ ومشروع ─────────────────────────────
  // وكلُّ بُعدٍ يقبل **قائمةً** بفواصل كما يكتبها شريط الشاشة (`client=c1,c2`): القارئ يختار
  // عميلين فيرى الورقةُ والملفُّ ما تراه شاشتُه. وما لا وجود له في هذا القطاع يسقط صامتاً
  // كما يسقط على الشاشة، ورأسُ الورقة يسمّي المختار كلَّه لا أوّلَه.
  const askedList = (raw) => {
    const out = [];
    for (const part of String(raw || '').split(',')) {
      const v = part.trim();
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  };
  const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');
  // الترتيب ترتيبُ ما كتبه القارئ في الرابط، لا ترتيبَ القاعدة — فالأسماء في الرأس بترتيبه.
  const orderAsAsked = (asked, rows) => asked
    .map((id) => rows.find((r) => r.id === id))
    .filter(Boolean);

  const askedDept = askedList(query.dept);
  const deptIds = askedDept.filter((d) => d !== NO_DEPT);
  const deptRows = deptIds.length
    ? await all(`SELECT id, name_ar FROM department
        WHERE id IN (${placeholders(deptIds.length)}) AND sector_id = ? AND deleted_at IS NULL`,
    [...deptIds, sectorId])
    : [];
  const deptPicked = orderAsAsked(askedDept, deptRows).map((d) => ({ id: d.id, name: d.name_ar || '' }));
  if (askedDept.includes(NO_DEPT)) deptPicked.unshift({ id: NO_DEPT, name: G.withoutDepartment });
  const dept = deptPicked.length ? deptPicked.map((d) => d.id) : null;
  const deptName = deptPicked.map((d) => d.name).filter(Boolean).join('، ');

  const askedClient = askedList(query.client);
  // عميلٌ له أثرٌ في هذا القطاع (فرصةٌ أو مشروع) — لا أيُّ عميلٍ في الشركة.
  const clientRows = askedClient.length
    ? await all(`SELECT c.id, c.name_ar FROM client c
       WHERE c.id IN (${placeholders(askedClient.length)}) AND c.deleted_at IS NULL AND (
         EXISTS(SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.sector_id = ? AND o.deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM project pr WHERE pr.client_id = c.id AND pr.sector_id = ? AND pr.deleted_at IS NULL))`,
    [...askedClient, sectorId, sectorId])
    : [];
  const clientPicked = orderAsAsked(askedClient, clientRows);
  const client = clientPicked.length ? clientPicked.map((c) => c.id) : null;
  const clientName = clientPicked.map((c) => c.name_ar || '').filter(Boolean).join('، ');
  // المشروع: بعدسة السنة المعروضة نفسها (`projectYearClause` — قاعدة «مشروع السنة» الواحدة)
  // ومقصوصاً بما اختير قبله إدارةً وعميلاً، حرفاً بحرف كقائمة المشاريع على الشاشة. ومشروعٌ لا
  // تعرضه الشاشة في هذه السنة تحت هذين المرشِّحين لا يُقصّ به ملفٌّ ولا ورقة — وإلا كان رابطٌ
  // محرَّرٌ باليد يفتح قصّاً لا وجود له على الشاشة، فاختلف المطبوع عن المقروء.
  const askedProject = askedList(query.project);
  let projectRows = [];
  if (askedProject.length) {
    const pyc = projectYearClause(year);
    const deptCond = scopeCondSql('department_id', dept, { nullKey: NO_DEPT });
    const clientCond = scopeCondSql('client_id', client);
    projectRows = await all(`SELECT id, name_ar FROM project
       WHERE id IN (${placeholders(askedProject.length)}) AND sector_id = ? AND deleted_at IS NULL
         AND ${pyc.clause}${deptCond ? deptCond.sql : ''}${clientCond ? clientCond.sql : ''}`,
    [...askedProject, sectorId, ...pyc.params, ...(deptCond ? deptCond.args : []), ...(clientCond ? clientCond.args : [])]);
  }
  const projectPicked = orderAsAsked(askedProject, projectRows);
  const project = projectPicked.length ? projectPicked.map((p) => p.id) : null;
  const projectName = projectPicked.map((p) => p.name_ar || '').filter(Boolean).join('، ');

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
  costs_are_sector_wide: G.costsAreSectorWide,
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
  if (statement.rows.some((r) => r.key === 'gp')) {
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
