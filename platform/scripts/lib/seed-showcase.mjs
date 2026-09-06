// بيانات العرض الغنية — تُزرع عبر الشبكة من خدمات المنصة نفسها، لا بإدخالٍ خام.
//
// الغرض: نسخةٌ قابلة للرمي تبدو فيها كل شاشة حيّةً كما تبدو عند عميل يعمل — لالتقاط صور
// الشاشات التي تُبنى منها صفحة العرض. ولذلك تمرّ كل صفٍّ من هنا بخدمته: سجلّ المراحل يُكتب،
// وطلبات الاعتماد تُرفع، وتأكيدات التسكين تُنشأ، وأسطر الإيراد تُشتقّ من التسليم، وسجل التدقيق
// ينمو — وهي كلها أشياء لا يصنعها إدخالٌ مباشر، وبدونها تبدو الشاشات فارغةً من الداخل.
//
// ثلاث قواعد لا تُكسر هنا:
//   ١) **كل ما في هذا الملف مُختلَق**: لا جهة حقيقية، ولا موظف حقيقي، ولا رقم منقول من مكان.
//      الأسماء عربية سعودية معقولة والجهات مبتكرة — فلا يُقرأ صفٌّ منها يوماً كبيانات عميل.
//   ٢) **بلا ساعة حائط**: كل تاريخ يُشتقّ من `TODAY` المثبّت أدناه، وكل اختيار عشوائي يخرج من
//      مولّد `mulberry32` ببذرةٍ ثابتة. تشغيلان يُنتجان القاعدة نفسها، فتُلتقط الصور نفسها.
//   ٣) **المال بالريال صحيحاً** عبر الشبكة؛ الخدمات هي التي تحوّله إلى هللات.
//
// ما لا خدمة له في المنتج — فيُكتب مباشرةً، وكلُّه مذكور هنا صراحةً:
//   • `stage`  : جدول مراحل خط الفرص، لا خدمة له في المنتج كله (نفس ما يفعله scripts/scenarios.mjs).
//   • أعمدة **الزمن الماضي**: `opportunity.created_at/stage_changed_at`، و`opportunity_stage_history.changed_at`،
//     و`crm_activity.at`، و`invoice.issue_date/due_date/status`. الخدمات تكتب هذه من ساعة الخادم
//     بحكم أنها تسجّل ما يحدث الآن — ولا باب في المنتج لتأريخ الماضي. وبلا تأريخٍ ماضٍ تُقرأ كل
//     الشاشات «اليوم»: لا فرصة راكدة، ولا فاتورة متأخرة، ولا سجل حركةٍ يمتدّ.
import { makeClient } from '../scenarios.mjs';
import { DEMO_PW, DEMO_USERS } from '../seed.js';

// ── الثوابت ────────────────────────────────────────────────────────────────────
export const TODAY = '2026-09-06';
export const YEAR = 2026;
const SEED = 0x5A17D2;

