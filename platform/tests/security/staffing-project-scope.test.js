// التسكين يمنح رؤية المشروع — وأثره لا يتجاوز ما سُكِّن عليه.
//
// العطب الذي يغلقه هذا الملف: نطاق المشروع كان يُبنى من الملكية والعضوية فقط، و**لا مسار في
// المنتج كله يكتب عضوية مشروع** (المسار الوحيد الذي يكتب جدول العضويات يكتب نوع «فرصة»). فكل
// منح `scope:'project'` — وهو كامل صلاحيات المستشار والموظف — يسقط مغلقاً على شخص مسكَّن فعلاً:
// يفتح صفحة مشروعه فيُرَد، ومهامه فتُرَد، ومخرجاته فتُرَد. وكان الالتفاف موضعياً في شاشة واحدة.
//
// والخطر المقابل الذي تحرسه الاختبارات بالقدر نفسه: ألّا يتحول الإصلاح إلى تسريب — تسكين محذوف
// ناعماً، أو مشروع محذوف، أو مشروع لم يُسكَّن عليه أحد، لا يمنح شيئاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-scope.db');
process.env.SANAD_DB = TEST_DB;

const T = '2026-03-01T08:00:00.000Z';
const YEAR = new Date().getUTCFullYear();
let db, ids, resolveUser, can, ROLE_GRANTS;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

const SID = 'sess_staffed';

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  ({ can } = await import('../../src/core/rbac/index.js'));
  ({ ROLE_GRANTS } = await import('../../src/core/rbac/matrix.js'));

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'S1', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'مستشار مسكَّن', sector_id: 'S1', department_id: 'D1', active: 1, created_at: T });
  await db.insert('app_user', { id: 'U1', username: 'staffed', role_id: 'consultant', sector_id: 'S1',
    scope: 'own', employee_id: 'E1', active: 1, created_at: T });
  await db.insert('session', { id: SID, user_id: 'U1', created_at: T, expires_at: '2099-01-01T00:00:00.000Z' });

  // أربعة مشاريع: مسكَّن عليه · مسكَّن ثم أُلغي التسكين · مشروع محذوف مع تسكين حيّ · لم يُسكَّن عليه
  for (const [pid, name] of [['P_ON', 'مشروع مسكَّن عليه'], ['P_OFF', 'مشروع أُلغي تسكينه'],
    ['P_DEL', 'مشروع محذوف'], ['P_NONE', 'مشروع بلا تسكين']])
    await db.insert('project', { id: pid, name_ar: name, sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  await db.run('UPDATE project SET deleted_at = ? WHERE id = ?', [T, 'P_DEL']);

  const alloc = (pid, deleted) => db.insert('allocation', { id: ids.id('alc'), employee_id: 'E1', project_id: pid,
    sector_id: 'S1', type: 'member', monthly_json: '{"3":1}', year: YEAR, source: 'manual',
    created_at: T, deleted_at: deleted || null });
  await alloc('P_ON'); await alloc('P_OFF', T); await alloc('P_DEL');
});
after(async () => { await db.close(); wipe(); });

test('المسكَّن يصل إلى مشروعه — كان يُرَد عنه رغم أنه يعمل فيه', async () => {
  const u = await resolveUser(SID);
  assert.ok(u, 'الجلسة تُحلّ إلى مستخدم');
  assert.ok(u.projectIds.has('P_ON'), 'المشروع المسكَّن عليه داخل نطاقه');
  const p = await db.get('SELECT * FROM project WHERE id = ?', ['P_ON']);
  assert.equal(can(u, 'read', 'project', p), true, 'وفحص الصلاحية يمرّ على صف المشروع نفسه');
});

test('لا يتجاوز الإصلاح ما سُكِّن عليه — ثلاث حالات لا تمنح شيئاً', async () => {
  const u = await resolveUser(SID);
  assert.ok(!u.projectIds.has('P_NONE'), 'مشروع لم يُسكَّن عليه: لا وصول');
  assert.ok(!u.projectIds.has('P_OFF'), 'تسكين محذوف ناعماً: لا وصول');
  assert.ok(!u.projectIds.has('P_DEL'), 'مشروع محذوف ولو بقي التسكين: لا وصول');
  const none = await db.get('SELECT * FROM project WHERE id = ?', ['P_NONE']);
  assert.equal(can(u, 'read', 'project', none), false, 'وفحص الصلاحية يرفضه');
});

