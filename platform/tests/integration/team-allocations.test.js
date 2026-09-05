// ── طلبات التسكين والمصفوفة (وحدة الفريق والموارد — B2) ─────────────────────────────────
//
// حالات القبول من الموجّه بأسمائها: T02 (المبدئي منفصل)، T07 (300% يبقى ويُعلَّم)، T11 (خارج
// الارتباط يمنع المؤكد)، T14 (تعديل شهرٍ واحد يحفظ الباقي)، T18 (طلبٌ عبر إدارةٍ أخرى لا يغيّر
// المؤكد قبل الاعتماد)، T19 (مفتاح عدم التكرار)، T20 (طلبان متنافسان — الثاني يُعاد)، T21 (الرفض
// بسببٍ محفوظ). كل كتابةٍ تُفحص بأثرها في التدقيق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-alloc-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, A, engine, resolveUser;
const T = new Date().toISOString();
const Y = new Date().getUTCFullYear();
const K = (m) => `${Y}-${String(m).padStart(2, '0')}`;

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const allocCount = async (eid) => Number((await db.get('SELECT COUNT(*) c FROM allocation WHERE employee_id = ? AND deleted_at IS NULL', [eid])).c);
const auditActions = async (reqId) => (await db.all(
  `SELECT action, user_id FROM audit_log WHERE resource = 'allocation_request' AND resource_id = ? ORDER BY at, id`, [reqId]));
