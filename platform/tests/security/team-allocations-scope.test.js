// ── حدود طلبات التسكين ────────────────────────────────────────────────────────────────
//
// «إخفاء زرٍّ لا يكفي» (الموجّه §10): الحد في الخدمة على الصفوف والطلبات والقرارات معاً.
//   • من لا يملك «طلب تسكين» يُرفض — الموظف على زميله، والموارد البشرية (قراءةً لا طلباً).
//   • الموظف يرى طلباته هو فقط، ولا يفتح طلب غيره بالمعرّف.
//   • مدير الإدارة يرى طلبات أهل إدارته لا غيرها، والقائمة والصف بحدٍّ واحد.
//   • القرار لمن وُجِّه إليه: مدير إدارة أخرى لا يقرّر، وصاحب الطلب لا يعتمد نفسه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-alloc-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, A, resolveUser;
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

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  A = await import('../../src/modules/team/allocations.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  const mkUser = (uid, role, scope = 'own', sector = 'SOL') => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_dm1', 'department_manager', 'department');
  await mkUser('u_dm2', 'department_manager', 'department');
  await mkUser('u_bd', 'bd_manager', 'own');
  await mkUser('u_e1', 'consultant');          // موظف الإدارة الأولى
  await mkUser('u_e2', 'employee');            // موظف الإدارة الثانية — بلا أي منح على الطلبات
  await mkUser('u_hr', 'hr', 'own', null);     // يقرأ الطلبات شركةً ولا يطلب
  await mkUser('u_pm', 'project_manager', 'own'); // مدير مشروع P1: «طلب تسكين» بنطاق مشروع بلا قراءة الموظفين
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_c', user_id: null, name_ar: 'مورد قطاع آخر', sector_id: 'CONS', department_id: null,
    job_title: 'استشاري', status: 'نشط', active: 1, hire_date: '2025-01-01', created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', manager_user_id: 'u_dm1', active: 1, created_at: T });
  await db.insert('department', { id: 'D2', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي', manager_user_id: 'u_dm2', active: 1, created_at: T });
  const mkEmp = async (eid, uid, dept) => {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: 'مورد ' + eid, sector_id: 'SOL', department_id: dept,
      job_title: 'استشاري', status: 'نشط', active: 1, hire_date: '2025-01-01', created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: eid });
  };
  await mkEmp('e_dm1', 'u_dm1', 'D1'); await mkEmp('e_dm2', 'u_dm2', 'D2');
  await mkEmp('e_1', 'u_e1', 'D1'); await mkEmp('e_2', 'u_e2', 'D2'); await mkEmp('e_3', null, 'D1');
  await db.insert('project', { id: 'P1', name_ar: 'منظومة رصد الحافلات', sector_id: 'SOL', department_id: 'D1', status: 'IN_PROGRESS',
    owner_user_id: 'u_pm', budget_halalas: 500000, contract_value_halalas: 900000, created_at: T });
});

