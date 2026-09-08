// ── حدود الإقفال الشهري: من يقرأ، ومن يؤكد، ومن يقفل ─────────────────────────────────────
//
// «المراجعة المالية» = مكتب الرئيس التنفيذي ومدير النظام (لا دور مالية — EXECUTION-LOG C1).
// مدير الإدارة يراجع أهل إدارته ولا يقفل («لا إقفال مالي» — الموجّه §10)، والموظف لا يقرأ
// الإقفال أصلاً، والموارد البشرية ترى الأسماء في الفريق ولا تقرأ توزيع التكلفة ولا تقفله.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-close-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, C, resolveUser;
const T = new Date().toISOString();
const YEAR = 2026; const MONTH = 6;
const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const is403 = (e) => e.status === 403;

let periodId;
before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  C = await import('../../src/modules/team/cost-close.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_ceo', 'ceo_office', null, 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_cons_lead', 'sector_lead', 'CONS', 'sector');
  await mkUser('u_dm', 'department_manager');
  await mkUser('u_emp', 'employee');
  await mkUser('u_cons', 'consultant');
  await mkUser('u_hr', 'hr', 'SOL', 'company');
  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء', active: 1, created_at: T });
  const mkEmp = async (id2, dept, uid = null) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: 'موظف ' + id2, sector_id: 'SOL', department_id: dept,
      job_title: 'استشاري', active: 1, hire_date: '2025-01-01', created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_dm', 'D_INNOV', 'u_dm');
  await mkEmp('e_innov', 'D_INNOV');
  await mkEmp('e_ai', 'D_AI');
  await mkEmp('e_emp', 'D_INNOV', 'u_emp');
  await mkEmp('e_cons', 'D_AI', 'u_cons');
  await mkEmp('e_hr', 'D_AI', 'u_hr');

  const view = await C.periodOverview(await sess('u_ceo'), { sector: 'SOL', year: YEAR, month: MONTH });
  periodId = view.period.id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('الموظف لا يقرأ الإقفال — لا نظرةً ولا توزيع مورد ولو كان ملفه هو', async () => {
  await assert.rejects(async () => C.periodOverview(await sess('u_emp'), { sector: 'SOL', year: YEAR, month: MONTH }), is403);
  await assert.rejects(async () => C.resourceShares(await sess('u_emp'), periodId, 'e_emp'), is403);
  await assert.rejects(async () => C.resourceShares(await sess('u_cons'), periodId, 'e_cons'), is403);
  await assert.rejects(async () => C.exportPeriod(await sess('u_emp'), periodId), is403);
});

test('الموارد البشرية لا تقرأ الإقفال ولا تقفله ولا تصدّره', async () => {
  await assert.rejects(async () => C.periodOverview(await sess('u_hr'), { sector: 'SOL', year: YEAR, month: MONTH }), is403);
  await assert.rejects(async () => C.lockPeriod(await ctxOf('u_hr'), periodId, { expectedVersion: 1 }), is403);
  await assert.rejects(async () => C.exportPeriod(await sess('u_hr'), periodId), is403);
  await assert.rejects(async () => C.sendToFinance(await ctxOf('u_hr'), periodId), is403);
});

test('مدير إدارةٍ بلا إدارة مسندة لا يرى القطاع كله — «لا نطاق» تعني لا شاشة، لا كل الصفوف', async () => {
  // كان منحُ «إدارة» يمرّ من البوابة ثم يُقرأ اتساعُه «لا شيء» فتُعامَل صفوف القطاع كلها كأنها في نطاقه.
  await db.insert('app_user', { id: 'u_dm_none', username: 'u_dm_none', name_ar: 'مدير بلا إدارة', role_id: 'department_manager',
    sector_id: 'SOL', scope: 'department', active: 1, created_at: T });
  const u = await sess('u_dm_none');
  await assert.rejects(async () => C.periodOverview(u, { year: YEAR, month: MONTH }), (e) => {
    assert.equal(e.status, 403); assert.match(e.message, /لا إدارة مسندة/); return true;
  });
});

test('مدير الإدارة يراجع أهل إدارته فقط ولا يقفل — «لا إقفال مالي»', async () => {
  const dm = await ctxOf('u_dm');
  const view = await C.periodOverview(dm.user, { year: YEAR, month: MONTH });
  const ids = view.rows.map((r) => r.employeeId).sort();
  assert.deepEqual(ids, ['e_dm', 'e_emp', 'e_innov'], 'مدير الابتكار يرى أهل إدارته وحدهم');
  assert.equal(view.counters.resources, 3, 'العدادات تحت الحد نفسه');
  assert.equal(view.canLock, false);
  assert.equal(view.canSendToFinance, false);
  assert.equal(view.canExport, false);
  // يؤكد لأهل إدارته
  const ok = await C.confirmShares(dm, periodId, 'e_innov', { lines: [{ target_kind: 'sector', shareBp: 10000 }] });
  assert.equal(ok.reviewStatus, 'confirmed');
  // ولا يفتح ولا يؤكد لغيرهم
  await assert.rejects(async () => C.resourceShares(dm.user, periodId, 'e_ai'), is403);
  await assert.rejects(async () => C.confirmShares(dm, periodId, 'e_ai', { lines: [{ target_kind: 'sector', shareBp: 10000 }] }), is403);
  // ولا يرسل القطاع ولا يقفل ولا يعيد ولا يصدّر
  await assert.rejects(async () => C.sendToFinance(dm, periodId), is403);
  await assert.rejects(async () => C.lockPeriod(dm, periodId, { expectedVersion: 1 }), (e) => {
    assert.equal(e.status, 403); assert.match(e.message, /مكتب الرئيس التنفيذي/); return true;
  });
  await assert.rejects(async () => C.returnToManager(dm, periodId, 'سبب'), is403);
  await assert.rejects(async () => C.exportPeriod(dm.user, periodId), is403);
  // والأثر يحمل من أكّد
  const rows = await db.all("SELECT user_id FROM audit_log WHERE resource = 'cost_share' AND action = 'confirm'");
  assert.ok(rows.some((r) => r.user_id === 'u_dm'));
});

test('قائد القطاع: يرى قطاعه كله ويرسل، ولا يقفل ولا يرى قطاعاً آخر؛ والإقفال لمكتب الرئيس التنفيذي وحده', async () => {
  const lead = await ctxOf('u_lead');
  const view = await C.periodOverview(lead.user, { year: YEAR, month: MONTH });
  assert.equal(view.rows.length, 6);
  await assert.rejects(async () => C.periodOverview(await sess('u_cons_lead'), { sector: 'SOL', year: YEAR, month: MONTH }), is403);
  await assert.rejects(async () => C.resourceShares(await sess('u_cons_lead'), periodId, 'e_ai'), is403);
  for (const e of ['e_dm', 'e_emp', 'e_ai', 'e_cons', 'e_hr']) {
    await C.confirmShares(lead, periodId, e, { lines: [{ target_kind: 'sector', shareBp: 10000 }] });
  }
  const sent = await C.sendToFinance(lead, periodId);
  assert.equal(sent.period.status, 'finance_review');
  await assert.rejects(async () => C.lockPeriod(lead, periodId, { expectedVersion: 1 }), is403);
  await assert.rejects(async () => C.lockPeriod(await ctxOf('u_dm'), periodId, { expectedVersion: 1 }), is403);
  await assert.rejects(async () => C.lockPeriod(await ctxOf('u_hr'), periodId, { expectedVersion: 1 }), is403);
  const locked = await C.lockPeriod(await ctxOf('u_ceo'), periodId, { expectedVersion: 1 });
  assert.equal(locked.status, 'locked');
  // بعد الإقفال: التصحيح يطلبه المدير ويقرّره المراجع المالي وحده
  const corr = await C.createCorrection(await ctxOf('u_dm'), periodId, 'e_innov', {
    proposed: [{ target_kind: 'sector', shareBp: 10000, note: 'x' }, ], reason: 'مطابق؟',
  }).catch((e) => e);
  assert.match(corr.message, /مطابق/, 'مقترحٌ مطابق للمقفل يُرفض لا يُقبل بصمت');
  await assert.rejects(async () => C.decideCorrection(await ctxOf('u_dm'), 'nope', 'approve'), is403);
  await assert.rejects(async () => C.decideCorrection(await ctxOf('u_hr'), 'nope', 'approve'), is403);
  const lock = await db.all("SELECT user_id, role_id FROM audit_log WHERE resource = 'cost_period' AND action = 'lock'");
  assert.equal(lock.length, 1);
  assert.equal(lock[0].role_id, 'ceo_office', 'أثر الإقفال يحمل دور المراجعة المالية لا غيره');
});
