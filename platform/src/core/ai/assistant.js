// المساعد المحكوم — محرّك محلي حتمي، يقرأ ما يملك صاحبه قراءته، ولا يكتب حرفاً بلا معاينة وتأكيد.
//
// ضمانات هذه الوحدة، بالترتيب الذي تفرضه:
//  ١) النطاق — كل قراءة تمرّ بـ`scopeFilter` أو بفحص `can` على الصف نفسه. لا استعلام يسأل
//     «هل نطاق الحساب شركة؟» بدل أن يسأل محرّك الصلاحيات — فذلك السؤال كان يفتح أرقام الشركة
//     لمن اتّسعت نافذته لغرض تشغيلي بلا أن يملك منحاً قيادياً واحداً.
//  ٢) الحجب — الكلفة والهامش والراتب لا تدخل نصّ الرد إلا لمن يملك بوابتها، والمحجوب يُقال
//     صراحةً «محجوب عن دورك» لا يُطبَع صفراً.
//  ٣) **لا كتابة تُخمَّن من نص**. لا محرّك لغوي هنا، فأي «فهمٍ» لجملة حرة هو مطابقة أنماط —
//     ومطابقة الأنماط تخطئ. لذلك: الدردشة **لا تعيد رمز تأكيد إطلاقاً**. الكتابة تبدأ من
//     `proposePreview` بحمولة مبنيّة (نوع + حقول) معرّفاتُها **صادرة من الخادم** عبر
//     `optionsFor` — فالنص الحر يملأ نموذجاً، ولا يختار هدفاً أبداً.
//  ٤) الغموض حالة مصمَّمة لا صدفة: صفر مطابقات ومطابقة واحدة و«اختر من هذه» و«ضيّق بحثك»
//     أربع حالات مختلفة برسائل مختلفة. لا اختيار صامت لأول نتيجة.
//  ٥) السجل — كل طلب يُسجَّل **بعد القرار** بنتيجته، ونص الطلب المرفوض لا يُحفظ.
import { all, get } from '../db/index.js';
import { can, effectiveScope } from '../rbac/index.js';
import { scopeFilter } from '../rbac/scope.js';
import { approvedTaskSql } from '../../modules/pmo/task-approval.js';
import { seesCompanyPerformance } from '../policy/pages.js';
import { aiMode, complete, logProviderFallback, warnOnceIfKeyIgnored } from './provider.js';
import { logAsk, savePreview, OUTCOME, PREVIEW_TTL_MINUTES } from './store.js';
import { projectKpis } from '../reports/metrics.js';
import { buildReport } from '../reports/engine.js';
import { isPersonalTask, notPersonalSql } from '../../modules/pmo/tasks.js';
import { nowIso, fmtSar } from '../util/ids.js';
import { forbidden, badRequest, notFound } from '../http/errors.js';

// تسمية بالمعنى لا بالقيمة المخزَّنة — نفس خرائط الواجهة (لا استيراد من web/ حفاظاً على اتجاه
// الطبقات core→web، فهذه نسخة محلية بنفس القيم). وما لا تعرفه الخريطة يُقال «غير محدّدة»:
// طباعة القيمة الخام كانت تُخرج كلمات إنجليزية داخل جملة عربية في وجه المستخدم.
const STATUS_AR = { IN_PROGRESS: 'قيد التنفيذ', ON_HOLD: 'متوقّف مؤقتًا', COMPLETED: 'مكتمل',
  NOT_STARTED: 'لم يبدأ', PLANNED: 'مُخطَّط', CANCELLED: 'ملغى' };
const RAG_AR = { GREEN: 'على المسار', AMBER: 'في خطر', RED: 'حرج' };
const PRIORITY_AR = { P0: 'حرجة', P1: 'عالية', P2: 'متوسطة', P3: 'منخفضة' };
const TASK_STATUS_AR = { TODO: 'قيد الانتظار', IN_PROGRESS: 'قيد التنفيذ', BLOCKED: 'مُعطَّل',
  IN_REVIEW: 'قيد المراجعة', DONE: 'منجز', CANCELLED: 'ملغاة' };
const UNKNOWN_AR = 'غير محدّدة';
const label = (map, v) => map[v] || UNKNOWN_AR;

// ── سجل النوايا: بطاقات الاقتراح وبوابة كل نية في مكان واحد ───────────────────
// الواجهة تعرض ما يعيده `aiStatus` وحده، فلا تظهر بطاقة لعملٍ يردّه الخادم — والبوابة نفسها
// تُفحص ثانيةً عند التنفيذ، فالبطاقة تسهيلٌ لا حارس.
export const INTENTS = [
  { intent: 'summarize_project', label_ar: 'ملخّص مشروع', kind: 'read',
    allow: (u) => can(u, 'read', 'project') },
  { intent: 'weekly_report', label_ar: 'مسودة الموجز الأسبوعي', kind: 'read',
    allow: (u) => seesCompanyPerformance(u) },
  { intent: 'detect_risks', label_ar: 'كشف المخاطر', kind: 'read',
    allow: (u) => !!effectiveScope(u, 'read', 'project') },
  { intent: 'data_quality', label_ar: 'فحص جودة البيانات', kind: 'read',
    allow: (u) => can(u, 'read', 'client') || can(u, 'read', 'service')
      || can(u, 'read', 'opportunity') || can(u, 'read', 'project') },
  { intent: 'suggest_priorities', label_ar: 'أولوياتي اليوم', kind: 'read', allow: () => true },
  { intent: 'create_task', label_ar: 'إنشاء مهمة', kind: 'write',
    allow: (u) => can(u, 'create', 'task') },
  { intent: 'update_task_status', label_ar: 'تحديث حالة مهمة', kind: 'write',
    allow: (u) => can(u, 'update', 'task') },
  { intent: 'move_opportunity_stage', label_ar: 'نقل فرصة إلى مرحلة', kind: 'write',
    allow: (u) => can(u, 'update', 'opportunity') },
];
const INTENT_BY_KEY = Object.fromEntries(INTENTS.map((i) => [i.intent, i]));
// النية ⟵ نوع التغيير المبنيّ الذي تُرسله الواجهة إلى `proposePreview`.
const WRITE_TYPE_OF = { create_task: 'task_create', update_task_status: 'task_status',
  move_opportunity_stage: 'opp_stage' };