test('الملكية تبقى مصدراً مستقلاً — الإصلاح أضاف ولم يستبدل', async () => {
  await db.insert('project', { id: 'P_OWN', name_ar: 'مشروع يملكه', sector_id: 'S1', owner_user_id: 'U1',
    status: 'IN_PROGRESS', rag: 'GREEN', created_at: T });
  const u = await resolveUser(SID);
  assert.ok(u.projectIds.has('P_OWN'), 'ما يملكه يبقى داخل نطاقه');
  assert.ok(u.projectIds.has('P_ON'), 'ومعه ما سُكِّن عليه');
});

test('مستخدم بلا ربط بموظف لا يكتسب شيئاً — التسكين يُقرأ عبر الموظف', async () => {
  await db.insert('app_user', { id: 'U2', username: 'unlinked', role_id: 'consultant', sector_id: 'S1',
    scope: 'own', active: 1, created_at: T });
  await db.insert('session', { id: 'sess_unlinked', user_id: 'U2', created_at: T, expires_at: '2099-01-01T00:00:00.000Z' });
  const u = await resolveUser('sess_unlinked');
  assert.equal(u.projectIds.size, 0, 'بلا ربط بموظف: نطاق مشاريع فارغ');
});

// ── «المدير المباشر»: نطاق قابل للتحقق بدل نطاق لا يُجتاز أبداً ─────────────────
test('منح «المدير المباشر» لم يعد بنطاق الفريق — كان يسقط مغلقاً في كل فحص صف', () => {
  const g = ROLE_GRANTS.line_manager;
  assert.ok(g.length, 'للدور منح');
  assert.equal(g.filter((x) => x.scope === 'team').length, 0, 'لا منح بنطاق الفريق — نطاق غير قابل للاجتياز');
  // منحُه **الإداري** كله بنطاق الإدارة. ولا يُشترط أن يكون كل منح كذلك: المدير المباشر شخصٌ
  // أيضاً، فله منح «خاصتي» على وقته هو — وهي إضافة لاحقة مقصودة لا انحراف عن هذا القرار.
  const managerial = g.filter((x) => x.scope !== 'own');
  assert.ok(managerial.length, 'له منح إدارية');
  assert.ok(managerial.every((x) => x.scope === 'department'), 'وكلها بنطاق الإدارة');
  assert.ok(g.some((x) => x.resource === 'timesheet' && x.action === 'approve' && x.scope === 'department'),
    'واعتماد كشوف الدوام باقٍ بنطاق قابل للتحقق — هو سبب وجود الدور');
});

test('نطاق «الفريق» يبقى مغلقاً حيث بقي — لا يُفتح فراغاً', async () => {
  const { scopeReaches } = await import('../../src/core/rbac/index.js');
  const u = await resolveUser(SID);
  assert.equal(scopeReaches(u, 'team', { team_id: 'T1' }), false, 'بلا عضوية فرق حقيقية يُرفض');
  assert.equal(scopeReaches(u, 'team', {}), false, 'وهدف بلا فريق يُرفض ولا يمرّ فراغاً');
});

// ── الترحيلة 010 ───────────────────────────────────────────────────────────────
test('المهمة صارت تحمل إدارتها وخطوتها التالية', async () => {
  await db.insert('task', { id: 'TSK1', title: 'مهمة', sector_id: 'S1', department_id: 'D1',
    next_step: 'مراجعة المخرج مع العميل', status: 'TODO', created_at: T });
  const t = await db.get('SELECT department_id, next_step FROM task WHERE id = ?', ['TSK1']);
  assert.equal(t.department_id, 'D1');
  assert.equal(t.next_step, 'مراجعة المخرج مع العميل');
});

test('الترحيلة لا تُسنِد شيئاً تلقائياً — نسبة العمل قرار بشري', async () => {
  await db.insert('task', { id: 'TSK2', title: 'مهمة بلا إسناد', sector_id: 'S1', status: 'TODO', created_at: T });
  const t = await db.get('SELECT department_id, next_step FROM task WHERE id = ?', ['TSK2']);
  assert.equal(t.department_id, null, 'بلا تخمين من قطاع المشروع');
  assert.equal(t.next_step, null);
});
