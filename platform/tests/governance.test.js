// AI-governance + workflow + timesheet-validation tests on an isolated temp DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-governance.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, ai, ts, wf;

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../src/core/db/index.js');
  const { migrate } = await import('../scripts/migrate.js');
  const { seedRbac } = await import('../scripts/seed-rbac.js');
  ids = await import('../src/core/util/ids.js');
  migrate(); seedRbac();
  (await import('../src/core/rbac/index.js')).loadGrants();
  const now = ids.nowIso();
  db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1 });
  db.insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 5, is_won: 1 });
  db.insert('sector', { id: 'S1', name_ar: 'قطاع 1', active: 1, created_at: now });
  // app_user rows so FK targets (time_entry.user_id, notification.user_id) resolve
  for (const role of ['employee', 'sector_lead', 'bd_manager', 'viewer', 'admin']) {
    db.insert('app_user', { id: 'u_' + role, username: role, role_id: role, sector_id: 'S1', scope: role === 'admin' ? 'company' : 'own', active: 1, created_at: now });
  }
  db.insert('opportunity', { id: 'O1', title_ar: 'فرصة', sector_id: 'S1', stage_id: 'LEAD', value_halalas: 100000, created_at: now });
  ai = await import('../src/core/ai/assistant.js');
  ts = await import('../src/modules/timesheets/timesheets.js');
  wf = await import('../src/modules/workflow/engine.js');
});
after(() => { db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

const U = (role, sector, scope = 'own') => ({ id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });

test('AI: propose_change returns a PREVIEW and does NOT write', async () => {
  const r = await ai.ask(ctx(U('sector_lead', 'S1', 'sector')), 'انقل', { intent: 'propose_change', change: { type: 'opp_stage', oppId: 'O1', stage: 'WON' } });
  assert.ok(r.applyToken, 'must return an apply token');
  assert.equal(db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1']).stage_id, 'LEAD', 'no write before apply');
});

test('AI: viewer without update permission is DENIED at propose time', async () => {
  await assert.rejects(
    () => ai.ask(ctx(U('viewer', 'S1', 'sector')), 'x', { intent: 'propose_change', change: { type: 'opp_stage', oppId: 'O1', stage: 'WON' } }),
    /صلاحية|forbidden|تعديل/);
});

test('AI: apply with another user\'s token is rejected', async () => {
  const r = await ai.ask(ctx(U('sector_lead', 'S1', 'sector')), 'انقل', { intent: 'propose_change', change: { type: 'opp_stage', oppId: 'O1', stage: 'WON' } });
  assert.throws(() => ai.applyChange(ctx(U('viewer', 'S1', 'sector')), r.applyToken), /غير صالحة/);
  assert.equal(db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1']).stage_id, 'LEAD');
});

test('AI: owner applies own token → writes + audits', async () => {
  const owner = U('sector_lead', 'S1', 'sector');
  const r = await ai.ask(ctx(owner), 'انقل', { intent: 'propose_change', change: { type: 'opp_stage', oppId: 'O1', stage: 'WON' } });
  const res = ai.applyChange(ctx(owner), r.applyToken);
  assert.match(res.reply, /تم تطبيق/);
  assert.equal(db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1']).stage_id, 'WON');
  assert.ok(db.get("SELECT id FROM audit_log WHERE resource='opportunity' AND action='update'"), 'must be audited');
});

test('AI: data quality scan runs and returns findings text', async () => {
  const r = await ai.ask(ctx(U('admin', null, 'company')), 'افحص جودة البيانات', {});
  assert.match(r.reply, /جودة البيانات|جيدة/);
});

test('Timesheet: rejects >16h/day and non-positive hours', () => {
  const u = U('employee', 'S1');
  assert.throws(() => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 20 }), /الساعات/);
  assert.throws(() => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 0 }), /الساعات/);
  const ok = ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 8, work_kind: 'project' });
  assert.equal(ok.hours, 8);
  // second entry pushing the day over 16h is rejected
  assert.throws(() => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 9 }), /تجاوز/);
});

test('Workflow: submit → pending; approver acts → approved', () => {
  db.insert('workflow_definition', { id: 'WF1', key: 'k', name_ar: 'مسار', target_resource: 'opportunity', active: 1, created_at: ids.nowIso() });
  db.insert('approval_step', { id: 'ST1', workflow_id: 'WF1', step_order: 1, approver_role: 'sector_lead', approver_scope: 'sector', min_amount_halalas: 0, name_ar: 'خطوة' });
  const req = wf.submitForApproval(ctx(U('bd_manager', 'S1')), { workflowKey: 'k', resource: 'opportunity', resourceId: 'O1', sectorId: 'S1' });
  assert.equal(req.status, 'PENDING');
  const done = wf.actOnApproval(ctx(U('sector_lead', 'S1', 'sector')), req.id, 'approve');
  assert.equal(done.status, 'APPROVED');
});