const cellOf = (matrix, eid, key) => matrix.rows.find((r) => r.resource.id === eid).cells.find((c) => c.key === key);

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  A = await import('../../src/modules/team/allocations.js');
  engine = await import('../../src/modules/workflow/engine.js');

  for (const [sid, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id: sid, name_ar: name, kind: 'delivery', active: 1, created_at: T });
  }
  const mkUser = (uid, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');          // قائد قطاع الحلول — يملك أمر أهله كلهم
  await mkUser('u_dm1', 'department_manager', 'SOL', 'department'); // مدير الإدارة الأولى
  await mkUser('u_dm2', 'department_manager', 'SOL', 'department'); // مدير الإدارة الثانية
  await mkUser('u_bd', 'bd_manager', 'SOL', 'own');                // يطلب ولا يملك — الحالة T18
  await mkUser('u_e1', 'consultant', 'SOL', 'own');

  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', manager_user_id: 'u_dm1', active: 1, created_at: T });
  await db.insert('department', { id: 'D2', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي', manager_user_id: 'u_dm2', active: 1, created_at: T });
  await db.insert('department', { id: 'D3', sector_id: 'SOL', name_ar: 'إدارة بلا مدير', active: 1, created_at: T });

  const mkEmp = async (eid, uid, dept, extra = {}) => {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: 'مورد ' + eid, sector_id: 'SOL', department_id: dept,
      job_title: 'استشاري', status: 'نشط', active: 1, hire_date: '2025-01-01', created_at: T, ...extra });
    if (uid) await db.update('app_user', uid, { employee_id: eid });
  };
  await mkEmp('e_dm1', 'u_dm1', 'D1');
  await mkEmp('e_dm2', 'u_dm2', 'D2');
  await mkEmp('e_1', 'u_e1', 'D1');
  await mkEmp('e_2', null, 'D1');                                    // بلا حساب دخول — يُخطَّط له (T16)
  await mkEmp('e_3', null, 'D2', { end_date: `${Y}-09-30` });        // ينتهي ارتباطه آخر سبتمبر (T11)
  await mkEmp('e_4', null, 'D3');                                    // إدارته بلا مدير

  for (const pid of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
    await db.insert('project', { id: pid, name_ar: 'مشروع ' + pid, sector_id: 'SOL', department_id: 'D1', status: 'IN_PROGRESS', created_at: T });
  }
  await db.insert('project', { id: 'PC', name_ar: 'مشروع الاستشارات', sector_id: 'CONS', status: 'IN_PROGRESS', created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── T02 ─────────────────────────────────────────────────────────────────────────────
test('T02: المبدئي منفصل في المصفوفة — لا يُخصم من المتاح المؤكد، وحالته على صف التسكين', async () => {
  const dm1 = await ctxOf('u_dm1');
  const r1 = await A.submitRequest(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P1' },
    months: { [K(10)]: 60, [K(11)]: 60, [K(12)]: 60 }, allocStatus: 'confirmed' }, {});
  assert.equal(r1.requests[0].status, 'applied', 'مالك أمر المورد يطبّق فوراً');
  assert.equal(r1.directApply, true);
  const r2 = await A.submitRequest(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P2' },
    from: K(10), to: K(10), pct: 20, allocStatus: 'tentative' }, {});
  const tent = await db.get('SELECT status, billable, monthly_json FROM allocation WHERE id = ?', [r2.requests[0].appliedAllocationId]);
  assert.equal(tent.status, 'tentative', 'الحالة كُتبت على صف التسكين بعد الكاتب القائم');
  assert.deepEqual(JSON.parse(tent.monthly_json), { 10: 0.2 });

  const m = await A.planningMatrix(await sess('u_dm1'), { from: K(10), to: K(12) });
  assert.equal(m.total, 3, 'مدير الإدارة يرى أهل إدارته الثلاثة');
  const c = cellOf(m, 'e_1', K(10));
  assert.equal(c.confirmedPct, 60);
  assert.equal(c.tentativePct, 20);
  assert.equal(c.availablePct, 40, 'المبدئي لا يُخصم');
  assert.equal(c.items.filter((i) => i.status === 'tentative').length, 1);
  assert.equal(c.items.find((i) => i.status === 'tentative').label, 'مشروع P2');
  const hidden = await A.planningMatrix(await sess('u_dm1'), { from: K(10), to: K(10), showTentative: false });
  assert.equal(cellOf(hidden, 'e_1', K(10)).tentativePct, 0);
  assert.ok(!cellOf(hidden, 'e_1', K(10)).items.some((i) => i.status === 'tentative'));

  const acts = (await auditActions(r1.requests[0].id)).map((a) => a.action);
  assert.deepEqual(acts, ['create', 'apply'], 'إنشاء الطلب وتطبيقه مكتوبان في الأثر');
  assert.ok((await auditActions(r1.requests[0].id)).every((a) => a.user_id === 'u_dm1'), 'الأثر بفاعله');
  const g = await A.getRequest(await sess('u_dm1'), r1.requests[0].id);
  assert.equal(g.status_ar, 'مطبَّق');
  assert.ok(Array.isArray(g.effect) && g.effect.length === 3, 'الأثر قبل/بعد محفوظ للمطبَّق');
  assert.equal(g.effect[0].current, 0); assert.equal(g.effect[0].after, 60);
});

// ── T07 ─────────────────────────────────────────────────────────────────────────────
test('T07: 300% يبقى ويُعلَّم تجاوزاً — المعاينة تقوله ولا تمنعه', async () => {
  const dm1 = await ctxOf('u_dm1');
  const p1 = await A.previewChange(await sess('u_dm1'), { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P1' }, from: K(11), pct: 150 });
  assert.equal(p1.perResource[0].months[0].after, 150);
  assert.equal(p1.perResource[0].months[0].conflict, true);
  assert.equal(p1.canSubmit, true, 'التعارض يُعرض ولا يُمنع');
  assert.match(p1.perResource[0].warnings_ar[0], /تجاوز الطاقة/);
  await A.submitRequest(dm1, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P1' }, from: K(11), pct: 150 }, {});
  const p2 = await A.previewChange(await sess('u_dm1'), { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P2' }, from: K(11), pct: 150 });
  assert.equal(p2.perResource[0].months[0].current, 150);
  assert.equal(p2.perResource[0].months[0].after, 300);
  assert.equal(p2.perResource[0].months[0].availableAfter, 0);
  const r = await A.submitRequest(dm1, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P2' }, from: K(11), pct: 150 }, {});
  assert.equal(r.requests[0].status, 'applied');
  const m = await A.planningMatrix(await sess('u_dm1'), { from: K(11), to: K(11) });
  const c = cellOf(m, 'e_2', K(11));
  assert.equal(c.confirmedPct, 300, 'لا يُقصّ إلى 100');
  assert.equal(c.overPct, 200);
  assert.equal(c.state, 'over');
  assert.equal(c.band, 'over');
  assert.equal(c.availablePct, 0);
  // والإضافة الثالثة على نفس المشروع تُرَدّ بموانع المعاينة لا بخطأ الكاتب المتأخر
  const p3 = await A.previewChange(await sess('u_dm1'), { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P2' }, from: K(12), pct: 10 });
  assert.equal(p3.canSubmit, false);
  assert.match(p3.perResource[0].blockers_ar[0], /مُسكَّن على/);
  await assert.rejects(async () => A.submitRequest(dm1, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P2' }, from: K(12), pct: 10 }, {}), /مُسكَّن على/);
});

// ── T14 ─────────────────────────────────────────────────────────────────────────────
test('T14: تعديل أكتوبر وحده يحفظ بقية الأشهر — و«حتى نهاية السنة» يمسّ ما بعده فقط', async () => {
  const dm1 = await ctxOf('u_dm1');
  const alloc = await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_1' AND project_id = 'P1' AND deleted_at IS NULL`);
  const pv = await A.previewChange(await sess('u_dm1'), { kind: 'adjust', allocationId: alloc.id, months: { [K(10)]: 30 }, scope: 'month' });
  assert.equal(pv.change.kind, 'adjust');
  assert.equal(pv.perResource[0].months.length, 1, 'المعاينة تذكر الشهر الملموس وحده');
  assert.equal(pv.perResource[0].months[0].current, 60);
  assert.equal(pv.perResource[0].months[0].after, 30);
  const r = await A.submitRequest(dm1, { kind: 'adjust', allocationId: alloc.id, months: { [K(10)]: 30 }, scope: 'month' }, {});
  assert.equal(r.requests[0].status, 'applied');
  assert.equal(r.requests[0].appliedAllocationId, alloc.id);
  const mj = JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [alloc.id])).monthly_json);
  assert.deepEqual(mj, { 10: 0.3, 11: 0.6, 12: 0.6 }, 'نوفمبر وديسمبر كما كانا');
  // حتى نهاية السنة: من نوفمبر إلى ديسمبر، وأكتوبر لا يُمَسّ — وبلا معرّف تسكين (الخلية تكفي: المورد + الوجهة + السنة)
  const r2 = await A.submitRequest(dm1, { kind: 'adjust', employeeId: 'e_1', target: { kind: 'project', id: 'P1' }, from: K(11), pct: 40, scope: 'onward' }, {});
  assert.equal(r2.requests[0].status, 'applied');
  const mj2 = JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [alloc.id])).monthly_json);
  assert.deepEqual(mj2, { 10: 0.3, 11: 0.4, 12: 0.4 });
  // الصفر يمسح شهره وحده
  await A.submitRequest(dm1, { kind: 'adjust', allocationId: alloc.id, months: { [K(12)]: 0 } }, {});
  const mj3 = JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [alloc.id])).monthly_json);
  assert.deepEqual(mj3, { 10: 0.3, 11: 0.4 });
  // وسنةٌ أخرى تُرَدّ بالعربية
  await assert.rejects(async () => A.previewChange(await sess('u_dm1'), { kind: 'adjust', allocationId: alloc.id, months: { [`${Y + 1}-01`]: 10 } }), /سنة التسكين/);
});

// ── T11 ─────────────────────────────────────────────────────────────────────────────
test('T11: شهرٌ خارج الارتباط يمنع التسكين المؤكد ولا يمنع المبدئي', async () => {
  const dm2 = await ctxOf('u_dm2');
  const pv = await A.previewChange(await sess('u_dm2'), { kind: 'new', employeeId: 'e_3', target: { kind: 'bucket', id: 'bd' }, from: K(9), to: K(10), pct: 30 });
  const sep = pv.perResource[0].months.find((m) => m.key === K(9)); const oct = pv.perResource[0].months.find((m) => m.key === K(10));
  assert.equal(sep.outOfEngagement, false);
  assert.equal(oct.outOfEngagement, true);
  assert.equal(oct.after, null, 'خارج الارتباط حالةٌ لا رقم');
  assert.equal(pv.canSubmit, false);
  assert.match(pv.perResource[0].blockers_ar[0], /خارج فترة ارتباط/);
  await assert.rejects(async () => A.submitRequest(dm2, { kind: 'new', employeeId: 'e_3', target: { kind: 'bucket', id: 'bd' }, from: K(9), to: K(10), pct: 30 }, {}),
    /خارج فترة ارتباط/);
  assert.equal(await allocCount('e_3'), 0, 'لا حجز بعد الرفض');
  const r = await A.submitRequest(dm2, { kind: 'new', employeeId: 'e_3', target: { kind: 'bucket', id: 'bd' }, from: K(9), to: K(10), pct: 30, allocStatus: 'tentative' }, {});
  assert.equal(r.requests[0].status, 'applied', 'المبدئي يمرّ بتحذير');
});

// ── T18 ─────────────────────────────────────────────────────────────────────────────
test('T18: طلبٌ عبر إدارةٍ أخرى لا يغيّر المؤكد قبل الاعتماد — ويُطبَّق بصلاحية المعتمِد بعده', async () => {
  const bd = await ctxOf('u_bd');
  const before1 = await allocCount('e_1');
  const pv = await A.previewChange(await sess('u_bd'), { kind: 'new', employeeId: 'e_1', target: { kind: 'bucket', id: 'pmo' }, from: K(12), pct: 50 });
  assert.equal(pv.directApply, false);
  assert.deepEqual(pv.reviewers.map((x) => x.userId), ['u_dm1'], 'المعتمِد مدير إدارة المورد');
  assert.match(pv.reviewers[0].why_ar, /مدير إدارة/);
  const r = await A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'bucket', id: 'pmo' }, from: K(12), pct: 50 },
    { expectedFingerprints: pv.fingerprints, idempotencyKey: 'k-t18' });
  const req = r.requests[0];
  assert.equal(req.status, 'pending');
  assert.equal(req.status_ar, 'بانتظار الاعتماد');
  assert.equal(req.reviewer.id, 'u_dm1');
  assert.ok(req.approvalRequestId, 'طلب اعتماد موجَّه في الصندوق الواحد');
  assert.equal(await allocCount('e_1'), before1, 'الطلب المعلَّق لا يحجز شيئاً');

  const m = await A.planningMatrix(await sess('u_dm1'), { from: K(12), to: K(12) });
  const c = cellOf(m, 'e_1', K(12));
  assert.equal(c.pendingPct, 50, 'المعلَّق طبقةُ عرضٍ في المصفوفة');
  assert.equal(c.confirmedPct, 0, 'والمؤكد كما هو (ديسمبر مُسح في T14)');
  assert.equal(c.availablePct, 100);
  const q = await engine.myDirectApprovals(await sess('u_dm1'));
  assert.ok(q.some((x) => x.id === req.approvalRequestId), 'وصل إلى صندوق المدير');
  const mine = await A.listRequests(await sess('u_dm1'), { filter: 'pending_my_decision' });
  assert.ok(mine.rows.some((x) => x.id === req.id && x.canDecide), '«بانتظار قراري» تعرضه للمدير');
  const ntf = await db.get(`SELECT id FROM notification WHERE user_id = 'u_dm1' AND ref_id = ?`, [req.approvalRequestId]);
  assert.ok(ntf, 'المدير أُخطر');

  const d = await A.decideRequest(await ctxOf('u_dm1'), req.id, 'approve', 'موافق');
  assert.equal(d.status, 'applied');
  assert.ok(d.appliedAllocationId);
  const a = await db.get('SELECT status, work_bucket, monthly_json FROM allocation WHERE id = ?', [d.appliedAllocationId]);
  assert.equal(a.work_bucket, 'pmo');
  assert.equal(a.status, 'confirmed');
  assert.deepEqual(JSON.parse(a.monthly_json), { 12: 0.5 });
  assert.equal((await db.get('SELECT status FROM approval_request WHERE id = ?', [req.approvalRequestId])).status, 'APPROVED');
  const acts = await auditActions(req.id);
  assert.deepEqual(acts.map((x) => x.action), ['create', 'apply']);
  assert.equal(acts[1].user_id, 'u_dm1', 'التطبيق بصلاحية المعتمِد واسمه');
  const g = await A.getRequest(await sess('u_bd'), req.id);
  assert.equal(g.approval.status, 'APPROVED');
  assert.equal(g.approval.actions[0].action, 'approve');
  assert.ok(g.history.some((h) => h.action === 'apply'));
  assert.equal(cellOf(await A.planningMatrix(await sess('u_dm1'), { from: K(12), to: K(12) }), 'e_1', K(12)).confirmedPct, 50);
});

