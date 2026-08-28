// بوابة شاشة «الفعاليات» — من يدخلها، ومن لا يدخلها، ولماذا.
//
// القرار المقصود: الفعاليات شأن الشركة كلها — كل موظفٍ يقف في الجناح ويلتقط، والمشاهد يقرأ.
// الوحيد خارج الباب حسابُ البوابة الخارجية («external»): حساب عميل، لا يرى بطاقات المعارض.
// والجدول مكتوبٌ يدوياً لا مشتقٌّ من الدالة التي يفحصها — وإلا صار الاختبار مرآةً للكود.
//
// ملاحظة تنفيذية: `PAGE_ACCESS.events` تُضاف في جلسة التوصيل (core/policy/pages.js). هذا
// الملف كُتب قبلها عمداً ليحدّد المطلوب منها، ويبقى أحمر حتى تُسجَّل — ولا يُخفَّف.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js');
const { primeGrantsFromCode, can } = await import('../../src/core/rbac/index.js');
primeGrantsFromCode(ROLE_GRANTS);
const { PAGE_ACCESS } = await import('../../src/web/nav.js');

// نطاق كل دور كما يبذره scripts/seed.js — الشرط يُقيَّم على شكل الحساب لا على الدور وحده.
const SCOPE = {
  admin: 'company', ceo_office: 'company', sector_lead: 'sector', bd_manager: 'own',
  project_manager: 'own', hr: 'company', consultant: 'own',
  employee: 'own', viewer: 'sector', department_manager: 'department', line_manager: 'team',
  bd_head: 'company', operations: 'sector', procurement: 'company', approver: 'sector',
  external: 'own',
};
// كل دور إلا الخارجي — مكتوبةً واحداً واحداً.
const ALLOWED = new Set(['admin', 'ceo_office', 'sector_lead', 'bd_manager', 'project_manager', 'hr',
  'consultant', 'employee', 'viewer', 'department_manager', 'line_manager', 'bd_head', 'operations',
  'procurement', 'approver']);

const shape = (role) => ({ id: 'u_' + role, role_id: role, scope: SCOPE[role], sector_id: 'SOLUTIONS',
  department_id: 'D1', projectIds: new Set(), teamIds: new Set() });

test('بوابة الفعاليات مسجَّلة في سياسة الصفحات', () => {
  assert.equal(typeof PAGE_ACCESS.events, 'function',
    'بوابة «الفعاليات» غير مسجَّلة بعد في core/policy/pages.js — تُضاف في جلسة التوصيل');
});

test('بوابة الفعاليات: الأدوار الستة عشر — القرار مطابق للمقصود دوراً دوراً', () => {
  for (const role of Object.keys(SCOPE)) {
    assert.equal(!!PAGE_ACCESS.events(shape(role)), ALLOWED.has(role),
      `قرار فتح «الفعاليات» للدور «${role}» يخالف المقصود`);
  }
});

test('بوابة الفعاليات لا تضيق عن خدمتها ولا تتسع: من يقرأ الفعالية يدخل الشاشة، ولا أحد سواه', () => {
  // نفس شرط listEvents في src/modules/events/events.js — البوابة لا يجوز أن تكون أضيق منه، وإلا
  // رُدّ المستخدم عن بيانات مسموحة له، ولا أوسع منه، وإلا فتحنا شاشةً ستتحوّل إلى خطأ صلاحية.
  for (const role of Object.keys(SCOPE)) {
    const u = shape(role);
    assert.equal(!!PAGE_ACCESS.events(u), can(u, 'read', 'event'),
      `بوابة الصفحة وخدمة الفعاليات تختلفان على الدور «${role}»`);
  }
});

test('المشاهد يدخل ولا يلتقط، والخارجي لا يدخل أصلاً', () => {
  const viewer = shape('viewer');
  assert.equal(PAGE_ACCESS.events(viewer), true, 'المشاهد يقرأ الفعاليات');
  assert.equal(can(viewer, 'create', 'event_contact'), false, 'ولا يلتقط بطاقة');
  assert.equal(can(viewer, 'create', 'event'), false, 'ولا ينشئ فعالية');
  assert.equal(PAGE_ACCESS.events(shape('external')), false, 'حساب البوابة الخارجية خارج الشاشة');
  // ومن يدير الفعالية نفسها ثلاثة بقرار المصفوفة: مدير النظام وقائد القطاع ومكتب الرئيس.
  for (const role of ['admin', 'sector_lead', 'ceo_office']) {
    assert.equal(can(shape(role), 'delete', 'event'), true, `الدور «${role}» يدير الفعالية`);
  }
  for (const role of ['consultant', 'employee', 'bd_manager', 'hr', 'operations', 'bd_head']) {
    assert.equal(can(shape(role), 'delete', 'event'), false, `الدور «${role}» لا يحذف فعالية`);
  }
});
