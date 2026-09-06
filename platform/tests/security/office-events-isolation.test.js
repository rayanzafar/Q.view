// ── حارس: أدوار المكتب لا تُمنَح فعاليات الشركة (v5.61) ───────────────────────
//
// حلقةُ الفعاليات في matrix.js تمنح كلَّ دورٍ جديدٍ فعالياتِ الشركة كاملةً افتراضياً. ولو
// سُحِبت على دورَي المكتب لصار العضو يقرأ التقاطَ كل قطاع — وهو تسريبٌ يكسر عزل المكتب.
// هذا الحارس يُثبّت أن نطاق منح الفعاليات لهما «إدارة» (يسقط مغلقاً) لا «شركة».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_GRANTS } from '../../src/core/rbac/matrix.js';

for (const role of ['office_member', 'office_coordinator']) {
  test(`${role}: لا منحَ فعالياتٍ بنطاق الشركة`, () => {
    const grants = ROLE_GRANTS[role] || [];
    const companyEvents = grants.filter((g) =>
      /^event(_contact|_partner|_meeting)?$/.test(g.resource) && g.scope === 'company');
    assert.deepEqual(companyEvents, [],
      `${role} مُنِح فعالياتٍ شركيّة: ${companyEvents.map((g) => g.resource + ':' + g.action).join('، ')}`);
    // ولا منحَ على القطاعات أو المشاريع أو العملاء — العزل بنيةً لا عادة.
    for (const res of ['opportunity', 'project', 'client', 'sector']) {
      assert.ok(!grants.some((g) => g.resource === res),
        `${role} يملك منحاً على «${res}» — يكسر عزل المكتب`);
    }
  });
}
