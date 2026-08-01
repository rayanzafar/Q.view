// المهام — لم يكن لها **أي اختبار إطلاقاً** رغم أنها الصفحة الافتراضية لأغلب المستخدمين
// وصفحة العودة من كل رفض صلاحية. هذا الملف يغطي الثغرات الثلاث المُصلَحة والميزتين الجديدتين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-tasks-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, update, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const T = await import('../../src/modules/pmo/tasks.js');

const TS = '2026-07-01T00:00:00Z';
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (id, role, sector, scope) => ({ id, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });

const lead = U('u_lead', 'sector_lead', 'S1', 'sector');       // قائد قطاع الحلول
const emp = U('u_emp', 'employee', 'S1', 'own');                // موظف عادي داخل القطاع
const outsider = U('u_out', 'employee', 'S2', 'own');           // موظف في قطاع آخر
const ceo = U('u_ceo', 'ceo_office', null, 'company');

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'الحلول', active: 1, sort_order: 1, created_at: TS });
  await insert('sector', { id: 'S2', name_ar: 'الاستشارات', active: 1, sort_order: 2, created_at: TS });
  for (const [id, sec] of [['u_lead', 'S1'], ['u_emp', 'S1'], ['u_out', 'S2'], ['u_ceo', null]]) {
    await insert('app_user', { id, username: id, name_ar: 'مستخدم ' + id, role_id: id === 'u_lead' ? 'sector_lead' : 'employee',
      sector_id: sec, scope: 'own', active: 1, created_at: TS });
  }
  await insert('project', { id: 'P1', name_ar: 'مشروع حيّ', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: TS });
  await insert('project', { id: 'P_DEL', name_ar: 'مشروع محذوف', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: TS, deleted_at: TS });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── الثغرة ١: إسناد مهمة لأي مستخدم في الشركة ──
test('ثغرة مُصلَحة: الموظف لا يستطيع دفع مهمة إلى قائمة شخص آخر', async () => {
  await assert.rejects(
    () => T.quickAddTask(ctx(emp), { title: 'مهمة مدسوسة', assignee_user_id: 'u_out' }),
    (e) => e.code === 'forbidden' || e.code === 'bad_request'
  );
});

test('ثغرة مُصلَحة: قائد القطاع لا يُسند خارج قطاعه — الفحص كان يمرّ فراغاً بلا قطاع الهدف', async () => {
  const ok = await T.quickAddTask(ctx(lead), { title: 'مهمة داخل القطاع', assignee_user_id: 'u_emp' });
  assert.equal(ok.assignee_user_id, 'u_emp', 'داخل قطاعه مسموح');
  await assert.rejects(
    () => T.quickAddTask(ctx(lead), { title: 'مهمة خارج القطاع', assignee_user_id: 'u_out' }),
    (e) => e.code === 'forbidden', 'خارج قطاعه ممنوع — كان يمرّ قبل الإصلاح'
  );
});

// ── الثغرة ٢: إعادة الإسناد عبر التعديل ──
test('ثغرة مُصلَحة: ملكية المهمة لا تخوّل دفعها إلى قائمة شخص آخر', async () => {
  const mine = await T.quickAddTask(ctx(emp), { title: 'مهمتي' });
  // تعديل محتواها مسموح (ملكية)
  const edited = await T.updateTask(ctx(emp), mine.id, { title: 'مهمتي بعد التعديل', status: 'DOING' });
  assert.equal(edited.title, 'مهمتي بعد التعديل');
  // لكن إعادة إسنادها لشخص آخر ممنوعة — كانت تمر بلا أي فحص
  await assert.rejects(
    () => T.updateTask(ctx(emp), mine.id, { assignee_user_id: 'u_out' }),
    (e) => e.code === 'forbidden' || e.code === 'bad_request'
  );
});

test('الإسناد لمستخدم غير موجود يُرفض برسالة عربية لا بخطأ داخلي', async () => {
  await assert.rejects(
    () => T.quickAddTask(ctx(lead), { title: 'مهمة', assignee_user_id: 'u_ghost' }),
    /غير موجود/
  );
});

