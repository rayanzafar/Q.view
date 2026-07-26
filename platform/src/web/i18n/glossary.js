// المعجم الموحّد — المصدر الوحيد لكل مصطلح يظهر للمستخدم (صفحات، بريد، تقارير، تصدير، أخطاء).
// القاعدة: عربية أعمال طبيعية، لا ترجمة حرفية، لا مصطلحات تقنية، أزرار ≤ 3 كلمات.
// تسميات حالة المشروع وعتبات الطاقة تأتي من core/i18n/thresholds.js — المصدر الواحد الذي
// يشترك فيه البريد والصفحات معاً (web يستورد من core، ولا عكس أبداً).
import { HEALTH_LABELS, CAPACITY, CAPACITY_LEGEND } from '../../core/i18n/thresholds.js';

export const G = {
  // ── الانتباه والقرار ──
  attention: 'يحتاج انتباهك الآن',
  needsDecision: 'بانتظار قرارك',
  decisions: 'القرارات',
  offTrack: 'خارج المسار',
  onTrack: 'على المسار',
  watch: 'تحت المراقبة',
  nextAction: 'الخطوة التالية',
  noNextAction: 'بلا خطوة تالية',
  allGood: 'كل شيء على ما يرام',
  nothingNeedsYou: 'لا يوجد ما يتطلب تدخلك الآن',

  // ── الفرص والمبيعات ──
  opportunities: 'الفرص',
  myOpportunities: 'فرصي',
  opportunity: 'فرصة',
  pipeline: 'قيد المتابعة',
  weighted: 'القيمة المرجّحة',
  raw: 'القيمة الإجمالية',
  winRate: 'نسبة الفوز',
  stage: 'المرحلة',
  stageAge: (n) => `منذ ${n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n >= 3 && n <= 10 ? n + ' أيام' : n + ' يوماً'} في هذه المرحلة`,
  stalled: 'فرصة متوقفة',
  won: 'مكسوبة',
  lost: 'مفقودة',
  probability: 'احتمال الفوز',
  expectedClose: 'الإغلاق المتوقع',
  oppTeam: 'فريق الفرصة',
  bookings: 'التعاقدات',

  // ── الأهداف والمال ──
  target: 'المستهدف',
  actual: 'المحقق',
  forecast: 'المتوقع نهاية السنة',
  attainment: 'نسبة التحقق',
  revenue: 'الإيراد',
  sales: 'المبيعات',
  contractValue: 'قيمة العقد',
  budget: 'الميزانية',
  invoiced: 'المفوتر',
  collected: 'المحصَّل',
  outstanding: 'المستحق',
  overdue: 'متأخر السداد',
  margin: 'الهامش',
  cost: 'التكلفة',
  deviation: 'الانحراف',

  // ── المشاريع ──
  projects: 'المشاريع',
  project: 'المشروع',
  portfolio: 'المحفظة',
  health: 'صحة المشروع',
  progress: 'نسبة الإنجاز',
  deliverables: 'المخرجات',
  milestones: 'المعالم',
  risks: 'المخاطر',
  issues: 'المعوقات',
  changes: 'طلبات التغيير',
  lessons: 'الدروس المستفادة',
  planVsActual: 'الخطة مقابل الفعلي',
  burnVsDelivery: 'الصرف مقابل الإنجاز',

  // ── الفريق والطاقة ──
  team: 'الفريق',
  capacity: 'الطاقة الاستيعابية',
  utilization: 'الإشغال',
  overloaded: 'تجاوز الطاقة',
  underused: 'سعة متاحة',
  onBench: 'غير مُسكَّن حالياً',
  staffed: 'مُسكَّن',
  assignment: 'التكليف',
  availability: 'الجاهزية',
  monthlyStaffing: 'التسكين الشهري',
  sectorParking: 'تسكين قطاعي',
  peak: 'الذروة',

  // ── العملاء ──
  clients: 'العملاء',
  client: 'العميل',
  contacts: 'جهات الاتصال',
  activities: 'سجل التواصل',
  activity: 'نشاط',
  lastActivity: 'آخر تواصل',
  relationship: 'حالة العلاقة',
  relActive: 'نشطة',
  relCooling: 'فاترة',
  relDormant: 'خاملة',
  concentration: 'التركّز',
  clientValue: 'قيمة العميل',
  winLossHistory: 'سجل الفوز والخسارة',

  // ── الاستيراد والتصدير ──
  dataCenter: 'البيانات',
  exportData: 'تصدير Excel',
  downloadTemplate: 'قالب فارغ',
  importData: 'استيراد Excel',
  importAdd: 'إضافة الجديد فقط',
  importUpsert: 'إضافة وتحديث',
  importReplace: 'استبدال كامل',
  preview: 'معاينة قبل التنفيذ',
  confirmImport: 'تأكيد الاستيراد',
  undoImport: 'تراجع عن العملية',
  importLog: 'سجل العمليات',
  rowError: (n, p) => `الصف ${n}: ${p}`,
  mapping: 'مطابقة الأعمدة',
  duplicates: 'سجلات مكررة',
  willCreate: 'سيُضاف',
  willUpdate: 'سيُحدَّث',
  willSkip: 'سيُتجاهل',
  hasErrors: 'به أخطاء',

  // ── معجم مركز القيادة (v2.1 — مصطلحات الفريق المعتادة من المنصة السابقة) ──
  commandCenter: 'مركز القيادة',
  pipelineLine: 'خط الفرص',
  funnel: 'قمع الفرص',
  // حالة المشروع: نفس التسميات التي يستعملها البريد حرفياً (مصدرها core/i18n/thresholds.js)
  hOnTrack: HEALTH_LABELS.GREEN,
  hAtRisk: HEALTH_LABELS.AMBER,
  hCritical: HEALTH_LABELS.RED,
  // شرح عتبات الطاقة بجملة واحدة — تُعرض تحت أي مقياس إشغال
  capacityLegend: CAPACITY_LEGEND,
  overCapacityPct: CAPACITY.over,
  healthyCapacityPct: CAPACITY.healthy,
  spendPct: 'صرف%',
  progressPct: 'إنجاز%',
  delivered: 'مُسلّم',
  invoicedShort: 'مفوتر',
  lateClaim: 'المستخلص المتأخر',
  topClient: 'العميل الأول',
  clientConc: 'تركّز العميل',
  whatChanged: 'ما تغيّر',
  yearElapsed: (n) => `انقضى ${n}% من السنة`,
  relOwner: 'مالك العلاقة',

  // ── عام ──
  overview: 'نظرة عامة',
  details: 'التفاصيل',
  save: 'حفظ',
  cancel: 'إلغاء',
  add: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  confirm: 'تأكيد',
  back: 'رجوع',
  search: 'بحث',
  filter: 'تصفية',
  all: 'الكل',
  savedViews: 'عروض محفوظة',
  saveView: 'حفظ العرض',
  defaultView: 'العرض الافتراضي',
  emptyList: 'لا توجد سجلات بعد',
  loadFailed: 'تعذّر جلب البيانات — أعد المحاولة',
  saved: 'تم الحفظ',
  sar: 'ريال',
  today: 'اليوم',
  thisMonth: 'هذا الشهر',
  thisQuarter: 'هذا الربع',
  thisYear: 'هذه السنة',
  vsLastMonth: 'مقارنة بالشهر الماضي',
  vsLastQuarter: 'مقارنة بالربع الماضي',
  vsLastYear: 'مقارنة بالسنة الماضية',
};

