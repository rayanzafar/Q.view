// ── تسليمُ عمل المغادر قبل حذف حسابه ────────────────────────────────────────────────────
// ما تحرسه:
//   ١) كلُّ ما يمنع الحذف يُعالَج في نداءٍ واحد، فيصير الحساب قابلاً للحذف فعلاً.
//   ٢) العملُ ينتقل والخاصُّ يُغلق: المهمة الشخصية تُلغى ولا تُسلَّم إلى دفتر زميل.
//   ٣) لا يُسلَّم العملُ لصاحبه، ولا لحسابٍ موقوف.
//   ٤) العمليةُ لمدير النظام وحده، وسطرٌ في سجل التدقيق يقول ماذا انتقل وإلى من.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-reassign-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, all, run, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const identity = await import('../../src/modules/identity/identity.js');
const remove = await import('../../src/core/lifecycle/remove.js');

const T = '2026-01-05T00:00:00Z';
const ADMIN = { id: 'u_admin', username: 'u_admin', name_ar: 'مدير النظام', role_id: 'admin', sector_id: 'SOL', scope: 'company', projectIds: new Set(), teamIds: new Set() };
const LEAVER = { id: 'u_go', username: 'u_go', name_ar: 'مغادر', role_id: 'consultant', sector_id: 'SOL', scope: 'own' };
const STAY = { id: 'u_stay', username: 'u_stay', name_ar: 'الزميل المستلِم', role_id: 'consultant', sector_id: 'SOL', scope: 'own' };
const OFF = { id: 'u_off', username: 'u_off', name_ar: 'حساب موقوف', role_id: 'consultant', sector_id: 'SOL', scope: 'own' };
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  // القطاعُ أولاً بلا قائد (الحسابات تشير إليه)، ثم الحسابات، ثم يُسنَد القائد — وإلا ارتطم
  // قيدُ المفتاح الأجنبي على صفٍّ لم يُنشأ بعد.
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [ADMIN, LEAVER, STAY]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('app_user', { id: OFF.id, username: OFF.username, name_ar: OFF.name_ar, role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 0, created_at: T });
  await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', [LEAVER.id, 'SOL']);
  await insert('department', { id: 'D1', name_ar: 'إدارة الابتكار', sector_id: 'SOL', manager_user_id: LEAVER.id, created_at: T });
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة المغادر', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: LEAVER.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 500000_00, year: 2026, stage_changed_at: T, created_at: T, created_by: LEAVER.id });
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع المغادر', sector_id: 'SOL', client_id: 'C1',
    status: 'IN_PROGRESS', rag: 'GREEN', owner_user_id: LEAVER.id, created_at: T });
  const mk = (id2, extra) => insert('task', { id: id2, title: 'مهمة ' + id2, assignee_user_id: LEAVER.id, created_by: LEAVER.id,
    sector_id: 'SOL', status: 'TODO', priority: 'P2', work_kind: 'internal', approved_by: LEAVER.id, created_at: T, ...extra });
  await mk('t_work');
  await mk('t_private', { work_kind: 'personal', title: 'ملاحظاتي الخاصة' });
  await mk('t_done', { status: 'DONE' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('نداءٌ واحد يُفرغ الحساب فيصير قابلاً للحذف', async () => {
  const before_ = await remove.removalBlockers('user', LEAVER.id, ctxOf(ADMIN));
  assert.ok(before_.length >= 4, 'الموانع قائمة قبل التسليم: ' + before_.join(' · '));

  const r = await identity.reassignUserWork(ctxOf(ADMIN), LEAVER.id, STAY.id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.blockers, [], 'لا مانع بعد التسليم — وهذا هو المقصود');

  assert.equal((await get('SELECT owner_user_id FROM opportunity WHERE id = ?', ['O1'])).owner_user_id, STAY.id);
  assert.equal((await get('SELECT owner_user_id FROM project WHERE id = ?', ['P1'])).owner_user_id, STAY.id);
  assert.equal((await get('SELECT assignee_user_id FROM task WHERE id = ?', ['t_work'])).assignee_user_id, STAY.id);
  assert.equal((await get('SELECT lead_user_id FROM sector WHERE id = ?', ['SOL'])).lead_user_id, STAY.id);
  assert.equal((await get('SELECT manager_user_id FROM department WHERE id = ?', ['D1'])).manager_user_id, STAY.id);
});

test('العملُ ينتقل والخاصُّ يُغلق — لا تُسلَّم ملاحظات أحدٍ إلى دفتر زميل', async () => {
  const priv = await get('SELECT assignee_user_id, status FROM task WHERE id = ?', ['t_private']);
  assert.equal(priv.assignee_user_id, LEAVER.id, 'المهمة الشخصية بقيت باسم صاحبها');
  assert.equal(priv.status, 'CANCELLED', 'وأُلغيت بدل أن تُسلَّم');
  // والمنجَزُ لا يُمَسّ: التسليم للعمل المفتوح لا لإعادة كتابة التاريخ
  assert.equal((await get('SELECT assignee_user_id FROM task WHERE id = ?', ['t_done'])).assignee_user_id, LEAVER.id);
});

test('لا يُسلَّم العملُ لصاحبه ولا لحسابٍ موقوف، والعملية لمدير النظام وحده', async () => {
  await assert.rejects(() => identity.reassignUserWork(ctxOf(ADMIN), STAY.id, STAY.id),
    (e) => { assert.match(e.message, /غير صاحب الحساب/); return true; });
  await assert.rejects(() => identity.reassignUserWork(ctxOf(ADMIN), STAY.id, OFF.id),
    (e) => { assert.match(e.message, /موقوف أو محذوف/); return true; });
  const consultant = { ...LEAVER, id: 'u_c', username: 'u_c' };
  await assert.rejects(() => identity.reassignUserWork(ctxOf(consultant), STAY.id, ADMIN.id),
    (e) => { assert.match(e.message, /مدير النظام/); return true; });
});

test('سطرُ تدقيقٍ يقول ماذا انتقل وإلى من — ثم يُحذف الحساب فعلاً', async () => {
  const row = await get("SELECT detail_json, user_id FROM audit_log WHERE resource = 'app_user' AND resource_id = ? ORDER BY at DESC LIMIT 1", [LEAVER.id]);
  assert.equal(row.user_id, ADMIN.id);
  assert.match(String(row.detail_json), /تسليم عمل/);
  assert.match(String(row.detail_json), /الزميل المستلِم/);

  const del = await remove.removeRecord(ctxOf(ADMIN), 'user', LEAVER.id, { reason: 'مغادرة' });
  assert.equal(del.ok, true, 'الحذف صار ممكناً بعد التسليم');
  assert.ok((await get('SELECT deleted_at FROM app_user WHERE id = ?', [LEAVER.id])).deleted_at);
});
