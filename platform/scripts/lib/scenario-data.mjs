// بيانات السيناريوهات الاصطناعية — تعريفٌ صِرف بلا أي اتصال بقاعدة البيانات.
//
// لماذا ملف منفصل: مشغّل السيناريوهات (scripts/scenarios.mjs) يزرع هذه البيانات ثم **يمحوها**
// ويُثبت نظافة المنصة بعدها. أي غموض في «ما الذي زرعناه؟» يتحوّل مباشرةً إلى غموض في «ما الذي
// محوناه؟». لذلك الوصف كله هنا، معلَناً وثابتاً، ومنه وحده يُشتقّ الزرع والمحو والتقرير.
//
// ثلاث قواعد لا تُكسر في هذا الملف:
//   ١) **كل صف يحمل وسماً ظاهراً** في اسمه العربي: «سيناريو تجريبي». الوسم ليس تجميلاً — الحارس
//      في scripts/scenarios.mjs يرفض العمل على قاعدة فيها صفٌّ بلا وسم، فالوسم هو ما يجعل
//      «قاعدة رمي» قابلةً للإثبات لا للادّعاء. ولا صفَّ هنا يمكن أن يُقرأ يوماً كعميل حقيقي
//      أو موظف حقيقي أو عقد حقيقي: الأسماء تقول عن نفسها إنها تجربة.
//   ٢) **بلا حقائق عمل**: لا اسم جهة حقيقية، ولا راتب حقيقي، ولا قيمة عقد منقولة من مكان.
//      الأرقام مدوّرة ومصطنعة، وغرضها الوحيد تشغيل مسارات الحساب (هللات صحيحة، لا كسور).
//   ٣) **بلا ساعة حائط**: كل تاريخ يُشتقّ من `today` المُمرَّر، فالتشغيل اليوم وبعد سنة يُنتجان
//      البيانات نفسها. الخدمات نفسها قد تكتب `created_at` من الساعة — وهذا شأنها لا شأننا،
//      ولا يدخل في أي تحقّق هنا.
//
// المال: كل المبالغ بالريال (سار) **صحيحةً**، وتحويلها إلى هللات يتم في طبقة الخدمة عبر
// toHalalas — فلا كسور عشرية تدخل قاعدة البيانات من هنا إطلاقاً.

export const SCENARIO_MARK = 'سيناريو تجريبي';   // الوسم داخل كل اسم عربي نكتبه
export const DEMO_MARK = '(تجريبي)';              // وسم حسابات وإدارات العرض في scripts/seed.js
export const ID_PREFIX = 'scn_';                  // بادئة المعرّفات التي نكتبها بأنفسنا

// الأسماء المسموح وجودها في قاعدة رمي: ما زرعناه نحن، وما يزرعه بذر المنصة نفسه (حسابات وإدارات
// العرض). أي اسم ثالث يعني بياناتٍ لم نُنشئها — والحارس يرفض العمل عندها.
export const SAFE_NAME_MARKS = [SCENARIO_MARK, DEMO_MARK];

export const tag = (label) => `${label} (${SCENARIO_MARK})`;
export const scnId = (...parts) => ID_PREFIX + parts.join('_');
export const isScenarioName = (name) => SAFE_NAME_MARKS.some((m) => String(name || '').includes(m));

// أرقام عربية-هندية للترقيم داخل الأسماء — كي يقرأ الاسم كنصٍّ عربي طبيعي لا كسطر مولَّد.
const AR_NUM = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n) => String(n).split('').map((d) => AR_NUM[Number(d)] ?? d).join('');

