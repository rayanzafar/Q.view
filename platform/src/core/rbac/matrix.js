// Canonical role → permission matrix (source of truth seeded into role_permission).
// Admin can edit grants later from the UI; this is the default least-privilege baseline.
// Grant = { resource, action, scope }. action: read|create|update|delete|approve|export|admin
// scope: company|sector|department|project|team|own

// Sensitive pseudo-resources gate field-level access (see redactor):
//   salary (individual pay), margin (profit %), cost (actual spend/cost lines), ip (login IPs)
export const SENSITIVE_FIELDS = {
  employee: { salary_halalas: 'salary' },
  project: { actual_spend_halalas: 'cost', margin_pct: 'margin' },
  proposal: { margin_pct: 'margin' },
  pricing_line: { unit_cost_halalas: 'cost' },
  service_package: { cost_halalas: 'cost' },
  expense: { amount_halalas: 'cost' },
  cost_line: { amount_halalas: 'cost' },
  app_user: { ip: 'ip' },
  login_history: { ip: 'ip' },
};

const OPERATIONAL = ['client', 'contact', 'opportunity', 'proposal', 'project', 'task',
  'milestone', 'deliverable', 'risk', 'issue', 'service', 'allocation'];

// helper builders
const crud = (resources, scope, actions = ['read', 'create', 'update']) =>
  resources.flatMap((r) => actions.map((a) => ({ resource: r, action: a, scope })));
const read = (resources, scope) => resources.map((r) => ({ resource: r, action: 'read', scope }));