// ── المدخل الوحيد للدردشة ─────────────────────────────────────────────────────
// عقدٌ صريح: **لا رمز تأكيد في أي رد من هنا**. الكتابة تبدأ من `proposePreview` وحدها.
export async function ask(ctx, message, opts = {}) {
  const user = ctx.user;
  const text = String(message || '').trim();
  const intent = classify(text, opts.intent);
  try {
    const out = await route(user, intent, text, opts);
    // نزع أي رمز تأكيد **بنيوياً** لا اتفاقاً: لو أعادت نيّةٌ يوماً رمزاً بالخطأ فلن يصل إلى
    // الواجهة أصلاً. هذا هو الثابت الذي يجعل خطأ «فهمٍ» غير قادر على إنتاج كتابة.
    const { outcome = OUTCOME.OK, applyToken: _t, previewId: _p, preview: _v, ...answer } = out;
    await logAsk(user, { intent, outcome, prompt: text, sectorId: user.sector_id });
    // الردّ يسمّي نيّته. بلا ذلك كان اختيار المستخدم من قائمة الالتباس يعود نصّاً يُصنَّف من
    // جديد — فيضيع الاختيار ويُجاب بجواب عام. النيّة رمز داخلي لا يُعرض لأحد، والواجهة تعيده
    // كما وصلها مع الاختيار فيبقى الطلب هو الطلب.
    return { intent, ...answer };
  } catch (e) {
    // القرار أولاً ثم السجل: المرفوض يُسجَّل بنيّته ونتيجته بلا نصّ طلبه.
    await logAsk(user, { intent, outcome: OUTCOME.DENIED, sectorId: user.sector_id });
    throw e;
  }
}

async function route(user, intent, text, opts) {
  switch (intent) {
    case 'summarize_project': return await summarizeProject(user, opts.projectId || null, text);
    case 'weekly_report': return await weeklyReportDraft(user);
    case 'detect_risks': return await detectRisks(user);
    case 'data_quality': return await dataQualityScan(user);
    case 'suggest_priorities': return await suggestPriorities(user);
    case 'create_task':
    case 'update_task_status':
    case 'move_opportunity_stage': return await offerForm(user, intent, text, opts);
    default: return smallTalk(user);
  }
}

function classify(text, forced) {
  if (forced && INTENT_BY_KEY[forced]) return forced;
  if (forced) return 'smalltalk';
  if (/(أنشئ|أضف|اضف|سجّل|سجل).*(مهمة|مهمّة)|مهمة جديدة/.test(text)) return 'create_task';
  if (/(حالة|أنجز|انجز|أغلق|اغلق|عطّل|علّق).*(مهمة|مهمّة)|(مهمة|مهمّة).*(منجزة|معطَّلة|معطلة)/.test(text)) return 'update_task_status';
  if (/(فرصة|الفرصة).*(فائزة|مكسوبة|خسارة|مفقودة|مؤهلة|تفاوض|عرض)|انقل.*(فرصة|الفرصة)/.test(text)) return 'move_opportunity_stage';
  if (/(لخّص|لخص|ملخّص|ملخص|حالة).*(مشروع)/.test(text)) return 'summarize_project';
  if (/تقرير.*أسبوع|الموجز/.test(text)) return 'weekly_report';
  if (/مخاطر|متعثر|متعثّر|حرج/.test(text)) return 'detect_risks';
  if (/جودة.*بيانات|نواقص/.test(text)) return 'data_quality';
  if (/أولوي|اولوي|المهم/.test(text)) return 'suggest_priorities';
  if (/غيّر|حدّث|عدّل|أنشئ|اضبط/.test(text)) return 'create_task'; // طلب تعديل مبهم ⟵ نموذج لا تخمين
  return 'smalltalk';
}

// ── نوايا القراءة (لا تكتب حرفاً) ─────────────────────────────────────────────
async function summarizeProject(user, projectRef, text) {
  if (!effectiveScope(user, 'read', 'project')) {
    throw forbidden('قراءة المشاريع خارج صلاحيتك. اطلب «أولوياتي اليوم» أو اطلب التفعيل من مدير النظام.');
  }
  let project = null;
  let preface = '';
  if (projectRef) {
    project = await get('SELECT * FROM project WHERE (id = ? OR code = ?) AND deleted_at IS NULL', [projectRef, projectRef]);
    if (!project) throw notFound('المشروع غير موجود');
    if (!can(user, 'read', 'project', project)) throw forbidden('هذا المشروع خارج نطاقك');
  } else {
    const found = await resolveRef(user, 'project', text);
    if (found.total === 0) {
      return { reply: found.query
        ? `لم أجد مشروعاً باسم «${found.query}» ضمن نطاقك. حدّد المشروع بالاسم كما يظهر في «المشاريع».`
        : 'حدّد المشروع (اسم أو رمز) لألخّص حالته.', outcome: OUTCOME.EMPTY };
    }
    if (found.total > 5) {
      return { reply: `وجدت ${found.total} مشروعاً يطابق «${found.query}» — اكتب اسماً أدق أو افتح المشروع من «المشاريع» ثم اطلب تلخيصه.`,
        outcome: OUTCOME.EMPTY };
    }
    if (found.total > 1) {
      // `choice_field` يقول بأي مفتاح يعود الاختيار — فتُرسله الواجهة باسمه لا بمفتاحين تخميناً.
      return { reply: `أكثر من مشروع يطابق «${found.query}» — اختر أيّها تقصد:`,
        choices: found.matches.map((m) => ({ id: m.id, label_ar: m.label })),
        choice_field: 'projectId', outcome: OUTCOME.EMPTY };
    }
    project = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [found.matches[0].id]);
    preface = `اخترتُ «${project.name_ar}» — المطابق الوحيد ضمن نطاقك. إن قصدت غيره فاذكر اسمه كاملاً.\n\n`;
  }

  const k = await projectKpis(project.id);
  const risks = await all("SELECT title FROM risk WHERE project_id = ? AND status != 'CLOSED' AND deleted_at IS NULL ORDER BY title LIMIT 5", [project.id]);
  const showCost = can(user, 'read', 'cost');
  const facts = [
    `الحالة: ${label(STATUS_AR, project.status)} · الصحة: ${label(RAG_AR, project.rag)} · الإنجاز: ${Math.round(project.progress_pct || 0)}%`,
    `المهام: ${k.taskCompletionRate}% مكتملة · متأخرة: ${k.lateTasks}`,
    `قبول المخرجات: ${k.deliverableAcceptanceRate}% (من ${k.totalDeliverables})`,
    showCost
      ? `الصرف الفعلي: ${fmtSar(project.actual_spend_halalas)} · قيمة العقد: ${fmtSar(project.contract_value_halalas)}`
      : `قيمة العقد: ${fmtSar(project.contract_value_halalas)} (التكلفة محجوبة عن دورك)`,
    risks.length ? `مخاطر مفتوحة: ${risks.map((r) => r.title).join('، ')}` : 'لا مخاطر مفتوحة',
  ];
  const tail = project.rag === 'RED' ? ' ⚠ المشروع حرج ويحتاج تدخلًا.'
    : k.lateTasks > 0 ? ' ⚠ توجد مهام متأخرة.' : ' على المسار.';
  const answer = await llmOrLocal(`لخّص حالة المشروع «${project.name_ar}» بإيجاز تنفيذي وبنبرة مهنية.`, facts,
    () => `**${project.name_ar}** — ${facts.join(' · ')}.${tail}`);
  return { reply: preface + answer };
}

