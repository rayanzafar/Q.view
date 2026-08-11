// ── العضوية المعلَّقة لا تفتح الفرصة قبل موافقة المدير (v5.24) ────────────────
//
// القاعدة المعتمدة (B8.5 في حزمة المالك، وتوثيق ARCHITECTURE.md نفسه): «لا membership ولا
// access قبل الموافقة». وكان `opportunityIds` عند حلّ الجلسة يضمّ العضويات المعلَّقة، فيقرأ
// الموظفُ فرصةً لم يوافق مديره بعدُ على عمله فيها — والفرصة قبل الترسية سرُّ أهلها.
// الإصلاح في `core/http/context.js`: استثناء `status='PENDING'`. وهذا حارسه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-pendacc-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, oppteam, engine, depts, resolveUser;
const T = new Date().toISOString();
let DM_INNO, DM_AI;

// الجلسة تُحلّ كما يحلّها الخادم — لا كائن مركّب باليد يفحص افتراضَنا لا المنتج.
const sess = async (uid) => {
  const sid = 's_' + uid + '_' + Math.random().toString(36).slice(2, 8);
  await db.insert('session', { id: sid, user_id: uid, created_at: T,
    expires_at: new Date(Date.now() + 864e5).toISOString() });
  return await resolveUser(sid);
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  opps = await import('../../src/modules/crm/opportunities.js');
  oppteam = await import('../../src/modules/crm/oppteam.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_inno', username: 'inno', name_ar: 'مدير الابتكار', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ai', username: 'ai', name_ar: 'مدير الذكاء', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  // الموظف المضموم: استشاري بنطاق «خاصتي» — لا يصل للفرصة إلا بالعضوية.
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'عمار الرجوب', role_id: 'consultant', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL', manager_user_id: 'u_inno', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء', sector_id: 'SOL', manager_user_id: 'u_ai', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_theirs', name_ar: 'عمار الرجوب', sector_id: 'SOL', department_id: 'D_AI', user_id: 'u_emp', active: 1, created_at: T });
  await db.update('app_user', 'u_emp', { employee_id: 'e_theirs' });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('opportunity', { id: 'OPP', title_ar: 'منصة سرية قبل الترسية', sector_id: 'SOL', department_id: 'D_INNO',
    stage_id: 'PROPOSAL', value_halalas: 100000, owner_user_id: 'u_inno', created_at: T });

  const mk = async (uid) => ({
    id: uid, username: uid, role_id: 'department_manager', scope: 'department', sector_id: 'SOL',
    department_id: null, departmentIds: await depts.readerDepartmentIds(uid, null),
  });
  DM_INNO = await mk('u_inno');
  DM_AI = await mk('u_ai');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('قبل الضمّ: لا يرى الفرصة أصلاً — خط الأساس', async () => {
  const emp = await sess('u_emp');
  assert.ok(!(emp.opportunityIds ? [...emp.opportunityIds] : []).includes('OPP'));
  assert.equal((await opps.listOpportunities(emp)).length, 0);
});

test('ضُمّ من مديرٍ لا يملك أمره ⇒ معلَّق، ولا قراءة قبل موافقة مديره', async () => {
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_theirs', role_in_group: 'member' });
  const m = await db.get("SELECT * FROM membership WHERE group_kind='opportunity' AND group_id='OPP' AND employee_id='e_theirs' AND deleted_at IS NULL");
  assert.equal(m.status, 'PENDING', 'العيّنة ليست معلَّقة — الفحص لا يقيس شيئاً');

  const emp = await sess('u_emp');
  assert.ok(!(emp.opportunityIds ? [...emp.opportunityIds] : []).includes('OPP'),
    'الجلسة تحمل فرصةً لم يوافق المدير بعدُ على العمل فيها — التسريب عاد');
  assert.equal((await opps.listOpportunities(emp)).length, 0, 'المعلَّق يرى الفرصة في قائمته');
  await assert.rejects(() => opps.opportunityDetail(emp, 'OPP'), 'المعلَّق يفتح صفحة الفرصة');
});

test('فإذا وافق مديره فُتح له الباب — العضوية الفعلية تمنح القراءة', async () => {
  const q = await engine.myDirectApprovals(DM_AI);
  await engine.actOnApproval({ user: DM_AI, ip: '1' }, q[0].id, 'approve', 'نعم يعمل عليها');
  const emp = await sess('u_emp');
  assert.ok((emp.opportunityIds ? [...emp.opportunityIds] : []).includes('OPP'), 'الموافقة لم تفتح الوصول');
  assert.equal((await opps.listOpportunities(emp)).map((o) => o.id).join(), 'OPP');
  const d = await opps.opportunityDetail(emp, 'OPP');
  assert.equal(d.opp.id, 'OPP');
  // والعضوية قراءةٌ فقط — لا تعديل بها (حكم scope.js الصلب).
  assert.equal(d.canEdit, false, 'العضوية منحت تعديلاً — الحكم الصلب انكسر');
});

test('وطلبات الضمّ المعلَّقة يراها من يقرأ الفرصة (رؤية الطالب لمصير طلبه)', async () => {
  // عيّنة جديدة معلَّقة على الفرصة نفسها
  await db.insert('employee', { id: 'e_two', name_ar: 'موظف ثانٍ', sector_id: 'SOL', department_id: 'D_AI', active: 1, created_at: T });
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_two', role_in_group: 'member' });
  const rows = await oppteam.pendingTeamApprovals(DM_INNO, 'OPP');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employee_name, 'موظف ثانٍ');
  assert.equal(rows[0].approver_name, 'مدير الذكاء');
});