export const ROLE_GRANTS = {
  admin: [{ resource: '*', action: 'admin', scope: 'company' }], // wildcard — full access + all sensitive

  ceo_office: [
    ...read(['sector', 'department', 'employee', ...OPERATIONAL, 'contract', 'invoice', 'collection',
      'budget', 'revenue_line', 'report', 'kpi', 'audit'], 'company'),
    // يعلو قادة القطاعات في التسلسل الهرمي ⟵ يدير هيكل أي قطاع (إدارات ووحدات) لا قطاعاً بعينه.
    // إنشاء/حذف القطاع نفسه يبقى لمدير النظام — قرار بنية شركة.
    { resource: 'department', action: 'admin', scope: 'company' },
    // ويعدّل المشروع ومخرجاته: «مدير المشروع **ومن فوقه** يقدر يعدلها ويشوف» — ومكتب الرئيس
    // التنفيذي فوقه. وكان يقرأ كل شيء ولا يعدّل مشروعاً واحداً، فيرى الخلل ولا يملك تصحيحه.
    // **تعديلٌ لا إنشاء ولا حذف**: القرار المنقول «يعدّلها ويشوف» حرفياً، وإنشاءُ المشروع يبدأ من
    // الفرصة عند تطوير الأعمال وقائد القطاع، وحذفُه لا رجعة فيه فيبقى لصاحب القطاع ومدير النظام.
    ...crud(['project', 'milestone', 'deliverable', 'project_phase'], 'company', ['read', 'update']),
    { resource: 'deliverable', action: 'approve', scope: 'company' },
    // ── ما ورثه عن «المالية» بعد إلغاء الدور ────────────────────────────────────
    // قرار مالك: «الإدارة المالية ما لها علاقة من المنصة، احذفهم» — ولا فريق مالية في الشركة
    // أصلاً. وحذف الدور وحده يترك ثقباً لا يملأه أحد: تسجيل التحصيل واعتماد المصروف وإصدار
    // الفاتورة على مستوى الشركة كانت كلها منحاً لهذا الدور وحده (وللمصفوفة الشاملة عند مدير
    // النظام). ومدير النظام وظيفة تقنية لا وظيفة عمل، فلا يصحّ أن يبقى المال معلَّقاً عليه.
    // فالسلطة تصعد إلى أعلى ما بقي: مكتب الرئيس التنفيذي. وهي كتابةٌ على أرقامٍ يقرؤها أصلاً
    // منذ اليوم الأول — لا نافذة بيانات جديدة، بل قدرةٌ على تصحيح ما يراه.
    ...crud(['contract', 'invoice', 'collection', 'revenue_line', 'expense', 'contract_payment'],
      'company', ['create', 'update']),
    { resource: 'invoice', action: 'approve', scope: 'company' },
    { resource: 'expense', action: 'approve', scope: 'company' },
    { resource: 'expense', action: 'read', scope: 'company' },
    { resource: 'contract_payment', action: 'read', scope: 'company' },
    // وأوامر الشراء **قراءةً** فقط: كتابتها عند «المشتريات» ولم تتغيّر — والدور المُلغى كان
    // يقرؤها لأن الصرف على الشركة لا يُقرأ ناقصاً. فبلا هذا السطر يُقرأ سجل المشتريات «مقيَّداً»
    // على شاشة مال المشروع لمن يملك المال كلّه.
    { resource: 'purchase_order', action: 'read', scope: 'company' },
    { resource: 'report', action: 'export', scope: 'company' },
    // exec sees company margins/cost/revenue (aggregate), not individual salary or IPs
    { resource: 'margin', action: 'read', scope: 'company' },
    { resource: 'cost', action: 'read', scope: 'company' },
  ],

  sector_lead: [
    ...crud(OPERATIONAL, 'sector', ['read', 'create', 'update', 'delete']),
    ...crud(['budget', 'revenue_line', 'contract', 'invoice', 'expense'], 'sector'),
    // والتحصيل معها: كان منح «التحصيل» حصراً على دور المالية المُلغى، فبلا هذا السطر لا يستطيع
    // أحد — سوى مدير النظام — أن يسجّل ريالاً وصل. وقائد القطاع يفوتر عقود قطاعه أصلاً، فتسجيل
    // ما حُصِّل منها امتدادٌ لعمله لا سلطة جديدة. (ويبقى بعيداً عن مدير المشروع بقرار مالك سابق.)
    ...crud(['collection'], 'sector'),
    { resource: 'opportunity', action: 'approve', scope: 'sector' },
    { resource: 'proposal', action: 'approve', scope: 'sector' },
    { resource: 'expense', action: 'approve', scope: 'sector' },
    { resource: 'deliverable', action: 'approve', scope: 'sector' },
    { resource: 'timesheet', action: 'approve', scope: 'sector' },
    ...read(['employee', 'department', 'team', 'report', 'kpi'], 'sector'),
    // Sector manager owns their people roster (add/edit member, assign to projects).
    // Salary is NOT among their grants: sealed platform-wide until the Odoo integration lands
    // (owner decision) — see SEALED_GATES in core/rbac/index.js.
    { resource: 'employee', action: 'create', scope: 'sector' },
    { resource: 'employee', action: 'update', scope: 'sector' },
    // يملك هيكل قطاعه بالكامل: يضيف الإدارات ويعيد تسميتها ويعطّلها حسب حاجته التشغيلية
    // (خدمية كالمدن الذكية، أو مكتب إدارة مشاريع، أو تطوير أعمال داخل القطاع…) بلا انتظار أحد.
    { resource: 'department', action: 'admin', scope: 'sector' },
    { resource: 'allocation', action: 'create', scope: 'sector' },
    { resource: 'allocation', action: 'update', scope: 'sector' },
    { resource: 'report', action: 'export', scope: 'sector' },
    { resource: 'margin', action: 'read', scope: 'sector' },
    { resource: 'cost', action: 'read', scope: 'sector' },
  ],

  // منح التقارير هنا يعالج **عكس** العطل الموصوف تحت «المدير المباشر»: هذان الدوران كانا
  // مفتوحَين صفّياً ومغلقَين صفحياً. فمحرك التقارير الدوري يقيس **اتساع** المنح لا وجودها
  // (`widthAtLeast` في `core/reports/periods.js`)، ومصادره الثلاثة تشمل «الموظفين» — فكلا
  // المديرَين يجتاز حارس عدسة «الإدارة» وعدسة «الشخص» لأهل إدارته أصلاً، ثم يُرَدّ ٤٠٣ على باب
  // الصفحة نفسها (`PAGE_ACCESS.reports`) فلا يبلغ ما يحق له. أي أن ثمرة الإسناد الإداري كانت
  // محسوبة ولا يفتحها من بُنيت له. والتصدير لم يُمنح لأيٍّ منهما: الملف يخرج من المنصة ولا
  // يُسترجَع. («المدير المباشر» أدناه بقي على النطاق «إدارة» كما كُتب هنا.)
  //
  // ── «مدير الإدارة»: عملُه بنطاق إدارته، وأرقامُ قطاعه أمامه ──────────────────────
  // قرارا مالكٍ متعاقبان التقيا على هذا الدور، وكلاهما عن **شاشةٍ يدخلها ولا يجد فيها ما بُنيت
  // له**:
  //
  // ① «حساب ريان مو شايف ولا فرصة، الخانة كلها مو موجودة» — و«فرصة» كانت غائبة عن منحه
  //    إطلاقاً. وأثر الغياب ليس قائمةً فارغة بل **اختفاء الخانة**: بوابة الصفحة تمرّ بوجود منحٍ
  //    على المورد، فبلا منحٍ لا مدخل ولا شاشة. فأُضيف مسار البيع كاملاً — والفرصةُ بلا عميلها
  //    نصفُ معلومة، فمعها العميل وجهة الاتصال والعرض والخدمة.
  //    والنطاق «الإدارة» هنا يعطيه **فرص قطاعه كلها** فعلاً: تضييق القوائم إلى الإدارة غير
  //    مفعَّل في scope.js (موثَّق هناك). ولو كُتب «القطاع» صراحةً لانتقل الدور في الدليل إلى
  //    فئة «نطاقه القطاع» فوُصف بما لا ينطبق على الأشخاص والكشوف — فتُوسَّع رؤيته للناس بلا
  //    طلب. الأثر واحد والحدّ محفوظ.
  //
  // ② «لازم مدير الإدارة يشوف مركز القطاع من ناحية ربح وكم الإيراد وكم من التارقيت وكل الأمور
  //    هذه» — وكان الباب مفتوحاً والغرفة فارغة: `PAGE_ACCESS.sector` يمرّره (يقرأ المشاريع)، ثم
  //    تسقط الشاشة إلى وجهها الشخصي «قطاعي» لأن اتساع منحه لا يبلغ القطاع، ولا هامش عنده ولا
  //    كلفة. مديرُ إدارةٍ يخطّط عمل فريقه على ربح القطاع ومستهدفه، فإخفاؤهما يجعله يخطّط بلا رقم.
  //      • `report`/`kpi` بنطاق **قطاع**: اتساعٌ يبلغ عدسة القطاع في محرك التقارير ويفتح مركز
  //        قيادته — الإيراد والمبيعات والمستهدفات وخط الفرص. (ولذلك خرجت «report» من قائمة
  //        الإدارة أدناه: صارت أوسع، لا أنها سقطت.)
  //      • `margin`/`cost` بنطاق **قطاع**: الربح والكلفة يصلانه فعلاً بدل أرقام محجوبة.
  //
  // **والحدّ في الحالتين واحد**: الاتساع في **الأرقام** لا في **الأشخاص**. الكتابة والاعتماد
  // وقراءةُ الناس وملفاتهم ومهامّهم تبقى بنطاق «إدارة» حرفاً بحرف — ولا راتب بأي شكل (مختوم
  // لمدير النظام وحده حتى تكامل Odoo)، ولا لوحة قيادة شركة (`seesCompanyPerformance` تشترط
  // اتساعاً شركياً). والفحوص تحرس الحدّين معاً.
  // «المسؤولية على الأشخاص في التعديل والتسكين بدءاً من مدير المشروع واللي فوقه، كلهم يشوفوا
  // أو يعدّلوا — مثل مدير إدارة أو مدير قطاع» — بلسان المالك.
  //
  // وكان مدير الإدارة **بلا منحِ كتابةٍ واحد** على المشروع ولا على الفرصة: يقرأ كل شيء ولا يحرّك
  // شيئاً. والأثر لم يكن نظرياً — شاشة المشروع تحسب `can(update, project)` فتُعلن «للقراءة فقط
  // بدورك الحالي»، فمديرُ إدارةٍ يقود المشروع كلَّه لا يستطيع أن يعلن تسليم مخرَجٍ سلّمه فريقه،
  // ولا أن يسكّن أحداً عليه، ولا أن يفتح فرصةً لإدارته. فيُدار العمل خارج المنصة أو من خلف الشاشة.
  //
  // النطاق **الإدارة** لا القطاع: يكتب على ما يحمل معرّف إحدى إداراته (المشروع والفرصة والتسكين
  // والمهمة تحمله كلها منذ الموجة 007/010)، ولا يمسّ إدارةً أخرى ولو في قطاعه.
  //
  // والحدود مقصودة: **لا حذف ولا إنشاء مشروع** — الحذف لا رجعة فيه فيبقى لقائد القطاع ومدير
  // النظام، وإنشاء المشروع يبدأ من فرصةٍ مكسوبة. وهو نفس ما رُسم لمكتب الرئيس التنفيذي أعلاه.
  department_manager: [
    ...read(['client', 'contact', 'proposal', 'service'], 'department'),
    ...read(['employee', 'timesheet'], 'department'),
    // ── التسليم: يقرأ ويعدّل ما تحت يده ──
    ...crud(['project', 'milestone', 'deliverable', 'project_phase', 'risk', 'issue'], 'department',
      ['read', 'update']),
    { resource: 'deliverable', action: 'approve', scope: 'department' },
    // المخرَج يُضاف ويُشطب مع تغيّر النطاق — وهما وجها إدارة التسليم نفسها لا سلطة إضافية.
    ...crud(['milestone', 'deliverable', 'project_phase'], 'department', ['create', 'delete']),
    // ── التسكين: «التعديل والتسكين» معاً في جملة المالك ──
    ...crud(['allocation'], 'department', ['read', 'create', 'update', 'delete']),
    // ── الفرص: فرصةُ إدارته تُفتح وتتحرّك مراحلها بيده ──
    // «لازم في طريقة أقدر أضيف الفرص والحالة تبعها» — والقراءة وحدها كانت تجعل الإدارة تُنسب
    // إليها الفرص في التقارير آخر السنة ولا تملك إدخال واحدة منها.
    ...crud(['opportunity'], 'department', ['read', 'create', 'update']),
    ...crud(['task'], 'department', ['read', 'create', 'update']),
    { resource: 'task', action: 'approve', scope: 'department' },
    { resource: 'timesheet', action: 'approve', scope: 'department' },
    { resource: 'expense', action: 'approve', scope: 'department' },
    ...read(['report', 'kpi'], 'sector'),
    { resource: 'margin', action: 'read', scope: 'sector' },
    { resource: 'cost', action: 'read', scope: 'sector' },
  ],

  // «المدير المباشر» — منحُه كان كلّه بنطاق «الفريق»، وهو نطاق **لا يمكن اجتيازه إطلاقاً**: فحصه
  // يشترط أن يحمل الهدف معرّف فريق، ولا مستدعي واحد في المنصة يضبطه، ومجموعة فرق المستخدم تُبنى
  // فارغة دائماً — لأن جدول الفرق أثريّ لا يكتب فيه المنتج شيئاً. فكان الدور **معطَّلاً صفّياً
  // ومفتوحاً صفحياً** في آن: يفشل كل فحص صف، ويجتاز فحص الصفحة (الذي يمرّ بمجرد وجود منح) فيرى
  // قائمة القطاع كاملة. والأسوأ أثراً أن مسار اعتماد كشوف الدوام يوجّه خطوته الأولى إليه: فيصل
  // الطلب إلى قائمته ويظهر في شاشته، ثم يُرَد ٤٠٣ عند التصرّف — طريق مسدود يبتلع كشوف الفريق.
  //
  // النطاق هنا «الإدارة»: هي أصغر وحدة تنظيمية يحملها الموظف فعلاً وتُحسم من بياناته، فيصير
  // المنح قابلاً للتحقق. والتبعية الإدارية الحقيقية (من يرفع لمن، عمود `line_manager_id`) تبقى
  // بُعداً للعرض لا محور صلاحيات — قرار مقصود: محور رابع يمسّ كل استعلام في منصة قيد الاستخدام.
  line_manager: [
    ...read(['employee', 'task', 'timesheet', 'report'], 'department'),
    { resource: 'timesheet', action: 'approve', scope: 'department' },
  ],

  // مدير المشروع يملك **مالية مشروعه** — قرار مالك صريح: «مدير المشروع ومن فوقه يقدر يعدلها
  // ويشوف». وكان لا يقرأ عقد مشروعه ولا فاتورةً واحدة عليه، فيدير تسليماً لا يعرف قيمته ولا ما
  // طُولب به. وأشدُّ منه أثراً أنه **لا يستطيع إصدار مستخلص** على مخرَجٍ سلّمه — ولا فريق مالية
  // في الشركة يفعلها عنه، فيبقى المخرَج مُسلَّماً بلا مطالبة إلى أن يتذكّره أحد.
  // والنطاق **مشروع** لا شركة: يرى مال مشاريعه وحدها، ولا تفتح له شاشة مالية الشركة (بوابتها
  // تشترط نطاقاً أوسع — انظر core/policy/pages.js). والتحصيل ليس له: شأن الإدارة المالية.
  project_manager: [
    ...crud(['project', 'task', 'milestone', 'deliverable', 'risk', 'issue', 'allocation'], 'project',
      ['read', 'create', 'update']),
    { resource: 'deliverable', action: 'approve', scope: 'project' },
    { resource: 'task', action: 'approve', scope: 'project' },
    ...read(['budget', 'report', 'kpi'], 'project'),
    ...read(['contract', 'revenue_line', 'contract_payment'], 'project'),
    { resource: 'invoice', action: 'read', scope: 'project' },
    { resource: 'invoice', action: 'create', scope: 'project' }, // المستخلص على مخرَجٍ سلّمه
  ],

  // «مدير تطوير الأعمال» — كان يقود فرص قطاعه ولا يرى إنساناً واحداً.
  // كشفه تدقيقٌ على سؤال المالك «كل مدير يقدر يشوف موظفينه، ولو ضغط على كل موظف يطلع شغال على
  // شي»: هذا الدور وحده — من بين كل من يحمل كلمة «مدير» — يسقط على السؤال. ولا منح **موظف**
  // له ولا منح **مهمة**، فتنغلق عليه ثلاثة أبواب دفعةً واحدة: شاشة «الفريق» (بوابتها قراءة
  // الموظف)، وعدسة الفريق في «مهامي» (بوابتها قراءة المهمة)، وصفحةُ أي شخص. وهو يسكّن الناس
  // على فرصه فعلاً (التسكين بوابته `update opportunity` وهي عنده) — أي أنه **يسكّن من لا يراه**.
  //
  // والاتساع «القطاع» لا الشركة: هو مدير تطوير أعمالٍ **داخل قطاع** (بخلاف رئيس تطوير الأعمال
  // أعلاه، ونطاقه شركي في كل منح) — فيقرأ أهل قطاعه ومهامهم، لا أهل الشركة.
  // و**قراءةً فقط**: لا إنشاء موظف ولا تعديله ولا كتابة مهمة على أحد. الرؤية تفتح شاشة، والكتابة
  // على الناس تبقى حيث هي — عند مدير الإدارة وقائد القطاع والموارد البشرية.
  // ولا راتب: الختم على مستوى المنصة لمدير النظام وحده حتى تكامل Odoo، ولا يُفتح لدور جديد.
  bd_manager: [
    ...crud(['opportunity', 'client', 'contact', 'proposal', 'pricing_line', 'service'], 'sector',
      ['read', 'create', 'update']),
    ...read(['project', 'report', 'kpi'], 'sector'),
    ...read(['employee', 'task'], 'sector'),
  ],

  // رئيس تطوير الأعمال — وحدة مساندة على مستوى **الشركة** لا داخل قطاع واحد: يعمل على فرص
  // القطاعات الأربعة كلها ويسكّن عليها فِرقاً، فنطاقه «شركة» في كل منح. قرار المالك حرفياً:
  // «كل شيء إلا الرواتب». ترجمة القرار إلى منح صريحة لا إلى منح شامل:
  //   • العمل التشغيلي (الفرص والعملاء والمشاريع والمهام والتسكين…): قراءة وإنشاء وتعديل.
  //     بلا **حذف**: إزالة عمل قائم قرار لا رجعة فيه يبقى لصاحب القطاع ولمدير النظام.
  //     وبلا **اعتماد**: الاعتماد فعل حوكمة يخص من يملك القرار في القطاع، لا من يقود المسار.
  //   • المال (العقود والفواتير والتحصيل والموازنات والإيراد): قراءة فقط — يحتاج الرقم ليقود
  //     تطوير الأعمال، ولا يحتاج أن يكتبه.
  //   • هامش الربح والكلفة على مستوى الشركة: مكشوفان له صراحةً كما لمكتب الرئيس التنفيذي.
  //   • **لا منح راتب بأي شكل**: الراتب مختوم لمدير النظام وحده بقرار مالك سابق حتى يتم التكامل
  //     مع Odoo. الختم لا يُفتح لدور جديد مهما اتسعت مسؤوليته — والاختبار يحرس ذلك.
  //   • لا إدارة نظام: لا إنشاء قطاع ولا حذفه ولا أي منح شامل — بنية الشركة قرار مدير النظام.
  bd_head: [
    ...crud(OPERATIONAL, 'company'),                       // قراءة + إنشاء + تعديل (لا حذف)
    ...crud(['pricing_line'], 'company'),                  // تسعير العروض جزء أصيل من عمله
    ...read(['sector', 'department', 'employee'], 'company'), // مورد الشركة كاملاً أمامه للتسكين
    ...read(['contract', 'invoice', 'collection', 'budget', 'revenue_line', 'report', 'kpi'], 'company'),
    { resource: 'report', action: 'export', scope: 'company' },
    { resource: 'margin', action: 'read', scope: 'company' },
    { resource: 'cost', action: 'read', scope: 'company' },
  ],

  // ── «المالية» دورٌ مُلغى — لا يُعاد ────────────────────────────────────────────
  // كان هنا دورٌ بنطاق **شركة** على المال كلّه: الفواتير والتحصيل والمصروفات وسطور الكلفة
  // والإيراد والموازنات والعقود ودفعاتها وأوامر الشراء، مع اعتماد المصروف واعتماد الفاتورة،
  // وقراءةِ الهامش والكلفة عبر الشركة. وقرار المالك أنه لا وجود لهذه الإدارة في الشركة:
  // «مافي الآن فريق في المالية فأي أحد عنده أكسس على الموضوع»، ثم «الإدارة المالية ما لها
  // علاقة من المنصة، احذفهم» — ثم حدّده: **الإدارة المالية على مستوى الشركة تُحذف، وإدارة
  // مالية المشروع تبقى** لمدير المشروع ومن فوقه، ولا يراها موظفٌ مسكَّن على المشروع.
  //
  // فأين ذهبت سلطته: مالية **المشروع** إلى مدير المشروع (قراءة عقده وفواتيره وإصدار مستخلصه)،
  // ومالية **القطاع** إلى قائد القطاع (وقد نقصه التحصيل فأُضيف)، ومالية **الشركة** إلى مكتب
  // الرئيس التنفيذي. وأوامر الشراء عند «المشتريات» أصلاً. ولم يُنقل منه شيء إلى مدير المشروع
  // من التحصيل — قرار مالك صريح: «التحصيل تبع المالية، ما له علاقة بإدارة المشروع».
  //
  // ولا تُضِف `finance` هنا مرّة أخرى: الترحيلة ٠١٨ حذفت الدور من قاعدة البيانات ونقلت من كان
  // يحمله وخطوات الاعتماد التي كانت تشير إليه. وإعادةُ المفتاح إلى هذه الخريطة تُنشئ الدور من
  // جديد عند أول بذرة (`seed-rbac.js` تُدرج كل مفتاح غائب) — أي أن العطل يعود بلا أن يقرّره أحد.
  // والاختبار `tests/security/finance-role-retired.test.js` يحرس ذلك.

  procurement: [
    ...crud(['supplier', 'purchase_order'], 'company'),
    ...read(['project', 'expense'], 'company'),
  ],

  hr: [
    ...crud(['employee', 'position', 'department', 'unit', 'team'], 'company'),
    { resource: 'employee', action: 'delete', scope: 'company' }, // HR owns the staff roster: offboard/remove
    // NOTE: no salary grant — sealed platform-wide until the Odoo integration (owner decision).
    ...read(['timesheet', 'report', 'kpi'], 'company'),
  ],

  operations: [
    ...crud(['project', 'task', 'allocation', 'milestone', 'deliverable'], 'sector'),
    ...read(['report', 'kpi'], 'sector'),
  ],

  consultant: [
    ...read(['project', 'task', 'deliverable'], 'project'),
    { resource: 'opportunity', action: 'read', scope: 'own' }, // opportunity has no project link

    { resource: 'task', action: 'create', scope: 'own' },
    { resource: 'task', action: 'update', scope: 'own' },
    { resource: 'timesheet', action: 'create', scope: 'own' },
    { resource: 'timesheet', action: 'update', scope: 'own' },
  ],

  employee: [
    { resource: 'task', action: 'read', scope: 'own' },
    { resource: 'task', action: 'create', scope: 'own' },
    { resource: 'task', action: 'update', scope: 'own' },
    { resource: 'timesheet', action: 'read', scope: 'own' },
    { resource: 'timesheet', action: 'create', scope: 'own' },
    { resource: 'timesheet', action: 'update', scope: 'own' },
    { resource: 'project', action: 'read', scope: 'project' }, // projects they are a member of
    { resource: 'notification', action: 'read', scope: 'own' },
  ],

  approver: [
    { resource: 'opportunity', action: 'approve', scope: 'sector' },
    { resource: 'expense', action: 'approve', scope: 'sector' },
    { resource: 'deliverable', action: 'approve', scope: 'sector' },
  ],

  viewer: [
    ...read(['sector', ...OPERATIONAL, 'report', 'kpi'], 'sector'),
  ],

  external: [
    { resource: 'project', action: 'read', scope: 'own' },
    { resource: 'invoice', action: 'read', scope: 'own' },
  ],
};