// مولّد أعداد شبه عشوائي ببذرة ثابتة — لا Math.random ولا Date.now في هذا الملف.
function mulberry32(a) {
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const stampOf = (iso, hour = 9, min = 15) => `${iso}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`;

// ── المفردات المُختلَقة ────────────────────────────────────────────────────────
const SECTORS = [
  { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', color: '#2563eb', sort_order: 1, salesPct: 0.96, revPct: 0.81 },
  { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', color: '#7c3aed', sort_order: 2, salesPct: 1.04, revPct: 0.88 },
  { id: 'SAP', name_ar: 'قطاع الأنظمة المؤسسية', color: '#b45309', sort_order: 3, salesPct: 0.72, revPct: 0.67 },
];

const DEPARTMENTS = [
  { key: 'sol_change', sector: 'SOLUTIONS', name_ar: 'إدارة تحول الأعمال', manager: 'demo.deptmgr' },
  { key: 'sol_digital', sector: 'SOLUTIONS', name_ar: 'إدارة البنية الرقمية', manager: 'demo.deptmgr' },
  { key: 'sol_pmo', sector: 'SOLUTIONS', name_ar: 'إدارة مكتب المشاريع', manager: 'demo.deptmgr' },
  { key: 'con_mgmt', sector: 'CONSULTING', name_ar: 'إدارة الاستشارات الإدارية', manager: 'demo.bdhead' },
  { key: 'con_ops', sector: 'CONSULTING', name_ar: 'إدارة استشارات التشغيل', manager: null },
  { key: 'con_research', sector: 'CONSULTING', name_ar: 'إدارة الدراسات والأبحاث', manager: null },
  { key: 'sap_apps', sector: 'SAP', name_ar: 'إدارة تطبيقات الأنظمة', manager: null },
  { key: 'sap_integ', sector: 'SAP', name_ar: 'إدارة تكامل الأنظمة', manager: null },
];

// ٣٥ شخصاً مُختلَقاً — أسماء عربية سعودية، لا أحد منهم موظف حقيقي.
const PEOPLE = [
  ['فيصل العتيبي', 'sol_change', 'قائد قطاع', 34000, '2022-02-01'],
  ['ريم الدوسري', 'sol_change', 'مديرة إدارة', 27000, '2022-08-15'],
  ['بندر الحربي', 'sol_change', 'مدير تطوير أعمال', 24000, '2023-01-10'],
  ['نورة الشهري', 'sol_change', 'أخصائية تطوير أعمال', 15000, '2024-03-01'],
  ['هيثم القحطاني', 'sol_change', 'مستشار تحول', 22000, '2023-06-01'],
  ['جواهر المالكي', 'sol_change', 'منسقة أعمال', 12000, '2025-01-15'],
  ['سلطان العنزي', 'sol_digital', 'مدير مباشر', 23000, '2022-11-01'],
  ['ماجد السبيعي', 'sol_digital', 'مهندس حلول', 19000, '2023-09-01'],
  ['أروى الغامدي', 'sol_digital', 'محللة أعمال', 16000, '2024-01-20'],
  ['زياد الرشيدي', 'sol_digital', 'مهندس تكامل', 18000, '2024-05-05'],
  ['هند الزهراني', 'sol_digital', 'مصممة تجربة مستخدم', 15000, '2025-02-01'],
  ['وليد الجهني', 'sol_digital', 'مهندس بيانات', 20000, '2023-04-01'],
  ['تركي الخالدي', 'sol_pmo', 'مدير مشاريع', 25000, '2022-05-01'],
  ['دانة الصاعدي', 'sol_pmo', 'أخصائية مكتب مشاريع', 14000, '2024-09-01'],
  ['رائد البقمي', 'sol_pmo', 'مدير عمليات', 21000, '2023-02-15'],
  ['سارة العسيري', 'con_mgmt', 'مستشارة أولى', 26000, '2022-03-01'],
  ['خالد الشمري', 'con_mgmt', 'مستشار أول', 24000, '2022-10-01'],
  ['منى الحازمي', 'con_mgmt', 'مستشارة', 17000, '2024-02-01'],
  ['عبدالله المطيري', 'con_mgmt', 'مستشار', 17000, '2024-04-10'],
  ['شهد السهلي', 'con_ops', 'مستشارة تشغيل', 18000, '2023-08-01'],
  ['نايف الدوسري', 'con_ops', 'مهندس عمليات', 16000, '2024-06-01'],
  ['بدور العتيبي', 'con_ops', 'محللة تشغيل', 13000, '2025-03-01'],
  ['مشعل الحربي', 'con_ops', 'مستشار جودة', 19000, '2023-11-01'],
  ['غادة القحطاني', 'con_research', 'باحثة أولى', 18000, '2023-05-01'],
  ['ياسر الشهري', 'con_research', 'باحث سوق', 14000, '2024-08-01'],
  ['لمياء البقمي', 'con_research', 'محللة بيانات', 15000, '2024-10-01'],
  ['سعود الغامدي', 'sap_apps', 'مستشار أنظمة أول', 28000, '2022-07-01'],
  ['أحمد الزهراني', 'sap_apps', 'مستشار أنظمة', 22000, '2023-03-01'],
  ['هيفاء الرشيدي', 'sap_apps', 'محللة تطبيقات', 16000, '2024-07-01'],
  ['طلال المالكي', 'sap_apps', 'مستشار مالي للأنظمة', 23000, '2023-10-01'],
  ['عائشة الخالدي', 'sap_apps', 'أخصائية تدريب', 13000, '2025-04-01'],
  ['صالح الجهني', 'sap_integ', 'مهندس تكامل أول', 25000, '2022-12-01'],
  ['ندى السبيعي', 'sap_integ', 'مهندسة أنظمة', 18000, '2024-01-05'],
  ['عمر العنزي', 'sap_integ', 'مهندس بنية تحتية', 19000, '2023-07-01'],
  ['ريما الحازمي', 'sap_integ', 'منسقة تسليم', 12000, '2025-05-01'],
];

// ربط حسابات العرض بسجلات الأشخاص — بدونه تبقى شاشات المدير والإدارة والفريق فارغة.
const LINKS = [
  ['demo.sectorlead', 'فيصل العتيبي'],
  ['demo.deptmgr', 'ريم الدوسري'],
  ['demo.bd', 'بندر الحربي'],
  ['demo.linemgr', 'سلطان العنزي'],
  ['demo.consultant', 'ماجد السبيعي'],
  ['demo.employee', 'أروى الغامدي'],
  ['demo.viewer', 'هند الزهراني'],
  ['demo.pm', 'تركي الخالدي'],
  ['demo.ops', 'رائد البقمي'],
  ['demo.approver', 'دانة الصاعدي'],
  ['demo.hr', 'جواهر المالكي'],
  ['demo.bdhead', 'سارة العسيري'],
  ['demo.ceo', 'هيثم القحطاني'],
  ['demo.procurement', 'صالح الجهني'],
];

// أسماء العرض للحسابات التجريبية. الحساب في seed.js اسمه وظيفتُه موسومةً بـ«(تجريبي)» — وهو
// وسمٌ صحيح في قاعدة اختبار، وعيبٌ ظاهر في صورةٍ تُعرض على شاشة معرض: اسم المالك في بطاقة
// الفرصة، والمُسنَد إليه في درج المهمة، وصاحب المنح في شاشة المستخدمين، كلها منه. فيُعاد تسمية
// الحسابات الثمانية عشر بأسماء أشخاصٍ مُختلَقين: المربوطة بسجلّ موظف تأخذ اسم سجلّها حرفاً
// (LINKS أعلاه) فلا يقول الحساب اسماً ويقول كشفُ الفريق اسماً آخر، والأربعة الباقية بلا سجلّ
// موظف فلها أسماؤها هنا. **أسماء الدخول لا تتغيّر** — الدخول بـ demo.<role> يبقى كما هو.
const UNLINKED_PERSONA_NAMES = {
  'demo.admin': 'طارق الفيفي',
  'demo.external': 'مشاري القرني',
  'demo.officecoord': 'لمى العمري',
  'demo.officemember': 'راكان الشثري',
};
const PERSONA_NAMES = { ...Object.fromEntries(LINKS), ...UNLINKED_PERSONA_NAMES };

const CLIENTS = [
  ['هيئة تطوير المدن الذكية', 'حكومي'],
  ['الهيئة العامة للنقل الحضري', 'حكومي'],
  ['الهيئة الوطنية لجودة الخدمات', 'حكومي'],
  ['الأمانة العامة لتنمية المناطق', 'حكومي'],
  ['المركز الوطني للمحتوى المحلي', 'حكومي'],
  ['الشركة الوطنية لتطوير البنية الرقمية', 'شبه حكومي'],
  ['مؤسسة الطاقة المستدامة', 'شبه حكومي'],
  ['صندوق تمكين المنشآت الصغيرة', 'شبه حكومي'],
  ['مجموعة الأفق القابضة', 'خاص'],
  ['شركة نماء للصناعات', 'خاص'],
  ['شركة مسار للخدمات اللوجستية', 'خاص'],
  ['شركة رواسي للمقاولات', 'خاص'],
  ['مجموعة واحة التجزئة', 'خاص'],
  ['مبادرات رؤية الخبراء الداخلية', 'داخلي'],
];

const WORK_TITLES = [
  'تطوير استراتيجية التحول الرقمي',
  'دراسة جدوى منصة الخدمات الموحدة',
  'تصميم نموذج التشغيل المستهدف',
  'إعادة هندسة إجراءات خدمة المستفيدين',
  'بناء مكتب إدارة المشاريع',
  'مراجعة الهيكل التنظيمي وتوصيف الوظائف',
  'تطوير خارطة طريق البيانات والتحليلات',
  'تأسيس مركز الخدمات المشتركة',
  'تحديث منظومة تخطيط الموارد',
  'تكامل الأنظمة المالية والمشتريات',
  'إعداد الخطة الاستراتيجية الخمسية',
  'قياس رضا المستفيدين وتحسين التجربة',
  'تصميم منظومة إدارة الأداء المؤسسي',
  'حوكمة أمن المعلومات والامتثال',
  'دراسة السوق وتحليل التنافسية',
  'تطوير منصة التوظيف الإلكتروني',
  'أتمتة دورة الشراء والتعاقد',
  'إنشاء لوحات مؤشرات الأداء التنفيذية',
  'مراجعة كفاءة الإنفاق التشغيلي',
  'تصميم تجربة المستخدم للخدمات الرقمية',
  'إعداد دليل السياسات والإجراءات',
  'تأهيل الكوادر ونقل المعرفة',
  'تحليل فجوات الجاهزية التقنية',
  'تصميم منظومة إدارة المخاطر',
];

const NEXT_ACTIONS = [
  'عرض تقديمي للجنة المشتريات الأسبوع القادم',
  'انتظار ردّ الجهة على النطاق المقترح',
  'تجهيز العرض الفني والمالي',
  'اجتماع تفاوضي على جدول الدفعات',
  'استكمال مستندات التأهيل',
  'متابعة محضر الاجتماع الأخير',
  'إعادة تسعير النطاق بعد التعديل',
];

const DELIVERABLE_NAMES = [
  'تقرير الوضع الراهن',
  'ورشة تحديد المتطلبات',
  'مسودة التصميم المقترح',
  'النموذج التشغيلي المعتمد',
  'خطة التنفيذ التفصيلية',
  'دليل الإجراءات',
  'التدريب ونقل المعرفة',
  'التقرير النهائي والتوصيات',
  'الدعم بعد الإطلاق',
];

const TASK_TITLES = [
  'إعداد محضر ورشة المتطلبات',
  'مراجعة مسودة التقرير مع الجهة',
  'تحديث خطة المشروع وجدولها',
  'تجهيز عرض اللجنة التوجيهية',
  'تحليل نتائج الاستبيان الميداني',
  'متابعة ملاحظات المراجعة الفنية',
  'إعداد مصفوفة الأدوار والمسؤوليات',
  'مقابلات أصحاب المصلحة',
  'جمع بيانات الأداء التشغيلي',
  'صياغة توصيات التحسين',
  'مراجعة العقد مع الشؤون القانونية',
  'إعداد مادة التدريب',
  'اختبار قبول المستخدمين',
  'توثيق قرارات اللجنة',
  'تحديث سجل المخاطر',
  'إغلاق ملاحظات الجودة',
  'تجهيز تقرير التقدّم الشهري',
  'تنسيق زيارة الموقع',
];

const ACTIVITY_TITLES = [
  ['meeting', 'اجتماع تعريفي مع فريق الجهة'],
  ['call', 'مكالمة متابعة على النطاق'],
  ['email', 'إرسال ملخص الاجتماع والتوصيات'],
  ['visit', 'زيارة ميدانية لمقر الجهة'],
  ['proposal', 'تسليم العرض الفني والمالي'],
  ['note', 'ملاحظة على أولويات الجهة لهذا العام'],
  ['update', 'تحديث حالة التفاوض'],
];

const EXPENSE_TYPES = ['سفر وإقامة', 'ضيافة اجتماعات', 'طباعة وتجهيز مواد', 'اشتراك أدوات تحليل',
  'تدريب فريق المشروع', 'نقل داخلي', 'استشاري متخصص'];

const EVENT_CONTACT_PEOPLE = [
  ['سعد الشمري', 'مدير التخطيط'], ['أمل الحربي', 'رئيسة قسم الجودة'], ['فهد المطيري', 'مدير تقنية المعلومات'],
  ['نوف العتيبي', 'أخصائية مشتريات'], ['راكان الدوسري', 'مدير الموارد البشرية'], ['ليلى القحطاني', 'مديرة التطوير'],
  ['ثامر الغامدي', 'مستشار تشغيل'], ['رزان الزهراني', 'محللة أعمال'], ['عادل السبيعي', 'مدير العمليات'],
  ['جود الرشيدي', 'منسقة مشاريع'], ['مازن البقمي', 'رئيس قسم الأنظمة'], ['شذى الجهني', 'مديرة التواصل'],
  ['حمد الخالدي', 'مدير مالي'], ['بشاير العنزي', 'أخصائية تدريب'], ['عبدالرحمن السهلي', 'مدير فرع'],
];

const EVENT_CONTACT_ORGS = [
  'هيئة تطوير المدن الذكية', 'مجموعة الأفق القابضة', 'شركة نماء للصناعات', 'مؤسسة الطاقة المستدامة',
  'الشركة الوطنية لتطوير البنية الرقمية', 'شركة مسار للخدمات اللوجستية', 'صندوق تمكين المنشآت الصغيرة',
  'مجموعة واحة التجزئة', 'الهيئة الوطنية لجودة الخدمات', 'شركة رواسي للمقاولات',
];

const PARTNERS = [
  ['شركة أُفق التقنية', 'شراكة تقنية', 'قيد النقاش'],
  ['مجموعة بيان للتسويق', 'تجارية / تسويقية', 'مبدئية'],
  ['شركة إتقان للتنفيذ', 'تنفيذ من الباطن', 'مذكّرة تفاهم'],
  ['أكاديمية مسار للتدريب', 'تدريب وتوظيف', 'اتفاقية موقّعة'],
  ['المركز الوطني للمحتوى المحلي', 'جهة حكومية', 'نشطة'],
  ['شركة رؤى للتحليلات', 'شراكة تقنية', 'قيد النقاش'],
];

// ── أدوات النداء ───────────────────────────────────────────────────────────────
class Seeder {
  constructor(base) {
    this.C = makeClient(base);
    this.rnd = mulberry32(SEED);
    this.calls = 0;
    this.ids = { user: {}, dept: {}, emp: {}, empDept: {}, client: {}, opp: [], project: [],
      contract: {}, deliverable: {}, task: [], invoice: [], event: {} };
  }

  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  int(min, max) { return min + Math.floor(this.rnd() * (max - min + 1)); }

  async call(as, path, method, body, label) {
    this.calls++;
    const r = await this.C.req(as, path, method === 'GET' ? {} : { method, body });
    if (r.status !== 200) {
      const msg = r.json?.error?.message || String(r.text).slice(0, 200);
      throw new Error(`${label || path} — ${method} ${path} ردّ ${r.status}: ${msg}`);
    }
    return r.json;
  }

  get(as, path, label) { return this.call(as, path, 'GET', undefined, label); }
  post(as, path, body, label) { return this.call(as, path, 'POST', body, label); }
  patch(as, path, body, label) { return this.call(as, path, 'PATCH', body, label); }

  // نداءٌ يُسمح له بالتعثّر (حالات يرفضها حارسٌ بحقّ) — يُعدّ ولا يُسقط الزرع.
  async soft(as, path, method, body) {
    this.calls++;
    const r = await this.C.req(as, path, method === 'GET' ? {} : { method, body });
    return r.status === 200 ? r.json : null;
  }
}

// ── الزرع ──────────────────────────────────────────────────────────────────────
export async function seedShowcase(base) {
  const t0 = Date.now();
  const S = new Seeder(base);
  const db = await import('../../src/core/db/index.js');
  const { id: mkId, nowIso } = await import('../../src/core/util/ids.js');

  // ① مراحل خط الفرص — الجدول الوحيد بلا خدمة في المنتج كله (إدخال مباشر موثَّق).
  const STAGES = [
    { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, color: '#94a3b8', is_won: 0, is_lost: 0 },
    { id: 'QUALIFIED', name_ar: 'مؤهلة', default_win_pct: 25, sort_order: 2, color: '#0891b2', is_won: 0, is_lost: 0 },
    { id: 'PROPOSAL', name_ar: 'عرض مقدم', default_win_pct: 50, sort_order: 3, color: '#2563eb', is_won: 0, is_lost: 0 },
    { id: 'NEGOTIATION', name_ar: 'تفاوض', default_win_pct: 75, sort_order: 4, color: '#d97706', is_won: 0, is_lost: 0 },
    { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, color: '#059669', is_won: 1, is_lost: 0 },
    { id: 'LOST', name_ar: 'مفقودة', default_win_pct: 0, sort_order: 6, color: '#dc2626', is_won: 0, is_lost: 1 },
  ];
  for (const s of STAGES) {
    if (!(await db.get('SELECT id FROM stage WHERE id = ?', [s.id]))) await db.insert('stage', s);
  }

  // ② الدخول بكل الحسابات — لكل حساب عنوانه كي لا يصطدم بحدّ محاولات الدخول
  for (const [i, u] of DEMO_USERS.entries()) {
    await S.C.login(u.u, DEMO_PW, `10.80.1.${i + 1}`);
    const row = await db.get('SELECT id FROM app_user WHERE username = ?', [u.u]);
    S.ids.user[u.u] = row?.id || null;
  }

  // ②-ب أسماء العرض — تمرّ بخدمة الهوية كأي تعديل حساب (تحقق + تدقيق + منح مدير النظام)،
  // لا بكتابةٍ مباشرة في `app_user`. وهي أول ما يُفعل بعد الدخول كي يحمل كل ما يُكتب بعدها
  // الاسم الجديد أينما قُرئ.
  let renamed = 0;
  for (const u of DEMO_USERS) {
    const name = PERSONA_NAMES[u.u];
    if (!name) throw new Error(`لا اسم عرضٍ للحساب ${u.u} — أضِفه في PERSONA_NAMES`);
    await S.patch('demo.admin', `/api/identity/users/${S.ids.user[u.u]}`, { name_ar: name }, `تسمية ${u.u}`);
    renamed++;
  }

  // ③ القطاعات (بمستهدفات مبدئية تُضبط في آخر الزرع من الأرقام الفعلية)
  for (const s of SECTORS) {
    await S.post('demo.admin', '/api/org/sectors', {
      id: s.id, name_ar: s.name_ar, color: s.color, kind: 'delivery', sort_order: s.sort_order,
      target_sales_sar: 1_000_000, target_revenue_sar: 1_000_000, target_margin_pct: 28,
    }, `إنشاء ${s.name_ar}`);
  }
  await S.patch('demo.admin', '/api/org/sectors/SOLUTIONS', { lead_user_id: S.ids.user['demo.sectorlead'] }, 'قائد قطاع الحلول');
  await S.patch('demo.admin', '/api/org/sectors/CONSULTING', { lead_user_id: S.ids.user['demo.bdhead'] }, 'قائد قطاع الاستشارات');

  // ④ الإدارات
  for (const d of DEPARTMENTS) {
    const r = await S.post('demo.admin', '/api/org/departments', {
      sector_id: d.sector, name_ar: d.name_ar,
      manager_user_id: d.manager ? S.ids.user[d.manager] : null,
    }, `إنشاء ${d.name_ar}`);
    S.ids.dept[d.key] = r.id;
  }
  const deptOf = (key) => DEPARTMENTS.find((d) => d.key === key);

  // ⑤ الأشخاص
  for (const [name, deptKey, title, salary, hire] of PEOPLE) {
    const d = deptOf(deptKey);
    const r = await S.post('demo.admin', '/api/org/employees', {
      name_ar: name, sector_id: d.sector, department_id: S.ids.dept[deptKey],
      job_title: title, hire_date: hire, salary_sar: salary,
    }, `إضافة ${name}`);
    S.ids.emp[name] = r.id;
    S.ids.empDept[name] = deptKey;
  }

  // ⑥ ربط الحسابات بسجلات الأشخاص
  for (const [username, name] of LINKS) {
    await S.post('demo.admin', `/api/employees/${S.ids.emp[name]}/link`,
      { user_id: S.ids.user[username] }, `ربط ${username}`);
  }
  // الجلسات تُعاد كي يحمل سياق كل حساب إدارته الجديدة (اعتماد المهام يُقرأ منها)
  for (const [i, u] of DEMO_USERS.entries()) await S.C.login(u.u, DEMO_PW, `10.80.2.${i + 1}`);

  // ⑦ الجهات
  for (const [name, type] of CLIENTS) {
    const r = await S.post('demo.admin', '/api/clients', { name_ar: name, type }, `إضافة ${name}`);
    S.ids.client[name] = r.id;
  }

  // ⑧ الفرص — كلٌّ بحساب من يملك إنشاءها في قطاعها
  const sectorDepts = (sec) => DEPARTMENTS.filter((d) => d.sector === sec).map((d) => d.key);
  const creatorFor = (sec) => (sec === 'SOLUTIONS' ? 'demo.bd' : 'demo.bdhead');
  const ownerPool = {
    SOLUTIONS: ['demo.bd', 'demo.sectorlead', 'demo.pm'],
    CONSULTING: ['demo.bdhead', 'demo.admin'],
    SAP: ['demo.bdhead', 'demo.admin'],
  };
  const OPEN_STAGES = ['LEAD', 'LEAD', 'QUALIFIED', 'QUALIFIED', 'PROPOSAL', 'PROPOSAL', 'NEGOTIATION'];
  const clientNames = CLIENTS.map((c) => c[0]);
  const opps = [];
  for (let i = 0; i < 60; i++) {
    const sec = i % 5 === 0 ? 'SAP' : i % 3 === 0 ? 'CONSULTING' : 'SOLUTIONS';
    const dk = sectorDepts(sec)[i % sectorDepts(sec).length];
    const clientName = clientNames[i % clientNames.length];
    const title = `${WORK_TITLES[i % WORK_TITLES.length]} — ${clientName}`;
    const startStage = OPEN_STAGES[i % OPEN_STAGES.length];
    const value = S.int(3, 48) * 50_000;
    const creator = creatorFor(sec);
    const r = await S.post(creator, '/api/opportunities', {
      title_ar: title, sector_id: sec, client_id: S.ids.client[clientName],
      department_id: S.ids.dept[dk], stage_id: startStage, value_sar: value,
      priority: ['P0', 'P1', 'P1', 'P2', 'P2', 'P3'][i % 6], year: YEAR,
      owner_user_id: S.ids.user[ownerPool[sec][i % ownerPool[sec].length]],
      next_action: NEXT_ACTIONS[i % NEXT_ACTIONS.length],
    }, `إنشاء فرصة ${i + 1}`);
    opps.push({ id: r.id, sector: sec, dept: dk, creator, stage: startStage, value, client: clientName, ageDays: 0 });
  }

  // نقلات المراحل — تكتب سجل المراحل الحقيقي، ومنه يُقرأ «عمر المرحلة»
  const FORWARD = { LEAD: 'QUALIFIED', QUALIFIED: 'PROPOSAL', PROPOSAL: 'NEGOTIATION', NEGOTIATION: 'NEGOTIATION' };
  let moves = 0;
  for (let i = 0; i < opps.length && moves < 45; i++) {
    const o = opps[i];
    if (i % 7 === 3) {
      await S.post(o.creator, `/api/opportunities/${o.id}/stage`,
        { stage: 'LOST', note: 'رست المنافسة على مورد آخر بفارق السعر' }, 'نقل إلى مفقودة');
      o.stage = 'LOST'; moves++;
      continue;
    }
    const times = i % 4 === 0 ? 2 : 1;
    for (let k = 0; k < times && moves < 45; k++) {
      const next = FORWARD[o.stage];
      if (!next || next === o.stage) break;
      await S.post(o.creator, `/api/opportunities/${o.id}/stage`,
        { stage: next, note: 'تحديث بعد اجتماع المتابعة' }, 'نقل مرحلة');
      o.stage = next; moves++;
    }
  }

  // فريق الفرصة — عضويات تُنشئ تأكيدات تسكين حقيقية
  let teamAdds = 0;
  for (const o of opps) {
    if (teamAdds >= 10) break;
    if (o.sector !== 'SOLUTIONS' || o.stage === 'LOST') continue;
    const pool = PEOPLE.filter((p) => deptOf(p[1]).sector === 'SOLUTIONS').map((p) => p[0]);
    const name = pool[teamAdds % pool.length];
    const ok = await S.soft('demo.sectorlead', `/api/opportunities/${o.id}/team`, 'POST',
      { employee_id: S.ids.emp[name], role_in_group: teamAdds % 4 === 0 ? 'lead' : 'member', allocation_pct: S.int(10, 40) });
    if (ok) teamAdds++;
  }

  // ⑨ المشاريع — مسار استلام العمل (مشروع + عقد + مخرجات في معاملة واحدة)
  const PROJECT_PLAN = [];
  for (let i = 0; i < 20; i++) {
    const sec = i % 5 === 4 ? 'SAP' : i % 3 === 2 ? 'CONSULTING' : 'SOLUTIONS';
    PROJECT_PLAN.push({ sec, i });
  }
  const projCreator = (sec) => (sec === 'SOLUTIONS' ? 'demo.sectorlead' : 'demo.admin');
  const projOwner = {
    SOLUTIONS: ['demo.pm', 'demo.ops', 'demo.sectorlead'],
    CONSULTING: ['demo.bdhead', 'demo.admin'],
    SAP: ['demo.admin', 'demo.bdhead'],
  };
  const projects = [];
  for (const { sec, i } of PROJECT_PLAN) {
    const clientName = clientNames[(i * 3 + 1) % clientNames.length];
    const name = `${WORK_TITLES[(i * 5 + 2) % WORK_TITLES.length]} — ${clientName}`;
    const startMonth = 1 + (i % 6);
    const endMonth = Math.min(12, startMonth + 5 + (i % 4));
    const nD = 4 + (i % 5);
    const unit = S.int(6, 26) * 25_000;
    const deliverables = [];
    for (let k = 0; k < nD; k++) {
      const m = Math.min(12, startMonth + Math.round((k * (endMonth - startMonth)) / Math.max(1, nD - 1)));
      deliverables.push({ name_ar: `${DELIVERABLE_NAMES[k % DELIVERABLE_NAMES.length]} — المرحلة ${k + 1}`,
        amount_sar: unit, month: m });
    }
    const value = unit * nD;
    const r = await S.post(projCreator(sec), '/api/intake/create', {
      name_ar: name, sector_id: sec, client_id: S.ids.client[clientName],
      owner_user_id: S.ids.user[projOwner[sec][i % projOwner[sec].length]],
      value_sar: value,
      start_date: `${YEAR}-${String(startMonth).padStart(2, '0')}-05`,
      end_date: `${YEAR}-${String(endMonth).padStart(2, '0')}-25`,
      contract_code: `EVC-${YEAR}-${String(i + 101)}`,
      status: 'IN_PROGRESS', deliverables,
    }, `إنشاء مشروع ${i + 1}`);
    const rows = await db.all('SELECT id, month FROM deliverable WHERE project_id = ? ORDER BY month, created_at', [r.project_id]);
    projects.push({ id: r.project_id, contract: r.contract_id, sector: sec, client: clientName,
      name, value, startMonth, endMonth, creator: projCreator(sec), deliverables: rows });
    S.ids.contract[r.project_id] = r.contract_id;
  }

  // حالات المخرجات: مقبول / مسلَّم / جارٍ العمل / مسودة — ومنها تُشتقّ أسطر الإيراد المحقق
  const DLV_MIX = ['ACCEPTED', 'ACCEPTED', 'DELIVERED', 'DELIVERED', 'IN_PROGRESS', 'DRAFT'];
  let dlvSeq = 0;
  for (const p of projects) {
    for (const d of p.deliverables) {
      const m = Number(d.month) || p.startMonth;
      const past = m <= 8;
      const st = past ? DLV_MIX[dlvSeq % 4] : DLV_MIX[4 + (dlvSeq % 2)];
      const dueDay = 20 + (dlvSeq % 8);
      await S.patch(p.creator, `/api/pmo/deliverable/${d.id}`, {
        status: st, period: `${YEAR}-${String(m).padStart(2, '0')}`,
        due_date: `${YEAR}-${String(m).padStart(2, '0')}-${String(Math.min(28, dueDay)).padStart(2, '0')}`,
      }, 'حالة مخرَج');
      d.status = st;
      dlvSeq++;
    }
  }

  // حالة المشروع ولونه ونسبة إنجازه
  const RAGS = ['GREEN', 'GREEN', 'GREEN', 'AMBER', 'AMBER', 'RED'];
  const STATUSES = ['IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'PLANNED'];
  for (const [i, p] of projects.entries()) {
    await S.patch(p.creator, `/api/projects/${p.id}`, {
      rag: RAGS[i % RAGS.length], status: STATUSES[i % STATUSES.length],
      progress_pct: [15, 30, 45, 55, 65, 72, 80, 90, 100][i % 9],
    }, 'تحديث المشروع');
  }

  // ⑩ المهام — الأغلب بحساب من نطاقه قطاع (فتُضاف فوراً)، وبضعٌ بحساب موظف (فتنتظر اعتماد مديره)
  // الاستشاري خارج الدورة العامة: حِمله يُبنى وحده أدناه كي يبقى «فوق طاقته» رقماً مقصوداً.
  const ASSIGNEES = ['demo.employee', 'demo.pm', 'demo.linemgr', 'demo.deptmgr',
    'demo.ops', 'demo.viewer', 'demo.approver', 'demo.sectorlead', 'demo.hr'];
  const PRIOS = ['P0', 'P1', 'P1', 'P2', 'P2', 'P2', 'P3'];
  const tasks = [];
  for (let i = 0; i < 132; i++) {
    const p = projects[i % projects.length];
    const boss = p.sector === 'SOLUTIONS' ? 'demo.sectorlead' : 'demo.admin';
    // حِمل ظاهر: الاستشاري يتجاوز طاقته بوضوح في مقياس الحِمل — تجاوزٌ يُقرأ لا تجاوزٌ هزلي.
    const heavy = i % 8 === 0;
    const assignee = heavy ? 'demo.consultant' : ASSIGNEES[i % ASSIGNEES.length];
    const due = day(TODAY, S.int(-30, 30));
    const util = heavy ? S.int(10, 16) : S.int(4, 18);
    const r = await S.post(boss, '/api/tasks/quick', {
      title: `${TASK_TITLES[i % TASK_TITLES.length]} — ${p.client}`,
      project_id: p.id, assignee_user_id: S.ids.user[assignee],
      sector_id: p.sector, priority: PRIOS[i % PRIOS.length], due_date: due,
      utilization_pct: util, category: ['متابعة', 'تقرير', 'اجتماع', 'تحليل'][i % 4],
      next_step: 'مراجعة المخرَج مع مدير المشروع',
    }, `مهمة ${i + 1}`);
    tasks.push({ id: r.id, assignee, boss, project: p.id, sector: p.sector });
  }
  // حالات المهام: منجزة / جارية / متوقفة — والمنجزة تخرج من مقياس الحِمل بحقّ
  for (const [i, t] of tasks.entries()) {
    if (i % 3 === 0) await S.patch(t.boss, `/api/tasks/${t.id}`, { status: 'DONE' }, 'إنجاز مهمة');
    else if (i % 3 === 1) await S.patch(t.boss, `/api/tasks/${t.id}`, { status: 'IN_PROGRESS', progress_pct: S.int(20, 80) }, 'مهمة جارية');
    else if (i % 9 === 5) await S.patch(t.boss, `/api/tasks/${t.id}`, { status: 'BLOCKED', blocked_reason: 'بانتظار بيانات من الجهة' }, 'مهمة متوقفة');
  }
  const solProjects = projects.filter((p) => p.sector === 'SOLUTIONS');

  // ⑪ التسكين — نسبٌ شهرية مختلفة تصنع نسيج مصفوفة الإشغال
  const empBySector = {};
  for (const [name, deptKey] of PEOPLE.map((p) => [p[0], p[1]])) {
    const sec = deptOf(deptKey).sector;
    (empBySector[sec] ||= []).push(name);
  }
  // لكل شخصٍ **ثلاثة** بنود تسكين متداخلة (وأربعة لواحدٍ من كل أربعة، فيتجاوز طاقته):
  //   • خلية المصفوفة تكتب عدد بنودها بصيغة العدد العربي، وصيغة المثنّى بلا رقم («· بندان»)
  //     تُقرأ على شاشةٍ بعيدة كأنها صفر. ثلاثةٌ فأكثر تكتب الرقم صريحاً («· 3 بنود»).
  //   • وكل بنود الشخص تبدأ من **شهره** نفسه وتمتدّ إلى ديسمبر، فلا يقع شهرٌ ببندين اثنين؛
  //     واختلاف شهر البداية بين الأشخاص يُبقي في المصفوفة نسيج الفجوات التاريخية.
  // وبهذا يصل كل من نطاقه «خاصتي» (الاستشاري والموظف والمشاهد) إلى مشاريع بحكم تسكينه —
  // وهو الشرط الذي بدونه لا مهمة يكتبها ولا اعتماد ينتظر مديره.
  const PROFILES = [
    [20, 20, 25, 25, 30, 30, 25, 25, 30, 30, 25, 20],
    [30, 30, 25, 25, 20, 20, 25, 30, 30, 25, 20, 20],
    [15, 20, 20, 25, 25, 30, 35, 30, 25, 20, 20, 15],
    [25, 25, 30, 30, 35, 30, 25, 20, 20, 25, 30, 25],
    [35, 30, 25, 20, 20, 25, 30, 35, 30, 25, 20, 15],
    [20, 25, 30, 35, 30, 25, 20, 20, 25, 30, 35, 30],
  ];
  const HEAVY_PROFILE = [40, 45, 45, 40, 35, 40, 45, 50, 45, 40, 35, 30];
  const START_MIX = [1, 1, 1, 3, 1, 5, 1, 2, 1, 4];
  // معاملُ ثقلٍ لكل بند: بدونه تتكرر ستة أنماطٍ فقط على خمسة وثلاثين شخصاً، فتخرج في المصفوفة
  // صفوفٌ متطابقة حرفاً — نسيجٌ يُقرأ مصنوعاً لا مأخوذاً من عمل. ودوراتُ الأربعة (٦ · ١٠ · ٤ · ٨)
  // لا تلتقي قبل مئةٍ وعشرين، فلا يتكرر صفّان في الكشف كلّه.
  const LOAD_MULTS = [0.65, 0.8, 0.95, 1.1, 1.25, 0.9, 1.05, 0.75];
  // ولمسةٌ سابعة: أطوال الجداول أعلاه (٦ · ٨ · ١٠ · ٤) تلتقي عند أربعةٍ وعشرين، فيتطابق كل
  // شخصٍ مع من يبعد عنه أربعةً وعشرين في الكشف. وسبعةٌ لا تقاسم أياً منها قاسماً، فتصير الدورة
  // ثمانمئةً وأربعين — أطول من أي كشفٍ في مكتب.
  const LOAD_JITTER = [0, 0.06, -0.05, 0.11, -0.09, 0.03, -0.12];
  const shapeFrom = (profile, start, mult) => {
    const out = {};
    for (let m = start; m <= 12; m++) out[m] = Math.max(5, Math.round(profile[m - 1] * mult));
    return out;
  };
  let allocs = 0;
  // ترتيبُ الشخص في **الكشف كلّه** (لا في قطاعه) هو ما يختار شكل حِمله: بترتيبه داخل قطاعه
  // يخرج ثلاثةُ أشخاص — واحدٌ من كل قطاع — بأرقامٍ متطابقة شهراً بشهر، وهو أول ما تلتقطه العين
  // في المصفوفة. أما الترتيب العام فلا يتكرر قبل مئةٍ وعشرين، ولا كشف فيه هذا العدد.
  let gi = 0;
  for (const [sec, names] of Object.entries(empBySector)) {
    const secProjects = projects.filter((p) => p.sector === sec);
    if (!secProjects.length) continue;
    for (const [ei, name] of names.entries()) {
      const start = START_MIX[gi % START_MIX.length];
      const slots = [0, 1, 3].map((k) => PROFILES[(gi + k) % PROFILES.length]);
      if (gi % 4 === 0) slots.push(HEAVY_PROFILE);
      for (const [si, profile] of slots.entries()) {
        // مشروعٌ مختلف لكل بند: التسكين الواحد لا يتكرر على نفس (المشروع + الشخص + السنة).
        const p = secProjects[(ei * 3 + si) % secProjects.length];
        const ok = await S.soft(p.creator, `/api/projects/${p.id}/staff`, 'POST', {
          employeeId: S.ids.emp[name], type: si === 0 ? 'lead' : 'member', year: YEAR,
          months: shapeFrom(profile, start,
            LOAD_MULTS[(gi * 7 + si) % LOAD_MULTS.length] + LOAD_JITTER[(gi + si) % LOAD_JITTER.length]),
        });
        if (ok) allocs++;
      }
      gi++;
    }
  }

  // حِمل الاستشاري في الشهر الجاري: الرقم الذي يقرؤه في صفحته الأولى («إشغالك في سبتمبر»)
  // مجموعُ **تسكيناته** لا مجموعُ نسب مهامه (src/modules/home/home.js) — وهما رقمان مختلفان.
  // فيُقرأ ما تراكم له، ثم يُضاف بندٌ واحد يرفعه إلى ١٢٠٪ كي يُقرأ التجاوز في المقياس بلا لبس.
  const LOAD_TARGET_PCT = 120;
  const consEmpId = S.ids.emp['ماجد السبيعي'];
  const curMonth = Number(TODAY.slice(5, 7));
  const consRows = await db.all(
    'SELECT project_id, monthly_json FROM allocation WHERE employee_id = ? AND year = ? AND deleted_at IS NULL',
    [consEmpId, YEAR]);
  let consNow = 0; const consOn = new Set();
  for (const r of consRows) {
    if (r.project_id) consOn.add(r.project_id);
    let mj = {}; try { mj = JSON.parse(r.monthly_json || '{}'); } catch { mj = {}; }
    consNow += Math.round((Number(mj[curMonth]) || 0) * 100);
  }
  const loadGap = LOAD_TARGET_PCT - consNow;
  const sparePrj = solProjects.find((p) => !consOn.has(p.id));
  if (loadGap > 0 && sparePrj) {
    const shape = { [curMonth - 1]: Math.max(10, Math.round(loadGap * 0.6)), [curMonth]: loadGap };
    if (curMonth < 12) shape[curMonth + 1] = Math.max(10, Math.round(loadGap * 0.8));
    const ok = await S.soft(sparePrj.creator, `/api/projects/${sparePrj.id}/staff`, 'POST',
      { employeeId: consEmpId, type: 'member', year: YEAR, months: shape });
    if (ok) allocs++;
  }

  // مهام تنتظر اعتماد مدير الإدارة — بحسابات نطاقها «خاصتي» داخل إدارة لها مدير مسجَّل.
  // المشروع يُختار من قائمة صاحب الحساب نفسه: مهمةٌ على مشروعٍ لا يصله تُردّ بحقّ.
  const PENDING_AUTHORS = ['demo.consultant', 'demo.employee', 'demo.pm', 'demo.consultant',
    'demo.employee', 'demo.pm', 'demo.consultant', 'demo.employee'];
  const pendingTaskIds = [];
  for (const [i, author] of PENDING_AUTHORS.entries()) {
    const reach = (await S.get(author, '/api/projects', 'مشاريع صاحب الحساب')) || [];
    const mine = reach.filter((p) => p.sector_id === 'SOLUTIONS');
    if (!mine.length) continue;
    const p = mine[i % mine.length];
    const r = await S.soft(author, '/api/tasks/quick', 'POST', {
      title: `${TASK_TITLES[(i * 3) % TASK_TITLES.length]} — ${p.name_ar.split(' — ').pop()}`,
      project_id: p.id, sector_id: 'SOLUTIONS', priority: 'P2',
      due_date: day(TODAY, S.int(3, 21)), utilization_pct: S.int(5, 15),
    });
    if (r) { tasks.push({ id: r.id, assignee: author, boss: author, project: p.id, sector: 'SOLUTIONS' }); pendingTaskIds.push(r.id); }
  }

  // ⑫ سجل الوقت — ثمانية أسابيع مضت، بأيام عمل حقيقية
  // من يُسجّل وقتاً على مهمةٍ لا بدّ أن يملك تعديلها (حارس timesheets.js): مديرُ الإدارة والمدير
  // المباشر منحُهما على المهام قراءةٌ بنطاق إدارتهما، ومهامُ المشاريع بلا إدارة — فتُردّ كتابتُهما
  // بحقّ. فالمسجِّلون هنا من يملك أمر مهامه: صاحبها، أو من نطاقه القطاع.
  const TIMERS = ['demo.consultant', 'demo.employee', 'demo.pm', 'demo.ops', 'demo.sectorlead'];
  const PER_TIMER = 18;
  let entries = 0;
  for (const [ui, who] of TIMERS.entries()) {
    const mine = tasks.filter((t) => t.assignee === who && !pendingTaskIds.includes(t.id));
    let n = 0;
    for (let d = 1; d <= 56 && n < PER_TIMER; d++) {
      const date = day(TODAY, -d);
      const dow = new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay();
      if (dow === 5 || dow === 6) continue;          // الجمعة والسبت عطلة
      const t = mine.length ? mine[(d + ui) % mine.length] : null;
      const ok = await S.soft(who, '/api/timesheets', 'POST', {
        hours: S.int(3, 8), entry_date: date,
        task_id: t ? t.id : null, project_id: t ? t.project : (projects[ui % projects.length].id),
        work_kind: 'project', billable: (d + ui) % 5 !== 0,
        note: t ? 'عمل على مهمة المشروع' : 'تنسيق ومتابعة مع فريق المشروع',
      });
      if (ok) { entries++; n++; }
    }
  }

  // ⑬ المال — مستخلصات، تحصيلات، مصروفات
  let claims = 0;
  for (const p of projects) {
    if (claims >= 22) break;
    const ready = p.deliverables.filter((d) => d.status === 'DELIVERED' || d.status === 'ACCEPTED');
    if (!ready.length) continue;
    const half = Math.max(1, Math.ceil(ready.length / 2));
    const first = await S.soft(p.creator, '/api/finance/progress-claim', 'POST',
      { contractId: p.contract, deliverableIds: ready.slice(0, half).map((d) => d.id), periodLabel: 'الدفعة الأولى' });
    if (first) { S.ids.invoice.push({ id: first.id, project: p.id, creator: p.creator, amount: first.amount_halalas }); claims++; }
    if (ready.length > half && claims < 22) {
      const second = await S.soft(p.creator, '/api/finance/progress-claim', 'POST',
        { contractId: p.contract, deliverableIds: ready.slice(half).map((d) => d.id), periodLabel: 'الدفعة الثانية' });
      if (second) { S.ids.invoice.push({ id: second.id, project: p.id, creator: p.creator, amount: second.amount_halalas }); claims++; }
    }
  }
  let collected = 0;
  for (const [i, inv] of S.ids.invoice.entries()) {
    if (collected >= 14) break;
    if (i % 3 === 2) continue;
    const full = i % 2 === 0;
    const sar = Math.max(1, Math.round((inv.amount / 100) * (full ? 1 : 0.4)));
    const ok = await S.soft(inv.creator, '/api/finance/collections', 'POST',
      { invoiceId: inv.id, amountSar: sar, collectedAt: day(TODAY, -S.int(5, 90)), method: 'تحويل بنكي' });
    if (ok) collected++;
  }

  let expenses = 0; let submitted = 0;
  for (let i = 0; i < 18; i++) {
    const p = projects[i % projects.length];
    const status = submitted < 6 && i % 3 === 0 ? 'SUBMITTED' : 'DRAFT';
    const ok = await S.soft(p.creator, `/api/projects/${p.id}/expenses`, 'POST', {
      type: EXPENSE_TYPES[i % EXPENSE_TYPES.length], amount_sar: S.int(8, 90) * 500,
      month: 1 + (i % 8), year: YEAR, status,
    });
    if (ok) { expenses++; if (status === 'SUBMITTED') submitted++; }
  }

  // ⑬-ب التكاليف — بلا كلفةٍ مسجَّلة يقرأ **الهامش ١٠٠٪** في لوحة القيادة وفي شريط «المال في
  // القطاع»، وهو رقمٌ لا يقع في مكتبٍ يعمل. والمعادلة في `src/core/reports/metrics.js`:
  // الهامش = (الإيراد الصافي − التكلفة) ÷ الإيراد، والتكلفة طرفاها بند الكلفة (`cost_line`،
  // ولا مسار في المنتج كله يكتبه) و**المصروف المعتمَد أو المدفوع**. فالباب الوحيد المتاح هو
  // بابه الصحيح: يُسجَّل المصروف على مشروعه بحساب من يملك تسجيله، ثم يعتمده مكتب الرئيس
  // التنفيذي (منح اعتماد المصروف على مستوى الشركة) — مساران حقيقيان لا كتابة مباشرة.
  // المبالغ تُشتقّ من إيراد كل قطاع كي يقع هامشه على رقمٍ مقصود يُقرأ (٣١٪–٤٧٪).
  const MARGIN_TARGET_PCT = { SOLUTIONS: 38, CONSULTING: 47, SAP: 31 };
  //  [الوصف، حصته من كلفة القطاع، معفيّ من الضريبة]. الرواتب معفاة بطبيعتها، وما عداها يحمل
  //  ضريبةً مسجَّلة صراحةً (لا مفترضة) كي يبقى الصافي — وهو ما تقرؤه المعادلة — رقماً مضبوطاً.
  const COST_LINES = [
    ['رواتب فريق المشروع', 0.46, true],
    ['تعاقد من الباطن', 0.22, false],
    ['سفر وإقامة الفريق', 0.09, false],
    ['تراخيص وأدوات تحليل', 0.08, false],
    ['ورش تدريب ونقل معرفة', 0.08, false],
    ['طباعة وتجهيز مواد التسليم', 0.07, false],
  ];
  const preCost = await S.get('demo.ceo', `/api/metrics/company?year=${YEAR}`, 'إيراد القطاعات قبل التكاليف');
  let costRows = 0; let costNetSar = 0;
  for (const s of SECTORS) {
    const row = (preCost.sectors || []).find((x) => x.id === s.id);
    const revenueSar = Math.round((row?.revenue_halalas || 0) / 100);
    const secProjects = projects.filter((p) => p.sector === s.id);
    if (revenueSar <= 0 || !secProjects.length) continue;
    const targetCost = Math.round((revenueSar * (100 - MARGIN_TARGET_PCT[s.id])) / 100);
    const parts = [];
    for (const [i, [type, share, exempt]] of COST_LINES.entries()) {
      const perLine = Math.round(targetCost * share);
      const n = Math.min(3, secProjects.length);
      for (let k = 0; k < n; k++) {
        parts.push({ type, exempt, project: secProjects[(i * 3 + k * 2) % secProjects.length],
          net: Math.round(perLine / n), month: 1 + ((i * 2 + k * 3) % 8) });
      }
    }
    // فروق التقريب تُحمَّل على أول بند كي يقع الهامش على الرقم المقصود بالضبط لا قريباً منه.
    parts[0].net += targetCost - parts.reduce((a, x) => a + x.net, 0);
    for (const part of parts) {
      if (part.net <= 0) continue;
      const gross = part.exempt ? part.net : Math.round(part.net * 1.15);
      const vat = gross - part.net;
      const made = await S.soft(part.project.creator, `/api/projects/${part.project.id}/expenses`, 'POST', {
        type: part.type, amount_sar: gross, month: part.month, year: YEAR, status: 'SUBMITTED',
        ...(part.exempt ? { vat_exempt: true } : { vat_sar: vat }),
      });
      if (!made) continue;
      const approved = await S.soft('demo.ceo', `/api/finance/expenses/${made.id}`, 'PATCH', { status: 'APPROVED' });
      if (approved) { costRows++; costNetSar += part.net; }
    }
  }

  // ⑭ سجل الحركة على الجهات والفرص
  let acts = 0;
  for (let i = 0; i < 30; i++) {
    const o = opps[(i * 7) % opps.length];
    const [kind, title] = ACTIVITY_TITLES[i % ACTIVITY_TITLES.length];
    const who = o.sector === 'SOLUTIONS' ? (i % 2 ? 'demo.bd' : 'demo.sectorlead') : 'demo.bdhead';
    const ok = await S.soft(who, '/api/activities', 'POST', {
      kind, title: `${title} — ${o.client}`, opportunity_id: o.id,
      detail: 'نُقلت أبرز النقاط إلى خطة المتابعة، والخطوة التالية محدَّدة بموعدها.',
    });
    if (ok) acts++;
  }

  // ⑮ الفعاليات — قائمة الآن، وقادمة، ومنتهية
  const EVENTS = [
    { key: 'running', name_ar: 'ملتقى التقنية والتحول الرقمي 2026', venue: 'مركز المعارض الدولي', booth_no: 'B-14',
      starts_on: day(TODAY, -2), ends_on: day(TODAY, 2), contacts: 20 },
    { key: 'upcoming', name_ar: 'معرض الحلول المؤسسية 2026', venue: 'قاعة الأعمال الكبرى', booth_no: 'C-08',
      starts_on: day(TODAY, 62), ends_on: day(TODAY, 64), contacts: 8 },
    { key: 'past', name_ar: 'قمة الاستشارات الإدارية 2026', venue: 'فندق الواحة', booth_no: 'A-03',
      starts_on: day(TODAY, -118), ends_on: day(TODAY, -116), contacts: 17 },
  ];
  const OUTCOME_MIX = ['لم تُراجع', 'تواصلنا', 'صارت فرصة', 'لم تُراجع', 'لا متابعة', 'صارت شراكة'];
  const KIND_MIX = ['تعريف بالشركة', 'شراكة', 'تعاون', 'توظيف', 'تعريف بالشركة'];
  let contactsN = 0;
  for (const e of EVENTS) {
    const r = await S.post('demo.admin', '/api/events', {
      name_ar: e.name_ar, venue: e.venue, booth_no: e.booth_no, starts_on: e.starts_on, ends_on: e.ends_on,
    }, `إنشاء فعالية ${e.name_ar}`);
    S.ids.event[e.key] = r.id;
    for (let i = 0; i < e.contacts; i++) {
      const [person, job] = EVENT_CONTACT_PEOPLE[(contactsN + i) % EVENT_CONTACT_PEOPLE.length];
      const org = EVENT_CONTACT_ORGS[(contactsN + i * 3) % EVENT_CONTACT_ORGS.length];
      const who = ['demo.bd', 'demo.sectorlead', 'demo.bdhead', 'demo.admin'][i % 4];
      const ok = await S.soft(who, `/api/events/${r.id}/contacts`, 'POST', {
        kind: KIND_MIX[i % KIND_MIX.length],
        person_name: `${person} ${i + 1}`, org_name: org, job_title: job,
        phone: `05${String(10000000 + (contactsN + i) * 137).slice(0, 8)}`,
        email: `contact${contactsN + i}@example.test`,
        note: 'مهتم بعرض تعريفي عن خدمات المكتب، وطلب موعداً بعد المعرض.',
      });
      if (ok) {
        contactsN++;
        const outcome = OUTCOME_MIX[(contactsN) % OUTCOME_MIX.length];
        if (outcome !== 'لم تُراجع') await S.soft(who, `/api/events/contacts/${ok.contact.id}/outcome`, 'POST', { outcome });
      }
    }
  }
  for (const [i, [org, kind, status]] of PARTNERS.entries()) {
    const evKey = i % 3 === 2 ? 'past' : 'running';
    await S.soft('demo.bdhead', `/api/events/${S.ids.event[evKey]}/partners`, 'POST', {
      org_name: org, partner_kind: kind, status,
      contact_name: EVENT_CONTACT_PEOPLE[i % EVENT_CONTACT_PEOPLE.length][0],
      phone: `05${String(20000000 + i * 913).slice(0, 8)}`,
      scope_note: 'نطاق التعاون المبدئي: تنفيذ مشترك على مشاريع القطاع الحكومي.',
      next_step: 'تبادل مسودة مذكرة التفاهم', next_date: day(TODAY, 14 + i * 3),
    });
  }
  const MEETING_TITLES = ['لقاء تعريفي بخدمات المكتب', 'مناقشة نطاق تعاون مشترك', 'عرض دراسة حالة',
    'متابعة طلب عرض سعر', 'اجتماع فريق الجناح', 'لقاء مع فريق المشتريات'];
  let meetings = 0;
  for (let i = 0; i < 12; i++) {
    const evKey = i % 4 === 3 ? 'upcoming' : 'running';
    const base2 = EVENTS.find((e) => e.key === evKey);
    const dayIso = day(base2.starts_on, i % 3);
    const hour = 9 + (i % 6);
    const ok = await S.soft('demo.admin', `/api/events/${S.ids.event[evKey]}/meetings`, 'POST', {
      title: `${MEETING_TITLES[i % MEETING_TITLES.length]} — ${EVENT_CONTACT_ORGS[i % EVENT_CONTACT_ORGS.length]}`,
      meeting_date: dayIso,
      start_time: `${String(hour).padStart(2, '0')}:00`, end_time: `${String(hour).padStart(2, '0')}:45`,
      location: `الجناح ${base2.booth_no}`,
      attendee_ids: [S.ids.user['demo.bd'], S.ids.user['demo.sectorlead']],
      note: 'التحضير: نسخة من ملف التعريف وثلاث دراسات حالة.',
    });
    if (ok) meetings++;
  }

  // ⑯ طلبات الاعتماد على أعمال قائمة — طابور قائد قطاع الحلول
  const solOpps = opps.filter((o) => o.sector === 'SOLUTIONS' && o.stage !== 'LOST');
  const approvals = [];
  for (const o of solOpps.slice(0, 12)) {
    const r = await S.soft('demo.bd', '/api/approvals', 'POST',
      { workflowKey: 'opportunity_go_nogo', resource: 'opportunity', resourceId: o.id });
    if (r && r.status === 'PENDING') approvals.push(r.id);
  }
  for (const p of solProjects.slice(0, 5)) {
    const d = p.deliverables.find((x) => x.status === 'IN_PROGRESS' || x.status === 'DRAFT');
    if (!d) continue;
    const r = await S.soft('demo.ops', '/api/approvals', 'POST',
      { workflowKey: 'deliverable_acceptance', resource: 'deliverable', resourceId: d.id });
    if (r && r.status === 'PENDING') approvals.push(r.id);
  }
  // قراراتٌ متَّخذة — كي لا يبدو سجل الاعتمادات كأن أحداً لم يقرّر فيه شيئاً قط
  let acted = 0;
  for (const aid of approvals.slice(0, 2)) {
    if (await S.soft('demo.sectorlead', `/api/approvals/${aid}/act`, 'POST', { action: 'approve', comment: 'مطابق لأولويات القطاع' })) acted++;
  }
  for (const aid of approvals.slice(2, 3)) {
    if (await S.soft('demo.sectorlead', `/api/approvals/${aid}/act`, 'POST', { action: 'reject', comment: 'النطاق غير مكتمل — يُعاد بعد تحديد المخرجات' })) acted++;
  }
  const deptDirect = await db.all(
    "SELECT id FROM approval_request WHERE status = 'PENDING' AND assignee_user_id = ? ORDER BY created_at",
    [S.ids.user['demo.deptmgr']]);
  for (const row of deptDirect.slice(0, 1)) {
    if (await S.soft('demo.deptmgr', `/api/approvals/${row.id}/act`, 'POST', { action: 'approve', comment: 'معتمَدة — تدخل ضمن خطة الإدارة' })) acted++;
  }

  // ⑰ منح على مستوى الإدارة
  // المنح المعروضة تُعطى لمن يقرأ الفرص بدوره أصلاً (الاستشاري والمشاهد): «قراءة فرص إدارة»
  // لمن لا يقرؤها بدوره تفتح له شاشة «الفرص» كاملةً — وهو تغييرُ صلاحيةٍ حقيقي تلتقطه مصفوفة
  // الصلاحيات والمسح الحيّ، ولا شأن لبيانات عرضٍ بأن تغيّره. المقصود هنا إظهار سطور المنح.
  const GRANTS = [
    ['demo.consultant', 'sol_pmo', 'opportunity', 'read'],
    ['demo.consultant', 'sol_change', 'opportunity', 'read'],
    ['demo.viewer', 'sol_change', 'opportunity', 'read'],
    ['demo.viewer', 'sol_digital', 'opportunity', 'read'],
  ];
  let grants = 0;
  for (const [who, dk, resource, action] of GRANTS) {
    const ok = await S.soft('demo.admin', '/api/identity/grants', 'POST',
      { user_id: S.ids.user[who], department_id: S.ids.dept[dk], resource, action, note: 'يعمل على أعمال هذه الإدارة' });
    if (ok) grants++;
  }

  // ⑱ تأريخ الماضي — لا خدمة في المنتج تكتب هذه الأعمدة (انظر رأس الملف)
  const oppRows = await db.all('SELECT id FROM opportunity WHERE deleted_at IS NULL ORDER BY created_at, id');
  for (const [i, row] of oppRows.entries()) {
    const age = [4, 9, 16, 23, 31, 45, 58, 74, 96, 128][i % 10] + (i % 7);
    const created = day(TODAY, -(age + 20 + (i % 30)));
    const moved = day(TODAY, -age);
    await db.run('UPDATE opportunity SET created_at = ?, stage_changed_at = ? WHERE id = ?',
      [stampOf(created, 8, 30), stampOf(moved, 11, 5), row.id]);
    await db.run('UPDATE opportunity_stage_history SET changed_at = ? WHERE opportunity_id = ?',
      [stampOf(moved, 11, 5), row.id]);
  }
  const actRows = await db.all('SELECT id FROM crm_activity ORDER BY at, id');
  for (const [i, row] of actRows.entries()) {
    await db.run('UPDATE crm_activity SET at = ? WHERE id = ?', [stampOf(day(TODAY, -(2 + i * 3)), 10, 20), row.id]);
  }
  // فواتير قديمة ومتأخرة — كي تُقرأ صفحة المالية كما تُقرأ في مؤسسة تعمل منذ أشهر
  const invRows = await db.all("SELECT id, status FROM invoice WHERE deleted_at IS NULL ORDER BY created_at, id");
  for (const [i, row] of invRows.entries()) {
    const issued = day(TODAY, -(18 + i * 9));
    const due = day(issued, 30);
    const overdue = row.status === 'ISSUED' && i % 4 === 1;
    await db.run('UPDATE invoice SET issue_date = ?, due_date = ?, status = ? WHERE id = ?',
      [issued, due, overdue ? 'OVERDUE' : row.status, row.id]);
  }

  // ⑲ المستهدفات تُضبط من الأرقام الفعلية كي تقع نسب الإنجاز في نطاق يُقرأ (٦٢–١٠٨٪)
  const metrics = await S.get('demo.ceo', `/api/metrics/company?year=${YEAR}`, 'مؤشرات الشركة');
  for (const s of SECTORS) {
    const row = (metrics.sectors || []).find((x) => x.id === s.id);
    if (!row) continue;
    const salesTarget = Math.max(1000, Math.round((row.sales_halalas / 100) / s.salesPct));
    const revTarget = Math.max(1000, Math.round((row.revenue_halalas / 100) / s.revPct));
    await S.patch('demo.admin', `/api/org/sectors/${s.id}`,
      { target_sales_sar: salesTarget, target_revenue_sar: revTarget }, 'ضبط المستهدف');
  }

  // ── ما تحتاجه سكربتات اللقطات ─────────────────────────────────────────────
  const midOpp = opps.find((o) => o.stage === 'PROPOSAL') || opps.find((o) => o.stage === 'NEGOTIATION') || opps[0];
  const richProject = projects.slice().sort((a, b) => b.deliverables.length - a.deliverables.length)[0];
  const heavyUser = S.ids.user['demo.consultant'];
  const heavyEmp = S.ids.emp['ماجد السبيعي'];
  const showcase = {
    today: TODAY, year: YEAR,
    opportunityId: midOpp.id,
    opportunityStage: midOpp.stage,
    projectId: richProject.id,
    contractId: richProject.contract,
    clientId: S.ids.client['هيئة تطوير المدن الذكية'],
    eventRunningId: S.ids.event.running,
    eventUpcomingId: S.ids.event.upcoming,
    eventPastId: S.ids.event.past,
    heavyUserId: heavyUser,
    heavyEmployeeId: heavyEmp,
    sectorId: 'SOLUTIONS',
    sectorLeadUserId: S.ids.user['demo.sectorlead'],
    deptManagerUserId: S.ids.user['demo.deptmgr'],
  };

  const counts = await tableCounts(db);
  await db.close();
  return { showcase, counts, calls: S.calls, ms: Date.now() - t0,
    made: { opportunities: opps.length, stageMoves: moves, oppTeam: teamAdds, projects: projects.length,
      tasks: tasks.length, pendingTasks: pendingTaskIds.length, allocations: allocs, timeEntries: entries,
      claims, collections: collected, expenses, submittedExpenses: submitted, activities: acts,
      renamedPersonas: renamed, costExpenses: costRows, costNetSar,
      eventContacts: contactsN, meetings, approvals: approvals.length, actedApprovals: acted, grants } };
}

// عدّ الصفوف الحيّة في الجداول التي تُقرأ من الشاشات — يُطبع في نهاية الإقلاع.
const COUNTED = ['sector', 'department', 'employee', 'client', 'opportunity', 'opportunity_stage_history',
  'project', 'contract', 'deliverable', 'task', 'approval_request', 'allocation', 'membership',
  'time_entry', 'invoice', 'collection', 'expense', 'revenue_line', 'crm_activity',
  'event', 'event_contact', 'event_partner', 'event_meeting', 'audit_log'];

export async function tableCounts(db) {
  const out = {};
  for (const t of COUNTED) {
    try { out[t] = (await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n; }
    catch { out[t] = null; }
  }
  return out;
}
