// بوابة شاشة «الهيكل التنظيمي» — من يدخلها، ومن لا يدخلها، ولماذا.
//
// العطل الذي يقفله هذا الملف: بوابة الصفحة كانت تسأل عن **إنشاء** موظف (`create employee`) بينما
// الشاشة قراءةٌ في أصلها، والخدمة تحتها (orgTree) تفتح على **قراءة** موظف. فكانت البوابة أضيق من
// كل خدمةٍ خلفها: مدير الإدارة، والمدير المباشر، ورئيس تطوير الأعمال، **ومكتب الرئيس التنفيذي**
// يُردّون بأربعمئة وثلاثة عن شجرةٍ بياناتُها مسموحة لهم أصلاً. وهذا يمسّ التجربة مباشرةً: مديرو
// الإدارات في قطاع الحلول هم أول من يفتح هذه الشاشة، وغايتها المعلَنة أن تُقرأ.
//
// وما تحرسه الحارة أن المواءمة **لم تفتح شيئاً جديداً**: الأدوار التي كانت خارجاً بلا منح قراءة
// موظف تبقى خارجاً — مدير المشروع، والمالية، والاستشاري، والموظف، والمشاهد، والعمليات،
// والمشتريات، والمعتمِد، والخارجي، ومدير تطوير الأعمال.
//
// الجدول أدناه مكتوبٌ يدوياً لا مشتقٌّ من الدالة التي يفحصها — وإلا صار الاختبار مرآةً للكود.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js');
const { primeGrantsFromCode, can } = await import('../../src/core/rbac/index.js');
primeGrantsFromCode(ROLE_GRANTS);
const { PAGE_ACCESS } = await import('../../src/web/nav.js');

// نطاق كل دور كما يبذره scripts/seed.js — الشرط يُقيَّم على شكل الحساب لا على الدور وحده.
const SCOPE = {
  admin: 'company', ceo_office: 'company', sector_lead: 'sector', bd_manager: 'own',
  project_manager: 'own', finance: 'company', hr: 'company', consultant: 'own',
  employee: 'own', viewer: 'sector', department_manager: 'department', line_manager: 'team',
  bd_head: 'company', operations: 'sector', procurement: 'company', approver: 'sector',
  external: 'own',
};
// القرار المقصود: من يملك «قراءة موظف» بأي نطاق، أو إدارة القطاعات. لا أحد سواهم.
const ALLOWED = new Set(['admin', 'ceo_office', 'sector_lead', 'hr',
  'department_manager', 'line_manager', 'bd_head']);

const shape = (role) => ({ role_id: role, scope: SCOPE[role], sector_id: 'SOLUTIONS',
  department_id: 'D1', projectIds: new Set(), teamIds: new Set() });

test('بوابة الهيكل: الأدوار السبعة عشر — القرار مطابق للمقصود دوراً دوراً', () => {
  for (const role of Object.keys(SCOPE)) {
    assert.equal(!!PAGE_ACCESS.org(shape(role)), ALLOWED.has(role),
      `قرار فتح «الهيكل التنظيمي» للدور «${role}» يخالف المقصود`);
  }
});

test('بوابة الهيكل لا تضيق عن خدمتها: كل من يقرأ الموظفين يدخل الشاشة', () => {
  // نفس شرط orgTree في src/modules/org/org.js — البوابة لا يجوز أن تكون أضيق منه، وإلا رُدّ
  // المستخدم عن بيانات مسموحة له، ولا أوسع منه، وإلا فتحنا شاشةً ستتحوّل إلى خطأ صلاحية.
  for (const role of Object.keys(SCOPE)) {
    const u = shape(role);
    const serviceOpens = role === 'admin' || can(u, 'read', 'employee') || can(u, 'create', 'sector');
    assert.equal(!!PAGE_ACCESS.org(u), serviceOpens,
      `بوابة الصفحة وخدمة الشجرة تختلفان على الدور «${role}»`);
  }
});

test('من لا يملك قراءة الموظفين يبقى خارج الشاشة — المواءمة لم تفتح باباً جديداً', () => {
  for (const role of ['bd_manager', 'project_manager', 'finance', 'consultant', 'employee',
    'viewer', 'operations', 'procurement', 'approver', 'external']) {
    assert.equal(PAGE_ACCESS.org(shape(role)), false, `الدور «${role}» يجب أن يبقى خارج الهيكل`);
  }
});

test('التعديل ليس القراءة: من دخل بمنح القراءة لا يملك تعديل الهيكل', () => {
  // mayEdit في src/web/views/org.js يسأل can(admin, department) — سؤالٌ مستقلٌّ عن بوابة الصفحة.
  // الثلاثة الداخلون بمنح «قراءة موظف» لا يملكونه، فيرون الشجرة بلا أدوات.
  for (const role of ['department_manager', 'line_manager', 'bd_head']) {
    const u = shape(role);
    assert.equal(PAGE_ACCESS.org(u), true, `الدور «${role}» يقرأ الهيكل`);
    assert.equal(can(u, 'admin', 'department', { sector_id: 'SOLUTIONS' }), false,
      `الدور «${role}» يجب ألّا يملك تعديل هيكل القطاع`);
  }
  // ومكتب الرئيس التنفيذي يملك تعديل الإدارات في مصفوفة المنح — وكان **مردوداً عن الشاشة**
  // التي يُفترض أن يديرها منها. هذا أحدّ وجوه العطل: منحٌ بلا مدخل.
  const ceo = shape('ceo_office');
  assert.equal(PAGE_ACCESS.org(ceo), true, 'مكتب الرئيس التنفيذي يفتح الهيكل');
  assert.equal(can(ceo, 'admin', 'department', { sector_id: 'SOLUTIONS' }), true,
    'ومنحه يشمل تعديل الإدارات فعلاً');
});
