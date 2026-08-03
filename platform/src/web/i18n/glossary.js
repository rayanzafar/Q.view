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

  // ── ضريبة القيمة المضافة: المبلغ له وجهان دائماً ──
  // القاعدة المعلنة للمستخدم: ما يدفعه العميل «مع الضريبة»، وما يخصّ الشركة «بدون الضريبة»،
  // والفارق أمانةٌ تُورَّد للدولة. تُكتب بهذه الألفاظ لا بغيرها كي لا يظهر مصطلحان لمعنى واحد.
  vat: 'ضريبة القيمة المضافة',
  vatShort: 'الضريبة',
  withVat: 'مع الضريبة',
  withoutVat: 'بدون الضريبة',
  netAmount: 'المبلغ بدون الضريبة',
  grossAmount: 'المبلغ مع الضريبة',
  netRevenue: 'الإيراد بدون الضريبة',
  vatOfWhich: 'منها ضريبة',
  vatNotRecorded: 'الضريبة غير مُسجَّلة',
  vatExempt: 'بلا ضريبة',
  vatExplain: 'المطالبة والتحصيل مع الضريبة لأن العميل يدفعها، والإيراد بدون الضريبة لأنها تُورَّد للدولة ولا تخصّ الشركة.',

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

  // ── مركز العمل اليومي (المهام) ──
  // القاعدة الحاكمة لهذا المقطع (docs/benchmarks.md، جولة 2026-07-27): لغة إنجاز مهنية هادئة،
  // لا نقاط ولا أوسمة ولا سلاسل أيام؛ وكل رقم من مصدر مسجَّل أو فراغ معلن.
  workCentre: 'مركز عملي',
  myWork: 'مهامي',
  teamWork: 'مهام فريقي',
  task: 'مهمة',
  tasks: 'المهام',
  viewList: 'قائمة',
  viewBoard: 'لوح',
  viewCalendar: 'تقويم',
  dayPlan: 'خطة اليوم',
  doneToday: 'أنجزت اليوم',
  doneThisWeek: 'أنجزت هذا الأسبوع',
  remainingToday: 'المتبقي اليوم',
  dayClear: 'يومك مُغلق',
  dayClearSub: 'لا شيء مستحق اليوم — راجع القادم متى شئت.',
  nothingScheduled: 'لا شيء مجدول لليوم',
  assignee: 'المسؤول',
  unassigned: 'غير مُسنَدة',
  taskStatus: 'الحالة',
  priority: 'الأولوية',
  dueDate: 'الاستحقاق',
  noDueDate: 'بلا موعد',
  taskProgress: 'التقدم',
  noProgressYet: 'لم يُسجَّل تقدم بعد',
  blocker: 'العائق',
  noBlocker: 'بلا عائق',
  setBlocker: 'اكتب سبب التعطيل',
  nextStep: 'الخطوة التالية',
  setNextStep: 'حدّد الخطوة التالية',
  parentLink: 'الجهة المرتبطة',
  internalWork: 'عمل داخلي',
  noParentLink: 'بلا جهة مرتبطة',
  window: 'النافذة الزمنية',
  winToday: 'اليوم',
  winWeek: 'هذا الأسبوع',
  winLater: 'لاحقاً',
  winOverdue: 'متأخرة',
  winAll: 'الكل',
  bulkSelected: 'مهمة محددة',
  bulkApply: 'تطبيق',
  bulkClear: 'إلغاء التحديد',
  myOpenOpportunities: 'الفرص اللي عليّ',
  markDone: 'إنجاز',
  quickAdd: 'إضافة سريعة',

  // ── المهام الشخصية والملاحظات ───────────────────────────────────────────────
  // «وفي برضو مكان المهام أضيف شي اسمه مهام شخصية، وأضيف مكان الواحد يكتب فيه النوت» —
  // بلسان المالك. والكلمتان تحملان وعداً صريحاً بالخصوصية، فلا تُستعملان في شاشة يقرؤها
  // غير صاحبها أبداً: «شخصية» تعني لصاحبها وحده، و«عمل داخلي» تعني للشركة بلا مشروع.
  personalWork: 'مهمة شخصية',
  personalTasks: 'مهام شخصية',
  personalOnlyYou: 'تظهر لك وحدك',
  myNotes: 'ملاحظاتي',
  noteSubject: 'الموضوع',
  noteBody: 'نص الملاحظة',
  noteDay: 'اليوم',
  newNote: 'ملاحظة جديدة',
  pinNote: 'تثبيت',
  unpinNote: 'إلغاء التثبيت',
  pinnedNotes: 'المثبَّتة',
  noteEdit: 'تعديل',
  noteDelete: 'حذف',

  // ── حركة المال على المشروع ──────────────────────────────────────────────────
  // مفردات طلب المالك بلغته: «الكاش إن والكاش آوت والمصروفات والتسكين… ونسبتهم حسب الشهر».
  // القاعدة الحاكمة لهذا المقطع: الغياب والتقييد والصفر ثلاث حالات لا تتشابه — ولكلٍّ كلمتها.
  moneyOnProject: 'حركة المال على المشروع',
  moneyOnProjectSub: 'الداخل والخارج والمصروفات والتسكين — شهراً بشهر، بما هو مسجَّل فقط',
  moneyBridge: 'من التعاقد إلى التحصيل',
  moneyStage: 'مرحلة',
  contracted: 'قيمة التعاقد',
  revenueRecognised: 'الإيراد المحقق',
  cashIn: 'الداخل النقدي',
  cashOut: 'الخارج النقدي',
  monthlyMovement: 'الحركة الشهرية',
  monthDetails: 'تفصيل الأشهر',
  clientPo: 'أمر شراء العميل',
  retentionHeld: 'محتجز',
  draftInvoices: 'فواتير مسودة',
  invoicesByStatus: 'الفواتير حسب حالتها',
  expenses: 'المصروفات',
  expenseRegister: 'سجل المصروفات',
  expenseByType: 'المصروفات حسب الوصف',
  expenseDesc: 'وصف المصروف',
  expenseAmount: 'المبلغ بالريال',
  expenseMonth: 'شهر الصرف',
  expenseWho: 'مَن سجَّله',
  addExpense: 'تسجيل مصروف',
  saveExpense: 'حفظ التعديل',
  paidOut: 'مدفوع فعلاً',
  committedNotPaid: 'معتمد لم يُصرف',
  requestedNotApproved: 'مطلوب لم يُعتمد',
  rejectedExpenses: 'مرفوض',
  recordedCost: 'الكلفة المسجّلة',
  actualSpendField: 'المصروف الفعلي المدوَّن',
  suppliers: 'الموردون',
  subscriptions: 'الاشتراكات',
  recurringExpenses: 'مصروفات تتكرر',
  staffingShare: 'التسكين بالنسب الشهرية',
  staffingCostLine: 'كلفة التسكين لكل شخص',
  monthsStaffed: 'أشهر التسكين',
  averageShare: 'المتوسط الشهري',
  yearShare: 'حصة السنة',
  monthlyTotalShare: 'مجموع النِّسَب الشهرية',
  allMonths: 'التغطية الشهرية',
  notRecorded: 'غير مُسجَّل',
  notRecordedF: 'غير مسجّلة',
  restricted: 'مقيَّد',
  restrictedAmounts: 'المبالغ مقيَّدة عن دورك',
  noWritePathYet: 'لا مسار لتسجيله بعد',
  notTrackedYet: 'بلا سجل في المنصة',
  whatIsMissing: 'ما ينقص الصورة',
  pictureComplete: 'لا نقص معلوماً في هذه الصورة',
  whatItNeeds: 'ما يحتاجه التسجيل',
  workaroundNow: 'البديل المتاح اليوم',
  undatedRows: 'بلا شهر مسجَّل',
  showYear: 'سنة العرض',
  otherYearsMovement: 'وللمشروع حركة مسجّلة في',
  moneyLoadFailed: 'تعذّر عرض حركة المال على هذا المشروع',

  // ── المخرجات داخل المشروع ──
  deliverable: 'مخرَج',
  addDeliverable: 'إضافة مخرج',
  deliverableName: 'اسم المخرج',
  deliverableMonth: 'شهر الاستحقاق',
  deliverableAmount: 'القيمة',
  amountUnset: 'غير محدَّدة',
  monthUnset: 'بلا شهر',
  financeOwned: 'تُضبط من المسار المالي',

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