// ── T19 ─────────────────────────────────────────────────────────────────────────────
test('T19: نفس مفتاح عدم التكرار ⇒ الطلب نفسه لا حجزان — في المسارين المعلَّق والمباشر', async () => {
  const bd = await ctxOf('u_bd');
  const change = { kind: 'new', employeeId: 'e_2', target: { kind: 'bucket', id: 'bd' }, from: K(12), pct: 20 };
  const r1 = await A.submitRequest(bd, change, { idempotencyKey: 'k-t19' });
  const r2 = await A.submitRequest(bd, change, { idempotencyKey: 'k-t19' });
  assert.equal(r1.requests[0].id, r2.requests[0].id);
  assert.equal(r2.summary.reused, 1);
  assert.equal(Number((await db.get(`SELECT COUNT(*) c FROM allocation_request WHERE idempotency_key LIKE 'k-t19:%'`)).c), 1);
  assert.equal(Number((await db.get(`SELECT COUNT(*) c FROM approval_request WHERE resource_id = ?`, [r1.requests[0].id])).c), 1, 'طلب اعتماد واحد');
  const dm1 = await ctxOf('u_dm1');
  const direct = { kind: 'new', employeeId: 'e_2', target: { kind: 'bucket', id: 'product' }, from: K(12), pct: 10 };
  const d1 = await A.submitRequest(dm1, direct, { idempotencyKey: 'k-t19-direct' });
  const d2 = await A.submitRequest(dm1, direct, { idempotencyKey: 'k-t19-direct' });
  assert.equal(d1.requests[0].status, 'applied');
  assert.equal(d1.requests[0].id, d2.requests[0].id);
  assert.equal(Number((await db.get(`SELECT COUNT(*) c FROM allocation WHERE employee_id = 'e_2' AND work_bucket = 'product' AND deleted_at IS NULL`)).c), 1);
});

