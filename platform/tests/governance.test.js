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
  await migrate(); await seedRbac();
  await (await import('../src/core/rbac/index.js')).initRbac();
  const now = ids.nowIso();
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1 });
  await db.insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 5, is_won: 1 });
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع 1', active: 1, created_at: now });
  // app_user rows so FK targets (time_entry.user_id, notification.user_id) resolve
  for (const role of ['employee', 'sector_lead', 'bd_manager', 'viewer', 'admin']) {
    await db.insert('app_user', { id: 'u_' + role, username: role, role_id: role, sector_id: 'S1', scope: role === 'admin' ? 'company' : 'own', active: 1, created_at: now });
  }
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة', sector_id: 'S1', stage_id: 'LEAD', value_halalas: 100000, created_at: now });
  ai = await import('../src/core/ai/assistant.js');
  ts = await import('../src/modules/timesheets/timesheets.js');
  wf = await import('../src/modules/workflow/engine.js');
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

const U = (role, sector, scope = 'own') => ({ id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });

// المسار تغيّر بقرار تصميم معلَن: الدردشة **لا تُصدر رمز تأكيد إطلاقاً** (فلا يمكن لخطأ في
// «فهم» جملة أن يكتب شيئاً)، والكتابة تبدأ من معاينة بحمولة مبنيّة {type, fields}، والتطبيق
// انتقل إلى طبقة الوحدات (modules/ai/apply.js) كي يمرّ بخدمة `moveStage` بكل قواعدها بدل أن
// يكتب في الجدول مباشرةً. الفحوص أدناه تحرس العقد الجديد؛ وتفصيلُه في tests/security/ai-*.
test('AI: a chat turn NEVER returns an apply token and never writes', async () => {
  const r = await ai.ask(ctx(U('sector_lead', 'S1', 'sector')), 'انقل الفرصة إلى فائزة');
  assert.ok(!('applyToken' in r), 'chat must not hand out a write token');
  assert.ok(r.form, 'it hands back a form to fill instead of guessing');
  assert.equal((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'LEAD', 'no write from chat');
});

test('AI: viewer without update permission is DENIED at preview time', async () => {
  await assert.rejects(
    () => ai.proposePreview(ctx(U('viewer', 'S1', 'sector')), { type: 'opp_stage', fields: { oppId: 'O1', stage: 'WON' } }),
    /صلاحية|forbidden|تعديل/);
});

test('AI: apply with another user\'s token is rejected', async () => {
  const { applyChange } = await import('../src/modules/ai/apply.js');
  const r = await ai.proposePreview(ctx(U('sector_lead', 'S1', 'sector')), { type: 'opp_stage', fields: { oppId: 'O1', stage: 'WON' } });
  await assert.rejects(async () => applyChange(ctx(U('viewer', 'S1', 'sector')), r.applyToken), /لا أجد هذه المعاينة/);
  assert.equal((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'LEAD');
});

test('AI: owner applies own token → writes through the service + audits', async () => {
  const { applyChange } = await import('../src/modules/ai/apply.js');
  const owner = U('sector_lead', 'S1', 'sector');
  const r = await ai.proposePreview(ctx(owner), { type: 'opp_stage', fields: { oppId: 'O1', stage: 'WON' } });
  const res = await applyChange(ctx(owner), r.applyToken);
  assert.match(res.reply, /تم تطبيق/);
  assert.equal((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['O1'])).stage_id, 'WON');
  assert.ok(await db.get("SELECT id FROM opportunity_stage_history WHERE opportunity_id='O1'"), 'stage history written by moveStage');
  assert.ok(await db.get("SELECT id FROM audit_log WHERE resource='opportunity' AND action='update'"), 'must be audited');
});

test('AI: data quality scan runs and returns findings text', async () => {
  const r = await ai.ask(ctx(U('admin', null, 'company')), 'افحص جودة البيانات', {});
  assert.match(r.reply, /جودة البيانات|جيدة/);
});

test('Timesheet: rejects >16h/day and non-positive hours', async () => {
  const u = U('employee', 'S1');
  await assert.rejects(async () => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 20 }), /الساعات/);
  await assert.rejects(async () => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 0 }), /الساعات/);
  const ok = await ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 8, work_kind: 'project' });
  assert.equal(ok.hours, 8);
  // second entry pushing the day over 16h is rejected
  await assert.rejects(async () => ts.addEntry(ctx(u), { entry_date: '2026-07-13', hours: 9 }), /تجاوز/);
});

