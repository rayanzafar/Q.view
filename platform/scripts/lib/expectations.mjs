// Single source of truth for the quality harness: demo roles, the page map, API probes and the
// per-role EXPECTED HTTP status for each — shared by tests/security/permissions-matrix.test.js
// and scripts/sweep.mjs so the two can never drift apart.
//
// Every cell below was verified empirically against the running app (2026-07-20) and cross-checked
// against src/core/rbac/matrix.js grants. The design deliberately returns 200-with-scoped-content
// (empty lists / zeroed aggregates) for list endpoints instead of 403 — the scope filter fails
// closed at the SQL level ('1=0'), so a 200 here is not a leak. Hard 403s appear where a service
// guards the whole resource (org roster/tree) or a row is out of the caller's scope (IDOR probes).
import { DEMO_PW } from '../seed.js';

export { DEMO_PW };

// The 17 demo personas seeded by scripts/seed.js — ONE PER ROLE in src/core/rbac/matrix.js
// (username → role + REAL scope/sector, so PAGE_ACCESS predicates evaluate against the same shape
// the server resolves at login). Seven of these (department_manager, line_manager, bd_head,
// operations, procurement, approver, external) had no account until 2026-07-27, which meant no
// sweep, no matrix cell and no leak scan ever touched them. Keep this list in lock-step with
// DEMO_USERS in scripts/seed.js — tests/security/role-coverage.test.js fails if they drift.
export const ROLES = [
  { username: 'demo.admin', role: 'admin', scope: 'company', sector_id: null },
  { username: 'demo.ceo', role: 'ceo_office', scope: 'company', sector_id: null },
  { username: 'demo.sectorlead', role: 'sector_lead', scope: 'sector', sector_id: 'SOLUTIONS' },
  { username: 'demo.bd', role: 'bd_manager', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.pm', role: 'project_manager', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.hr', role: 'hr', scope: 'company', sector_id: null },
  { username: 'demo.consultant', role: 'consultant', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.employee', role: 'employee', scope: 'own', sector_id: 'SOLUTIONS' },
  { username: 'demo.viewer', role: 'viewer', scope: 'sector', sector_id: 'SOLUTIONS' },
  // مدير الإدارة التجريبي يقود إدارةً مبذورة فعلاً (seed.js: «إدارة تحول الأعمال» بمعرّفٍ مولَّد)؛
  // شروط الصفحات تسأل «هل له إدارة؟» (departmentScope) لا عن معرّفها — فيُمرَّر معرّفٌ رمزي.
  // بدونه كانت الأداة تتوقع ٤٠٣ على شاشة الإقفال وتُعلن انحرافاً كاذباً على ٢٠٠ الصحيحة.
  { username: 'demo.deptmgr', role: 'department_manager', scope: 'department', sector_id: 'SOLUTIONS', department_id: 'seeded-department' },
  { username: 'demo.linemgr', role: 'line_manager', scope: 'team', sector_id: 'SOLUTIONS' },
  { username: 'demo.bdhead', role: 'bd_head', scope: 'company', sector_id: null },
  { username: 'demo.ops', role: 'operations', scope: 'sector', sector_id: 'SOLUTIONS' },
  { username: 'demo.procurement', role: 'procurement', scope: 'company', sector_id: null },
  { username: 'demo.approver', role: 'approver', scope: 'sector', sector_id: 'SOLUTIONS' },
  { username: 'demo.external', role: 'external', scope: 'own', sector_id: null },
  { username: 'demo.officecoord', role: 'office_coordinator', scope: 'own', sector_id: null },
  { username: 'demo.officemember', role: 'office_member', scope: 'own', sector_id: null },
];

// Current PAGES map in src/web/routes.js (hardcoded on purpose: the harness must notice when a
// page disappears or a new one is not covered).
// «دليلي» مفتوحة للجميع بحكم كونها صفحة مساعدة — ومحتواها هو المُفلتَر لا الصفحة. وجودها هنا
// ليس تجميلاً: مصفوفة الصلاحيات والمسح الحيّ وفحوص الاتجاه كلها تشتق قائمتها من هنا، فصفحة
// غائبة عن هذه القائمة لا يفحصها أحد — وقد شُحنت «دليلي» فعلاً وهي خارج كل بوابة جودة.
// «التسكين» كانت غائبة عن هذه القائمة رغم وجودها في خريطة PAGES وفي القائمة الجانبية — نفس العطل
// الذي أصاب «دليلي»: صفحة مشحونة خارج كل بوابة جودة. حارسها هو حارس «الفريق» نفسه.
// «صفحتي» مفتوحة للجميع كـ«دليلي» — بلا بوابة لأن كل بياناتها مقيَّدة بصاحب الحساب. ووجودها
// هنا هو ما يُخضِعها للمسح الحيّ ولفحص التسرّب: صفحة الهبوط لكل مستخدم أولى الصفحات بالفحص.
// أقسام «الفريق والموارد» (ADR-0016) بمفاتيحها في سياسة الصفحات `team/<section>` — تُفحص كصفحات:
// بوابتها بوابة «الفريق» إلا «الإقفال الشهري» فبوابته منح الإقفال.
export const PAGES = ['home', 'ceo', 'portfolio', 'sector', 'opportunities', 'my-opportunities', 'projects',
  'clients', 'events', 'tasks', 'timesheet', 'approvals', 'team', 'staffing', 'imports', 'users', 'audit', 'reports', 'org', 'finance', 'mail', 'ops',
  'guide',
  'team/resources', 'team/org', 'team/people', 'team/work', 'team/planning', 'team/requests', 'team/analysis', 'team/needs', 'team/close'];

// Roles whose service guards admit them to the people/org surfaces: staffingRoster() and orgTree()
// both open on `role==='admin' || can(read employee)` (orgTree also on `can(create sector)`), so the
// set is exactly "every role holding an employee-read grant at ANY scope" — target-less can() is a
// grant-existence question, not a scope question. department_manager (department), line_manager
// (team) and bd_head (company) all hold one; operations/procurement/approver/external do not.
// و`bd_manager` انضمّ إليها حين نال «قراءة موظف @قطاع» (matrix.js): كان يسكّن الناس على فرصه
// ولا يرى كشفهم ولا يفتح ملف أحدهم. والخلية هنا مشتقّة من المنح لا من ردٍّ مرصود.
const ORG_READERS = new Set(['admin', 'ceo_office', 'sector_lead', 'hr',
  'department_manager', 'line_manager', 'bd_head', 'bd_manager']);

// ── page-level expectation ─────────────────────────────────────────────────────
// CURRENT behavior: every authenticated role gets 200 on every page EXCEPT team/org, whose page
// functions call service guards (staffingRoster/orgTree) that throw 403. There is NO page-level
// access map yet — that is the documented 'PENDING nav-guard' gap. Once src/web/nav.js exists and
// exports PAGE_ACCESS, loadPageAccess() returns it and expectations flip to strict 200/403.
export function pageExpected(role, page, pageAccess = null) {
  if (pageAccess) {
    const allowed = pageAllowed(role, page, pageAccess);
    if (allowed === null) return { status: 200, soft: true }; // unknown shape — stay soft
    return { status: allowed ? 200 : 403, soft: false };
  }
  if ((page === 'team' || page === 'org') && !ORG_READERS.has(role)) return { status: 403, soft: false };
  // 200-for-all-authed is asserted as CURRENT behavior; the authz distinction is PENDING nav-guard.
  return { status: 200, soft: false, pendingNavGuard: !['tasks', 'timesheet'].includes(page) };
}

function pageAllowed(role, page, pageAccess) {
  const rule = pageAccess?.[page];
  if (rule === undefined) return null;
  if (Array.isArray(rule)) return rule.includes(role) || rule.includes('*');
  if (typeof rule === 'function') {
    const p = ROLES.find((r) => r.role === role);
    // شرطٌ يرمي استثناءً لا يعني «افتراض السماح». كان الالتقاط الصامت هنا يعيد null، و«المجهول»
    // يُترجَم أعلاه إلى «٢٠٠ ليّنة» — أي أن أي خلل في تقييم شرط الصلاحية يُقرأ **سماحاً**. وهذا
    // ما حدث فعلاً: شرط لوحة القيادة صار يسأل محرّك الصلاحيات، والمحرّك يرمي ما لم تُحمَّل المنح،
    // فابتلع الالتقاط الرمية وأعلن ٢٠٠ لقائد قطاع تردّه المنصة ٤٠٣ — فسقط الفحص الحيّ على عطلٍ
    // في الأداة لا في المنتج. الأداة التي تفشل مفتوحةً أسوأ من غياب الأداة: تُخفي الحقيقة وتُطمئن.
    try {
      return !!rule({ role_id: role, scope: p?.scope || 'own', sector_id: p?.sector_id ?? null, department_id: p?.department_id ?? null });
    } catch (e) {
      throw new Error(`تعذّر تقييم شرط فتح صفحة «${page}» للدور «${role}»: ${e.message}\n`
        + 'الأداة لا تفترض السماح عند العجز — حمِّل منح الصلاحيات قبل اشتقاق التوقعات.');
    }
  }
  return null;
}

// Detect the future nav-guard. Returns PAGE_ACCESS or null (absent today).
export async function loadPageAccess() {
  const nav = await import(new URL('../../src/web/nav.js', import.meta.url));
  if (!nav.PAGE_ACCESS) return null;
  // شروط فتح الصفحات صارت تسأل محرّك الصلاحيات، ومن يشتقّ التوقعات هنا لا يُقلع التطبيق — فتلزم
  // تعبئة المنح صراحةً. وتُقرأ **من الكود** لا من قاعدة البيانات: الربط بقاعدة يجعل الاشتقاق
  // رهينةَ ما يصادف وجوده على القرص، وهو ما حدث بالضبط — نجح على جهاز فيه قاعدة قديمة وفشل على
  // معالج الفحص النظيف، فعاد اشتقاقٌ فارغ يُقرأ سماحاً وسقط الفحص الحيّ على عطلٍ في الأداة.
  // ومنح الأدوار النظامية مصدرها الكود أصلاً (الخادم يبذرها من هذه المصفوفة عند كل إقلاع).
  const { primeGrantsFromCode } = await import(new URL('../../src/core/rbac/index.js', import.meta.url));
  const { ROLE_GRANTS } = await import(new URL('../../src/core/rbac/matrix.js', import.meta.url));
  primeGrantsFromCode(ROLE_GRANTS);
  return nav.PAGE_ACCESS;
  // بلا التقاط صامت: عجزُ الأداة عن قراءة سياسة الصفحات ليس «لا سياسة» بل خللٌ يجب أن يُسمع.
  // الالتقاط القديم كان يعيد null فتنقلب التوقعات إلى «٢٠٠ لكل مسجَّل» — أي فحصٌ يمرّ بلا أن يفحص.
}

// ── API probes (staging-safe: no fixture ids) ──────────────────────────────────
// expect: either a number (same status for every role) or { default, [role]: status }.
// Every non-default cell below is DERIVED from the role's grants in src/core/rbac/matrix.js and the
// guard the service actually runs — never from an observed response. Where the derived value and
// the observed value disagree, the cell is meant to fail and the defect is reported, not adjusted.
export const API_PROBES = [
  { method: 'GET', path: '/auth/me', expect: 200 },
  { method: 'GET', path: '/api/opportunities', expect: 200 },              // scope-filtered list
  { method: 'GET', path: '/api/projects', expect: 200 },                   // scope-filtered list
  { method: 'GET', path: '/api/pipeline', expect: 200 },                   // scope-filtered aggregate
  { method: 'GET', path: '/api/org/roster', expect: rosterExpect() },      // hard service guard
  { method: 'GET', path: '/api/org/tree', expect: rosterExpect() },        // hard service guard
  { method: 'GET', path: '/api/finance/summary', expect: 200 },            // zeros when unscoped
  { method: 'GET', path: '/api/finance/by-pm', expect: 200 },
  { method: 'GET', path: '/api/finance/by-contract', expect: 200 },
  // QH-2 FIXED: metrics are leadership numbers — company scope only for /company; sector members
  // (any role whose sector_id matches) plus company scope for /sector/:id.
  // bd_head holds report/kpi/margin/cost at company scope (matrix.js) → the leadership numbers are his.
  // QD-2 أُغلق: كان «المشتريات» يستقبل ٢٠٠ لأن الحارس يقرأ اتساع نافذة البيانات (`app_user.scope`)
  // بدل منحٍ قيادي — ومنحه شركية بحقّ (موردون وأوامر شراء عبر الشركة) فيُترجَم الاتساع رتبةً
  // قيادية بلا قرار من أحد، فيفتح إيراد كل قطاع ومبيعاته ومستهدفاته وهو بلا منح تقرير أو مؤشر.
  // الحارس صار `seesCompanyPerformance` (core/policy/pages.js): منحٌ قيادي **مع** نافذة شركية،
  // ومصدره واحد يشترك فيه هذا المسار وشاشتا القيادة والمحفظة والقائمة الجانبية والدليل والبحث.
  { method: 'GET', path: '/api/metrics/company', expect: { default: 403, admin: 200, ceo_office: 200, hr: 200, bd_head: 200 } },
  // sector metrics: company scope OR membership of that sector. demo.external has neither.
  { method: 'GET', path: '/api/metrics/sector/SOLUTIONS', expect: { default: 200, external: 403, office_member: 403, office_coordinator: 403 } },
  { method: 'GET', path: '/api/tasks/mine', expect: 200 },                 // own-scoped
  { method: 'GET', path: '/api/timesheets/mine', expect: 200 },            // own-scoped
  { method: 'GET', path: '/api/notifications', expect: 200 },              // own-scoped
  { method: 'GET', path: '/api/approvals/queue', expect: 200 },            // role/sector-matched
  // POST probes with an EMPTY body separate authorization from validation: a role WITH the create
  // grant reaches validation (400 عنوان/اسم مطلوب); a role WITHOUT is rejected first (403).
  // bd_head: create opportunity/project @company (OPERATIONAL crud) → reaches validation.
  // ٤٠٠ لا ٤٠٣ لمن يملك المنح: الحمولة فارغة فيردّها التحقّق («عنوان الفرصة مطلوب») بعد اجتياز
  // البوابة — فالرمز هنا يفصل «مسموح له وحمولته ناقصة» عن «ممنوع». ومدير الإدارة انتقل إلى
  // الأولى بقرار المالك: «لازم في طريقة أقدر أضيف الفرص والحالة تبعها… حسب الإدارة».
  { method: 'POST', path: '/api/opportunities', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, department_manager: 400, bd_manager: 400, bd_head: 400 } },
  // employee create exists only for admin / sector_lead (@sector) / hr (@company) — none of the
  // seven new roles holds it (bd_head reads the roster, it does not write it).
  { method: 'POST', path: '/api/org/employees', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, hr: 400 } },
  // operations: create project @sector and its sector matches its own → reaches validation.
  // bd_manager انضمّ بقرار المالك ٢٠٢٦-٠٨-١٧: يدير مشاريع قطاعه إنشاءً وتعديلاً (بلا حذف).
  { method: 'POST', path: '/api/projects', body: {}, expect: { default: 403, admin: 400, sector_lead: 400, project_manager: 400, bd_head: 400, operations: 400, bd_manager: 400 } },
  // «مهامي» و«سجل الوقت» مفتوحتان لكل مستخدم مسجَّل بقرار منتج معلن (PAGE_ACCESS.tasks/timesheet)،
  // والخدمتان لا تفحصان منح الإنشاء إطلاقاً — لذلك 400 للجميع. القاعدة كُتبت حين كان «كل مستخدم
  // مسجَّل» = موظفاً؛ حساب `external` يكسر هذا الافتراض. مُبلَّغ عنه كعيب QD-3.
  { method: 'POST', path: '/api/tasks/quick', body: {}, expect: 400 },     // every role may create own tasks
  { method: 'POST', path: '/api/timesheets', body: {}, expect: 400 },      // every role logs own time
  { method: 'POST', path: '/api/approvals', body: {}, expect: 400 },       // unknown workflow key → validation
  // ── المساعد ────────────────────────────────────────────────────────────────
  // الحالة مفتوحة لكل مسجَّل: تقول «المحرّك محلي» وتعيد بطاقات الاقتراح **مُرشَّحة بمنح الدور**
  // (فلا تُعرض بطاقة لعملٍ يردّه الخادم). لا كتابة فيها ولا رقم عمل، فهي آمنة على أي بيئة.
  { method: 'GET', path: '/api/ai/status', expect: 200 },
  // سجل نشاط المساعد جزء من سجل التدقيق: بوابته `can(read audit)` — وهي منح مدير النظام
  // (شامل) ومكتب الرئيس التنفيذي (audit @company) وحدهما في مصفوفة المنح.
  { method: 'GET', path: '/api/ai/activity', expect: { default: 403, admin: 200, ceo_office: 200 } },
  // قوائم النموذج: مصدر كل معرّف تعرضه الواجهة. مشروطة بمنح القراءة على الملف نفسه، فمن لا
  // يقرأ الفرص لا تُعرض له فرصة يختارها — الهدف خارج النطاق لا يُعرض فضلاً عن أن يُكتب عليه.
  // قراءة المشروع ممنوحة لكل دور تقريباً (ولو بنطاق «مشروعي» أو «خاصتي»)؛ والثلاثة المستثناة
  // بلا منح مشروع إطلاقاً في matrix.js: الموارد البشرية، والمدير المباشر، والمعتمِد.
  { method: 'GET', path: '/api/ai/options/project',
    expect: { default: 200, hr: 403, line_manager: 403, approver: 403, office_member: 403, office_coordinator: 403 } },
  // والفرص أضيق: من لا يملك **قراءة** الفرصة يُردّ — ومنه المعتمِد الذي يملك «اعتماد» بلا قراءة.
  // `department_manager` أُضيف بقرار المالك: «مدراء الإدارات لهم صلاحية يشوفوا كل الفرص» —
  // وكان بلا منح قراءةٍ على الفرصة إطلاقاً، فتغيب الخانة كلها عن شاشته لا تظهر فارغة.
  { method: 'GET', path: '/api/ai/options/opportunity',
    expect: { default: 403, admin: 200, ceo_office: 200, sector_lead: 200, bd_manager: 200,
      bd_head: 200, viewer: 200, consultant: 200, department_manager: 200 } },
  // معاينة بحمولة فارغة: النوع يُرَدّ قبل أي فحص صلاحية وقبل أي كتابة — فلا صفَّ سجلٍ يُكتب،
  // والمسبار آمن على بيئة حيّة. (الدردشة تكتب سطر سجل، فمسبارها في مسار المسح وحده وبعلَم صريح.)
  { method: 'POST', path: '/api/ai/preview', body: {}, expect: 400 },
];

