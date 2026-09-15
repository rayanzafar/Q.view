// بطاقة «طاقة الفريق» تُفصَّل في مكانها (v5.35) — نافذة الشخص على مركز القيادة.
//
// ما تحرسه الاختبارات:
//   ١) لكل شخصٍ في كشف القارئ قالبُ نافذةٍ مخدوم من الخادم: حِمله، وشريط أشهره، ومشاريعه
//      بأسمائها، ومهامه بأسمائها، ورابط ملفه (إن كان له حساب ويحقّ للقارئ فتحه) ورابط درجه.
//   ٢) الصورة الرمزية وصفوف القائمتين تحمل معرّف الشخص وتفتح نافذته — لا نقرة صمّاء.
//   ٣) النطاق من كشف التسكين (KI-068): قارئُ إدارةٍ لا يرى اسم موظفٍ من إدارةٍ أخرى في الصفحة
//      كلها، والمشروع الشقيق يُطوى «مشروع خارج نطاقك» بلا رابط. ومن لا يقرأ الموظفين لا قالب له
//      ولا اسم — لا على البطاقة ولا في بند «فوق الطاقة».
//   ٤) سنةٌ غير جارية: لا «الشهر القادم» — الذروة والأشهر المُسكَّنة بدلاً منه.
//   ٥) لوحة التسكين تفتح درج الشخص من ?emp= إن كان في الكشف، وتتجاهل المعرّف الغريب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-cappopup-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
const { sectorPage } = await import('../../src/web/views/sector.js');
const { staffingPage } = await import('../../src/web/views/staffing.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();          // السنة الجارية كي يكون للبطاقة «شهر حالي»
const U = (id, role, scope, extra = {}) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: 'SOLUTIONS', scope,
  projectIds: new Set(), teamIds: new Set(), ...extra,
});
const lead = U('u_lead', 'sector_lead', 'sector');
const deptReader = U('u_dept', 'dept_reader', 'sector', { departmentIds: new Set(['D_AI']) });
const analyst = U('u_an', 'sector_analyst', 'sector');
const allMonths = (f) => JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, f])));

