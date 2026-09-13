// ── الرجوع عن الحذف: الوعد الذي كان في رأس remove.js صار باباً ──────────────────────────
// ما تحرسه:
//   ١) الحذف ناعم والاستعادة تُعيد الصفّ وتابعه — ومن يملك السحب يملك الرجوع.
//   ٢) الاستعادة مقيَّدةٌ بلحظة ذلك الحذف: ما حُذف قبله بشهر لا يُبعث معه.
//   ٣) نوعٌ حذفُه فعل ما لا يُرَدّ (الحساب: حرّر البريد وقطع الجلسات) يقول ذلك بدل استعادةٍ نصفية.
//   ٤) السلّة والاستعادة يُردّان على من لا يملك الحذف — بجملة عربية.
//   ٥) كل استعادة سطرٌ في سجل التدقيق باسم فاعله.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-restore-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, get, all, run, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const remove = await import('../../src/core/lifecycle/remove.js');

const T = '2026-01-05T00:00:00Z';
const BD = { id: 'u_bd', username: 'u_bd', name_ar: 'عضو تطوير الأعمال', role_id: 'bd_team', sector_id: 'SOL', scope: 'company', projectIds: new Set(), teamIds: new Set() };
const EMP = { id: 'u_emp', username: 'u_emp', name_ar: 'موظف', role_id: 'employee', sector_id: 'SOL', scope: 'own', projectIds: new Set(), teamIds: new Set() };
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  for (const u of [BD, EMP]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id, sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1, created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة تُسحب ثم تعود', client_id: 'C1', sector_id: 'SOL',
    owner_user_id: BD.id, stage_id: 'LEAD', win_pct: 10, value_halalas: 100000_00, year: 2026, stage_changed_at: T, created_at: T, created_by: BD.id });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('الحذف ناعم، والاستعادة تُعيد الفرصة إلى القوائم', async () => {
  await remove.removeRecord(ctxOf(BD), 'opportunity', 'O1', { reason: 'مكرّرة بالخطأ' });
  const gone = await get('SELECT deleted_at FROM opportunity WHERE id = ?', ['O1']);
  assert.ok(gone.deleted_at, 'محذوفة ناعماً — الصفّ باقٍ');
  assert.equal(await get('SELECT id FROM opportunity WHERE id = ? AND deleted_at IS NULL', ['O1']), undefined, 'وخارج القوائم');

  const bin = await remove.listRemoved(ctxOf(BD), 'opportunity');
  assert.ok(bin.some((r) => r.id === 'O1'), 'تظهر في سلّة المحذوف');

  const r = await remove.restoreRecord(ctxOf(BD), 'opportunity', 'O1');
  assert.equal(r.ok, true);
  assert.ok(await get('SELECT id FROM opportunity WHERE id = ? AND deleted_at IS NULL', ['O1']), 'عادت إلى القوائم');
});

test('الاستعادة مقيَّدة بلحظة ذلك الحذف — لا تبعث ما حُذف قبله', async () => {
  // مهمّةٌ حُذفت قبل شهر بقرارٍ مستقل، وأخرى ستُحذف مع الفرصة.
  await insert('task', { id: 't_old', title: 'مهمة حُذفت قديماً', opportunity_id: 'O1', assignee_user_id: BD.id,
    created_by: BD.id, sector_id: 'SOL', status: 'TODO', priority: 'P2', work_kind: 'opportunity', approved_by: BD.id, created_at: T });
  await insert('task', { id: 't_with', title: 'مهمة تُسحب مع الفرصة', opportunity_id: 'O1', assignee_user_id: BD.id,
    created_by: BD.id, sector_id: 'SOL', status: 'TODO', priority: 'P2', work_kind: 'opportunity', approved_by: BD.id, created_at: T });
  await run('UPDATE task SET deleted_at = ? WHERE id = ?', ['2026-08-01T00:00:00.000Z', 't_old']);

  await remove.removeRecord(ctxOf(BD), 'opportunity', 'O1', { reason: 'تجربة الرجوع' });
  assert.ok((await get('SELECT deleted_at FROM task WHERE id = ?', ['t_with'])).deleted_at, 'المهمة سُحبت مع الفرصة');

  await remove.restoreRecord(ctxOf(BD), 'opportunity', 'O1');
  assert.equal((await get('SELECT deleted_at FROM task WHERE id = ?', ['t_with'])).deleted_at, null, 'ما سُحب معها عاد معها');
  assert.equal((await get('SELECT deleted_at FROM task WHERE id = ?', ['t_old'])).deleted_at, '2026-08-01T00:00:00.000Z',
    'وما حُذف قبلها بقرارٍ مستقل بقي محذوفاً — الرجوع ليس إدخالاً لبيانات لم يطلبها أحد');
});

test('استعادةُ ما ليس محذوفاً تُردّ، وحسابُ الدخول يقول لماذا لا يُستعاد', async () => {
  await assert.rejects(() => remove.restoreRecord(ctxOf(BD), 'opportunity', 'O1'),
    (e) => { assert.match(e.message, /غير محذوفة/); return true; });
  // الحساب: حذفُه حرّر بريده وقطع جلساته — يُقال صراحةً بدل رفع الختم وإيهام الاستعادة
  await insert('app_user', { id: 'u_gone', username: 'u_gone', name_ar: 'حساب محذوف', role_id: 'employee',
    sector_id: 'SOL', scope: 'own', active: 0, created_at: T });
  await run('UPDATE app_user SET deleted_at = ? WHERE id = ?', ['2026-09-01T00:00:00.000Z', 'u_gone']);
  const admin = { ...BD, id: 'u_admin', role_id: 'admin', username: 'u_admin' };
  await assert.rejects(() => remove.restoreRecord(ctxOf(admin), 'user', 'u_gone'),
    (e) => { assert.match(e.message, /البريد|الجلسات|من جديد/); return true; });
});

test('من لا يملك الحذف لا يرى السلّة ولا يستعيد — بجملة عربية', async () => {
  await remove.removeRecord(ctxOf(BD), 'opportunity', 'O1', { reason: 'للاختبار' });
  await assert.rejects(() => remove.listRemoved(ctxOf(EMP), 'opportunity'),
    (e) => { assert.ok(/[؀-ۿ]/.test(e.message)); assert.match(e.message, /صلاحية/); return true; });
  await assert.rejects(() => remove.restoreRecord(ctxOf(EMP), 'opportunity', 'O1'),
    (e) => { assert.match(e.message, /من يملك السحب يملك الرجوع/); return true; });
  await remove.restoreRecord(ctxOf(BD), 'opportunity', 'O1');
});

test('كل استعادة سطرٌ في سجل التدقيق باسم فاعلها', async () => {
  const rows = await all("SELECT action, user_id, detail_json FROM audit_log WHERE action = 'restore' ORDER BY at DESC");
  assert.ok(rows.length >= 2, 'الاستعادات مسجَّلة');
  assert.ok(rows.every((r) => r.user_id === BD.id), 'كلٌّ باسم فاعله');
  assert.match(String(rows[0].detail_json), /استعادة/);
});
