// «لازم في النهاية المنصة وكل الانترفيس مع بعض إنتراكتف — من فرص ومشاريع ومهام، لأنه في
// النهاية لازم يكون هناك مصدر معلومات موحّد» — بلسان المالك.
//
// و«مصدرٌ موحّد» ليس جدولاً واحداً في القاعدة بل **سلسلةً موصولة في الشاشة**: من الفرصة إلى
// مشروعها، ومن المشروع إلى عميله وفريقه ومهامه وفرصته المصدر، ومن الشخص إلى عمله كلّه. فحلقةٌ
// مقطوعة تعني أن الموظف يقرأ الاسم ولا يبلغ صاحبه — فيفتح شاشةً أخرى ويبحث من جديد، أو يسأل
// زميله. وحينها لا يهمّ أن البيانات مرتبطة في القاعدة: هي غير موصولة عنده.
//
// وقد وُجد انقطاعٌ حقيقي بهذا الفحص: **جدول فريق المشروع كان يعرض الاسم نصّاً جامداً** — يرى
// المديرُ مَن على مشروعه ولا يستطيع الوصول إلى ما عنده. وسببه أن صفّ الفريق يحمل معرّف
// الموظف ولا يحمل معرّف حسابه، وصفحةُ الشخص تُفتح بالحساب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-chain-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, rbac, P;
const T = new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);
const ADMIN = { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'S', name_ar: 'قطاع الحلول', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', is_won: 1, is_lost: 0, sort_order: 9 });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_pm', username: 'pm', name_ar: 'مدير المشروع', role_id: 'project_manager', scope: 'own', sector_id: 'S', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_pm', name_ar: 'مدير المشروع', user_id: 'u_pm', sector_id: 'S', active: 1, created_at: T });

  await db.insert('opportunity', { id: 'OPP', title_ar: 'منصة البيانات — الفرصة', client_id: 'CL',
    sector_id: 'S', stage_id: 'WON', owner_user_id: 'u_pm', value_halalas: 100000, created_at: T });
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة البيانات', client_id: 'CL', sector_id: 'S',
    source_opp_id: 'OPP', owner_user_id: 'u_pm', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  await db.insert('allocation', { id: 'AL', employee_id: 'e_pm', project_id: 'PRJ', sector_id: 'S',
    year: Number(TODAY.slice(0, 4)), monthly_json: JSON.stringify({ [Number(TODAY.slice(5, 7))]: 0.5 }), created_at: T });
  await db.insert('task', { id: 'TK', title: 'مهمة على المشروع', project_id: 'PRJ', due_date: TODAY,
    status: 'TODO', assignee_user_id: 'u_pm', created_at: T });
  // فرصةٌ **مفتوحة** بجانب المكسوبة: صفحتا الشخص والعميل تعرضان خطّ الفرص الجاري (وهو
  // الصحيح — المكسوبة صارت مشروعاً ومكانها هناك). فبلا مفتوحةٍ في العيّنة يفشل الفحص على
  // سلوكٍ سليم، وذلك أسوأ من ألّا يوجد فحص.
  await db.insert('opportunity', { id: 'OPP2', title_ar: 'فرصة قيد المتابعة', client_id: 'CL',
    sector_id: 'S', stage_id: 'PROPOSAL', owner_user_id: 'u_pm', value_halalas: 70000, win_pct: 40,
    year: Number(TODAY.slice(0, 4)), created_at: T });
  await db.insert('deliverable', { id: 'DV', project_id: 'PRJ', name_ar: 'مخرَج', month: 3, year: 2026,
    status: 'ACCEPTED', amount_halalas: 50000, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

const has = (html, href) => html.includes(href);

test('الفرصة موصولة بعميلها وبمشروعها الناتج', async () => {
  const html = await P.opportunityDetailPage(ADMIN, 'OPP');
  assert.ok(has(html, '/app/client/CL'), 'الفرصة لا تقود إلى عميلها');
  assert.ok(has(html, '/app/project/PRJ'), 'الفرصة المكسوبة لا تقود إلى مشروعها');
});

test('والمشروع موصولٌ بعميله وفرصته المصدر — الطريق ذهاباً وإياباً', async () => {
  const html = await P.projectDetailPage(ADMIN, 'PRJ', {});
  assert.ok(has(html, '/app/client/CL'), 'المشروع لا يقود إلى عميله');
  assert.ok(has(html, '/app/opportunity/OPP'), 'المشروع لا يقود إلى فرصته المصدر');
});

// الانقطاع الذي وجده الفحص فعلاً على البيانات الحيّة.
test('واسم المُسكَّن على المشروع رابطٌ إلى صفحته لا نصٌّ جامد', async () => {
  const html = await P.projectDetailPage(ADMIN, 'PRJ', {});
  assert.ok(html.includes('مدير المشروع'), 'اسم المُسكَّن غائب عن جدول الفريق أصلاً');
  assert.ok(has(html, '/app/person/u_pm'),
    'اسم المُسكَّن نصٌّ جامد — يرى المديرُ من على مشروعه ولا يبلغ ما عنده');
});

test('وصفحة الشخص تجمع عمله كلّه: مهامه ومشاريعه وفرصه', async () => {
  const html = await P.personPage(ADMIN, 'u_pm');
  assert.ok(has(html, '/app/project/PRJ'), 'صفحة الشخص لا تقود إلى مشاريعه');
  assert.ok(has(html, '/app/opportunity/OPP2'), 'صفحة الشخص لا تقود إلى فرصه المفتوحة');
  assert.ok(html.includes('مهمة على المشروع'), 'صفحة الشخص لا تعرض مهامه');
});

test('وصفحة العميل تجمع مشاريعه وفرصه', async () => {
  const html = await P.clientDetailPage(ADMIN, 'CL');
  assert.ok(has(html, '/app/project/PRJ'), 'صفحة العميل لا تقود إلى مشاريعه');
  assert.ok(has(html, '/app/opportunity/OPP2'), 'صفحة العميل لا تقود إلى فرصه المفتوحة');
});

test('و«صفحتي» تجمع عمل صاحبها من الأنواع الثلاثة', async () => {
  const me = { id: 'u_pm', username: 'pm', name_ar: 'مدير المشروع', role_id: 'project_manager',
    scope: 'own', sector_id: 'S', projectIds: new Set(['PRJ']) };
  const html = await P.homePage(me, {});
  assert.ok(html.includes('مهمة على المشروع'), '«صفحتي» لا تعرض مهامه');
  assert.ok(html.includes('منصة البيانات'), '«صفحتي» لا تعرض مشروعه');
});