// ── T20 ─────────────────────────────────────────────────────────────────────────────
test('T20: طلبان متنافسان بالبصمة نفسها — الأول يُطبَّق والثاني يُعاد «تغيّرت الخطة منذ المعاينة»', async () => {
  const bd = await ctxOf('u_bd'); const bdUser = await sess('u_bd');
  const pvA = await A.previewChange(bdUser, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P3' }, from: K(12), pct: 10 });
  const pvB = await A.previewChange(bdUser, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 10 });
  assert.equal(pvA.fingerprints.e_1, pvB.fingerprints.e_1);
  const a = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P3' }, from: K(12), pct: 10 }, { expectedFingerprints: pvA.fingerprints })).requests[0];
  const b = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 10 }, { expectedFingerprints: pvB.fingerprints })).requests[0];
  assert.equal(a.status, 'pending'); assert.equal(b.status, 'pending');
  const dm1 = await ctxOf('u_dm1');
  const da = await A.decideRequest(dm1, a.id, 'approve');
  assert.equal(da.status, 'applied');
  const dbb = await A.decideRequest(dm1, b.id, 'approve');
  assert.equal(dbb.status, 'returned');
  assert.match(dbb.reason, /تغيّرت الخطة منذ المعاينة/);
  assert.equal(await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_1' AND project_id = 'P4' AND deleted_at IS NULL`), undefined, 'لا حجز للمُعاد');
  assert.equal((await db.get('SELECT status FROM approval_request WHERE id = ?', [b.approvalRequestId])).status, 'REJECTED', 'طلب الاعتماد أُغلق بسببه');
  assert.ok((await auditActions(b.id)).some((x) => x.action === 'return'), 'الإعادة في الأثر');
  const gb = await A.getRequest(bdUser, b.id);
  assert.equal(gb.status_ar, 'مُعاد للتعديل');
  assert.match(gb.approval.actions[0].comment, /تغيّرت الخطة/);

  // ومعاينةٌ قديمة لا تُرسل أصلاً: بصمة ما قبل التطبيق تُرَدّ عند الإرسال
  await assert.rejects(async () => A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 10 }, { expectedFingerprints: pvB.fingerprints }),
    /تغيّرت الخطة منذ المعاينة/);

  // ونفس الحارس داخل المُسوّي حين يعتمد المدير من صندوق الاعتمادات مباشرةً (بلا decideRequest)
  const pvC = await A.previewChange(bdUser, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 10 });
  const c = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 10 }, { expectedFingerprints: pvC.fingerprints })).requests[0];
  const d = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P5' }, from: K(12), pct: 10 }, { expectedFingerprints: pvC.fingerprints })).requests[0];
  await engine.actOnApproval(dm1, c.approvalRequestId, 'approve', 'من الصندوق');
  const gc = await A.getRequest(bdUser, c.id);
  assert.equal(gc.status, 'applied', 'المُسوّي الكسول طبّق الطلب');
  assert.ok(await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_1' AND project_id = 'P4' AND deleted_at IS NULL`));
  await engine.actOnApproval(dm1, d.approvalRequestId, 'approve', 'من الصندوق');
  const gd = await A.getRequest(bdUser, d.id);
  assert.equal(gd.status, 'returned');
  assert.match(gd.reason, /تغيّرت الخطة منذ المعاينة/);
  assert.equal(await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_1' AND project_id = 'P5' AND deleted_at IS NULL`), undefined);
  const told = await db.get(`SELECT body FROM notification WHERE user_id = 'u_bd' AND ref_id = ? AND title LIKE '%أُعيد%'`, [d.id]);
  assert.ok(told && /تغيّرت الخطة/.test(told.body), 'صاحب الطلب يُخبَر بسبب الإعادة');
});