// ── مسابر الدردشة: تكتب سطراً في سجل نشاط المساعد ⟵ **مطفأة افتراضياً على قاعدة بعيدة** ──
// تُشغَّل محلياً بلا شرط، وعلى قاعدة بعيدة بعلَم صريح (--ai-chat) مع طباعة سبب الإطفاء.
// `deny` يعني أن الردّ المتوقَّع رفضٌ ٤٠٣ لهذه الأدوار (بوابة أرقام الشركة).
export const AI_CHAT_PROBES = [
  { message: 'ما أولوياتي اليوم', expect: 200 },                      // مهام صاحب الطلب — لكل دور
  { message: 'ما المخاطر البارزة', expect: { default: 200, hr: 403, line_manager: 403, approver: 403 } },
  { message: 'افحص جودة البيانات', expect: 200 },                     // يردّ ولو بـ«لا شيء ضمن صلاحيتك»
  // نية كتابة من نص حر: تعيد **نموذجاً** لمن يملك منح الإنشاء، وتُرَدّ ٤٠٣ لمن لا يملكه.
  // مدير الإدارة انضمّ إلى مالكي منح الإنشاء بقرار المالك («التعديل والتسكين بدءاً من مدير
  // المشروع واللي فوقه»)، فصار المساعد يعيد له نموذجاً بدل رفضٍ — والنية نفسها والبوابة نفسها.
  { message: 'أنشئ مهمة متابعة العقد',
    expect: { default: 403, admin: 200, sector_lead: 200, department_manager: 200, project_manager: 200,
      consultant: 200, employee: 200, bd_head: 200, operations: 200 } },
  // نفس بوابة /api/metrics/company حرفياً — وهذا هو أصل العطل الذي أُغلق.
  { message: 'اكتب الموجز التنفيذي الأسبوعي',
    expect: { default: 403, admin: 200, ceo_office: 200, hr: 200, bd_head: 200 } },
];

