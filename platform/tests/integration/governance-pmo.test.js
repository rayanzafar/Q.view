// Project governance depth (WP17): CRUD for risk/issue/decision/change/milestone with audit,
// exposure derivation, milestone MET/MISSED transitions, and cross-sector 403s. Isolated temp DB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-governance-pmo.db');
process.env.SANAD_DB = TEST_DB;

let db, gov;
const now = () => new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const lead1 = { id: 'u_lead1', username: 'lead1', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const lead2 = { id: 'u_lead2', username: 'lead2', role_id: 'sector_lead', sector_id: 'S2', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const pm = { id: 'u_pm', username: 'pm', role_id: 'project_manager', sector_id: 'S1', scope: 'own', projectIds: new Set(['P1']), teamIds: new Set() };
const consultantIn = { id: 'u_c1', username: 'cons1', role_id: 'consultant', sector_id: 'S1', scope: 'own', projectIds: new Set(['P1']), teamIds: new Set() };
const consultantOut = { id: 'u_c2', username: 'cons2', role_id: 'consultant', sector_id: 'S2', scope: 'own', projectIds: new Set(['P9']), teamIds: new Set() };

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  gov = await import('../../src/modules/pmo/governance.js');
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });
  await db.insert('app_user', { id: 'u_owner', username: 'owner1', role_id: 'employee', sector_id: 'S1', scope: 'own', active: 1, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع الحوكمة', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

const auditCount = async (resource, action) =>
  (await db.get('SELECT COUNT(*) AS "n" FROM audit_log WHERE resource = ? AND action = ?', [resource, action])).n;

test('risk: create derives exposure, list, update recomputes exposure, soft-delete — all audited', async () => {
  const r = await gov.createItem(ctx(lead1), 'P1', 'risk', { title: 'تأخر توفير البيانات', probability: 'high', impact: 'high', mitigation: 'تصعيد للعميل', owner_user_id: 'u_owner' });
  assert.equal(r.status, 'OPEN');
  assert.equal(r.exposure, 'مرتفع', 'high × high derives high exposure');
  assert.equal(r.sector_id, 'S1', 'risk row carries the project sector');
  assert.equal(await auditCount('risk', 'create'), 1);
  const listed = await gov.listItems(lead1, 'P1', 'risk');
  assert.equal(listed.length, 1);
  const u = await gov.updateItem(ctx(lead1), 'risk', r.id, { probability: 'low', status: 'MITIGATING' });
  assert.equal(u.status, 'MITIGATING');
  assert.equal(u.exposure, 'متوسط', 'low × high recomputes to medium');
  assert.equal(await auditCount('risk', 'update'), 1);
  await gov.deleteItem(ctx(lead1), 'risk', r.id);
  assert.equal((await gov.listItems(lead1, 'P1', 'risk')).length, 0, 'soft-deleted rows leave the list');
  assert.ok((await db.get('SELECT deleted_at FROM risk WHERE id = ?', [r.id])).deleted_at, 'soft delete, not hard');
  assert.equal(await auditCount('risk', 'delete'), 1);
  await assert.rejects(() => gov.createItem(ctx(lead1), 'P1', 'risk', { title: 'س', probability: 'خطأ' }), /احتمال/);
});

test('issue: open → close stamps closed_at; reopen clears it', async () => {
  const i = await gov.createItem(ctx(pm), 'P1', 'issue', { title: 'تعذر الوصول للبيئة', severity: 'high', owner_user_id: 'u_owner' });
  assert.equal(i.status, 'OPEN');
  assert.ok(i.opened_at);
  assert.equal(i.closed_at, null);
  const closed = await gov.updateItem(ctx(pm), 'issue', i.id, { status: 'CLOSED' });
  assert.ok(closed.closed_at, 'closing stamps closed_at');
  const reopened = await gov.updateItem(ctx(pm), 'issue', i.id, { status: 'OPEN' });
  assert.equal(reopened.closed_at, null, 'reopening clears closed_at');
  await assert.rejects(() => gov.updateItem(ctx(pm), 'issue', i.id, { status: 'WEIRD' }), /الحالة/);
});

test('decision: log entry with decided_by/decided_at; status patches are rejected', async () => {
  const d = await gov.createItem(ctx(lead1), 'P1', 'decision', { title: 'اعتماد تمديد المرحلة', detail: 'شهر إضافي', decided_by: 'اللجنة التوجيهية' });
  assert.ok(d.decided_at, 'defaults to today');
  const u = await gov.updateItem(ctx(lead1), 'decision', d.id, { detail: 'شهران إضافيان' });
  assert.equal(u.detail, 'شهران إضافيان');
  await assert.rejects(() => gov.updateItem(ctx(lead1), 'decision', d.id, { status: 'APPROVED' }), /بلا حالة/);
});

test('change request: REQUESTED → APPROVED / REJECTED only', async () => {
  const c = await gov.createItem(ctx(lead1), 'P1', 'change', { title: 'توسيع النطاق: ورشة إضافية', impact: 'أسبوعا عمل' });
  assert.equal(c.status, 'REQUESTED');
  const a = await gov.updateItem(ctx(lead1), 'change', c.id, { status: 'APPROVED' });
  assert.equal(a.status, 'APPROVED');
  await assert.rejects(() => gov.updateItem(ctx(lead1), 'change', c.id, { status: 'MAYBE' }), /الحالة/);
  assert.ok(await auditCount('change_request', 'create') >= 1, 'audited under the real table name');
});

test('milestone: PENDING → MET and → MISSED transitions; bad status rejected', async () => {
  const m = await gov.createItem(ctx(pm), 'P1', 'milestone', { name_ar: 'تسليم التقرير الأول', due_date: '2026-08-15' });
  assert.equal(m.status, 'PENDING');
  const met = await gov.updateItem(ctx(pm), 'milestone', m.id, { status: 'MET' });
  assert.equal(met.status, 'MET');
  const missed = await gov.updateItem(ctx(pm), 'milestone', m.id, { status: 'MISSED' });
  assert.equal(missed.status, 'MISSED');
  await assert.rejects(() => gov.updateItem(ctx(pm), 'milestone', m.id, { status: 'DONE' }), /الحالة/);
  await assert.rejects(() => gov.createItem(ctx(pm), 'P1', 'milestone', { due_date: '2026-01-01' }), /اسم المعلم/);
});

test('403: consultant OUTSIDE the project cannot even read; consultant ON the project reads but cannot write', async () => {
  await assert.rejects(() => gov.listItems(consultantOut, 'P1', 'risk'), /نطاق|صلاحيات|forbidden/);
  const rows = await gov.listItems(consultantIn, 'P1', 'issue');
  assert.ok(Array.isArray(rows), 'project-member consultant may read');
  await assert.rejects(() => gov.createItem(ctx(consultantIn), 'P1', 'issue', { title: 'محاولة كتابة' }), /صلاحية|forbidden/);
});

test('403: sector lead of ANOTHER sector can neither create nor update through the item id (IDOR guard)', async () => {
  await assert.rejects(() => gov.createItem(ctx(lead2), 'P1', 'risk', { title: 'اختراق نطاق' }), /صلاحية|نطاق|forbidden/);
  const r = await gov.createItem(ctx(lead1), 'P1', 'risk', { title: 'خطر داخلي', probability: 'low', impact: 'low' });
  await assert.rejects(() => gov.updateItem(ctx(lead2), 'risk', r.id, { title: 'تلاعب' }), /صلاحية|forbidden/);
  await assert.rejects(() => gov.deleteItem(ctx(lead2), 'risk', r.id), /صلاحية|forbidden/);
});

test('projectGovernance composite payload carries all five registers + canEdit per caller', async () => {
  const forLead = await gov.projectGovernance(lead1, 'P1');
  assert.ok(forLead.canEdit);
  for (const k of ['risks', 'issues', 'decisions', 'changes', 'milestones']) assert.ok(Array.isArray(forLead[k]), k + ' present');
  const forConsultant = await gov.projectGovernance(consultantIn, 'P1');
  assert.equal(forConsultant.canEdit, false, 'read-only consultant sees canEdit=false');
});

test('unknown ids fail closed in Arabic', async () => {
  await assert.rejects(() => gov.listItems(lead1, 'P_missing', 'risk'), /غير موجود/);
  await assert.rejects(() => gov.updateItem(ctx(lead1), 'risk', 'rsk_missing', { title: 'س' }), /غير موجود/);
  await assert.rejects(() => gov.createItem(ctx(lead1), 'P1', 'wrongkind', { title: 'س' }), /غير معروف/);
});
