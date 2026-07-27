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
    { resource: 'report', action: 'export', scope: 'company' },
    // exec sees company margins/cost/revenue (aggregate), not individual salary or IPs
    { resource: 'margin', action: 'read', scope: 'company' },
    { resource: 'cost', action: 'read', scope: 'company' },
  ],

  sector_lead: [
    ...crud(OPERATIONAL, 'sector', ['read', 'create', 'update', 'delete']),
    ...crud(['budget', 'revenue_line', 'contract', 'invoice', 'expense'], 'sector'),
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

  department_manager: [
    ...read(['employee', 'project', 'task', 'timesheet', 'deliverable'], 'department'),
    { resource: 'task', action: 'update', scope: 'department' },
    { resource: 'timesheet', action: 'approve', scope: 'department' },
    { resource: 'expense', action: 'approve', scope: 'department' },
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
    ...read(['employee', 'task', 'timesheet'], 'department'),
    { resource: 'timesheet', action: 'approve', scope: 'department' },
  ],

  project_manager: [
    ...crud(['project', 'task', 'milestone', 'deliverable', 'risk', 'issue', 'allocation'], 'project',
      ['read', 'create', 'update']),
    { resource: 'deliverable', action: 'approve', scope: 'project' },
    { resource: 'task', action: 'approve', scope: 'project' },
    ...read(['budget', 'report', 'kpi'], 'project'),
  ],

  bd_manager: [
    ...crud(['opportunity', 'client', 'contact', 'proposal', 'pricing_line', 'service'], 'sector',
      ['read', 'create', 'update']),
    ...read(['project', 'report', 'kpi'], 'sector'),
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

  finance: [
    ...crud(['invoice', 'collection', 'expense', 'cost_line', 'revenue_line', 'budget', 'contract',
      'contract_payment', 'purchase_order'], 'company'),
    { resource: 'expense', action: 'approve', scope: 'company' },
    { resource: 'invoice', action: 'approve', scope: 'company' },
    ...read(['project', 'client', 'opportunity', 'report', 'kpi'], 'company'),
    { resource: 'report', action: 'export', scope: 'company' },
    { resource: 'margin', action: 'read', scope: 'company' },
    { resource: 'cost', action: 'read', scope: 'company' },
  ],

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

export const ROLE_LABELS = {
  admin: { ar: 'مدير النظام', en: 'System Admin' },
  ceo_office: { ar: 'مكتب الرئيس التنفيذي', en: 'CEO Office' },
  sector_lead: { ar: 'قائد قطاع', en: 'Sector Lead' },
  department_manager: { ar: 'مدير إدارة', en: 'Department Manager' },
  line_manager: { ar: 'مدير مباشر', en: 'Line Manager' },
  project_manager: { ar: 'مدير مشروع', en: 'Project Manager' },
  bd_manager: { ar: 'مدير تطوير الأعمال', en: 'BD Manager' },
  bd_head: { ar: 'رئيس تطوير الأعمال', en: 'Head of Business Development' },
  finance: { ar: 'المالية', en: 'Finance' },
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