// ── صفة الفرصة التجارية: نوع ارتباطها ونوع طرحها ───────────────────────────────
// «يا إنه تحطها اتفاقية إطارية، وبرضو يكون في مساحة تكون RFI أو RFP» — بلسان المالك.
//
// والاسمان الأجنبيان يبقيان مكتوبين بحروفهما بجانب شرحهما العربي، خلافاً لقاعدة المنصة في
// إخفاء المصطلح التقني: هذان ليسا مصطلحَي برمجيات بل **لغة العطاءات الحكومية** التي يقرؤها
// الفريق في كراسات الشروط كل يوم — و«طلب عرض» وحده لا يميّزه عن «طلب سعر» عند من يعمل بها.
export const ENGAGEMENT_TYPE_AR = {
  PROJECT: 'عمل محدَّد',
  FRAMEWORK: 'اتفاقية إطارية',
};
export const engagementTypeLabel = (v) => ENGAGEMENT_TYPE_AR[String(v || '').toUpperCase()] || 'لم يُحدَّد';
// شرحُ كلٍّ في سطر — يظهر عند الوقوف على الخانة، فلا يُختار نوعٌ بالتخمين.
export const ENGAGEMENT_TYPE_TIP = {
  PROJECT: 'عملٌ محدَّد النطاق والقيمة والمدة — قيمته التزامٌ متوقَّع.',
  FRAMEWORK: 'اتفاقية إطارية يُسحَب منها بأوامر عمل لاحقة — قيمتها سقفٌ لا التزامٌ مؤكَّد.',
};
export const SOLICITATION_TYPE_AR = {
  RFI: 'استطلاع سوق (RFI)',
  RFP: 'طلب عرض (RFP)',
  RFQ: 'طلب سعر (RFQ)',
  DIRECT_AWARD: 'تكليف مباشر',
  TENDER: 'منافسة عامة',
};
export const solicitationTypeLabel = (v) => SOLICITATION_TYPE_AR[String(v || '').toUpperCase()] || 'لم يُحدَّد';
export const SOLICITATION_TYPE_TIP = {
  RFI: 'الجهة تستطلع السوق ولم تطرح بعد — فرصةٌ مبكّرة لا عرضٌ مطلوب.',
  RFP: 'طلب عرضٍ فنّي ومالي على نطاقٍ معلَن.',
  RFQ: 'طلب سعرٍ على نطاقٍ محدَّد سلفاً — المنافسة على السعر غالباً.',
  DIRECT_AWARD: 'تكليفٌ من الجهة بلا منافسة.',
  TENDER: 'منافسة عامة مُعلَنة يتقدّم إليها الجميع.',
};

