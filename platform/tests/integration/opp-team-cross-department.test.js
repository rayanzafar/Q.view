// «ممكن في فرصة ناس من تطوير الأعمال وناس من إدارات مختلفة تشتغل عليها، فمدير أي إدارة يقدر
// يسكّن بعض الناس على فرصة موجودين في إدارة مختلفة — ولازم البحث بالاسم» — بلسان المالك.
//
// والصلاحية كانت مفتوحةً أصلاً: `addMember` لا يشترط على الموظف نطاقاً، فمدير الإدارة **يستطيع**
// ضمّ أي أحد منذ اليوم الأول. العطل أن القائمة كانت تُقرأ من كشف التسكين وهو محدودٌ بإدارة
// القارئ عن حقّ — فكان يستطيع الإضافة ولا يستطيع **العثور**: باب مفتوح بلا مفتاح.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppteam-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, oppteam, depts, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
let DM; // مدير «إدارة الابتكار» — يقودها وحدها

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  oppteam = await import('../../src/modules/crm/oppteam.js');
  depts = await import('../../src/core/rbac/departments.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'BD', name_ar: 'تطوير الأعمال', kind: 'support', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dm', username: 'dm', name_ar: 'مدير الابتكار', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء', sector_id: 'SOL', active: 1, created_at: T });

  await db.insert('employee', { id: 'e_mine', name_ar: 'سجى لشكر', job_title: 'استشارية',
    sector_id: 'SOL', department_id: 'D_INNO', active: 1, created_at: T });
  // شخصٌ في إدارةٍ أخرى، وآخر في تطوير الأعمال — وهما بالضبط من يريد المالك ضمّهما.
  await db.insert('employee', { id: 'e_other', name_ar: 'عمار الرجوب', job_title: 'مهندس حلول',
    sector_id: 'SOL', department_id: 'D_AI', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_bd', name_ar: 'محمود قشطة', job_title: 'أخصائي تطوير أعمال',
    sector_id: 'BD', active: 1, created_at: T });
  // حساب عرضٍ مربوطٌ بموظف — يجب ألّا يظهر لغير مدير النظام.
  await db.insert('app_user', { id: 'u_demo', username: 'demo.ops', name_ar: 'العمليات (تجريبي)', role_id: 'operations', scope: 'company', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_demo', name_ar: 'ريم الدوسري (تجريبي)', sector_id: 'SOL', user_id: 'u_demo', active: 1, created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('opportunity', { id: 'OPP', title_ar: 'منصة تحليلات', sector_id: 'SOL', department_id: 'D_INNO',
    stage_id: 'PROPOSAL', value_halalas: 100000, owner_user_id: 'u_admin', created_at: T });

  DM = { id: 'u_dm', username: 'dm', name_ar: 'مدير الابتكار', role_id: 'department_manager',
    scope: 'department', sector_id: 'SOL', department_id: null,
    departmentIds: await depts.readerDepartmentIds('u_dm', null) };
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('مدير الإدارة يجد أهل الإدارات الأخرى وتطوير الأعمال في قائمة الضمّ', async () => {
  const r = await oppteam.rosterForOpportunity(DM, 'OPP');
  const names = r.roster.map((x) => x.name_ar);
  assert.ok(names.includes('سجى لشكر'), 'أهل إدارته غائبون');
  assert.ok(names.includes('عمار الرجوب'), 'أهل الإدارة الأخرى غائبون — وهو بيت القصيد');
  assert.ok(names.includes('محمود قشطة'), 'تطوير الأعمال غائب');
});

test('ويضمّ فعلاً شخصاً من إدارةٍ ليست له — لا يُرَدّ', async () => {
  await oppteam.addMember({ user: DM, ip: '1' }, 'OPP', { employee_id: 'e_other', role_in_group: 'member' });
  const team = await oppteam.getTeam(DM, 'OPP');
  assert.ok(team.some((m) => m.employee_id === 'e_other' || m.name_ar === 'عمار الرجوب'),
    'الضمّ عبر الإدارات لم يُكتب');
});

test('ومن ضُمّ يختفي من القائمة — فلا يُختار مرتين ليُقال «عضو مسبقاً»', async () => {
  const r = await oppteam.rosterForOpportunity(DM, 'OPP');
  assert.ok(!r.roster.some((x) => x.id === 'e_other'), 'العضو الحالي ما زال معروضاً للضمّ');
});

test('والقائمة تُبحَث بالاسم — جزءٌ من الاسم يكفي', async () => {
  const r = await oppteam.rosterForOpportunity(DM, 'OPP', { q: 'قشطة' });
  assert.equal(r.roster.length, 1);
  assert.equal(r.roster[0].name_ar, 'محمود قشطة');
  const none = await oppteam.rosterForOpportunity(DM, 'OPP', { q: 'لا أحد بهذا الاسم' });
  assert.equal(none.roster.length, 0, 'بحثٌ بلا نتيجة يعيد فراغاً لا الكل');
});

test('وكل اسمٍ يحمل إدارته وقطاعه — فمن يضمّ يعرف من أين يأخذ', async () => {
  const r = await oppteam.rosterForOpportunity(DM, 'OPP', { q: 'سجى' });
  assert.equal(r.roster[0].department_name, 'إدارة الابتكار');
  assert.equal(r.roster[0].sector_name, 'قطاع الحلول');
});

test('وحسابات العرض خارج القائمة لغير مدير النظام', async () => {
  const forDm = await oppteam.rosterForOpportunity(DM, 'OPP');
  assert.ok(!forDm.roster.some((x) => /تجريبي/.test(x.name_ar)), 'موظف عرضٍ معروضٌ للضمّ');
  const forAdmin = await oppteam.rosterForOpportunity(ADMIN, 'OPP');
  assert.ok(forAdmin.roster.some((x) => /تجريبي/.test(x.name_ar)), 'مدير النظام لا يرى ما يديره');
});

// والحدّ محفوظ: القائمة ليست بابَ تسريبٍ لمن لا يملك الفرصة أصلاً.
test('ومن لا يملك تعديل الفرصة لا تُفتح له القائمة إطلاقاً', async () => {
  await db.insert('app_user', { id: 'u_c', username: 'c', name_ar: 'استشاري', role_id: 'consultant', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  const consultant = { id: 'u_c', username: 'c', role_id: 'consultant', scope: 'own', sector_id: 'SOL' };
  await assert.rejects(() => oppteam.rosterForOpportunity(consultant, 'OPP'), (e) => /صلاحية/.test(e.message));
});

test('وحقل البحث على الشاشة لا قائمةٌ منسدلة — مئات الأسماء لا يُبحث فيها', async () => {
  const html = await P.opportunityDetailPage(ADMIN, 'OPP');
  assert.ok(html.includes('team-emp-q') && html.includes('list="team-roster"'), 'لا حقل بحث بالاسم');
  assert.ok(html.includes('<datalist id="team-roster">'), 'لا قائمة اقتراحات');
  assert.ok(!html.includes('data-roster'), 'ما زالت القائمة المنسدلة القديمة مرسومة');
});
