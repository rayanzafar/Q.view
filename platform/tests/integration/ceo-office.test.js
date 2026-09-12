// ── مكتب الرئيس التنفيذي وحدةً معزولة (v5.61) ────────────────────────────────
//
// مساعدو الرئيس فريقٌ يتشارك بركةَ عمله ولا يرى قطاعاً آخر، ولا يُطلَب اعتمادٌ من الرئيس،
// والمنسّقة (نسرين) تُسنِد للأعضاء، ولكلٍّ مهامُّه الشخصية. سبعة حرّاس:
//   ① العضو يرى بركة المكتب المشتركة (مهام زملائه غير الشخصية) — لا مهامه هو وحدها.
//   ② ولا يرى قطاعاً آخر: قوائم الفرص والمشاريع والعملاء فارغة، ومهمةُ «SAP» بمعرّفها مردودة.
//   ③ العضو ينشئ مهمّته هو، ولا يُسنِد لغيره (منعٌ صريح).
//   ④ المنسّقة تُسنِد لعضوٍ في المكتب — فتظهر على بركته.
//   ⑤ ولا تُسنِد لغريبٍ خارج المكتب.
//   ⑥ مهمّةُ عضوٍ لا اعتماد لها (لا تُربَط بمشروع)، ولو رُبِطت لكان معتمِدُها المنسّقةَ لا الرئيس.
//   ⑦ المهمة الشخصية خاصّةٌ بصاحبها: لا تظهر في بركة المكتب لأحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-office-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, taskApproval, confirm, resolveUser, can;
const T = '2026-08-31T00:00:00Z';
const PERSONAL = 'personal';
const sess = async (uid) => {
  const sid = 's_' + uid + '_' + Math.random().toString(36).slice(2, 8);
  await db.insert('session', { id: sid, user_id: uid, created_at: T,
    expires_at: new Date(Date.now() + 864e5).toISOString() });
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  can = rbac.can;
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  tasks = await import('../../src/modules/pmo/tasks.js');
  taskApproval = (await import('../../src/modules/pmo/task-approval.js')).taskApproval;
  confirm = await import('../../src/modules/org/confirm.js');

  // قطاعان: مكتب الرئيس (مساند) و«SAP» (تسليم) — العزل بينهما هو ما يُختبر.
  await db.insert('sector', { id: 'CEO_OFFICE', name_ar: 'مكتب الرئيس التنفيذي', kind: 'support', active: 1, created_at: T });
  await db.insert('sector', { id: 'SAP', name_ar: 'قطاع SAP', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D_OFFICE', sector_id: 'CEO_OFFICE', name_ar: 'منسّقو مكتب الرئيس', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SAP', sector_id: 'SAP', name_ar: 'إدارة تطبيقات SAP', active: 1, created_at: T });

  // الرئيس نفسه ليس عضواً ولا مديراً هنا — وجودُه فقط ليُثبَت أن لا اعتماد يصل إليه.
  await db.insert('app_user', { id: 'u_ceo', username: 'the.ceo', name_ar: 'الرئيس التنفيذي',
    role_id: 'ceo_office', sector_id: null, scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_coord', username: 'nsreen', name_ar: 'نسرين (المنسّقة)',
    role_id: 'office_coordinator', sector_id: 'CEO_OFFICE', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_m1', username: 'office.one', name_ar: 'عضو المكتب الأول',
    role_id: 'office_member', sector_id: 'CEO_OFFICE', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_m2', username: 'office.two', name_ar: 'عضو المكتب الثاني',
    role_id: 'office_member', sector_id: 'CEO_OFFICE', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_sap', username: 'sap.person', name_ar: 'موظف SAP',
    role_id: 'employee', sector_id: 'SAP', scope: 'own', active: 1, created_at: T });

  for (const [eid, uid, dep, sec] of [
    ['e_coord', 'u_coord', 'D_OFFICE', 'CEO_OFFICE'], ['e_m1', 'u_m1', 'D_OFFICE', 'CEO_OFFICE'],
    ['e_m2', 'u_m2', 'D_OFFICE', 'CEO_OFFICE'], ['e_sap', 'u_sap', 'D_SAP', 'SAP'],
  ]) {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: uid, sector_id: sec,
      department_id: dep, job_title: 'موظف', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: eid });
  }
  // المنسّقة هي مديرةُ إدارة المكتب — فأيُّ اعتمادٍ (لو وُجد) يقصدها لا الرئيس.
  await db.update('department', 'D_OFFICE', { manager_user_id: 'u_coord' });

  // مهمة قطاع SAP — شاهدُ العزل: يجب ألّا يراها المكتب لا في القائمة ولا بمعرّفها.
  await db.insert('task', { id: 't_sap', title: 'مهمة SAP سرّية', work_kind: 'internal',
    sector_id: 'SAP', department_id: 'D_SAP', assignee_user_id: 'u_sap', created_by: 'u_sap',
    priority: 'P2', status: 'TODO', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// teamTasks تُرجِع مجموعاتٍ حسب الشخص، كلٌّ منها {tasks:[...]} — نُسطّحها للفحص.
const flatBoard = (groups) => groups.flatMap((g) => g.tasks || []);
const boardIds = (groups) => flatBoard(groups).map((r) => r.id);

// ④ المنسّقة تُسنِد لعضو ⇒ يظهر على بركته ── و③ العضو لا يُسنِد لغيره
test('المنسّقة تُسنِد مهمة لعضو المكتب — والعضو لا يُسنِد لزميله', async () => {
  const coord = await ctxOf('u_coord');
  const r = await tasks.quickAddTask(coord, { title: 'راجع عرض مجلس الإدارة', assignee_user_id: 'u_m1',
    category: 'عمل إداري' });
  const tid = r.task?.id || r.id;
  assert.ok(tid, 'المنسّقة لم تستطع الإنشاء والإسناد');
  assert.equal((await db.get('SELECT assignee_user_id FROM task WHERE id=?', [tid])).assignee_user_id, 'u_m1');

  // العضو يُسنِد لزميله ⇒ مردود
  const m1 = await ctxOf('u_m1');
  await assert.rejects(() => tasks.quickAddTask(m1, { title: 'مهمة لزميلي', assignee_user_id: 'u_m2' }),
    /صلاحي|لا تسمح|إسناد/);
});

// ① العضو يرى بركة المكتب المشتركة (مهمة أسندتها المنسّقة لزميله) و⑦ لا يرى الشخصية
test('عضو المكتب يرى بركة عمل المكتب كلها — لا مهامه وحده — والشخصيات مخفيّة', async () => {
  const coord = await ctxOf('u_coord');
  await tasks.quickAddTask(coord, { title: 'حضّر محضر الاجتماع', assignee_user_id: 'u_m2', category: 'اجتماع داخلي' });
  // مهمة شخصية لعضوٍ آخر — يجب ألّا تظهر لأحد
  await tasks.quickAddTask(await ctxOf('u_m2'), { title: 'موعد طبيبي', work_kind: PERSONAL });

  const m1 = await ctxOf('u_m1');
  const board = await tasks.teamTasks(m1.user, {});
  const titles = flatBoard(board).map((t) => t.title);
  assert.ok(titles.includes('راجع عرض مجلس الإدارة'), 'العضو لا يرى ما أُسند لزميله ①');
  assert.ok(titles.includes('حضّر محضر الاجتماع'), 'العضو لا يرى بركة المكتب كاملة');
  assert.ok(!titles.includes('موعد طبيبي'), 'مهمة شخصية ظهرت في بركة المكتب ⑦');
});

// ② العزل: لا قطاع آخر — قوائم فارغة ومهمة SAP لا تُقرأ بمعرّفها
test('عضو المكتب لا يرى قطاع SAP: القوائم فارغة، ومهمة SAP بصفّها لا تُقرأ', async () => {
  const m1 = await ctxOf('u_m1');
  const board = await tasks.teamTasks(m1.user, {});
  assert.ok(!boardIds(board).includes('t_sap'), 'مهمة SAP تسرّبت إلى بركة المكتب ②');

  const opps = await import('../../src/modules/crm/opportunities.js');
  const projects = await import('../../src/modules/pmo/projects.js');
  assert.deepEqual((await opps.listOpportunities(m1.user)).map((o) => o.id), [], 'العضو يرى فرصاً');
  assert.deepEqual((await projects.listProjects(m1.user)).map((p) => p.id), [], 'العضو يرى مشاريع');

  // حارس IDOR: صفّ مهمة SAP بعينه — القراءة عليه مرفوضة (نطاق «إدارة» لا يبلغ قطاعاً آخر).
  const sapRow = await db.get('SELECT id, sector_id, department_id, assignee_user_id FROM task WHERE id=?', ['t_sap']);
  assert.equal(can(m1.user, 'read', 'task', sapRow), false, 'العضو يقرأ مهمة قطاع آخر ②');
});

// ⑥ لا اعتماد من الرئيس: مهمة العضو غير مربوطة ⇒ لا اعتماد؛ ولو رُبِطت فالمعتمِد المنسّقة
test('مهمة عضو المكتب لا تُطلَب لها موافقةٌ من الرئيس', async () => {
  // مهمة داخلية غير مربوطة ⇒ لا اعتماد لأي أحد
  const none = await taskApproval((await ctxOf('u_m1')).user, { project_id: null, opportunity_id: null });
  assert.equal(none.needsApproval, false, 'مهمة غير مربوطة طُلب لها اعتماد');

  // ولو فُرِض ربطٌ يوماً: معتمِدُ العضو مديرُ إدارته = المنسّقة، لا الرئيس
  const approver = await confirm.managerOfEmployee('e_m1');
  assert.equal(approver, 'u_coord', 'معتمِد العضو ليس المنسّقة');
  assert.notEqual(approver, 'u_ceo', 'اعتمادُ العضو يصل الرئيس ⑥');
});

// ⑤ المنسّقة لا تُسنِد لغريبٍ خارج المكتب ── و العضو يضيف مهمّته الشخصية
test('المنسّقة لا تُسنِد لموظف خارج المكتب — والعضو يضيف مهمّته الشخصية بحرّية', async () => {
  const coord = await ctxOf('u_coord');
  await assert.rejects(() => tasks.quickAddTask(coord, { title: 'مهمة لموظف SAP', assignee_user_id: 'u_sap' }),
    /صلاحي|لا تسمح|إسناد/, 'المنسّقة أسندت لغريب ⑤');

  const m1 = await ctxOf('u_m1');
  const p = await tasks.quickAddTask(m1, { title: 'مذكرة شخصية', work_kind: PERSONAL });
  assert.ok(p.task?.id || p.id, 'العضو لم يستطع إضافة مهمّته الشخصية');
});