// إزاحة أيام على تاريخ بصيغة سنة-شهر-يوم — حساب في جافاسكربت لا في قاعدة البيانات (القاعدة
// المعلنة في platform/CLAUDE.md: لا دوال تواريخ في الاستعلامات).
export function shiftDays(iso, days) {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

// مراحل خط الفرص — الجدول الوحيد الذي لا خدمة له في المنتج كله، فيُكتب مباشرةً (موثَّق في التقرير).
export const STAGES = [
  { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, color: '#94a3b8', is_won: 0, is_lost: 0 },
  { id: 'QUALIFIED', name_ar: 'مؤهلة', default_win_pct: 25, sort_order: 2, color: '#0891b2', is_won: 0, is_lost: 0 },
  { id: 'PROPOSAL', name_ar: 'عرض مقدم', default_win_pct: 50, sort_order: 3, color: '#2563eb', is_won: 0, is_lost: 0 },
  { id: 'NEGOTIATION', name_ar: 'تفاوض', default_win_pct: 75, sort_order: 4, color: '#d97706', is_won: 0, is_lost: 0 },
  { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, color: '#059669', is_won: 1, is_lost: 0 },
  { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, color: '#dc2626', is_won: 0, is_lost: 1 },
];

// ── القطاعات: أربعة قطاعات تسليم + وحدتا مساندة ─────────────────────────────────
// المعرّفات هي معرّفات القطاعات التي تربط بها حسابات العرض نفسها (demo.sectorlead ⟵ SOLUTIONS
// في scripts/seed.js)، فبدونها لا يقع أي شخص داخل قطاع ولا يُختبر عزل القطاعات أصلاً. أما
// الأسماء فمن عندنا وتحمل الوسم — فلا يُقرأ الصف يوماً كقطاع حقيقي بأهدافه الحقيقية.
export const SECTORS = [
  { id: 'SOLUTIONS', name_ar: tag('قطاع الحلول'), name_en: 'Solutions (scenario)', color: '#2563eb',
    kind: 'delivery', target_sales_sar: 8_000_000, target_revenue_sar: 6_000_000, target_margin_pct: 25, sort_order: 1 },
  { id: 'CONSULTING', name_ar: tag('قطاع الاستشارات'), name_en: 'Consulting (scenario)', color: '#7c3aed',
    kind: 'delivery', target_sales_sar: 5_000_000, target_revenue_sar: 4_000_000, target_margin_pct: 30, sort_order: 2 },
  { id: 'STRATEGIC', name_ar: tag('قطاع الاستراتيجية'), name_en: 'Strategic (scenario)', color: '#0f766e',
    kind: 'delivery', target_sales_sar: 3_000_000, target_revenue_sar: 2_000_000, target_margin_pct: 35, sort_order: 3 },
  { id: 'SAP', name_ar: tag('قطاع الأنظمة المؤسسية'), name_en: 'Enterprise Systems (scenario)', color: '#b45309',
    kind: 'delivery', target_sales_sar: 4_000_000, target_revenue_sar: 3_000_000, target_margin_pct: 20, sort_order: 4 },
  // وحدات المساندة: ليست قطاع تسليم — لا تدخل مقارنات المبيعات، ولا تُنسب إليها فرصة، وأشخاصها
  // مورد مشترك يُسكَّن على مشاريع أي قطاع. كل هذه القواعد مختبَرة في السيناريوهات.
  { id: 'SHARED', name_ar: tag('وحدة الخدمات المشتركة'), name_en: 'Shared Services (scenario)', color: '#64748b',
    kind: 'support', target_sales_sar: 0, target_revenue_sar: 0, target_margin_pct: 0, sort_order: 8 },
  { id: 'BDU', name_ar: tag('وحدة تطوير الأعمال'), name_en: 'BD Unit (scenario)', color: '#475569',
    kind: 'support', target_sales_sar: 0, target_revenue_sar: 0, target_margin_pct: 0, sort_order: 9 },
];

export const DELIVERY_SECTOR_IDS = SECTORS.filter((s) => s.kind === 'delivery').map((s) => s.id);
export const SUPPORT_SECTOR_IDS = SECTORS.filter((s) => s.kind === 'support').map((s) => s.id);

// ── الإدارات ────────────────────────────────────────────────────────────────────
// إدارتان داخل قطاع الحلول تحديداً: نطاق «الإدارة» لا يُثبت بإدارة واحدة — «المدير رأى إدارته»
// ليس دليلاً ما لم توجد إدارة ثانية بأشخاص معروفين بأسمائهم ويثبت **غيابهم** عن كشفه.
export const DEPARTMENTS = [
  { key: 'sol_platform', sector: 'SOLUTIONS', name_ar: tag('إدارة المنصات') },
  { key: 'sol_ops', sector: 'SOLUTIONS', name_ar: tag('إدارة التشغيل') },
  { key: 'con_advisory', sector: 'CONSULTING', name_ar: tag('إدارة الاستشارات') },
  { key: 'str_office', sector: 'STRATEGIC', name_ar: tag('إدارة مكتب الاستراتيجية') },
  { key: 'sap_apps', sector: 'SAP', name_ar: tag('إدارة تطبيقات الأنظمة') },
  { key: 'shared_pool', sector: 'SHARED', name_ar: tag('إدارة الخدمات المشتركة') },
];

// ── الأشخاص ─────────────────────────────────────────────────────────────────────
// `link` = حساب عرض يُربط بهذا السجل. الربط ليس زينة: معرّف الإدارة وعضوية المشاريع يُستنتجان
// من هذا الرابط (src/core/http/context.js)، فبدونه يبقى نطاقا «الإدارة» و«المشروع» معطَّلين.
// `salary_sar` يُملأ لبعضهم عمداً: ختم الراتب يُختبر بوجود قيمة تُحجب، لا بغياب القيمة.
export const PEOPLE = [
  { key: 'sol_eng', name_ar: tag(`مهندس حلول تجريبي ${arNum(1)}`), sector: 'SOLUTIONS', dept: 'sol_platform',
    job_title: 'مهندس حلول', hire_date: '2025-09-01', salary_sar: 18_000, link: 'demo.consultant' },
  { key: 'sol_ba', name_ar: tag(`محلل أعمال تجريبي ${arNum(2)}`), sector: 'SOLUTIONS', dept: 'sol_platform',
    job_title: 'محلل أعمال', hire_date: '2025-09-01', salary_sar: 14_000, link: null },
  { key: 'sol_pmo', name_ar: tag(`منسق مشاريع تجريبي ${arNum(3)}`), sector: 'SOLUTIONS', dept: 'sol_ops',
    job_title: 'منسق مشاريع', hire_date: '2025-10-01', salary_sar: 12_000, link: null },
  { key: 'con_adv', name_ar: tag(`مستشار تجريبي ${arNum(4)}`), sector: 'CONSULTING', dept: 'con_advisory',
    job_title: 'مستشار أول', hire_date: '2025-09-15', salary_sar: 20_000, link: null },
  { key: 'con_res', name_ar: tag(`باحث تجريبي ${arNum(5)}`), sector: 'CONSULTING', dept: 'con_advisory',
    job_title: 'باحث', hire_date: '2026-01-05', salary_sar: 11_000, link: null },
  { key: 'str_lead', name_ar: tag(`مخطط استراتيجي تجريبي ${arNum(6)}`), sector: 'STRATEGIC', dept: 'str_office',
    job_title: 'مخطط استراتيجي', hire_date: '2025-11-01', salary_sar: 22_000, link: null },
  { key: 'sap_fun', name_ar: tag(`مستشار أنظمة تجريبي ${arNum(7)}`), sector: 'SAP', dept: 'sap_apps',
    job_title: 'مستشار أنظمة', hire_date: '2025-12-01', salary_sar: 19_000, link: null },
  // وحدة المساندة: مورد مشترك يُسكَّن على مشروع أي قطاع بلا نقل — وهذا بالضبط ما يُختبر.
  { key: 'shr_arch', name_ar: tag(`معماري مشترك تجريبي ${arNum(8)}`), sector: 'SHARED', dept: 'shared_pool',
    job_title: 'معماري حلول', hire_date: '2025-08-01', salary_sar: 21_000, link: null },
  { key: 'shr_qa', name_ar: tag(`مدقق جودة تجريبي ${arNum(9)}`), sector: 'SHARED', dept: 'shared_pool',
    job_title: 'مدقق جودة', hire_date: '2026-02-01', salary_sar: 13_000, link: null },
  // شخص يُحذف حذفاً ناعماً في أحد السيناريوهات — وجوده منفصلاً يمنع تلويث بقية الفحوص.
  { key: 'sol_leaver', name_ar: tag(`موظف مغادر تجريبي ${arNum(10)}`), sector: 'SOLUTIONS', dept: 'sol_ops',
    job_title: 'أخصائي تشغيل', hire_date: '2025-09-01', salary_sar: 10_000, link: null },
];

// ── العملاء ─────────────────────────────────────────────────────────────────────
// «داخلي» نوعٌ حقيقي في المنتج (CLIENT_TYPES) ويُغيّر تصنيف المشروع — فيُزرع كي يُختبر.
export const CLIENTS = [
  { key: 'gov', name_ar: tag('جهة تجريبية حكومية'), type: 'حكومي' },
  { key: 'priv', name_ar: tag('جهة تجريبية خاصة'), type: 'خاص' },
  { key: 'inner', name_ar: tag('جهة تجريبية داخلية'), type: 'داخلي' },
];

// ── الفرص ───────────────────────────────────────────────────────────────────────
// موزَّعة على القطاعات الأربعة كي يُختبر العزل بينها فعلياً: «لم يرَ الاستشارات» بلا فرصة
// استشارات ليس دليلاً. المالك هو من يُنشئها فعلاً عبر الشبكة بحسابه هو.
export const OPPORTUNITIES = [
  { key: 'sol_a', title_ar: tag('فرصة منصة الخدمات التجريبية'), sector: 'SOLUTIONS', client: 'gov',
    stage_id: 'LEAD', value_sar: 1_200_000, priority: 'P1', owner: 'demo.bd', next_action: 'متابعة العرض مع الجهة' },
  { key: 'sol_b', title_ar: tag('فرصة تشغيل المنصة التجريبية'), sector: 'SOLUTIONS', client: 'priv',
    stage_id: 'QUALIFIED', value_sar: 800_000, priority: 'P2', owner: 'demo.bd', next_action: 'إرسال التسعير المحدَّث' },
  { key: 'sol_c', title_ar: tag('فرصة دعم فني تجريبية'), sector: 'SOLUTIONS', client: 'gov',
    stage_id: 'PROPOSAL', value_sar: 500_000, priority: 'P2', owner: 'demo.sectorlead', next_action: null },
  { key: 'con_a', title_ar: tag('فرصة دراسة حوكمة تجريبية'), sector: 'CONSULTING', client: 'priv',
    stage_id: 'PROPOSAL', value_sar: 700_000, priority: 'P1', owner: 'demo.admin', next_action: 'جدولة اجتماع الإغلاق' },
  { key: 'con_b', title_ar: tag('فرصة إعادة هيكلة تجريبية'), sector: 'CONSULTING', client: 'gov',
    stage_id: 'NEGOTIATION', value_sar: 900_000, priority: 'P1', owner: 'demo.admin', next_action: 'مراجعة المسودة' },
  { key: 'str_a', title_ar: tag('فرصة خطة تحول تجريبية'), sector: 'STRATEGIC', client: 'gov',
    stage_id: 'QUALIFIED', value_sar: 600_000, priority: 'P2', owner: 'demo.admin', next_action: 'تأكيد نطاق العمل' },
  { key: 'sap_a', title_ar: tag('فرصة تطبيق أنظمة تجريبية'), sector: 'SAP', client: 'priv',
    stage_id: 'LEAD', value_sar: 1_500_000, priority: 'P1', owner: 'demo.admin', next_action: 'عرض تقديمي أولي' },
];

// ── المشاريع ────────────────────────────────────────────────────────────────────
// تُنشأ عبر مسار «استلام العمل» (intake) لأنه المسار الوحيد الذي يكتب المشروع والعقد والمخرجات
// في معاملة واحدة — أي أنه يزرع الأسطح المالية التي تُختبر لاحقاً (مستخلص، تحصيل، ذمم).
export const PROJECTS = [
  { key: 'sol_main', name_ar: tag('مشروع المنصة الموحدة'), sector: 'SOLUTIONS', client: 'gov', owner: 'demo.pm',
    creator: 'demo.sectorlead', value_sar: 1_000_000, start_date: '2026-01-01', end_date: '2026-12-31',
    contract_code: 'SCN-C-01',
    deliverables: [
      { name_ar: tag('مخرج تجريبي: وثيقة المتطلبات'), amount_sar: 250_000, month: 3 },
      { name_ar: tag('مخرج تجريبي: النسخة الأولى'), amount_sar: 350_000, month: 6 },
      { name_ar: tag('مخرج تجريبي: التشغيل التجريبي'), amount_sar: 400_000, month: 9 },
    ] },
  { key: 'sol_side', name_ar: tag('مشروع القدرات الرقمية'), sector: 'SOLUTIONS', client: 'priv', owner: 'demo.pm',
    creator: 'demo.sectorlead', value_sar: 400_000, start_date: '2026-02-01', end_date: '2026-10-31',
    contract_code: 'SCN-C-02',
    deliverables: [{ name_ar: tag('مخرج تجريبي: خطة التمكين'), amount_sar: 400_000, month: 5 }] },
  { key: 'con_main', name_ar: tag('مشروع الحوكمة المؤسسية'), sector: 'CONSULTING', client: 'priv', owner: 'demo.admin',
    creator: 'demo.admin', value_sar: 600_000, start_date: '2026-03-01', end_date: '2026-11-30',
    contract_code: 'SCN-C-03',
    deliverables: [{ name_ar: tag('مخرج تجريبي: تقرير الحوكمة'), amount_sar: 600_000, month: 7 }] },
  { key: 'str_main', name_ar: tag('مشروع خطة التحول'), sector: 'STRATEGIC', client: 'gov', owner: 'demo.admin',
    creator: 'demo.admin', value_sar: 300_000, start_date: '2026-04-01', end_date: '2026-09-30',
    contract_code: 'SCN-C-04', deliverables: [] },
  { key: 'sap_main', name_ar: tag('مشروع تطبيق الأنظمة'), sector: 'SAP', client: 'priv', owner: 'demo.admin',
    creator: 'demo.admin', value_sar: 900_000, start_date: '2026-05-01', end_date: '2026-12-15',
    contract_code: 'SCN-C-05', deliverables: [] },
  // مشروع بلا عميل وبلا قيمة تعاقدية: يُثبت أن «تشغيل داخلي» تصنيفٌ مشتقّ من القرائن لا من خانة.
  { key: 'sol_internal', name_ar: tag('مشروع تشغيل داخلي'), sector: 'SOLUTIONS', client: null, owner: 'demo.sectorlead',
    creator: 'demo.sectorlead', value_sar: 0, start_date: '2026-01-15', end_date: '2026-12-31',
    contract_code: 'SCN-C-06', deliverables: [] },
];

// ── المهام ──────────────────────────────────────────────────────────────────────
// `creator` هو من يُنشئها فعلاً بحسابه، و`assignee` هو من تُسنَد إليه — والفرق بينهما هو ما
// يُختبر (إسناد لغيرك يحتاج صلاحية إدارية على قطاعه).
export function tasksFor(today) {
  return [
    { key: 'main_req', title: tag('مهمة إعداد وثيقة المتطلبات'), project: 'sol_main', creator: 'demo.pm',
      assignee: 'demo.employee', priority: 'P1', due_date: shiftDays(today, 7) },
    { key: 'main_rev', title: tag('مهمة مراجعة المرحلة الأولى'), project: 'sol_main', creator: 'demo.pm',
      assignee: 'demo.employee', priority: 'P2', due_date: shiftDays(today, 14) },
    { key: 'main_late', title: tag('مهمة متأخرة للتحقق من التنبيه'), project: 'sol_main', creator: 'demo.pm',
      assignee: 'demo.employee', priority: 'P1', due_date: shiftDays(today, -5) },
    { key: 'side_ws', title: tag('مهمة ورشة عمل مع الجهة'), project: 'sol_side', creator: 'demo.pm',
      assignee: 'demo.consultant', priority: 'P2', due_date: shiftDays(today, 10) },
    { key: 'con_rep', title: tag('مهمة إعداد تقرير الحوكمة'), project: 'con_main', creator: 'demo.admin',
      assignee: 'demo.admin', priority: 'P2', due_date: shiftDays(today, 12) },
  ];
}

// ── سجل الوقت ───────────────────────────────────────────────────────────────────
// الفترة أسبوع كامل ينتهي قبل «اليوم»، وقيودها داخله — كي يكون رفع الفترة للاعتماد ذا معنى.
export function timesheetFor(today) {
  const end = shiftDays(today, -3);
  const start = shiftDays(end, -6);
  return {
    user: 'demo.employee',
    period: { start, end },
    entries: [
      { date: shiftDays(start, 1), hours: 6, task: 'main_req', billable: true, note: tag('عمل تجريبي') },
      { date: shiftDays(start, 2), hours: 5, task: 'main_req', billable: true, note: tag('عمل تجريبي') },
      { date: shiftDays(start, 3), hours: 3, task: null, billable: false, note: tag('اجتماع داخلي تجريبي') },
    ],
  };
}

// ── الإيراد المحقق ──────────────────────────────────────────────────────────────
// جدول بنود الإيراد لا خدمة له في المنتج (يُكتب من الاستيراد وحده) — يُكتب مباشرةً وموثَّق.
export const REVENUES = [
  { key: 'rev1', project: 'sol_main', month: 3, amount_sar: 200_000 },
  { key: 'rev2', project: 'sol_main', month: 5, amount_sar: 150_000 },
  { key: 'rev3', project: 'con_main', month: 6, amount_sar: 120_000 },
];

// ترتيب الحذف: الابن قبل الأب. أي جدول يشير إلى جدول آخر يجب أن يسبقه هنا، وإلا رفض المحرّك
// الحذف (مفاتيح خارجية مفعَّلة). القائمة أوسع مما نكتبه عمداً: المحو يجب أن يقدر على تنظيف
// كل ما قد يكتبه المنتج نتيجةً لأفعالنا، لا ما نكتبه نحن مباشرةً فقط.
export const PURGE_ORDER = [
  'email_log', 'email_queue', 'notification', 'ai_activity_log',
  'approval_action', 'approval_request',
  'invoice_line', 'collection', 'contract_payment', 'invoice',
  'expense', 'purchase_order', 'cost_line', 'revenue_line', 'budget',
  'contract',
  'time_entry', 'timesheet_period',
  'dependency', 'task',
  'deliverable', 'milestone', 'risk', 'issue', 'decision', 'change_request', 'action_item', 'lesson_learned',
  'crm_activity', 'document', 'saved_view', 'import_row', 'import_run',
  'membership', 'allocation',
  'opportunity_stage_history', 'opportunity_sector', 'pricing_line', 'proposal', 'opportunity',
  'workstream', 'project', 'program', 'portfolio',
  'contact', 'client',
  'employee', 'position', 'team', 'org_unit', 'department', 'sector',
  'session', 'login_history',
];

// الجداول التي يكتب فيها المنتج نتيجةً لأفعالنا بلا أن تعود إلينا معرّفاتها (فلا تدخل السجل
// اليدوي): تُنظَّف بالنسبة إلى فاعلها وزمنها. سجل التدقيق **ليس** منها — يبقى عمداً.
export const SIDE_EFFECT_TABLES = [
  { table: 'session', userCol: 'user_id', timeCol: 'created_at' },
  { table: 'login_history', userCol: 'user_id', timeCol: 'at' },
  { table: 'notification', userCol: 'user_id', timeCol: 'created_at' },
];

// الجداول التي يجب ألا تحوي صفاً بلا وسم في قاعدة رمي — أساس الحارس.
export const GUARDED_NAME_TABLES = [
  { table: 'sector', col: 'name_ar' },
  { table: 'department', col: 'name_ar' },
  { table: 'employee', col: 'name_ar' },
  { table: 'client', col: 'name_ar' },
  { table: 'opportunity', col: 'title_ar' },
  { table: 'project', col: 'name_ar' },
  { table: 'task', col: 'title' },
];

export function buildDataset({ today = '2026-07-27' } = {}) {
  const year = Number(String(today).slice(0, 4));
  return {
    today, year,
    stages: STAGES,
    sectors: SECTORS,
    departments: DEPARTMENTS,
    people: PEOPLE,
    clients: CLIENTS,
    opportunities: OPPORTUNITIES,
    projects: PROJECTS,
    tasks: tasksFor(today),
    timesheet: timesheetFor(today),
    revenues: REVENUES,
  };
}