// ── مدير المشروع: يخطّط بسياج قطاعه ولا يقرأ الفريق ─────────────────────────────────────────
// رحلة e2e كشفت أن صفحة التخطيط كانت تُغلق دونه (بوابتها «قراءة الموظفين») بينما الخدمة تقبل طلبه —
// فصار يرى مصفوفة قطاعه أسماءً وطاقةً (لا مال)، ويبقى سجل الموارد وملف المورد لمن يقرأ الموظفين.
test('مدير المشروع بلا قراءة الموظفين: يفتح مصفوفة قطاعه فقط (لا قطاعاً آخر)، وصفحة التخطيط تفتح له، وسجل الموارد وملف المورد لا', async () => {
  const pm = await sess('u_pm');
  const { canReadResources, canPlanResources } = await import('../../src/modules/team/access.js');
  assert.equal(canReadResources(pm), false); assert.equal(canPlanResources(pm), true);
  const m = await A.planningMatrix(pm, { from: K(11), to: K(11) });
  const ids = m.rows.map((r) => r.resource.id).sort();
  assert.deepEqual(ids, ['e_1', 'e_2', 'e_3', 'e_dm1', 'e_dm2'], 'زملاء قطاعه كلهم — ولا مورد القطاع الآخر');
  assert.ok(!ids.includes('e_c'));
  assert.ok(!JSON.stringify(m).match(/salary|halalas|_sar"/), 'لا مال في المصفوفة');
  const cross = await A.planningMatrix(pm, { from: K(11), to: K(11), sector: 'CONS' });
  assert.ok(!cross.rows.some((r) => r.resource.id === 'e_c'), 'مرشِّح القطاع لا يوسّع السياج');
  const { PAGE_ACCESS } = await import('../../src/core/policy/pages.js');
  assert.equal(!!PAGE_ACCESS['team/planning'](pm), true);
  assert.equal(!!PAGE_ACCESS['team/resources'](pm), false);
  assert.equal(!!PAGE_ACCESS['team'](pm), false);
  const R = await import('../../src/modules/team/resources.js');
  await assert.rejects(async () => R.listResources(pm, {}), /صلاحية/);
  await assert.rejects(async () => R.resourceProfile(pm, 'e_1', {}), /خارج نطاقك/);
  // والموظف بلا أي منح لا يزال خارج المصفوفة (لا يخطّط ولا يقرأ)
  await assert.rejects(async () => A.planningMatrix(await sess('u_e2'), { from: K(11), to: K(11) }), /صلاحية/);
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('من لا يملك «طلب تسكين» يُرفض: الموظف على زميله من إدارةٍ أخرى، والموارد البشرية قراءةً لا طلباً', async () => {
  const change = { kind: 'new', employeeId: 'e_1', target: { kind: 'bucket', id: 'bd' }, from: K(11), pct: 20 };
  await assert.rejects(async () => A.previewChange(await sess('u_e2'), change), /خارج صلاحيتك|خارج نطاقك/);
  await assert.rejects(async () => A.submitRequest(await ctxOf('u_e2'), change, {}), /خارج صلاحيتك|خارج نطاقك/);
  await assert.rejects(async () => A.previewChange(await sess('u_hr'), change), /خارج صلاحيتك/);
  await assert.rejects(async () => A.submitRequest(await ctxOf('u_hr'), change, {}), /خارج صلاحيتك/);
  assert.equal(Number((await db.get('SELECT COUNT(*) c FROM allocation_request')).c), 0, 'لا صفَّ طلبٍ لرفض');
  assert.equal(Number((await db.get('SELECT COUNT(*) c FROM allocation')).c), 0, 'ولا حجز');
});

test('المصفوفة لمن يقرأ الفريق: الموظف يُرفض، والموارد البشرية ترى الأسماء بلا مال', async () => {
  await assert.rejects(async () => A.planningMatrix(await sess('u_e2'), { from: K(11), to: K(11) }), /صلاحية/);
  await A.submitRequest(await ctxOf('u_dm1'), { kind: 'new', employeeId: 'e_3', target: { kind: 'project', id: 'P1' }, from: K(11), pct: 50 }, {});
  const m = await A.planningMatrix(await sess('u_hr'), { from: K(11), to: K(11) });
  assert.ok(m.rows.some((r) => r.resource.id === 'e_3'));
  const cell = m.rows.find((r) => r.resource.id === 'e_3').cells[0];
  assert.equal(cell.items[0].label, 'منظومة رصد الحافلات', 'اسم العمل يصل من يرى المورد');
  const text = JSON.stringify(m);
  for (const k of ['halalas', 'salary', 'budget', 'contract_value', 'margin']) assert.ok(!text.includes(k), `تسرّب حقل مال: ${k}`);
});

test('الزميل في الإدارة نفسها لا «يملك» زميله: لا تطبيق مباشر ولا طلب بلا منح — والمدير الفعلي يطبّق مباشرة', async () => {
  // `ownsEmployee` تعدّ الانتماء إلى الإدارة تملّكاً؛ حقوق التخطيط في هذه الوحدة أضيق: المباشر
  // لمن يدير المورد (منح كتابة + قيادة/نطاق) أو للنفس، والطلب لمن يملك «طلب تسكين».
  const { planningRights } = await import('../../src/modules/team/access.js');
  const peer = await sess('u_e1');                                   // استشاري في D1 — زميل e_3
  const e3 = await db.get('SELECT * FROM employee WHERE id = ?', ['e_3']);
  assert.deepEqual(await planningRights(peer, e3), { direct: false, request: false });
  await assert.rejects(async () => A.previewChange(peer, { kind: 'new', employeeId: 'e_3', target: { kind: 'bucket', id: 'bd' }, from: K(10), pct: 10 }), /خارج صلاحيتك|خارج نطاقك/);
  const self = await db.get('SELECT * FROM employee WHERE id = ?', ['e_1']);
  assert.equal((await planningRights(peer, self)).direct, true, 'ويسكّن نفسه مباشرة كما في مساحة التسكين');
  const dm1 = await sess('u_dm1');                                   // يقود D1 فعلاً
  assert.deepEqual(await planningRights(dm1, e3), { direct: true, request: true });
  const dm2 = await sess('u_dm2');                                   // يقود D2 — لا أمر له على e_3
  assert.equal((await planningRights(dm2, e3)).direct, false);
});

test('الموظف يرى طلباته هو فقط — ولا يفتح طلب غيره بالمعرّف', async () => {
  // كلٌّ يسكّن نفسه على عملٍ داخلي (يملك أمر نفسه) — فيصير لكلٍّ طلبٌ باسمه
  const r1 = (await A.submitRequest(await ctxOf('u_e1'), { kind: 'new', employeeId: 'e_1', target: { kind: 'bucket', id: 'bd' }, from: K(11), pct: 20 }, {})).requests[0];
  assert.equal(r1.status, 'applied');
  const r2 = (await A.submitRequest(await ctxOf('u_e2'), { kind: 'new', employeeId: 'e_2', target: { kind: 'bucket', id: 'pmo' }, from: K(11), pct: 20 }, {})).requests[0];
  assert.equal(r2.status, 'applied');
  // وطلبٌ من غيرهما على e_1 — لا يراه e_1 ولا e_2
  const r3 = (await A.submitRequest(await ctxOf('u_bd'), { kind: 'new', employeeId: 'e_1', target: { kind: 'project', id: 'P1' }, from: K(12), pct: 30 }, {})).requests[0];
  assert.equal(r3.status, 'pending');
  const l1 = await A.listRequests(await sess('u_e1'), {});
  assert.deepEqual(l1.rows.map((x) => x.id), [r1.id], 'الموظف يرى ما رفعه هو فقط');
  const l2 = await A.listRequests(await sess('u_e2'), {});
  assert.deepEqual(l2.rows.map((x) => x.id), [r2.id]);
  await assert.rejects(async () => A.getRequest(await sess('u_e2'), r1.id), /خارج نطاقك/);
  await assert.rejects(async () => A.getRequest(await sess('u_e1'), r3.id), /خارج نطاقك/);
  assert.equal((await A.getRequest(await sess('u_e1'), r1.id)).id, r1.id, 'وطلبه هو يُفتح');
  // ومن لا يقرأ الموارد لا تُفتح له قائمة «بانتظار قراري» على غيره
  assert.equal((await A.listRequests(await sess('u_e2'), { filter: 'pending_my_decision' })).rows.length, 0);
});

test('مدير الإدارة يرى طلبات أهل إدارته لا غيرها — والصف يُفتح بنفس حد القائمة', async () => {
  const dm1 = await sess('u_dm1'); const dm2 = await sess('u_dm2');
  const all1 = await A.listRequests(dm1, {});
  assert.ok(all1.rows.length >= 3, 'مدير الأولى يرى طلبات إدارته (ما رفعه وما رُفع عن أهله)');
  assert.ok(all1.rows.every((x) => x.employee.department_id === 'D1'), 'لا صفَّ من إدارةٍ أخرى');
  const all2 = await A.listRequests(dm2, {});
  assert.ok(all2.rows.every((x) => x.employee.department_id === 'D2'));
  const foreign = all1.rows.find((x) => x.status === 'pending');
  await assert.rejects(async () => A.getRequest(dm2, foreign.id), /خارج نطاقك/);
  assert.equal((await A.getRequest(dm1, foreign.id)).id, foreign.id);
  // والموارد البشرية تقرأ الطلبات شركةً بلا قرار
  const hr = await A.listRequests(await sess('u_hr'), {});
  assert.ok(hr.rows.some((x) => x.id === foreign.id));
  assert.ok(hr.rows.every((x) => x.canDecide === false));
  assert.equal((await A.listRequests(await sess('u_hr'), { filter: 'pending_my_decision' })).rows.length, 0);
});

test('القرار لمن وُجِّه إليه: مدير إدارة أخرى لا يقرّر، وصاحب الطلب لا يعتمد نفسه، والمصفوفة لا توسَّع بفلتر إدارة غريبة', async () => {
  const pending = (await A.listRequests(await sess('u_dm1'), { filter: 'pending_my_decision' })).rows[0];
  assert.ok(pending, 'طلبٌ بانتظار مدير الأولى');
  await assert.rejects(async () => A.decideRequest(await ctxOf('u_dm2'), pending.id, 'approve'), /موجَّه إلى مدير المورد/);
  await assert.rejects(async () => A.decideRequest(await ctxOf('u_bd'), pending.id, 'approve'), /رفعتَه بنفسك/);
  await assert.rejects(async () => A.decideRequest(await ctxOf('u_e1'), pending.id, 'approve'), /موجَّه إلى مدير المورد/);
  assert.equal((await db.get('SELECT status FROM allocation_request WHERE id = ?', [pending.id])).status, 'pending');
  await assert.rejects(async () => A.withdrawRequest(await ctxOf('u_e1'), pending.id), /صاحبُه/);
  const m = await A.planningMatrix(await sess('u_dm1'), { from: K(11), to: K(11), department: 'D2' });
  assert.ok(m.rows.every((r) => r.resource.department_id === 'D1'), 'فلتر إدارةٍ خارج النطاق يُتجاهل مغلقاً');
  assert.equal(m.filters.department, null);
});