// ── مستندات الفرصة: لغة العطاء لا لغة المشروع ──────────────────────────────────
// الفرصة قبل الترسية، فأسماء مستنداتها أسماء ما يُتداول في العطاء — لا «عقد» ولا «تقرير».
export const OPP_DOC_KIND_AR = {
  tender: 'إعلان المنافسة',
  rfp_doc: 'كراسة الشروط',
  technical: 'العرض الفني',
  financial: 'العرض المالي',
  correspondence: 'مراسلات',
  other: 'مستند آخر',
};
export const oppDocKindLabel = (v) => OPP_DOC_KIND_AR[String(v || '').toLowerCase()] || 'مستند آخر';

// ── حالات المخرج ومسارها ───────────────────────────────────────────────────────
// دورة عمل واحدة بيد الإنسان، من أول ما يُكتب إلى أن يعتمده العميل. والفوترة والتحصيل **ليستا
// حالتين هنا**: كانتا قيمتين في نفس الخانة، فيكتب إصدارُ المستخلص «مُفوتر» فوق «مقبول» ويُمحى
// أثرُ القبول — ويصير المخرَج المعتمَد من العميل مخرَجاً لا يُعرف أقُبل أم لا. صارتا ختمين
// مستقلين على الصف (تاريخ الفوترة وتاريخ التحصيل) يُقرآن مع الحالة لا بدلاً منها.
export const DELIVERABLE_STATUS_AR = {
  DRAFT: 'مسودة', IN_PROGRESS: 'جارٍ العمل', DELIVERED: 'تم التسليم',
  ACCEPTED: 'تم الاعتماد', REJECTED: 'مُعاد للتعديل',
};
export const deliverableStatusLabel = (s) => DELIVERABLE_STATUS_AR[String(s || '').toUpperCase()] || 'حالة غير محدَّدة';
// الخطوة التالية بنقرة واحدة — من الحالة الراهنة إلى الفعل الطبيعي بعدها (زر واحد ≤ 3 كلمات).
export const DELIVERABLE_NEXT = {
  DRAFT: { to: 'IN_PROGRESS', ar: 'بدء العمل' },
  IN_PROGRESS: { to: 'DELIVERED', ar: 'تسليم' },
  DELIVERED: { to: 'ACCEPTED', ar: 'اعتماد' },
  REJECTED: { to: 'DELIVERED', ar: 'إعادة تسليم' },
};
// الحقائق المالية على المخرَج — ختمان لا حالتان، ولفظُهما يقول إنهما نتيجةُ مسارٍ في المالية.
export const DELIVERABLE_MONEY_AR = { invoiced: 'تمت الفوترة', collected: 'تم التحصيل' };