// ── وقتُ المرء على عمله: حقٌّ لكل موظف، لا امتياز دور ──────────────────────────
// منتج شركة استشارية هو ساعات خبرائها، ومع ذلك كان تسجيل الوقت ممنوحاً لثلاثة أدوار فقط
// (مدير النظام والمستشار والموظف). فثلاثة عشر دوراً — من قائد القطاع إلى مدير المشروع إلى
// المالية — تُفتح لهم صفحة سجل الوقت ونموذجُها، ويُرَدّون عند الحفظ. الصفحة تَعِد بما يرفضه
// الخادم، وهو أسوأ من منعٍ صريح. (لم يظهر العطل قبل اليوم لأن الحفظ كان بلا فحص أصلاً —
// فلمّا وُضِع الفحص في موضعه ظهر نقصُ المنح تحته.)
//
// القاعدة تُكتب مرة واحدة هنا بدل نثرها في أحد عشر مدخلاً تتفرّق مع الوقت: كل دور موظَّف
// يسجّل **وقته هو** بنطاق «خاصتي». والمستثنى اثنان بقصد:
//   • `external` — حساب بوابة عميل، ليس موظفاً في EVC فلا وقت له عليها.
//   • `viewer`   — حساب مشاهدة للاطلاع، لا يُنتِج عملاً فلا يسجّل ساعات.
// «خاصتي» تعني الفحص على صف المستخدم نفسه: لا أحد يسجّل وقتاً باسم غيره بهذا المنح.
const NON_STAFF_ROLES = new Set(['external', 'viewer']);
for (const [roleId, grants] of Object.entries(ROLE_GRANTS)) {
  if (roleId === 'admin' || NON_STAFF_ROLES.has(roleId)) continue;
  for (const action of ['read', 'create', 'update']) {
    if (!grants.some((g) => g.resource === 'timesheet' && g.action === action && g.scope === 'own'))
      grants.push({ resource: 'timesheet', action, scope: 'own' });
  }
}