// ── تسميات القيم المخزَّنة (لا تُطبع قيمة خام للمستخدم أبداً) ──────────────────
// نوع العمل في سجل الوقت — كان يُطبع كما هو مخزَّن (project/opportunity/internal…).
export const WORK_KIND_AR = {
  project: 'مشروع',
  opportunity: 'فرصة',
  proposal: 'إعداد عرض',
  product: 'منتج',
  internal: 'عمل داخلي',
  leave: 'إجازة',
  training: 'تدريب',
  bd: 'تطوير أعمال',
  admin: 'أعمال إدارية',
};
// القائمة بترتيب العرض في نموذج تسجيل الوقت (القيمة المخزَّنة، التسمية العربية)
export const WORK_KIND_OPTIONS = ['project', 'opportunity', 'proposal', 'product', 'internal', 'leave', 'training', 'bd']
  .map((k) => [k, WORK_KIND_AR[k]]);
export const workKindLabel = (k) => WORK_KIND_AR[String(k || '').toLowerCase()] || 'غير محدَّد';

// اسم السجل المرتبط بطلب اعتماد أو حدث تدقيق — بدل طباعة اسم الجدول الإنجليزي.
export const RESOURCE_AR = {
  activity: 'نشاط تواصل', allocation: 'تسكين', app_user: 'مستخدم', approval: 'اعتماد',
  approval_request: 'طلب اعتماد', client: 'عميل', contact: 'جهة اتصال', contract: 'عقد',
  cost: 'تكلفة', deliverable: 'مخرج', department: 'إدارة', document: 'مستند',
  employee: 'موظف', expense: 'مصروف', import_run: 'عملية استيراد', invoice: 'فاتورة',
  issue: 'معوّق', margin: 'هامش', milestone: 'معلم', notification: 'إشعار',
  opp_team: 'فريق فرصة', opportunity: 'فرصة', project: 'مشروع', proposal: 'عرض',
  report: 'تقرير', report_schedule: 'جدولة تقرير', revenue_line: 'بند إيراد', risk: 'خطر',
  saved_view: 'عرض محفوظ', sector: 'قطاع', session: 'جلسة دخول', task: 'مهمة',
  timesheet: 'سجل وقت', unit: 'وحدة',
};
export const resourceLabel = (r) => RESOURCE_AR[String(r || '').toLowerCase()] || 'سجل';