async function weeklyReportDraft(user) {
  // بوابة أرقام الشركة واحدة في المنصة كلها: منحٌ قيادي **مع** نافذة شركية. كان هذا المسار
  // يصل إلى `companyOverview` التي تحرس نافذة الحساب وحدها — فيُردّ «المشتريات» على مسار
  // المقاييس ويستقبل الأرقام نفسها من المساعد. باب واحد لا بابان.
  if (!seesCompanyPerformance(user)) {
    throw forbidden('الموجز الأسبوعي يعرض إيراد الشركة ومبيعاتها ومستهدفاتها، وهي خارج صلاحيتك. '
      + 'تستطيع أن تطلب: «مخاطر نطاقي» أو «ملخّص مشروع» أو «أولوياتي اليوم».');
  }
  const data = await buildReport('weekly_exec_brief', user, {});
  const facts = [
    `الإيراد المحقق ${fmtSar(data.totals.revenue)} من ${fmtSar(data.totals.target_revenue)}`,
    `المبيعات ${fmtSar(data.totals.sales)} من ${fmtSar(data.totals.target_sales)}`,
    `خط الفرص ${fmtSar(data.pipeline_halalas)}`,
    data.achievements.length ? `إنجازات: ${data.achievements.join('، ')}` : '',
    data.risks.length ? `مخاطر: ${data.risks.join('، ')}` : '',
  ].filter(Boolean);
  const answer = await llmOrLocal('اكتب مسودة الموجز التنفيذي الأسبوعي بالعربية بنبرة تنفيذية موجزة.', facts,
    () => `**مسودة الموجز التنفيذي الأسبوعي**\n\n${facts.map((f) => '• ' + f).join('\n')}\n\n(يمكنك إرسالها من «التقارير والبريد».)`);
  return { reply: answer };
}