// ── T21 ─────────────────────────────────────────────────────────────────────────────
test('T21: الرفض والإعادة يحتاجان سبباً — ويُحفظ على الطلب وفي الأثر', async () => {
  const bd = await ctxOf('u_bd');
  const r = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P3' }, from: K(12), pct: 30 }, {})).requests[0];
  const dm1 = await ctxOf('u_dm1');
  await assert.rejects(async () => A.decideRequest(dm1, r.id, 'reject', ''), /سبب الرفض/);
  await assert.rejects(async () => A.decideRequest(dm1, r.id, 'return', '   '), /سبب الإعادة/);
  await assert.rejects(async () => A.decideRequest(dm1, r.id, 'maybe', 'x'), /حدّد القرار/);
  assert.equal((await db.get('SELECT status FROM allocation_request WHERE id = ?', [r.id])).status, 'pending', 'لا شيء تغيّر بلا سبب');
  const d = await A.decideRequest(dm1, r.id, 'reject', 'الأولوية لمشروع الحافلات');
  assert.equal(d.status, 'rejected');
  assert.equal(d.status_ar, 'مرفوض');
  assert.equal(d.decision_note, 'الأولوية لمشروع الحافلات');
  assert.equal(d.reason, 'الأولوية لمشروع الحافلات');
  assert.equal(d.decidedBy.id, 'u_dm1');
  assert.equal((await db.get('SELECT status FROM approval_request WHERE id = ?', [r.approvalRequestId])).status, 'REJECTED');
  const aud = await db.get(`SELECT detail_json FROM audit_log WHERE resource = 'allocation_request' AND resource_id = ? AND action = 'reject'`, [r.id]);
  assert.ok(aud && JSON.parse(aud.detail_json).reason === 'الأولوية لمشروع الحافلات', 'السبب في الأثر');
  assert.equal(await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_2' AND project_id = 'P3' AND deleted_at IS NULL`), undefined);
  await assert.rejects(async () => A.decideRequest(dm1, r.id, 'approve'), /لا يُقرَّر مرتين/);
  // الإعادة بسبب — والمُعاد يُقرأ بأثره الحيّ
  const r2 = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P4' }, from: K(12), pct: 30 }, {})).requests[0];
  const d2 = await A.decideRequest(dm1, r2.id, 'return', 'خفّض النسبة إلى 20');
  assert.equal(d2.status, 'returned');
  assert.equal(d2.reason, 'خفّض النسبة إلى 20');
  assert.ok(Array.isArray(d2.effect) && d2.effect.length === 1, 'المُعاد يُقرأ بأثره الحيّ');
  assert.equal(d2.effect[0].added, 30);
  assert.equal(d2.effect[0].after, d2.effect[0].current + 30, 'بعد = المؤكد الآن + المطلوب');
});

// ── ما بين الحالات: السحب، وبلا مدير، وفصل المهام ───────────────────────────────────
test('السحب: صاحبه وقبل القرار — ويُغلق طلب الاعتماد فلا يبقى في صندوق المدير', async () => {
  const bd = await ctxOf('u_bd');
  const r = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_2', target: { kind: 'project', id: 'P5' }, from: K(12), pct: 30 }, {})).requests[0];
  await assert.rejects(async () => A.withdrawRequest(await ctxOf('u_dm1'), r.id), /صاحبُه/);
  const w = await A.withdrawRequest(bd, r.id);
  assert.equal(w.status, 'withdrawn');
  assert.equal((await db.get('SELECT status FROM approval_request WHERE id = ?', [r.approvalRequestId])).status, 'CANCELLED');
  assert.ok(!(await engine.myDirectApprovals(await sess('u_dm1'))).some((x) => x.id === r.approvalRequestId));
  await assert.rejects(async () => A.decideRequest(await ctxOf('u_dm1'), r.id, 'approve'), /لا يُقرَّر مرتين/);
  assert.ok((await auditActions(r.id)).some((x) => x.action === 'withdraw'));
  await assert.rejects(async () => A.withdrawRequest(bd, r.id), /لا يُسحب بعد القرار/);
});

test('بلا مدير مسجَّل: الطلب يبقى معلَّقاً بملاحظةٍ تقول ذلك — ويقرّره من يملك أمر المورد', async () => {
  const bd = await ctxOf('u_bd');
  const pv = await A.previewChange(await sess('u_bd'), { kind: 'new', employeeId: 'e_4', target: { kind: 'bucket', id: 'bd' }, from: K(11), pct: 40 });
  assert.equal(pv.reviewers.length, 0);
  assert.match(pv.perResource[0].warnings_ar.join(' '), /لا مدير مسجَّل/);
  const r = (await A.submitRequest(bd, { kind: 'new', employeeId: 'e_4', target: { kind: 'bucket', id: 'bd' }, from: K(11), pct: 40 }, {})).requests[0];
  assert.equal(r.status, 'pending');
  assert.equal(r.approvalRequestId, null);
  assert.match(r.note, /لا مدير مسجَّل/);
  await assert.rejects(async () => A.decideRequest(bd, r.id, 'approve'), /رفعتَه بنفسك/);
  await assert.rejects(async () => A.decideRequest(await ctxOf('u_dm2'), r.id, 'approve'), /يملك أمر المورد/);
  const lead = await sess('u_lead');
  assert.ok((await A.listRequests(lead, { filter: 'pending_my_decision' })).rows.some((x) => x.id === r.id), 'قائد القطاع يجده في «بانتظار قراري»');
  const d = await A.decideRequest(await ctxOf('u_lead'), r.id, 'approve', 'تمام');
  assert.equal(d.status, 'applied');
  assert.equal((await db.get('SELECT status FROM allocation WHERE id = ?', [d.appliedAllocationId])).status, 'confirmed');
  assert.ok(await db.get(`SELECT id FROM notification WHERE user_id = 'u_bd' AND ref_id = ? AND title LIKE '%اعتُمد%'`, [r.id]), 'صاحب الطلب أُخطر');
});

test('الإزالة: طلب إزالة يحذف ناعماً عبر الكاتب القائم، والمعاينة تقرأ ما بعده صفراً', async () => {
  const dm1 = await ctxOf('u_dm1');
  const alloc = await db.get(`SELECT id FROM allocation WHERE employee_id = 'e_2' AND project_id = 'P2' AND deleted_at IS NULL`);
  const pv = await A.previewChange(await sess('u_dm1'), { kind: 'remove', allocationId: alloc.id });
  assert.equal(pv.change.kind, 'remove');
  const nov = pv.perResource[0].months.find((m) => m.key === K(11));
  assert.equal(nov.current, 300); assert.equal(nov.after, 150); assert.equal(nov.added, -150);
  const r = await A.submitRequest(dm1, { kind: 'remove', allocationId: alloc.id }, {});
  assert.equal(r.requests[0].status, 'applied');
  assert.ok((await db.get('SELECT deleted_at FROM allocation WHERE id = ?', [alloc.id])).deleted_at, 'حذف ناعم لا محو');
  assert.equal(cellOf(await A.planningMatrix(await sess('u_dm1'), { from: K(11), to: K(11) }), 'e_2', K(11)).confirmedPct, 150);
});

test('المدخلات المعطوبة تُرَدّ بالعربية: نوعٌ مجهول، نسبةٌ فوق السقف، ووجهةٌ ناقصة', async () => {
  const dm1 = await sess('u_dm1');
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'teleport', employeeId: 'e_1' }), /حدّد نوع التغيير/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P6' }, from: K(12), pct: 200 }), /بين 0 و150/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'bucket', id: 'x' }, from: K(12), pct: 10 }), /بند العمل الداخلي/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', from: K(12), pct: 10 }), /جهة العمل/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P6' }, from: 'الشهر', pct: 10 }), /السنة-الشهر/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P6' }, from: K(12), to: `${Y + 1}-02`, pct: 10 }), /سنة واحدة/);
  await assert.rejects(async () => A.previewChange(dm1, { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'PC' }, from: K(12), pct: 10 }), /خارج نطاقك/);
  await assert.rejects(async () => A.planningMatrix(dm1, { from: K(1), to: `${Y + 3}-12` }), /كحد أقصى/);
});
