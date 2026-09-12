// باب صفحة التقارير للمديرَين — «مدير إدارة» و«مدير مباشر».
//
// العطل الذي يحرسه هذا الملف هو **عكس** العطل المعروف: لا مفتوح صفحياً مغلق صفّياً، بل
// **مفتوح صفّياً مغلق صفحياً**. محرك التقارير الدوري يقيس اتساع المنح (`widthAtLeast`)
// ومصادره تشمل «الموظفين»، فكلا المديرَين كان يجتاز حارس عدسة «الإدارة» وعدسة «الشخص»
// لأهل إدارته — ثم يُرَدّ على باب الصفحة نفسها لأن `PAGE_ACCESS.reports` يشترط منح تقارير
// ولم يكن لأيٍّ منهما منح. أي أن ثمرة الإسناد الإداري كانت محسوبة ولا يفتحها من بُنيت له.
//
// والحارس هنا ذو حدَّين: يثبت أن الباب فُتح، **ويثبت أنه لم يتّسع**. منح «إدارة» لا يبلغ
// القطاع ولا الشركة ولا إدارةً أخرى ولا يمنح تصديراً — والفحوص أدناه تسقط إن اتّسع أيٌّ منها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-reports-mgr-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac, can, effectiveScope } = await import('../../src/core/rbac/index.js');
await initRbac();
const { PAGE_ACCESS } = await import('../../src/core/policy/pages.js');
const P = await import('../../src/core/reports/periods.js');

const T = '2026-01-01T00:00:00Z';
const U = (id, role, sector, scope, department = null) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
  department_id: department, projectIds: new Set(), teamIds: new Set(), employee_id: null,
});

// إدارتان في نفس القطاع، وثالثة في قطاع آخر — كي يُفحص الحدّ الأفقي (إدارة شقيقة) والحدّ
// الرأسي (خارج القطاع) كلٌّ على حدة، فلا يُنسب نجاح أحدهما إلى الآخر.
const deptMgr = U('u_dept', 'department_manager', 'SOLUTIONS', 'sector', 'D_SMART');
const lineMgr = U('u_line', 'line_manager', 'SOLUTIONS', 'sector', 'D_SMART');
const MINE = { id: 'D_SMART', name_ar: 'إدارة المدن الذكية', sector_id: 'SOLUTIONS' };
const SIBLING = { id: 'D_DATA', name_ar: 'إدارة البيانات', sector_id: 'SOLUTIONS' };
const FOREIGN = { id: 'D_CON', name_ar: 'مكتب إدارة المشاريع', sector_id: 'CONSULTING' };
const SECTOR_ROW = { id: 'SOLUTIONS', name_ar: 'قطاع الحلول' };

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  for (const d of [MINE, SIBLING, FOREIGN]) {
    await insert('department', { id: d.id, sector_id: d.sector_id, name_ar: d.name_ar, active: 1, created_at: T });
  }
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

for (const [label, mgr] of [['مدير الإدارة', deptMgr], ['المدير المباشر', lineMgr]]) {
  test(`${label} يفتح صفحة التقارير — الباب الذي كان مردوداً عليه`, () => {
    assert.equal(PAGE_ACCESS.reports(mgr), true,
      'الحارس الصفحي كان يردّ من يجتاز الحارس الصفّي — تناقض يُخفي التقرير عمّن بُني له');
  });

  test(`${label} يقرأ تقرير إدارته وحدها — لا إدارة شقيقة ولا إدارة قطاع آخر`, () => {
    assert.equal(P.departmentReadable(mgr, MINE), true, 'إدارته هو');
    assert.equal(P.departmentReadable(mgr, SIBLING), false,
      'إدارة شقيقة في نفس القطاع — المنح بنطاق إدارة لا قطاع');
    assert.equal(P.departmentReadable(mgr, FOREIGN), false, 'إدارة خارج قطاعه');
  });

  test(`${label} لا يبلغ عدسة الشركة`, () => {
    // عدسة الشركة تُفحص بنفس مقياس الاتساع: منحٌ بنطاق «شركة» من أحد مصادر العرض الثلاثة.
    assert.notEqual(effectiveScope(mgr, 'read', 'report'), 'company');
    assert.notEqual(effectiveScope(mgr, 'read', 'employee'), 'company');
    assert.notEqual(effectiveScope(mgr, 'read', 'project'), 'company');
  });

  test(`${label} لا يملك تصدير التقارير`, () => {
    assert.equal(can(mgr, 'export', 'report'), false,
      'الملف يخرج من المنصة ولا يُسترجَع — القراءة لا تستدعي التصدير');
  });

  test(`${label} بلا إدارة محسومة لا يرى أي إدارة`, () => {
    const homeless = { ...mgr, department_id: null };
    assert.equal(P.departmentReadable(homeless, MINE), false,
      'إدارة فارغة ⟵ لا شيء، لا القطاع كله: الغياب لا يُقرأ توسعةً');
  });
}

// ── عدسة القطاع: مفتوحة لمدير الإدارة وحده، بقرار مالك صريح ─────────────────────
// «لازم مدير الإدارة يشوف مركز القطاع من ناحية ربح وكم الإيراد وكم من التارقيت». فمنحه للتقارير
// والمؤشرات صار قطاعياً، وعدسة القطاع تُفتح له. و«المدير المباشر» لم يتغيّر حرفاً: منحه بنطاق
// إدارته، وعدسة القطاع مردودة عنه كما كانت — وهذا ما يفصله الفحصان أدناه.
test('مدير الإدارة يبلغ عدسة القطاع — أرقام قطاعه من شأنه بقرار المالك', () => {
  assert.equal(P.sectorReadable(deptMgr, SECTOR_ROW), true);
  assert.equal(effectiveScope(deptMgr, 'read', 'report'), 'sector');
  // والاتساع في الأرقام لا في الأشخاص: قراءة الموظفين بقيت عند إدارته حرفاً بحرف.
  assert.equal(effectiveScope(deptMgr, 'read', 'employee'), 'department');
});

test('المدير المباشر لا يبلغ عدسة القطاع — المنح الجديد لم يتسرّب إليه', () => {
  assert.equal(P.sectorReadable(lineMgr, SECTOR_ROW), false,
    'تقرير القطاع يجمع الإدارات كلها — منح «إدارة» لا يبلغه');
  assert.equal(effectiveScope(lineMgr, 'read', 'report'), 'department');
});

test('اتساع المنح لم يتغيّر لبقية الأدوار', () => {
  // الاستشاري والمشاهد لا يُمنحان شيئاً بالعرض — تأكيد أن الإضافة لم تتسرّب في حلقة عامة.
  const consultant = U('u_c', 'consultant', 'SOLUTIONS', 'own');
  assert.equal(PAGE_ACCESS.reports(consultant), false, 'الاستشاري كما كان — بلا تقارير');
});
