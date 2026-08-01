// «صفحتي» بلا بوابة صلاحيات — وهذا صحيحٌ بشرطٍ واحد: ألّا يظهر فيها أحدٌ غير صاحبها.
//
// الشرط يُفحص هنا على **الصفحة المرسومة** لا على الخدمة وحدها: خدمةٌ نظيفة يمكن أن تُغلَّف
// بشاشةٍ تضيف استعلاماً من عندها، فيصير التسريب في طبقة العرض. ويُفحص كذلك ما هو أخطر من
// التسريب في أثره اليومي: **رابطٌ يَعِد بشاشة يردّها النظام** — فمن لا يفتح «المشاريع» يجب أن
// يقرأ اسم مشروعه نصّاً لا رابطاً يقوده إلى «خارج صلاحياتك».
//
// وثالثةٌ بنيوية: الصفحة مسجَّلة في كل المواضع الأربعة معاً (خريطة الصفحات، سياسة الفتح،
// القائمة الجانبية، وجهة الدخول). صفحةٌ تنقص من أحدها تعمل جزئياً — تُفتح بالعنوان ولا يبلغها
// أحد، أو تظهر في القائمة ويردّها الحارس.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-homepage-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let pages, db, rbac, nav, policy, routes;
const T = new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);
const MINE = { id: 'u_me', username: 'me', name_ar: 'د. ريان زافار', role_id: 'project_manager', scope: 'own', sector_id: 'S1' };
// «المدير المباشر» لا يفتح «المشاريع» ولا «الفرص» (منحه على الأشخاص لا على العمل نفسه) —
// فصفحته يجب أن تعرض له مشاريعه وفرصه نصّاً بلا رابطٍ واحد يقوده إلى «خارج صلاحياتك».
const OUTSIDER = { id: 'u_me', username: 'me', name_ar: 'ريان', role_id: 'line_manager', scope: 'team', sector_id: 'S1' };