// ── الثغرة ٣: مشروع محذوف ناعماً ──
test('ثغرة مُصلَحة: مهام مشروع محذوف ناعماً لا تُقرأ', async () => {
  await assert.rejects(() => T.projectTasks(ceo, 'P_DEL'), (e) => e.code === 'not_found');
});

// ── ميزة: مهام فريقي ──
test('مهام فريقي: المدير يرى من يعمل على ماذا مجمَّعاً بالشخص، والأكثر تأخراً أولاً', async () => {
  const late = await T.quickAddTask(ctx(lead), { title: 'مهمة متأخرة', assignee_user_id: 'u_emp' });
  await update('task', late.id, { due_date: '2020-01-01' });
  await T.quickAddTask(ctx(lead), { title: 'مهمة قائد القطاع نفسه' });

  const board = await T.teamTasks(lead);
  assert.ok(board.length >= 1, 'يرجع تجميعاً بالأشخاص');
  assert.ok(board[0].name, 'كل مجموعة تحمل اسم الشخص لا معرّفه');
  assert.ok(board.some((b) => b.overdue > 0), 'يحسب المتأخر');
  assert.equal(board[0].overdue >= board[board.length - 1].overdue, true, 'الأكثر تأخراً في الأعلى');
  // ولا يتسرب أحد من قطاع آخر
  const ids = board.flatMap((b) => b.tasks.map((t) => t.assignee_user_id));
  assert.ok(!ids.includes('u_out'), 'لا مهام من قطاع آخر داخل نطاق قائد القطاع');
});

test('مهام فريقي محجوبة عن الموظف العادي', async () => {
  await assert.rejects(() => T.teamTasks(emp), (e) => e.code === 'forbidden');
});

// ── ميزة: التحديث الجماعي ──
test('التحديث الجماعي ينفّذ عبر فحص التعديل نفسه — لا مسار مختصر يتجاوز الصلاحية', async () => {
  const a = await T.quickAddTask(ctx(emp), { title: 'جماعي ١' });
  const b = await T.quickAddTask(ctx(emp), { title: 'جماعي ٢' });
  const res = await T.bulkUpdateTasks(ctx(emp), [a.id, b.id], { priority: 'P0' });
  assert.equal(res.updated, 2);
  assert.equal((await get('SELECT priority FROM task WHERE id = ?', [a.id])).priority, 'P0');

  // مهمة شخص آخر داخل الدفعة تفشل وحدها ولا تُسقط الباقي
  const foreign = await T.quickAddTask(ctx(lead), { title: 'مهمة قائد القطاع', assignee_user_id: 'u_lead' });
  const mixed = await T.bulkUpdateTasks(ctx(emp), [a.id, foreign.id], { priority: 'P1' });
  assert.equal(mixed.updated, 1, 'المسموح فقط يُحدَّث');
  assert.equal(mixed.failed.length, 1, 'والممنوع يُبلَّغ عنه بسببه');
});

test('التحديث الجماعي يرفض دفعة فارغة أو بلا تغيير أو أكبر من الحد', async () => {
  await assert.rejects(() => T.bulkUpdateTasks(ctx(emp), [], { status: 'DONE' }), /مهمة واحدة/);
  await assert.rejects(() => T.bulkUpdateTasks(ctx(emp), ['x'], {}), /ما تريد تغييره/);
  await assert.rejects(() => T.bulkUpdateTasks(ctx(emp), Array.from({ length: 101 }, (_, i) => 't' + i), { status: 'DONE' }), /100/);
});

test('إنجاز المهمة يضبط نسبة الإنجاز ووقت الإنجاز تلقائياً', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'للإنجاز' });
  const done = await T.updateTask(ctx(emp), t.id, { status: 'DONE' });
  assert.equal(done.status, 'DONE');
  assert.equal(done.progress_pct, 100);
  assert.ok(done.completed_at, 'يُختم بوقت الإنجاز');
});