// إجراءات سجل التدقيق — كل قيمة تُكتب فعلياً في السجل لها تسمية هنا (كانت تظهر لاتينية
// لأي إجراء خارج جدول التسميات: read/export/submit/import.apply…).
export const AUDIT_ACTION_AR = {
  create: 'إنشاء', update: 'تعديل', delete: 'حذف', approve: 'اعتماد', reject: 'رفض',
  submit: 'رفع للاعتماد', read: 'اطّلاع', export: 'تصدير', import: 'استيراد',
  'import.upload': 'رفع ملف استيراد', 'import.apply': 'تنفيذ استيراد', 'import.undo': 'تراجع عن استيراد',
  login: 'تسجيل دخول', logout: 'تسجيل خروج', error: 'عطل مسجَّل', skip: 'تم التجاوز',
  next_action: 'تحديد الخطوة التالية', admin: 'إجراء إداري', send: 'إرسال', schedule: 'جدولة',
};
export const auditActionLabel = (a) => AUDIT_ACTION_AR[String(a || '').toLowerCase()] || 'إجراء آخر';

// حالة الرسالة في طابور الإرسال — «جارٍ الإرسال» كانت تظهر بحروف لاتينية لأنها خارج جدول التسميات.
export const MAIL_STATUS_AR = {
  QUEUED: 'بانتظار الإرسال', SENDING: 'جارٍ الإرسال', PROCESSING: 'قيد المعالجة',
  SENT: 'أُرسلت', FAILED: 'تعذّر الإرسال', CANCELLED: 'أُلغيت',
};
export const mailStatusLabel = (s) => MAIL_STATUS_AR[String(s || '').toUpperCase()] || 'حالة غير معروفة';

// أحداث سجل البريد كما تُخزَّن (enqueued/sent/failed) — تُعرض بمعناها.
export const MAIL_EVENT_AR = {
  enqueued: 'بانتظار الإرسال', sending: 'جارٍ الإرسال', sent: 'أُرسلت',
  failed: 'تعذّر الإرسال', retry: 'إعادة محاولة', skipped: 'تم تجاوزها', cancelled: 'أُلغيت',
};
export const mailEventLabel = (e) => MAIL_EVENT_AR[String(e || '').toLowerCase()] || 'حدث بريد';

// مصطلحات محظورة في أي نص يظهر للمستخدم (تُفحص آلياً في scripts/check-glossary.mjs).
// حرّاس الفحص يتجاهلون أسماء المنتجات المسموحة (Excel) والكود غير المعروض.
export const BANNED_UI_TERMS = [
  'API', 'Schema', 'Entity', 'Adapter', 'Queue', 'Worker', 'Transaction',
  'JSON', 'SQL', 'Database', 'DB ', 'Backend', 'Frontend', 'Cache',
  'null', 'undefined', 'NaN', '[object', 'ID:', 'UUID', 'Timestamp',
  'سكيما', 'كيوري', 'انتيتي', 'باك اند', 'فرونت اند',
  // مصطلحات البريد والتشغيل التي كانت تتسرّب إلى عناوين الأقسام والشارات
  'Outbox', 'Inbox', 'Sandbox', 'SMTP', 'Endpoint', 'Payload', 'Token', 'Enum', 'Boolean',
  // قيم مخزَّنة كانت تُطبع خاماً بدل معناها (حالة المشروع، حالة العنصر)
  'RAG', 'RED', 'AMBER', 'GREEN', 'IN_PROGRESS', 'ON_HOLD', 'NOT_STARTED', 'TODO', 'DONE',
];
