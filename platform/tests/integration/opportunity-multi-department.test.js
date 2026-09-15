// «ممكن الفرصة تتسكّن على أكثر من إدارة — هاتان الفرصتان تحت إدارة البيانات والذكاء الاصطناعي
// وتحت إدارة المدن الذكية. فسجّلها، وخلّي مكان التسجيل ممكن أحطّ أكثر من إدارة أو قطاع يشتغل
// على الفرصة» — بلسان المالك.
//
// وأدقّ ما يُحرَس هنا **ألّا تُحسب الفرصة مرتين**: المشاركة رؤيةٌ وعمل، والقيمة تبقى على
// الإدارة المسؤولة وحدها — وإلا انتفخ مجموع القطاع على مجموع فرصه بلا أن يلاحظ أحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-multidept-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
const CTX = { user: ADMIN, ip: '1' };
let OPP;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'جهة', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي والبيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CITY', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('department', { id: 'D_OTHER', sector_id: 'SOL', name_ar: 'إدارة ثالثة', active: 1, created_at: T });

  OPP = (await opps.createOpportunity(CTX, {
    title_ar: 'منظومة رصد دخول الحافلات', sector_id: 'SOL', department_id: 'D_AI',
    client_id: 'CL', value_sar: 7000000, partner_department_ids: ['D_CITY'],
  })).id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('الفرصة تُسجَّل على إدارةٍ مسؤولة وأخرى مشاركة', async () => {
  const parts = await opps.opportunityDepartments(OPP);
  assert.deepEqual(parts.map((p) => p.department_id), ['D_CITY']);
  const row = await db.get('SELECT department_id FROM opportunity WHERE id = ?', [OPP]);
  assert.equal(row.department_id, 'D_AI', 'تبدّلت الإدارة المسؤولة');
});

test('وتظهر في قائمة الإدارتين معاً — من يعمل عليها يجدها في قائمته', async () => {
  const asAI = await opps.listOpportunities(ADMIN, { department: 'D_AI' });
  const asCity = await opps.listOpportunities(ADMIN, { department: 'D_CITY' });
  assert.ok(asAI.some((o) => o.id === OPP), 'غابت عن إدارتها المسؤولة');
  assert.ok(asCity.some((o) => o.id === OPP), 'غابت عن الإدارة المشاركة — وهي تعمل عليها');
  const asOther = await opps.listOpportunities(ADMIN, { department: 'D_OTHER' });
  assert.ok(!asOther.some((o) => o.id === OPP), 'ظهرت لإدارةٍ لا علاقة لها');
});

test('ولا تُحسب مرتين: القيمة على المسؤولة وحدها', async () => {
  // القائمة الكاملة تعرضها صفّاً واحداً مهما تعدّدت إداراتها — وهي المصدر الذي تُجمَع منه الأرقام.
  const all = await opps.listOpportunities(ADMIN, {});
  assert.equal(all.filter((o) => o.id === OPP).length, 1, 'تكرّر الصفّ فانتفخ المجموع');
});

test('والمسؤولة لا تُسجَّل مشاركةً ولو أُرسلت — صفٌّ يُعدّ الشيء مرتين', async () => {
  await opps.updateOpportunity(CTX, OPP, { partner_department_ids: ['D_AI', 'D_CITY'] });
  const parts = await opps.opportunityDepartments(OPP);
  assert.deepEqual(parts.map((p) => p.department_id), ['D_CITY']);
});

test('والمجموعة تُكتب كاملةً — فرفع إدارةٍ يكون بإلغاء تحديدها', async () => {
  await opps.updateOpportunity(CTX, OPP, { partner_department_ids: [] });
  assert.deepEqual(await opps.opportunityDepartments(OPP), []);
  await opps.updateOpportunity(CTX, OPP, { partner_department_ids: ['D_CITY', 'D_OTHER'] });
  assert.equal((await opps.opportunityDepartments(OPP)).length, 2);
});

test('ولا تُمَسّ إن لم تُرسَل — تعديل المبلغ لا يمحو المشاركين', async () => {
  await opps.updateOpportunity(CTX, OPP, { value_sar: 9000000 });
  assert.equal((await opps.opportunityDepartments(OPP)).length, 2, 'مُحيت المشاركة بتعديلٍ لا يخصّها');
});

test('و«بلا إدارة» لا تشمل ما تعمل عليه إدارةٌ مشاركة', async () => {
  const orphan = (await opps.createOpportunity(CTX, {
    title_ar: 'فرصة بلا إدارة', sector_id: 'SOL', client_id: 'CL', value_sar: 100000,
  })).id;
  const shared = (await opps.createOpportunity(CTX, {
    title_ar: 'فرصة بلا مسؤولة ولها مشاركة', sector_id: 'SOL', client_id: 'CL',
    value_sar: 100000, partner_department_ids: ['D_CITY'],
  })).id;
  const none = await opps.listOpportunities(ADMIN, { department: 'none' });
  assert.ok(none.some((o) => o.id === orphan), 'الفرصة غير المُسنَدة غابت عمّن يُسنِدها');
  assert.ok(!none.some((o) => o.id === shared), 'فرصةٌ تعمل عليها إدارة عُدّت غير مُسنَدة');
});

test('وصفحة الفرصة تعرض من يعمل عليها وتتيح تعديلهم', async () => {
  const html = await P.opportunityDetailPage(ADMIN, OPP, {});
  assert.ok(html.includes('إدارات مشاركة'), 'لا مكان لتسجيل أكثر من إدارة');
  assert.ok(html.includes('oc-partners'), 'الخانة تُعرض ولا تُكتب');
  assert.ok(html.includes('إدارة المدن الذكية'), 'المشاركة لا تظهر في الصفحة');
});