test('Workflow: submit → pending; approver acts → approved', async () => {
  await db.insert('workflow_definition', { id: 'WF1', key: 'k', name_ar: 'مسار', target_resource: 'opportunity', active: 1, created_at: ids.nowIso() });
  await db.insert('approval_step', { id: 'ST1', workflow_id: 'WF1', step_order: 1, approver_role: 'sector_lead', approver_scope: 'sector', min_amount_halalas: 0, name_ar: 'خطوة' });
  const req = await wf.submitForApproval(ctx(U('bd_manager', 'S1')), { workflowKey: 'k', resource: 'opportunity', resourceId: 'O1', sectorId: 'S1' });
  assert.equal(req.status, 'PENDING');
  const done = await wf.actOnApproval(ctx(U('sector_lead', 'S1', 'sector')), req.id, 'approve');
  assert.equal(done.status, 'APPROVED');
});

test('Finance: progress claim from delivered deliverables + permission + collection', async () => {
  const fin = await import('../src/modules/finance/finance.js');
  const now = ids.nowIso();
  await db.insert('project', { id: 'PF1', name_ar: 'مشروع مالي', sector_id: 'S1', owner_user_id: 'u_sector_lead', status: 'IN_PROGRESS', contract_value_halalas: 1000000, created_at: now });
  await db.insert('contract', { id: 'CF1', code: 'CF-1', project_id: 'PF1', sector_id: 'S1', value_halalas: 1000000, status: 'ACTIVE', created_at: now });
  await db.insert('deliverable', { id: 'DF1', project_id: 'PF1', name_ar: 'مخرج 1', amount_halalas: 400000, status: 'DELIVERED', sector_id: 'S1', created_at: now });
  await db.insert('deliverable', { id: 'DF2', project_id: 'PF1', name_ar: 'مخرج 2', amount_halalas: 300000, status: 'DELIVERED', sector_id: 'S1', created_at: now });
  const ctxF = (role) => ({ user: { id: 'u_' + role, username: role, role_id: role, sector_id: 'S1', scope: role === 'finance' ? 'company' : 'own', projectIds: new Set(['PF1']) }, ip: '127.0.0.1' });
  // bd_manager cannot issue a claim
  await assert.rejects(async () => fin.createProgressClaim(ctxF('bd_manager'), { contractId: 'CF1' }), /صلاحية|forbidden/);
  // finance can — amount = sum of delivered
  const inv = await fin.createProgressClaim(ctxF('finance'), { contractId: 'CF1', periodLabel: 'يونيو' });
  assert.equal(inv.amount_halalas, 700000);
  assert.equal(inv.status, 'ISSUED');
  assert.equal((await db.get('SELECT status FROM deliverable WHERE id=?', ['DF1'])).status, 'INVOICED');
  // record a partial collection → PARTIALLY_PAID, then full → PAID
  await fin.recordCollection(ctxF('finance'), { invoiceId: inv.id, amountSar: 3000 });
  assert.equal((await db.get('SELECT status FROM invoice WHERE id=?', [inv.id])).status, 'PARTIALLY_PAID');
});

