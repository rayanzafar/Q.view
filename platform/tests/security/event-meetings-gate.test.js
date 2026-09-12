// بوابة «الاجتماعات» داخل الفعاليات — من ينشئ، ومن يعدّل، ومن يحذف، ومن يقرأ فقط.
//
// القرار المقصود (الترحيلة ٠٤٠، قرار ٢٠٢٦-٠٨-٣٠): الاجتماعات على قواعد الفعاليات حرفاً بحرف —
// كل موظفٍ ينشئ اجتماعاً ويدعو، والمشاهد يقرأ، والخارجي لا شيء، والحذفُ الشامل لمن يدير
// الفعالية (وقاعدة رئيس تطوير الأعمال «لا حذف لأي مورد» تبقى كما هي).
// والجدول مكتوبٌ يدوياً لا مشتقٌّ من الدالة التي يفحصها — وإلا صار الاختبار مرآةً للكود.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js');
const { primeGrantsFromCode, can } = await import('../../src/core/rbac/index.js');
primeGrantsFromCode(ROLE_GRANTS);

const SCOPE = {
  admin: 'company', ceo_office: 'company', sector_lead: 'sector', bd_manager: 'own',
  project_manager: 'own', hr: 'company', consultant: 'own',
  employee: 'own', viewer: 'sector', department_manager: 'department', line_manager: 'team',
  bd_head: 'company', operations: 'sector', procurement: 'company', approver: 'sector',
  external: 'own',
};
const shape = (role) => ({ id: 'u_' + role, role_id: role, scope: SCOPE[role], sector_id: 'SOLUTIONS',
  department_id: 'D1', projectIds: new Set(), teamIds: new Set() });

// القرار دوراً دوراً — الأعمدة: قراءة، إنشاء، تعديل، حذف (حذفُ اجتماعات الغير، لا اجتماعه هو).
const EXPECTED = {
  admin: [true, true, true, true],
  ceo_office: [true, true, true, true],
  sector_lead: [true, true, true, true],
  department_manager: [true, true, true, false],
  line_manager: [true, true, true, false],
  project_manager: [true, true, true, false],
  bd_manager: [true, true, true, false],
  bd_head: [true, true, true, false],
  procurement: [true, true, true, false],
  hr: [true, true, true, false],
  operations: [true, true, true, false],
  consultant: [true, true, true, false],
  employee: [true, true, true, false],
  approver: [true, true, true, false],
  viewer: [true, false, false, false],
  external: [false, false, false, false],
};

test('اجتماعات الفعاليات: الأدوار الستة عشر — القرار مطابق للمقصود دوراً دوراً', () => {
  for (const [role, [r, c, u, d]] of Object.entries(EXPECTED)) {
    const usr = shape(role);
    assert.equal(!!can(usr, 'read', 'event_meeting'), r, `قراءة الاجتماعات للدور «${role}»`);
    assert.equal(!!can(usr, 'create', 'event_meeting'), c, `إنشاء اجتماع للدور «${role}»`);
    assert.equal(!!can(usr, 'update', 'event_meeting'), u, `تعديل اجتماع للدور «${role}»`);
    assert.equal(!!can(usr, 'delete', 'event_meeting'), d, `حذف اجتماعات الغير للدور «${role}»`);
  }
});

test('بوابة الاجتماعات تساوي بوابة الفعاليات: من يقرأ الفعالية يقرأ اجتماعاتها، ولا أحد سواه', () => {
  for (const role of Object.keys(SCOPE)) {
    const usr = shape(role);
    assert.equal(!!can(usr, 'read', 'event_meeting'), !!can(usr, 'read', 'event'),
      `قراءة الفعالية واجتماعاتها تختلفان على الدور «${role}»`);
  }
});