async function detectRisks(user) {
  if (!effectiveScope(user, 'read', 'project')) {
    throw forbidden('كشف المخاطر يقرأ المشاريع، وقراءتها خارج صلاحيتك. اطلب «أولوياتي اليوم» أو التفعيل من مدير النظام.');
  }
  const f = scopeFilter(user, 'project', 'read', { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id' });
  const red = await all(
    `SELECT name_ar FROM project WHERE rag = 'RED' AND deleted_at IS NULL AND ${f.clause}
      ORDER BY name_ar LIMIT 10`, f.params);
  const g = scopeFilter(user, 'project', 'read',
    { deptCol: 'p.department_id', sectorCol: 'p.sector_id', ownerCol: 'p.owner_user_id', projectCol: 'p.id' });
  const overdue = await all(
    `SELECT p.id, p.name_ar, COUNT(*) n FROM task t JOIN project p ON p.id = t.project_id
      WHERE t.status != 'DONE' AND t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?
        AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND ${approvedTaskSql('t.')} AND ${g.clause}
      GROUP BY p.id, p.name_ar ORDER BY n DESC, p.name_ar LIMIT 5`,
    [nowIso().slice(0, 10), ...g.params]);
  const lines = [];
  if (red.length) lines.push('مشاريع حرجة: ' + red.map((r) => r.name_ar).join('، '));
  for (const o of overdue) lines.push(`${o.name_ar}: ${o.n} مهمة متأخرة`);
  return { reply: lines.length ? '**المخاطر المكتشفة:**\n' + lines.map((l) => '• ' + l).join('\n') : 'لا مخاطر بارزة ضمن نطاقك حاليًا.',
    outcome: lines.length ? OUTCOME.OK : OUTCOME.EMPTY };
}

async function dataQualityScan(user) {
  // كل سطر مشروط بمنحه: «العميل» و«باقة الخدمة» بلا عمود قطاع، فحارسهما وجود المنح لا النطاق.
  // والسطر الذي لا يشمله نطاق صاحب الطلب **يُحذف** ولا يُطبع صفراً: الصفر يُقرأ «نظيف».
  const items = [];
  const scanned = [];   // ما فُحص فعلاً — تُذكر في رسالة «لا نواقص» كي لا تُقرأ أوسع مما هي
  if (can(user, 'read', 'client')) {
    scanned.push('العملاء');
    const n = (await get("SELECT COUNT(*) n FROM client WHERE (type IS NULL OR type = '') AND deleted_at IS NULL")).n;
    if (Number(n)) items.push(`${n} عميل بلا تصنيف نوع`);
  }
  if (can(user, 'read', 'service')) {
    scanned.push('باقات الخدمة');
    const n = (await get('SELECT COUNT(*) n FROM service_package WHERE price_halalas = 0')).n;
    if (Number(n)) items.push(`${n} باقة خدمة بسعر 0`);
  }
  if (effectiveScope(user, 'read', 'opportunity')) {
    scanned.push('الفرص');
    // نفس خيارات قائمة الفرص حرفاً — فما يَعُدّه الفحص هو ما تعرضه القائمة لنفس المستخدم.
    // و`memberCol` مؤهَّل باسم الجدول لأنه يُقرأ داخل EXISTS فرعي: جدول المشاركة بلا عمود
    // `id` أصلاً، فالاسم الباري يُحال إلى الاستعلام الخارجي — والتأهيل يدفع التباسه إذا
    // تعدّدت جداوله يوماً، ويُبقي المقصود (`opportunity.id`) مكتوباً لا مُخمَّناً.
    const f = scopeFilter(user, 'opportunity', 'read',
      { grantCol: 'department_id', memberCol: 'opportunity.id', deptCol: 'department_id' });
    const n = (await get(`SELECT COUNT(*) n FROM opportunity WHERE owner_user_id IS NULL AND deleted_at IS NULL AND ${f.clause}`, f.params)).n;
    if (Number(n)) items.push(`${n} فرصة بلا مالك`);
  }
  if (effectiveScope(user, 'read', 'project')) {
    scanned.push('المشاريع');
    const f = scopeFilter(user, 'project', 'read', { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id' });
    const n = (await get(`SELECT COUNT(*) n FROM project WHERE (start_date IS NULL OR end_date IS NULL) AND deleted_at IS NULL AND ${f.clause}`, f.params)).n;
    if (Number(n)) items.push(`${n} مشروع بلا تواريخ بداية/نهاية`);
  }
  if (!scanned.length) {
    return { reply: 'فحص جودة البيانات يقرأ العملاء وباقات الخدمة والفرص والمشاريع، ولا شيء منها ضمن صلاحيتك — فلا نتيجة أقولها لك.',
      outcome: OUTCOME.EMPTY };
  }
  // رسالة «لا نواقص» تسمّي ما فُحص: «نظيف» بلا ذكر المدى يُقرأ شهادةً على الشركة كلها.
  return { reply: items.length
    ? '**فحص جودة البيانات:**\n' + items.map((i) => '• ' + i).join('\n') + '\n\nأصلحها من الوحدات المعنية.'
    : `فحصتُ ${scanned.join('، ')} ضمن نطاقك — لا نواقص ظاهرة.`, outcome: items.length ? OUTCOME.OK : OUTCOME.EMPTY };
}

async function suggestPriorities(user) {
  const tasks = await all(
    `SELECT title, priority, due_date FROM task
      WHERE assignee_user_id = ? AND status NOT IN ('DONE','CANCELLED') AND deleted_at IS NULL
        AND ${approvedTaskSql('')}
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
               (due_date IS NULL), due_date, title LIMIT 6`, [user.id]);
  if (!tasks.length) return { reply: 'لا مهام مفتوحة لديك — قائمتك نظيفة.', outcome: OUTCOME.EMPTY };
  return { reply: '**أولوياتك المقترحة اليوم:**\n' + tasks.map((t, i) =>
    `${i + 1}. [${label(PRIORITY_AR, t.priority)}] ${t.title}${t.due_date ? ' — يستحق ' + String(t.due_date).slice(0, 10) : ''}`).join('\n') };
}

function smallTalk(user) {
  const mine = INTENTS.filter((i) => i.allow(user)).map((i) => i.label_ar);
  return { reply: `أنا مساعد سند، أعمل داخل المنصة. ما أستطيعه لك الآن: ${mine.join(' · ')}. `
    + 'أي تعديل يمرّ بنموذج ثم معاينة ثم تأكيد منك — لا أكتب شيئاً من تلقاء نفسي.' };
}

// ── النوايا الكاتبة في الدردشة: نموذجٌ يُملأ، لا تخمينٌ يُنفَّذ ────────────────
// حقول كل نموذج بالاسم: ما يُقبل مملوءاً مسبقاً في الطلب. الطلب يحمل القيمة باسم حقلها
// مباشرةً (هكذا يعود اختيار المستخدم من قائمة الالتباس) أو داخل `form` (إعادة فتح نموذج).
// وما ليس حقلاً في هذا النموذج يُهمَل — والقيمة تُقبل نصاً أو رقماً فقط، وتُعاد التحقق منها
// كلها وقت المعاينة على كل حال.
const FORM_FIELDS = {
  task_create: ['title', 'projectId', 'dueDate', 'priority'],
  task_status: ['taskId', 'status', 'blockedReason'],
  opp_stage: ['oppId', 'stage', 'note'],
};
function presetFor(type, opts) {
  const src = opts.form && typeof opts.form === 'object' ? { ...opts.form } : {};
  for (const key of FORM_FIELDS[type] || []) {
    const v = opts[key];
    if (typeof v === 'string' || typeof v === 'number') src[key] = String(v).slice(0, 200);
  }
  return src;
}

async function offerForm(user, intent, text, opts) {
  const spec = INTENT_BY_KEY[intent];
  if (!spec.allow(user)) throw forbidden(denialFor(intent));
  const type = WRITE_TYPE_OF[intent];
  const { form, note, choices, choiceField } = await buildForm(user, type, text, presetFor(type, opts));
  return {
    reply: `${note}\n\nاملأ الحقول ثم اضغط «معاينة» — أعرض عليك ما سيتغيّر بالضبط، ولا يُنفَّذ شيء قبل تأكيدك.`,
    form, ...(choices?.length ? { choices, choice_field: choiceField } : {}),
  };
}

function denialFor(intent) {
  if (intent === 'create_task') return 'إنشاء المهام خارج صلاحيتك — اطلب تفعيلها من مدير النظام.';
  if (intent === 'update_task_status') return 'تعديل المهام خارج صلاحيتك — اطلب تفعيلها من مدير النظام.';
  return 'تعديل الفرص خارج صلاحيتك — اطلب تفعيلها من مدير النظام.';
}

// ── شروط الحقول: الحقل يظهر ويُطلب في حالته وحدها ─────────────────────────────
// لغة الشرط التي ترسمها الواجهة: { field, equals|not_equals|in|not_in|filled|flag } وتركيبها
// { all:[…] } / { any:[…] } / { not:… }. `when` يحكم ظهور الحقل و`required_when` يحكم طلبه.
//
// ولماذا يرسلها الخادم أصلاً؟ لأن القاعدة قاعدة **الخدمة** لا قاعدة شاشة: «مُعطَّل» بلا سبب
// مكتوب ترفضه `updateTask`، والتراجع عن الفوز بلا سبب ترفضه `moveStage` — والرفض يقع بعد أن
// يكون المستخدم قد أكّد المعاينة. الشرط ينقل الطلب إلى ما قبل التأكيد: يُطلب السبب في النموذج
// فلا يُردّ صاحبه بعد موافقته. ومصدر الشرط هنا هو مصدر القاعدة نفسه — لا نسخة ثانية في المتصفح
// تتعفّن حين تتغيّر القاعدة.
const WHEN_BLOCKED = { field: 'status', equals: 'BLOCKED' };
// شرط سبب التراجع عن الفوز: فرصةٌ **حالها مكسوب** (راية على صفّها في القائمة، لا مطابقة اسم
// مرحلة) ومرحلةٌ جديدة ليست مرحلة فوز — وهي حرفياً قاعدة `moveStage`. مراحل الفوز تُقرأ من
// تعريف المراحل لا تُكتب رمزاً هنا: لو أضاف المشغّل مرحلة فوز ثانية بقي الشرط صادقاً.
async function reversalReasonWhen() {
  const won = (await all('SELECT id FROM stage WHERE is_won = 1 ORDER BY sort_order')).map((s) => s.id);
  const notWon = won.length === 1 ? { field: 'stage', not_equals: won[0] } : { field: 'stage', not_in: won };
  return { all: [{ field: 'oppId', flag: 'won' }, notWon] };
}

// مواصفة النموذج التي ترسمها الواجهة. القوائم تُجلب من «خيارات» الخادم، فلا يظهر في أي قائمة
// سجلٌّ لا يملك صاحب الطلب لمسه — أي أن الهدف الخارج عن النطاق لا يُعرض أصلاً فضلاً عن اختياره.
async function buildForm(user, type, text, given) {
  if (type === 'task_create') {
    const hint = await prefillFrom(user, 'project', text, given.projectId);
    return {
      note: hint.note || 'مهمة جديدة تُسنَد إليك، وقطاعها يُثبَّت على قطاعك.',
      choices: hint.choices, choiceField: 'projectId',
      form: {
        type, title_ar: 'إنشاء مهمة', submit_ar: 'معاينة',
        fields: [
          { name: 'title', label_ar: 'عنوان المهمة', kind: 'text', required: true, value: given.title || suggestTitle(text) },
          { name: 'projectId', label_ar: 'المشروع (اختياري)', kind: 'select', required: false,
            options_kind: 'project', value: hint.value || null, help_ar: 'اتركه فارغاً لمهمة داخلية.' },
          { name: 'dueDate', label_ar: 'تاريخ الاستحقاق', kind: 'date', required: false, value: given.dueDate || null },
          { name: 'priority', label_ar: 'الأهمية', kind: 'select', required: false,
            options_kind: 'priority', value: given.priority || 'P2' },
        ],
      },
    };
  }
  if (type === 'task_status') {
    const hint = await prefillFrom(user, 'task', text, given.taskId);
    return {
      note: hint.note || 'اختر المهمة والحالة الجديدة.',
      choices: hint.choices, choiceField: 'taskId',
      form: {
        type, title_ar: 'تحديث حالة مهمة', submit_ar: 'معاينة',
        fields: [
          { name: 'taskId', label_ar: 'المهمة', kind: 'select', required: true,
            options_kind: 'task', value: hint.value || null },
          { name: 'status', label_ar: 'الحالة الجديدة', kind: 'select', required: true,
            options_kind: 'task_status', value: given.status || null },
          { name: 'blockedReason', label_ar: 'سبب التعطيل', kind: 'textarea', required: false,
            when: WHEN_BLOCKED, required_when: WHEN_BLOCKED,
            value: given.blockedReason || null, help_ar: 'اكتب السبب ومَن يستطيع رفعه.' },
        ],
      },
    };
  }
  if (type === 'opp_stage') {
    const hint = await prefillFrom(user, 'opportunity', text, given.oppId);
    return {
      note: hint.note || 'اختر الفرصة والمرحلة التي تنتقل إليها.',
      choices: hint.choices, choiceField: 'oppId',
      form: {
        type, title_ar: 'نقل فرصة إلى مرحلة', submit_ar: 'معاينة',
        fields: [
          { name: 'oppId', label_ar: 'الفرصة', kind: 'select', required: true,
            options_kind: 'opportunity', value: hint.value || null },
          { name: 'stage', label_ar: 'المرحلة', kind: 'select', required: true,
            options_kind: 'stage', value: given.stage || null },
          // الملاحظة مفيدة في كل نقل (تُكتب في سجل المراحل)، فتبقى ظاهرة دائماً — ويُطلب
          // ملؤها في حالة واحدة: التراجع عن فوز. أي شرط طلبٍ لا شرط ظهور.
          { name: 'note', label_ar: 'ملاحظة', kind: 'textarea', required: false, value: given.note || null,
            required_when: await reversalReasonWhen(),
            help_ar: 'التراجع عن الفوز يستوجب سبباً مكتوباً.' },
        ],
      },
    };
  }
  throw badRequest('نوع التغيير غير مدعوم — اختر عملاً من بطاقات المساعد.');
}

// النص الحر **يقترح** قيمة أولية ويقول إنه اقترحها. لا يختار عند تعدّد المطابقات، ولا يُخفي
// اختياره عند المطابقة الواحدة — أربع حالات معلَنة، لا اختيار صامت.
async function prefillFrom(user, kind, text, givenId) {
  const noun = { project: 'مشروع', task: 'مهمة', opportunity: 'فرصة' }[kind];
  if (givenId) return { value: givenId, note: null, choices: [] };
  const found = await resolveRef(user, kind, text);
  if (!found.query) return { value: null, note: null, choices: [] };
  if (found.total === 0) return { value: null, note: `لم أجد ${noun} باسم «${found.query}» ضمن نطاقك — اختر من القائمة.`, choices: [] };
  if (found.total === 1) {
    return { value: found.matches[0].id, note: `اقترحتُ «${found.matches[0].label}» لأنه المطابق الوحيد ضمن نطاقك — غيّره إن أردت.`, choices: [] };
  }
  if (found.total > 5) return { value: null, note: `${found.total} نتيجة تطابق «${found.query}» — اختر من القائمة.`, choices: [] };
  return {
    value: null,
    note: `أكثر من ${noun} تطابق «${found.query}» — لن أختار عنك، اختر أنت:`,
    choices: found.matches.map((m) => ({ id: m.id, label_ar: m.label })),
  };
}

const suggestTitle = (text) => {
  const q = String(text || '').replace(/(أنشئ|أضف|اضف|سجّل|سجل|مهمة جديدة|مهمة|مهمّة|بعنوان|من فضلك)/g, ' ')
    .replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 3 ? q.slice(0, 120) : null;
};

// ── الحلّ من نص إلى **مجموعة** لا إلى صف ──────────────────────────────────────
// كان الحلّ يأخذ أول مطابقة بـLIMIT 1 ويمضي — أي أنه يختار عن المستخدم صامتاً. هنا يعود
// بالمجموعة وبعددها، والمنادي يقرّر بأي الحالات الأربع يجيب.
export async function resolveRef(user, kind, text) {
  const raw = String(text || '');
  const quoted = raw.match(/[«"']([^«»"']{2,})[»"']/);
  const explicit = raw.match(/\b((?:p|prj|opp|tsk)_[A-Za-z0-9_-]{4,}|PRJ-[A-Za-z0-9-]+)\b/);
  // الحشو يُحذف **ككلمات كاملة** لا كحروف داخل الكلمات: الحذف النصّي المباشر كان يقطع
  // «بحالة» إلى «ب» لأن «حالة» جزء منها، فيتحوّل السؤال إلى بحثٍ عن نصٍّ لا وجود له.
  const query = quoted ? quoted[1].trim() : stripNoise(raw);

  if (explicit) {
    const row = await lookupById(user, kind, explicit[1]);
    return { query: explicit[1], total: row ? 1 : 0, matches: row ? [row] : [] };
  }
  if (query.length < 2) return { query: '', total: 0, matches: [] };

  const q = `%${query}%`;
  const built = buildRefQuery(user, kind, query, q);
  if (!built) return { query, total: 0, matches: [] };
  const total = Number((await get(`SELECT COUNT(*) n FROM ${built.from} WHERE ${built.where}`, built.params)).n) || 0;
  const rows = total
    ? await all(`SELECT ${built.select} FROM ${built.from} WHERE ${built.where} ORDER BY ${built.order} LIMIT 5`, built.params)
    : [];
  return { query, total, matches: rows.map((r) => built.shape(r)) };
}

const NOISE_WORDS = new Set(['لخّص', 'لخص', 'ملخّص', 'ملخص', 'حالة', 'أنشئ', 'انشئ', 'أضف', 'اضف',
  'انقل', 'حدّث', 'حدث', 'عدّل', 'عدل', 'اجعل', 'مشروع', 'المشروع', 'مشاريع', 'مهمة', 'مهمّة',
  'المهمة', 'فرصة', 'الفرصة', 'إلى', 'الى', 'على', 'في', 'من', 'لي', 'اليوم', 'رجاءً', 'رجاء',
  // أسماء المراحل والحالات: جزءٌ من الأمر لا من اسم السجل المقصود. تركُها في نصّ البحث يمنع
  // إيجاد السجل أصلاً («انقل الفرصة س إلى فائزة» كان يبحث عن «س فائزة»).
  'فائزة', 'مكسوبة', 'خسارة', 'مفقودة', 'مؤهلة', 'تفاوض', 'عرض', 'ترشيح',
  'منجزة', 'معطَّلة', 'معطلة', 'عاجلة', 'مرحلة', 'المرحلة']);
function stripNoise(raw) {
  return String(raw).replace(/[«»"'.,؛:!]/g, ' ').split(/\s+/)
    .filter((w) => w && !NOISE_WORDS.has(w)).join(' ').trim();
}

function buildRefQuery(user, kind, query, like) {
  if (kind === 'project') {
    if (!effectiveScope(user, 'read', 'project')) return null;
    const f = scopeFilter(user, 'project', 'read', { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id' });
    return {
      select: 'id, name_ar, status', from: 'project',
      where: `${f.clause} AND deleted_at IS NULL AND (name_ar LIKE ? OR code = ? OR financial_code = ?)`,
      params: [...f.params, like, query, query],
      order: 'name_ar',
      shape: (r) => ({ id: r.id, label: r.name_ar, sub: label(STATUS_AR, r.status) }),
    };
  }
  if (kind === 'opportunity') {
    if (!effectiveScope(user, 'read', 'opportunity')) return null;
    // نفس خيارات قائمة الفرص: البحث يجد ما تعرضه القائمة لنفس المستخدم — لا أضيق ولا أوسع.
    const f = scopeFilter(user, 'opportunity', 'read',
      { grantCol: 'department_id', memberCol: 'opportunity.id', deptCol: 'department_id' });
    return {
      select: 'id, title_ar, stage_id', from: 'opportunity',
      where: `${f.clause} AND deleted_at IS NULL AND (title_ar LIKE ? OR code = ?)`,
      params: [...f.params, like, query],
      order: 'title_ar',
      shape: (r) => ({ id: r.id, label: r.title_ar, sub: null }),
    };
  }
  if (kind === 'task') {
    const f = scopeFilter(user, 'task', 'update', { ownerCol: 'assignee_user_id' }); // المهمة لا تحمل عمود مالك — صاحبها هو المُسنَد إليه
    return {
      select: 'id, title, status', from: 'task',
      where: `(assignee_user_id = ? OR created_by = ? OR ${f.clause}) AND deleted_at IS NULL
              AND status NOT IN ('DONE','CANCELLED') AND title LIKE ?`,
      params: [user.id, user.id, ...f.params, like],
      order: 'title',
      shape: (r) => ({ id: r.id, label: r.title, sub: label(TASK_STATUS_AR, r.status) }),
    };
  }
  return null;
}

async function lookupById(user, kind, ref) {
  if (kind === 'project') {
    // الصفّ **كاملاً** لا أعمدة منتقاة: فحص نطاق «الإدارة» في المحرّك يقرأ `department_id`،
    // وإسقاطُه من الاختيار كان يمرّ الهدف بلا إدارةٍ فيتساهل الفحص ويفتح مشروع إدارةٍ أخرى
    // بالمعرّف الصريح. لا جدول شركاء للمشروع (بخلاف الفرصة)، فـ`SELECT *` وحده يكفي.
    const row = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [ref]);
    return row && can(user, 'read', 'project', row) ? { id: row.id, label: row.name_ar, sub: label(STATUS_AR, row.status) } : null;
  }
  if (kind === 'opportunity') {
    // الصفّ **كاملاً** لا أعمدة منتقاة: فحص نطاق «الإدارة» يمرّ فارغاً على هدفٍ لا يحمل عمود
    // `department_id` (scopeReaches يتساهل مع الهدف بلا إدارة داخل القطاع نفسه) — فاختيار
    // الأعمدة هنا كان يفتح بالمعرّف الصريح فرصةَ إدارةٍ أخرى تحجبها القائمة عن مدير الإدارة.
    // والمشاركات تُحمَّل على الهدف بنفس اسم `partner_department_ids` الذي يقرؤه المحرّك —
    // كما تفعل crm/opp-access.js حرفاً. استعلامٌ محلي لا استيرادٌ منها: طبقة core لا تُثقَل
    // باعتمادٍ جديد على modules، والحكم نفسه يبقى في مكانه الواحد (rbac/index.js).
    const row = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [ref]);
    if (!row) return null;
    const partners = (await all(
      'SELECT department_id FROM opportunity_department WHERE opportunity_id = ?', [ref]
    )).map((r) => r.department_id).filter(Boolean);
    return can(user, 'read', 'opportunity', { ...row, partner_department_ids: partners })
      ? { id: row.id, label: row.title_ar, sub: null } : null;
  }
  const row = await get('SELECT id, title, status, work_kind, sector_id, assignee_user_id, created_by FROM task WHERE id = ? AND deleted_at IS NULL', [ref]);
  const mine = row && (row.assignee_user_id === user.id || row.created_by === user.id);
  // المهمة الشخصية لا يبلغها منحٌ إداري — ولا المساعد. من ليست له فهي «غير موجودة» عنده.
  if (isPersonalTask(row) && !mine) return null;
  return row && (mine || can(user, 'update', 'task', row))
    ? { id: row.id, label: row.title, sub: label(TASK_STATUS_AR, row.status) } : null;
}

// ── الخيارات: كل معرّف تعرضه الواجهة **صادر من هنا** ──────────────────────────
export async function optionsFor(user, kind) {
  if (kind === 'priority') {
    return { kind, options: Object.entries(PRIORITY_AR).map(([id2, label_ar]) => ({ id: id2, label_ar })) };
  }
  if (kind === 'task_status') {
    return { kind, options: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']
      .map((s) => ({ id: s, label_ar: TASK_STATUS_AR[s] })) };
  }
  if (kind === 'stage') {
    if (!can(user, 'update', 'opportunity')) throw forbidden('تعديل الفرص خارج صلاحيتك');
    const rows = await all('SELECT id, name_ar FROM stage ORDER BY sort_order');
    return { kind, options: rows.map((s) => ({ id: s.id, label_ar: s.name_ar })) };
  }
  if (kind === 'project') {
    if (!effectiveScope(user, 'read', 'project')) throw forbidden('قراءة المشاريع خارج صلاحيتك');
    const f = scopeFilter(user, 'project', 'read', { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id' });
    const rows = await all(`SELECT id, name_ar, status FROM project WHERE ${f.clause} AND deleted_at IS NULL
      ORDER BY name_ar LIMIT 100`, f.params);
    return { kind, options: rows.map((r) => ({ id: r.id, label_ar: r.name_ar, sub_ar: label(STATUS_AR, r.status) })) };
  }
  if (kind === 'opportunity') {
    if (!effectiveScope(user, 'read', 'opportunity')) throw forbidden('قراءة الفرص خارج صلاحيتك');
    // أعمدة النطاق مؤهَّلة صراحةً باسم الجدول (لا تعديل نصّي على الشرط بعد بنائه) —
    // ومنها `memberCol` الذي يُقرأ داخل EXISTS فرعي: جدول المشاركة بلا عمود `id` أصلاً،
    // فـ`id` عاريةً تُحال إلى الاستعلام الخارجي وفيه جدولان يحملانها (o وs) — التباسٌ
    // يحسمه التأهيل.
    const f = scopeFilter(user, 'opportunity', 'read',
      { sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', projectCol: 'o.id',
        grantCol: 'o.department_id', memberCol: 'o.id', deptCol: 'o.department_id' });
    const rows = await all(`SELECT o.id, o.title_ar, s.name_ar AS stage_name, s.is_won FROM opportunity o
      LEFT JOIN stage s ON s.id = o.stage_id
      WHERE ${f.clause} AND o.deleted_at IS NULL
      ORDER BY o.title_ar LIMIT 100`, f.params);
    // `won` حالٌ يقوله الصفّ عن نفسه: الواجهة تطلب سبب التراجع عن الفوز بناءً عليه. بدونه
    // كان الطريق الوحيد أمامها مطابقة اسم المرحلة العربي — وهي أسوأ من ألّا تفعل شيئاً.
    return { kind, options: rows.map((r) => ({ id: r.id, label_ar: r.title_ar,
      sub_ar: r.stage_name || UNKNOWN_AR, won: !!Number(r.is_won) })) };
  }
  if (kind === 'task') {
    const f = scopeFilter(user, 'task', 'update', { ownerCol: 'assignee_user_id' }); // المهمة لا تحمل عمود مالك — صاحبها هو المُسنَد إليه
    // ومهام غيره الشخصية خارج القائمة مهما اتّسع نطاقه: قائمةُ الاختيار هي المكان الذي تُقرأ
    // فيه **عناوين** المهام، فتسرّبُ عنوانٍ واحد هنا يكشف ما وُعد بستره. أمّا مهامه هو فتبقى.
    const rows = await all(
      `SELECT id, title, status FROM task
        WHERE (assignee_user_id = ? OR created_by = ? OR ${f.clause}) AND deleted_at IS NULL
          AND status NOT IN ('DONE','CANCELLED') AND ${approvedTaskSql('')}
          AND (assignee_user_id = ? OR ${notPersonalSql('')})
        ORDER BY title LIMIT 100`, [user.id, user.id, ...f.params, user.id]);
    return { kind, options: rows.map((r) => ({ id: r.id, label_ar: r.title, sub_ar: label(TASK_STATUS_AR, r.status) })) };
  }
  throw badRequest('قائمة غير معروفة — اطلب إحدى قوائم النموذج.');
}

// ── المعاينة: المدخل **الوحيد** الذي يمكن أن ينتج عنه تغيير ───────────────────
// حمولة مبنيّة لا نص: { type, fields }. وكل معرّف فيها يُعاد التحقق منه هنا — الواجهة لا تُصدّق.
const INTENT_OF_TYPE = { opp_stage: 'move_opportunity_stage', task_create: 'create_task', task_status: 'update_task_status' };
export async function proposePreview(ctx, body = {}) {
  const user = ctx.user;
  const type = String(body.type || '').trim();
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  let built;
  try {
    built = await buildPreview(user, type, fields);
  } catch (e) {
    // رفضُ طلبِ تغييرٍ **معروف النوع** يُسجَّل بنيّته ونتيجته (بلا حمولته). ونوعٌ مجهول لا
    // يُسجَّل أصلاً: طلبٌ لا معنى له لا يستحق صفاً، ولا يُحوِّل مسبار الفحص إلى كتابة.
    if (INTENT_OF_TYPE[type]) await logAsk(user, { intent: INTENT_OF_TYPE[type], outcome: OUTCOME.DENIED });
    throw e;
  }
  const { token, expiresAt } = await savePreview(user, built.preview, { intent: built.intent, sectorId: built.sectorId });
  await logAsk(user, { intent: built.intent, outcome: OUTCOME.PREVIEW, sectorId: built.sectorId });
  // `expires_at` هي اللحظة المحفوظة نفسها التي يفرضها المزلاج عند التأكيد — تُعاد كما هي لا
  // تُحسب في المتصفح. بها تقول اللوحة «صالحة للتأكيد حتى ٠٣:٢٠»، وتُعطّل زرّ التأكيد عند
  // انقضائها بدل أن تُرسل تأكيداً يعرف الخادم سلفاً أنه مرفوض.
  return {
    reply: `**معاينة تغيير — لن يُطبَّق إلا بتأكيدك:**\n${built.preview.summary}\n\n`
      + `صالحة ${PREVIEW_TTL_MINUTES} دقيقة، ولمرة واحدة.`,
    preview: built.preview, applyToken: token, previewId: token, expires_at: expiresAt,
  };
}

async function buildPreview(user, type, f) {
  if (type === 'opp_stage') {
    if (!can(user, 'update', 'opportunity')) throw forbidden(denialFor('move_opportunity_stage'));
    const opp = await get('SELECT * FROM opportunity WHERE id = ? AND deleted_at IS NULL', [String(f.oppId || '')]);
    if (!opp) throw notFound('الفرصة غير موجودة');
    if (!can(user, 'update', 'opportunity', opp)) {
      // الدرجة الثانية: مديرُ إدارةٍ مشاركة يعدّل مرحلتها (ADR-0006) — تُحمَّل المشاركات ويُعاد الفحص.
      const partners = (await all(
        'SELECT department_id FROM opportunity_department WHERE opportunity_id = ?', [opp.id]
      )).map((r) => r.department_id).filter(Boolean);
      if (!(partners.length && can(user, 'update', 'opportunity', { ...opp, partner_department_ids: partners }))) {
        throw forbidden('لا تملك صلاحية تعديل هذه الفرصة');
      }
    }
    // المرحلة تُتحقَّق **وقت المعاينة**: كانت تُكتب في الصف كما وصلت، فأي قيمة مكتوبة تصير مرحلة.
    const to = await get('SELECT id, name_ar FROM stage WHERE id = ?', [String(f.stage || '')]);
    if (!to) throw badRequest('مرحلة غير معروفة — اختر مرحلة من القائمة.');
    const from = opp.stage_id ? await get('SELECT id, name_ar FROM stage WHERE id = ?', [opp.stage_id]) : null;
    // نقلٌ إلى المرحلة نفسها ليس تغييراً: تطبيقه يكتب سطر مراحل وسطر تدقيق يقولان «لا شيء».
    if (from && from.id === to.id) throw badRequest(`الفرصة في مرحلة «${to.name_ar}» بالفعل — اختر مرحلة مختلفة.`);
    const note = f.note ? String(f.note).trim().slice(0, 500) : null;
    return {
      intent: 'move_opportunity_stage', sectorId: opp.sector_id,
      preview: { type, oppId: opp.id, oppTitle: opp.title_ar, from: opp.stage_id, to: to.id, note,
        summary: `نقل الفرصة «${opp.title_ar}» من مرحلة «${from?.name_ar || UNKNOWN_AR}» إلى «${to.name_ar}».` },
    };
  }
  if (type === 'task_create') {
    if (!can(user, 'create', 'task')) throw forbidden(denialFor('create_task'));
    const title = String(f.title || '').trim();
    if (!title) throw badRequest('عنوان المهمة مطلوب — اكتب ما المطلوب عمله.');
    let project = null;
    if (f.projectId) {
      project = await get('SELECT id, name_ar, sector_id, department_id, owner_user_id FROM project WHERE id = ? AND deleted_at IS NULL', [String(f.projectId)]);
      if (!project) throw badRequest('المشروع المختار غير موجود — اختر مشروعاً من القائمة');
      if (!can(user, 'read', 'project', project)) throw forbidden('هذا المشروع خارج نطاقك — اربط المهمة بمشروع من قائمتك');
    }
    const priority = PRIORITY_AR[f.priority] ? String(f.priority) : 'P2';
    const dueDate = f.dueDate ? String(f.dueDate).slice(0, 10) : null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw badRequest('التاريخ يُكتب هكذا: سنة-شهر-يوم');
    return {
      intent: 'create_task', sectorId: project?.sector_id || user.sector_id || null,
      preview: { type, title, projectId: project?.id || null, projectName: project?.name_ar || null,
        priority, dueDate,
        summary: `إنشاء مهمة «${title}» بأهمية ${PRIORITY_AR[priority]}`
          + `${project ? ` على مشروع «${project.name_ar}»` : ' كعمل داخلي'}`
          + `${dueDate ? ` تستحق ${dueDate}` : ' بلا موعد استحقاق'} ومُسنَدة إليك.` },
    };
  }
  if (type === 'task_status') {
    if (!can(user, 'update', 'task')) throw forbidden(denialFor('update_task_status'));
    const task = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [String(f.taskId || '')]);
    if (!task) throw notFound('المهمة غير موجودة');
    const mine = task.assignee_user_id === user.id || task.created_by === user.id;
    // ولا تُكتب مهمةُ غيره الشخصية من هنا: نفس حكم `updateTask` حرفياً — «غير موجودة» لا
    // «خارج نطاقك»، فالثانية تؤكّد وجودها وهي بذاتها كشفٌ صغير.
    if (isPersonalTask(task) && !mine) throw notFound('المهمة غير موجودة');
    if (!mine && !can(user, 'update', 'task', task)) throw forbidden('هذه المهمة خارج نطاقك');
    const to = String(f.status || '');
    if (!TASK_STATUS_AR[to] || to === 'CANCELLED') throw badRequest('حالة غير معروفة — اخترها من القائمة.');
    const reason = f.blockedReason ? String(f.blockedReason).trim().slice(0, 500) : null;
    return {
      intent: 'update_task_status', sectorId: task.sector_id || null,
      preview: { type, taskId: task.id, taskTitle: task.title, from: task.status, to, blockedReason: reason,
        summary: `تغيير حالة المهمة «${task.title}» من «${label(TASK_STATUS_AR, task.status)}» إلى «${TASK_STATUS_AR[to]}».` },
    };
  }
  throw badRequest('نوع التغيير غير مدعوم — اختر عملاً من بطاقات المساعد.');
}

// ── الحالة والاقتراحات ────────────────────────────────────────────────────────
export function aiStatus(user) {
  warnOnceIfKeyIgnored();   // مفتاح مُهمَل عمداً يُذكر في سجل الخادم مرة واحدة، لا في وجه المستخدم
  const mode = aiMode();
  const local = mode === 'local';
  return {
    mode,
    modeLabel: local ? 'محلي' : 'مزوّد',
    configured: !local,
    note: local
      ? 'يعمل داخل المنصة: لا تغادرها بيانات الشركة، والجواب نفسه لنفس السؤال في كل مرة.'
      : 'مفعَّل على مزوّد خارجي بإعلان صريح من المشغّل.',
    suggestions: user ? INTENTS.filter((i) => i.allow(user)).map((i) => ({ intent: i.intent, label_ar: i.label_ar, kind: i.kind })) : [],
  };
}

// ── المحرّك الخارجي (اختياري ومغلق افتراضياً) ─────────────────────────────────
async function llmOrLocal(task, facts, localFn) {
  if (aiMode() === 'local') return localFn();
  try {
    const sys = 'أنت مساعد تنفيذي لشركة استشارية. اكتب بالعربية، موجزًا ومهنيًا. لا تخترع أرقامًا خارج المعطيات.';
    const { text } = await complete({ system: sys, user: `${task}\n\nالمعطيات:\n- ${facts.join('\n- ')}` });
    return text || localFn();
  } catch (e) {
    logProviderFallback(e); // لا ابتلاع صامت: المستخدم يُجاب محلياً والمشغّل يقرأ السبب
    return localFn();
  }
}