// ── أيام الأسبوع بالعربية الكاملة ──────────────────────────────────────────────
// الفهرس صفري بمعيار JS (0 = الأحد)، والأسبوع السعودي يبدأ من الأحد — فرؤوس التقويم تُقرأ
// من اليمين: الأحد ثم الاثنين… حتى السبت في أقصى اليسار. القاعدة نفسها المطبَّقة على الأشهر
// في core/i18n/time.js: لا اختصارات عربية إطلاقاً، والاسم الكامل حيث تتسع المساحة.
// الشكل القصير هنا ليس اختصاراً مقطوعاً بل الاسم المفرد المتداول («أحد» لا «أح»).
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAYS_AR_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
export const weekdayLabel = (i, density = 'full') =>
  (density === 'short' ? WEEKDAYS_AR_SHORT : WEEKDAYS_AR)[((Number(i) % 7) + 7) % 7] || '';

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
  // «شخصية» لا «داخلي»: الأولى لصاحبها وحده والثانية عملٌ للشركة بلا مشروع — والخلط بينهما
  // في الكلمة يُغري بالخلط بينهما في الاستعمال، فيكتب المرء ما لا يريد أن يُقرأ حيث يُقرأ.
  personal: 'شخصية',
};
// القائمة بترتيب العرض في نموذج تسجيل الوقت (القيمة المخزَّنة، التسمية العربية)
export const WORK_KIND_OPTIONS = ['project', 'opportunity', 'proposal', 'product', 'internal', 'leave', 'training', 'bd']
  .map((k) => [k, WORK_KIND_AR[k]]);
export const workKindLabel = (k) => WORK_KIND_AR[String(k || '').toLowerCase()] || 'غير محدَّد';

// ── تصنيف المشروع: لمن يُنجَز هذا العمل؟ ───────────────────────────────────────
// القاعدة كلها في مكان واحد: `projectKind` في خدمة المشاريع تُقرّر المفتاح من قرائن الصف،
// وهنا الكلمة العربية وحدها — تماماً كما يفعل «نوع العمل» و«اسم السجل» أعلاه (القاعدة في
// الخدمة، والكلمة في المعجم، والطبقات لا تنعكس).
// قرار المالك في التسمية: لا كيان اسمه «مشاريع داخلية». العمل غير المرتبط بعميل يُقال له
// «تشغيل داخلي»، ومنتجات الشركة يُقال لها «منتج».
export const PROJECT_KIND_AR = {
  client: 'مشروع عميل',
  product: 'منتج',
  internal: 'تشغيل داخلي',
};
export const projectKindLabel = (k) => PROJECT_KIND_AR[String(k || '').toLowerCase()] || 'غير مصنَّف';

// سبب التصنيف بالعربية — يُعرض في تلميح الوسم كي يعرف القارئ من أين جاءت الكلمة، فلا يظنها رأياً.
export const PROJECT_KIND_BASIS_AR = {
  client: 'له عميل مسجَّل',
  internal_client: 'العميل المسجَّل هو الشركة نفسها',
  contract: 'له قيمة تعاقدية مسجَّلة',
  purchase_order: 'له أمر شراء مسجَّل',
  revenue: 'سُجِّل له إيراد محقق',
  opportunity: 'نشأ من فرصة بيع',
  stated_product: 'مسجَّل ضمن منتجات الشركة',
  stated_external: 'مسجَّل عملاً لعميل',
  none: 'لا عميل ولا قيمة تعاقدية ولا إيراد مسجَّل له',
};
export const projectKindBasisLabel = (b) => PROJECT_KIND_BASIS_AR[String(b || '').toLowerCase()] || '';
// تلميح الوسم: التصنيف وسببه؛ وحين يخالف السببُ التصنيفَ القديم المدوَّن على المشروع نقولها
// صراحةً — إخفاء التناقض يجعل التصحيح مستحيلاً، وإظهاره سطراً واحداً يكفي.
export const projectKindTip = ({ key, basis, stale } = {}) => {
  const why = projectKindBasisLabel(basis);
  const head = `التصنيف: ${projectKindLabel(key)}${why ? ` — ${why}` : ''}`;
  return stale ? `${head}. التصنيف المدوَّن على المشروع منذ نقل المنصة يقول غير ذلك ولم يُصحَّح بعد.` : head;
};