function rosterExpect() {
  const e = { default: 403 };
  for (const r of ORG_READERS) e[r] = 200;
  return e;
}

// Fixture-dependent probes (ids from scripts/lib/seed-fixture.mjs) — used ONLY by the permissions
// matrix test against a locally seeded DB; never by the live sweep.
export const FIXTURE_PROBES = [
  // IDOR: a CONSULTING-sector opportunity must be invisible to SOLUTIONS-scoped and own-scoped roles.
  // bd_head reads opportunity at COMPANY scope by design (support unit across all four sectors).
  // approver holds `approve opportunity` but no `read` — approve does not imply read → 403.
  { method: 'GET', path: '/api/opportunities/FX-OPP-CONS', expect: { default: 403, admin: 200, ceo_office: 200, bd_head: 200 } },
  // Contract detail: company invoice/contract readers + the owning sector's lead only.
  // bd_head reads contract @company; external reads INVOICE @own but no contract grant → 403.
  // مدير المشروع ٢٠٠ **لأن `FX-CON-1` عقدُ `FX-PRJ-1` وهو مشروعٌ يملكه** (انظر seed-fixture):
  // قرار مالك صريح أنه يدير مالية مشروعه ويُصدر مستخلصه، ولا فريق مالية يفعلها عنه. والمنح
  // بنطاق **مشروع**، والحارس صفّي (`can(read, contract, c)` والعقد يحمل `project_id`) — فعقدُ
  // مشروعٍ لا يديره يُردّ ٤٠٣، ويحرس ذلك tests/security/project-money-visibility.test.js.
  { method: 'GET', path: '/api/finance/contracts/FX-CON-1', expect: { default: 403, admin: 200, ceo_office: 200, sector_lead: 200, bd_head: 200, project_manager: 200 } },
  // Row-level write probe on a real invoice: authorized roles fall through to amount validation.
  // bd_head is READ-ONLY on money (matrix.js: «المال … قراءة فقط») → must stay 403 here.
  { method: 'POST', path: '/api/finance/collections', body: { invoiceId: 'FX-INV-2' }, expect: { default: 403, admin: 400, ceo_office: 400, sector_lead: 400 } },
];

export function expectedStatus(expect, role) {
  return typeof expect === 'number' ? expect : (expect[role] ?? expect.default);
}