before(async () => {
  for (const [id, ar] of [['dept_reader', 'قارئ إدارة'], ['sector_analyst', 'محلل قطاع']]) {
    await insert('role', { id, name_ar: ar, name_en: id, is_system: 0, created_at: T });
  }
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', color: '#244A99', active: 1, sort_order: 1,
    target_revenue_halalas: 900_000_000, target_sales_halalas: 700_000_000, created_at: T });
  await insert('department', { id: 'D_AI', sector_id: 'SOLUTIONS', name_ar: 'إدارة الذكاء الاصطناعي', active: 1, created_at: T });
  await insert('department', { id: 'D_CITY', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  for (const u of [lead, deptReader, analyst]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', ['u_lead', 'SOLUTIONS']);
  const grant = (role, resource, action, scope) =>
    run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', [role, resource, action, scope]);
  // قارئ إدارة بوجه مركز القيادة: فرص القطاع أرقاماً (تفتح له الوجه القيادي)، والمشاريع
  // والموظفون والمهام إدارته وحدها — فالمشروع الشقيق يُطوى له
  await grant('dept_reader', 'project', 'read', 'department');
  await grant('dept_reader', 'opportunity', 'read', 'sector');
  await grant('dept_reader', 'employee', 'read', 'department');
  await grant('dept_reader', 'task', 'read', 'department');
  await grant('sector_analyst', 'project', 'read', 'sector');
  await grant('sector_analyst', 'opportunity', 'read', 'sector');
  await initRbac();

  await insert('client', { id: 'C1', name_ar: 'أمانة المنطقة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0, color: '#94a3b8' });
  await insert('project', { id: 'P_AI', code: 'PRJ-1', name_ar: 'مشروع الذكاء', sector_id: 'SOLUTIONS', department_id: 'D_AI',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, created_at: T });
  await insert('project', { id: 'P_CITY', code: 'PRJ-2', name_ar: 'مشروع المدن', sector_id: 'SOLUTIONS', department_id: 'D_CITY',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 10, created_at: T });

  for (const id of ['u_e1', 'u_e2']) {
    await insert('app_user', { id, username: id, name_ar: id, role_id: 'employee', sector_id: 'SOLUTIONS', scope: 'own', active: 1, created_at: T });
  }
  const emp = (id, name, dept, userId) => insert('employee', { id, name_ar: name, sector_id: 'SOLUTIONS', department_id: dept,
    user_id: userId, job_title: 'استشاري', active: 1, created_at: T });
  await emp('E1', 'سارة العلي', 'D_AI', 'u_e1');
  await emp('E2', 'خالد العتيبي', 'D_CITY', 'u_e2');
  await emp('E3', 'نورة القحطاني', 'D_AI', null);
  for (const [id, empId] of [['u_e1', 'E1'], ['u_e2', 'E2']]) await run('UPDATE app_user SET employee_id = ? WHERE id = ?', [empId, id]);
  const alloc = (id, empId, pid, pname, mj) => insert('allocation', { id, employee_id: empId, person_name_ar: 'x', project_id: pid,
    project_name: pname, sector_id: 'SOLUTIONS', type: 'member', year: YEAR, monthly_json: mj, source: 'manual', created_at: T });
  await alloc('A1', 'E1', 'P_AI', 'مشروع الذكاء', allMonths(0.5));
  await alloc('A2', 'E1', 'P_CITY', 'مشروع المدن', allMonths(0.2));   // خارج نطاق قارئ إدارة الذكاء
  await alloc('A3', 'E2', 'P_CITY', 'مشروع المدن', allMonths(1.2));   // فوق الطاقة
  await insert('task', { id: 'T_LATE', title: 'تحديث خطة الاختبار', sector_id: 'SOLUTIONS', project_id: 'P_AI',
    assignee_user_id: 'u_e1', status: 'TODO', priority: 'P1', due_date: '2026-01-02', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

function mainOf(html) {
  const s = html.indexOf('<main');
  const e = html.indexOf('</main>');
  assert.ok(s >= 0 && e > s, 'الصفحة تُبنى داخل قالب المنصة');
  return html.slice(html.indexOf('>', s) + 1, e)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ');
}
const tpl = (html, id) => {
  const m = html.match(new RegExp(`<template id="dd-${id}">([\\s\\S]*?)</template>`));
  return m ? m[1] : null;
};
const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/, /\bID:/];

test('قائد القطاع: لكل شخصٍ نافذةٌ بحِمله ومشاريعه ومهامه وروابطه — والصورة والقائمة تفتحانها', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  for (const rx of NO_LEAK) assert.ok(!rx.test(html), `تسرّب ${rx}`);
  const body = mainOf(html);
  assert.ok(body.includes('ضمن نطاقك'), 'عدّاد الفريق يقول إنه نطاق القارئ');
  assert.ok(body.includes('اضغط على أي شخص لعرض التفصيل'), 'الدعوة إلى النقر مكتوبة');
  assert.match(body, /class="cap-av[^"]*"[^>]*data-emp="E1"/, 'الصورة الرمزية تحمل معرّف الشخص');
  assert.match(body, /class="cap-li cap-li-btn" role="button" tabindex="0" data-action="cap-person" data-emp="E2"/, 'صفّ «يحتاجون إعادة توزيع» زرٌّ يفتح نافذة خالد');

  const s = tpl(html, 'cap-emp-E1');
  assert.ok(s, 'قالب نافذة سارة موجود');
  assert.ok(s.includes('سارة العلي') && s.includes('إدارة الذكاء الاصطناعي'), 'الاسم والإدارة في الرأس');
  assert.ok(s.includes('70%'), 'الحِمل المخطَّط ٥٠ + ٢٠');
  assert.ok(s.includes('class="cap-strip"'), 'شريط الأشهر');
  assert.ok(s.includes('الشهر القادم'), 'نافذة الشهر القادم في السنة الجارية');
  assert.ok(s.includes('href="/app/project/P_AI"') && s.includes('href="/app/project/P_CITY"'), 'المشروعان بروابطهما');
  assert.ok(s.includes('تحديث خطة الاختبار') && s.includes('متأخرة'), 'مهمتها المتأخرة بالاسم');
  assert.ok(s.includes('href="/app/person/u_e1"'), 'رابط ملفها الكامل');
  assert.ok(s.includes('emp=E1'), 'رابط درجها في لوحة التسكين');
  assert.ok(s.includes('وليست ساعات عمل فعلية'), 'جملة الأساس في كل نافذة');

  const n = tpl(html, 'cap-emp-E3');
  assert.ok(n && n.includes('لا حساب دخول مرتبط'), 'من بلا حساب: الحالة مسمّاة');
  assert.ok(!n.includes('/app/person/'), 'ولا رابط ملف لمن لا حساب له');
  assert.ok(n.includes('لا بنود تسكين'), 'ولا تسكين: حالة مصمَّمة لا صفر صامت');

  const ov = tpl(html, 'att-overload');
  assert.ok(ov && ov.includes('خالد العتيبي') && ov.includes('data-emp="E2"'), 'بند «فوق الطاقة» يسمّي خالداً ويفتح نافذته');
});

test('قارئ إدارة: اسم موظف الإدارة الأخرى غائب عن الصفحة كلها، والمشروع الشقيق مطويٌّ بلا رابط', async () => {
  const html = await sectorPage(deptReader, { year: YEAR });
  const body = mainOf(html);
  assert.ok(body.includes('سارة العلي'), 'موظفة إدارته حاضرة');
  assert.ok(!html.includes('خالد العتيبي'), 'موظف الإدارة الأخرى لا يظهر — لا على البطاقة ولا في بند «فوق الطاقة» ولا في قالب');
  assert.equal(tpl(html, 'cap-emp-E2'), null, 'ولا قالب له');
  const s = tpl(html, 'cap-emp-E1');
  assert.ok(s.includes('مشروع خارج نطاقك'), 'المشروع الشقيق باسمٍ صريح');
  assert.ok(!s.includes('/app/project/P_CITY'), 'وبلا رابط');
  assert.ok(s.includes('70%'), 'والحِمل كاملاً وإن طُوي الاسم');
});

test('من لا يقرأ الموظفين: لا قالب ولا اسم — مجاميع بلا أسماء كما كانت', async () => {
  const html = await sectorPage(analyst, { year: YEAR });
  const body = mainOf(html);
  assert.ok(body.includes('طاقة الفريق'), 'البطاقة حاضرة');
  assert.ok(body.includes('أسماء الأفراد وأحمالهم تظهر لمن يملك صلاحية عرض الفريق'));
  assert.ok(!html.includes('dd-cap-emp-'), 'لا قوالب أشخاص');
  for (const name of ['سارة العلي', 'خالد العتيبي', 'نورة القحطاني']) assert.ok(!html.includes(name), `اسم متسرّب: ${name}`);
  const ov = tpl(html, 'att-overload');
  assert.ok(ov && !ov.includes('خالد'), 'بند «فوق الطاقة» بلا أسماء له');
});

test('سنةٌ غير جارية: لا «الشهر القادم» — الذروة والأشهر المُسكَّنة', async () => {
  const html = await sectorPage(lead, { year: YEAR - 1 });
  const s = tpl(html, 'cap-emp-E1');
  assert.ok(s, 'القالب موجود للسنة الماضية أيضاً');
  assert.ok(!s.includes('الشهر القادم'));
  assert.ok(s.includes('الذروة') && s.includes('أشهر التسكين'));
});

test('لوحة التسكين: ?emp= يفتح درج الشخص إن كان في الكشف، ويتجاهل الغريب', async () => {
  const ok = await staffingPage(lead, { year: YEAR, emp: 'E1' });
  assert.ok(ok.includes('deepEmp:"E1"'), 'المعرّف يُمرَّر إلى الصفحة');
  const nope = await staffingPage(lead, { year: YEAR, emp: 'NOPE' });
  assert.ok(nope.includes('deepEmp:null'), 'والغريب يُطوى بصمت');
});