test('Finance regression: sector-scoped user runs byPM/byContract/summary without ambiguous-column SQL error', async () => {
  const fin = await import('../src/modules/finance/finance.js');
  // sector_lead: invoice/contract read at 'sector' scope → scope clause `sector_id = ?` spliced into
  // JOINs where both tables expose sector_id. Must be qualified, else "ambiguous column name: sector_id".
  const lead = { id: 'u_sector_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set() };
  await assert.doesNotReject(async () => fin.financeByPM(lead), 'byPM must not raise ambiguous-column');
  await assert.doesNotReject(async () => fin.financeByContract(lead), 'byContract must not raise ambiguous-column');
  await assert.doesNotReject(async () => fin.financeSummary(lead), 'summary must not raise ambiguous-column');
});

test('Finance regression: summary billing figures respect the ?year param', async () => {
  const fin = await import('../src/modules/finance/finance.js');
  const admin = { id: 'u_admin', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set() };
  // The seeded progress-claim invoice was issued "now" (fiscal 2026 in this suite's clock context).
  const thisYear = new Date().getUTCFullYear();
  const cur = await fin.financeSummary(admin, thisYear);
  const past = await fin.financeSummary(admin, thisYear - 5);
  assert.ok(cur.invoiced_halalas >= 0, 'current-year invoiced computed');
  assert.equal(past.invoiced_halalas, 0, 'a year with no invoices must report 0 invoiced, not leak current-year figures');
  assert.equal(past.ar_halalas, 0, 'AR must also be year-scoped');
});

test('Intake: createFromIntake builds project+contract+deliverables+client, dedups client, enforces permission', async () => {
  const intake = await import('../src/modules/intake/intake.js');
  const ctxOf = (role, scope) => ({ user: { id: 'u_' + role, role_id: role, sector_id: 'S1', scope, projectIds: new Set() }, ip: '127.0.0.1' });
  const r = await intake.createFromIntake(ctxOf('admin', 'company'), { name_ar: 'مشروع من عقد', client_name: 'عميل تجريبي',
    sector_id: 'S1', value_sar: 1000000, deliverables: [{ name_ar: 'مخرج أ', amount_sar: 600000 }, { name_ar: 'مخرج ب', amount_sar: 400000 }] });
  assert.ok(r.project_id && r.contract_id && r.client_id, 'creates project+contract+client');
  assert.equal(r.deliverables, 2);
  assert.equal((await db.get('SELECT contract_value_halalas v FROM project WHERE id=?', [r.project_id])).v, 100000000, 'SAR→halalas');
  assert.equal((await db.get('SELECT COUNT(*) n FROM deliverable WHERE project_id=?', [r.project_id])).n, 2);
  assert.equal((await db.get('SELECT COALESCE(SUM(amount_halalas),0) v FROM deliverable WHERE project_id=?', [r.project_id])).v, 100000000, 'deliverables reconcile to value');
  // find-or-create: same client name must be reused, not duplicated
  const r2 = await intake.createFromIntake(ctxOf('admin', 'company'), { name_ar: 'مشروع ٢', client_name: 'عميل تجريبي', sector_id: 'S1', value_sar: 500000 });
  assert.equal(r2.client_id, r.client_id, 'client de-duplicated by name');
  // permission: an employee cannot create a project
  await assert.rejects(async () => intake.createFromIntake(ctxOf('employee', 'own'), { name_ar: 'x', sector_id: 'S1' }), /صلاحية|forbidden|نطاق/);
});

test('Staffing: assign/unassign with dedup guard and permission', async () => {
  const projects = await import('../src/modules/pmo/projects.js');
  const now = ids.nowIso();
  await db.insert('project', { id: 'PS1', name_ar: 'مشروع تسكين', sector_id: 'S1', owner_user_id: 'u_admin', status: 'IN_PROGRESS', created_at: now });
  await db.insert('employee', { id: 'E9', name_ar: 'موظف تسكين', sector_id: 'S1', status: 'active', active: 1, created_at: now });
  const ctxAdm = { user: { id: 'u_admin', role_id: 'admin', sector_id: 'S1', scope: 'company', projectIds: new Set() }, ip: '127.0.0.1' };
  const s = await projects.assignEmployee(ctxAdm, 'PS1', { employeeId: 'E9' });
  assert.equal(s.assigned.length, 1);
  await assert.rejects(async () => projects.assignEmployee(ctxAdm, 'PS1', { employeeId: 'E9' }), /مسبق|مُسكَّن/, 'dup assignment rejected');
  const s2 = await projects.unassignEmployee(ctxAdm, s.assigned[0].id);
  assert.equal(s2.assigned.length, 0, 'unassign removes the allocation');
});