// النص الظاهر وحده: الوسوم والنصوص المخفية ليست ما يقرأه الإنسان.
const visible = (html) => (html.split('<main')[1] || '')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<template[\s\S]*?<\/template>/g, ' ')
  .replace(/<[^>]+>/g, ' ');

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  nav = await import('../../src/web/nav.js');
  policy = await import('../../src/core/policy/pages.js');
  routes = await import('../../src/web/routes.js');
  pages = await import('../../src/web/pages.js');
  await rbac.initRbac();

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: 'جهة', created_at: T });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('app_user', { id: 'u_me', username: 'me', role_id: 'project_manager', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_them', username: 'them', role_id: 'employee', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_me', name_ar: 'ريان', user_id: 'u_me', sector_id: 'S1', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_them', name_ar: 'زميلي', user_id: 'u_them', sector_id: 'S1', active: 1, created_at: T });

  await db.insert('project', { id: 'p_mine', name_ar: 'مشروع تحت يدي', client_id: 'c1', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'AMBER', created_at: T });
  await db.insert('project', { id: 'p_theirs', name_ar: 'مشروع سرّي لغيري', client_id: 'c1', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  await db.insert('allocation', { id: 'al1', employee_id: 'e_me', project_id: 'p_mine', sector_id: 'S1', year: Number(TODAY.slice(0, 4)), monthly_json: JSON.stringify({ [Number(TODAY.slice(5, 7))]: 0.5 }), created_at: T });
  await db.insert('allocation', { id: 'al2', employee_id: 'e_them', project_id: 'p_theirs', sector_id: 'S1', year: Number(TODAY.slice(0, 4)), monthly_json: '{}', created_at: T });
  await db.insert('task', { id: 't1', title: 'مهمة باسمي', project_id: 'p_mine', due_date: TODAY, status: 'TODO', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't2', title: 'مهمة سرّية لغيري', project_id: 'p_theirs', due_date: TODAY, status: 'TODO', assignee_user_id: 'u_them', created_at: T });
  await db.insert('opportunity', { id: 'o1', title_ar: 'فرصة باسمي', client_id: 'c1', sector_id: 'S1', stage_id: 'PROPOSAL', owner_user_id: 'u_me', value_halalas: 100000, created_at: T });
  await db.insert('opportunity', { id: 'o2', title_ar: 'فرصة سرّية لغيري', client_id: 'c1', sector_id: 'S1', stage_id: 'PROPOSAL', owner_user_id: 'u_them', value_halalas: 100000, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('الصفحة المرسومة لا تحمل صفّاً واحداً لغير صاحبها', async () => {
  const html = await pages.homePage(MINE, {});
  const txt = visible(html);
  for (const secret of ['مهمة سرّية لغيري', 'فرصة سرّية لغيري', 'مشروع سرّي لغيري', 'زميلي']) {
    assert.ok(!txt.includes(secret), `تسرّب «${secret}» إلى صفحة شخصٍ آخر`);
  }
  for (const own of ['مهمة باسمي', 'فرصة باسمي', 'مشروع تحت يدي']) {
    assert.ok(txt.includes(own), `عمل صاحب الصفحة «${own}» غائب عنها`);
  }
});

test('ولا تسرّب قيمة خام ولا مصطلحاً تقنياً في نصّها الظاهر', async () => {
  const txt = visible(await pages.homePage(MINE, {}));
  for (const bad of ['undefined', 'NaN', '[object', 'IN_PROGRESS', 'AMBER', 'TODO', 'PENDING']) {
    assert.ok(!txt.includes(bad), `ظهرت «${bad}» في نصٍّ يقرأه المستخدم`);
  }
  assert.ok(txt.includes('أصفر'), 'صحة المشروع لم تُترجَم إلى العربية');
});

// ── لا وعدَ بشاشة يردّها النظام ──
test('من لا يفتح «المشاريع» يقرأ اسم مشروعه نصّاً لا رابطاً يقوده إلى الرفض', async () => {
  const open = await pages.homePage(MINE, {});
  assert.ok(open.includes('/app/project/p_mine'), 'مَن يفتح المشاريع حُرم من رابطها');

  const shut = await pages.homePage(OUTSIDER, {});
  assert.equal(policy.PAGE_ACCESS.projects(OUTSIDER), false, 'الفحص بلا دورٍ محروم لا يثبت شيئاً');
  assert.ok(!shut.includes('/app/project/'), 'رابط مشروع لمن يردّه حارس الصفحة');
  assert.ok(!shut.includes('/app/opportunity/'), 'رابط فرصة لمن يردّه حارس الصفحة');
  assert.ok(visible(shut).includes('مشروع تحت يدي'), 'حُذف المحتوى بدل أن يُحذف الرابط وحده');
});

// ── التسجيل في المواضع الأربعة ──
test('الصفحة مسجَّلة في كل المواضع معاً — لا نصف تسجيل', () => {
  assert.equal(typeof policy.PAGE_ACCESS.home, 'function', 'لا سياسة فتحٍ للصفحة');
  assert.equal(policy.PAGE_ACCESS.home({ id: 'x', role_id: 'external', scope: 'own' }), true,
    'الصفحة مغلقة على من لا يملك منحاً — وكل ما فيها بياناته هو');
  assert.ok(nav.NAV_ITEMS.some((n) => n.key === 'home'), 'الصفحة خارج القائمة الجانبية — تُفتح بالعنوان ولا يبلغها أحد');
  assert.equal(nav.NAV_ITEMS[0].key, 'home', 'ليست أول القائمة رغم أنها وجهة الدخول');
  assert.equal(nav.pageAllowed(OUTSIDER, 'home'), true);
  assert.equal(typeof pages.homePage, 'function', 'الصفحة غير مُصدَّرة من حزمة الصفحات');
});

test('ووجهة الدخول تقود إليها لكل دور — من المدير إلى الموظف', () => {
  for (const role of ['admin', 'ceo_office', 'sector_lead', 'project_manager', 'employee', 'external']) {
    assert.equal(routes.landingFor({ id: 'x', role_id: role, scope: 'own' }), 'home', `${role} يهبط على غيرها`);
  }
  assert.equal(routes.landingFor(null), 'tasks', 'زائرٌ بلا حساب فقد قاعه الآمن');
});

// ── حالة الشاشة في العنوان ──
test('شهر التقويم واليوم المفتوح يُقرآن من العنوان — فالحالة تُشارَك ويرجع إليها زرّ الرجوع', async () => {
  const html = await pages.homePage(MINE, { m: '2027-03' });
  assert.ok(visible(html).includes('مارس'), 'لم يُفتح الشهر المطلوب');
  assert.ok(html.includes('/app/home?m=2027-02') && html.includes('/app/home?m=2027-04'), 'سهما التنقّل لا يقودان إلى الشهرين المجاورين');
  // شهرٌ ملفَّق في العنوان لا يكسر الشاشة: يسقط إلى شهر اليوم بهدوء
  const bad = await pages.homePage(MINE, { m: '2026-13', d: '../../etc' });
  assert.ok(bad.includes('/app/home?m='), 'انكسرت الشاشة على قيمة ملفَّقة في العنوان');
  assert.ok(!bad.includes('etc'), 'قيمة ملفَّقة عبرت إلى الصفحة كما هي');
});