// اسم السجل المرتبط بطلب اعتماد أو حدث تدقيق — بدل طباعة اسم الجدول الإنجليزي.
export const RESOURCE_AR = {
  activity: 'نشاط تواصل', allocation: 'تسكين', app_user: 'مستخدم', approval: 'اعتماد',
  approval_request: 'طلب اعتماد', client: 'عميل', contact: 'جهة اتصال', contract: 'عقد',
  cost: 'تكلفة', deliverable: 'مخرج', department: 'إدارة', document: 'مستند',
  employee: 'موظف', expense: 'مصروف', import_run: 'عملية استيراد', invoice: 'فاتورة',
  issue: 'معوّق', login_code: 'رمز دخول', margin: 'هامش', milestone: 'معلم', notification: 'إشعار',
  opp_team: 'فريق فرصة', opportunity: 'فرصة', project: 'مشروع', proposal: 'عرض',
  report: 'تقرير', report_schedule: 'جدولة تقرير', revenue_line: 'بند إيراد', risk: 'خطر',
  saved_view: 'عرض محفوظ', sector: 'قطاع', session: 'جلسة دخول', task: 'مهمة',
  timesheet: 'سجل وقت', unit: 'وحدة',
};
export const resourceLabel = (r) => RESOURCE_AR[String(r || '').toLowerCase()] || 'سجل';

// أسماء التقارير الستة — تُعرض من هنا لا من الاسم المخزَّن، لأن قواعد قائمة تحمل أسماءً قديمة
// فيها اختصارات إنجليزية («تقرير حالة المشروع (RAG)») ولا توجد شاشة لإعادة تسميتها.
export const REPORT_NAME_AR = {
  weekly_exec_brief: 'الموجز التنفيذي الأسبوعي',
  sector_weekly_status: 'حالة القطاع الأسبوعية',
  monthly_sector_performance: 'أداء القطاع الشهري',
  project_status_report: 'تقرير حالة المشروع',
  workforce_utilization: 'تقرير القوى العاملة والإشغال',
  opportunity_pipeline: 'تقرير خط الفرص',
};
export const reportName = (key, stored) => REPORT_NAME_AR[key] || stored || 'تقرير';

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
  // «عُوينت» و«حُجبت» تفصلان ما لم يكن مفصولاً: رسالةٌ كُتبت للمعاينة، وأخرى منعها حارس
  // العناوين — وكلتاهما كانت تُعرض «أُرسلت» فيبدو الطابور ناجحاً وما غادرت رسالة.
  PREVIEWED: 'عُوينت ولم تُرسل', BLOCKED: 'حُجبت — عنوان غير مسموح',
};
export const mailStatusLabel = (s) => MAIL_STATUS_AR[String(s || '').toUpperCase()] || 'حالة غير معروفة';

// لون الحالة في مكان واحد — كانت كل شاشة تختار لونها فتختلف الشاشتان على الرسالة نفسها.
// الأخضر للمغادرة الفعلية وحدها؛ فلا يُقرأ «عُوينت» نجاحاً.
export const MAIL_STATUS_TONE = {
  SENT: 'green', FAILED: 'red', BLOCKED: 'amber', PREVIEWED: 'slate',
  QUEUED: 'blue', SENDING: 'blue', PROCESSING: 'blue', CANCELLED: 'slate',
};
export const mailStatusTone = (s) => MAIL_STATUS_TONE[String(s || '').toUpperCase()] || 'slate';

// أحداث سجل البريد كما تُخزَّن (enqueued/sent/failed) — تُعرض بمعناها.
export const MAIL_EVENT_AR = {
  enqueued: 'بانتظار الإرسال', sending: 'جارٍ الإرسال', sent: 'أُرسلت',
  failed: 'تعذّر الإرسال', retry: 'إعادة محاولة', skipped: 'تم تجاوزها', cancelled: 'أُلغيت',
  previewed: 'عُوينت ولم تُرسل', blocked: 'حُجبت — عنوان غير مسموح',
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