export const ROLE_LABELS = {
  admin: { ar: 'مدير النظام', en: 'System Admin' },
  ceo_office: { ar: 'مكتب الرئيس التنفيذي', en: 'CEO Office' },
  sector_lead: { ar: 'قائد قطاع', en: 'Sector Lead' },
  department_manager: { ar: 'مدير إدارة', en: 'Department Manager' },
  line_manager: { ar: 'مدير مباشر', en: 'Line Manager' },
  project_manager: { ar: 'مدير مشروع', en: 'Project Manager' },
  bd_manager: { ar: 'مدير تطوير الأعمال', en: 'BD Manager' },
  bd_head: { ar: 'رئيس تطوير الأعمال', en: 'Head of Business Development' },
  procurement: { ar: 'المشتريات', en: 'Procurement' },
  hr: { ar: 'الموارد البشرية', en: 'HR' },
  operations: { ar: 'العمليات', en: 'Operations' },
  consultant: { ar: 'استشاري', en: 'Consultant' },
  employee: { ar: 'موظف', en: 'Employee' },
  approver: { ar: 'معتمِد', en: 'Approver' },
  viewer: { ar: 'مشاهدة فقط', en: 'Viewer' },
  external: { ar: 'مستخدم خارجي', en: 'External' },
};

// Scope ordering: higher includes lower for read purposes.
export const SCOPE_RANK = { company: 5, sector: 4, department: 3, project: 2, team: 2, own: 1 };
