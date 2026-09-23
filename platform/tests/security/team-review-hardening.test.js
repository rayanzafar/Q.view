// مراجعة أمنية لوحدة الفريق والموارد (2026-09-05) — كل اختبار هنا يُثبت ثغرةً أُغلقت:
//   ١) مدير إدارةٍ لا يؤكّد توزيع موظفٍ في قطاعه **بلا إدارة** (منح «إدارة» كان يمرّ من `can()` على هدفٍ
//      بلا مفتاح إدارة) ولا يطلب عليه تسكيناً ولا يعاينه.
//   ٢) الاحتياج المرفق بطلب تسكين ليس حقلاً حراً: احتياج قطاعٍ آخر لا يُعلَّق عليه طلبٌ فتنقلب حالته.
//   ٣) مرشّحو الاحتياج تحت حدّ القارئ (وحدات المساندة تبقى — مورد مشترك).
//   ٤) قراران على الطلب نفسه لا يفوزان معاً — تحديثٌ مشروط بالحالة.
//   ٥) قراءة الإقفال من موقعٍ آخر لا تُنشئ مسودة (Sec-Fetch-Site: cross-site).
//   ٦) تحذير تشابه الاسم لا يعدّد موظفي قطاعٍ آخر.
//   ٧) احتياج بندٍ داخلي لا يُزرع في إدارة قطاعٍ آخر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-hardening-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
let db, A, C, N, R, resolveUser;
const T = new Date().toISOString();
const Y = 2026; const M = 6; const K = (m) => `${Y}-${String(m).padStart(2, '0')}`;
const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const is403 = (e) => e.status === 403;

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  A = await import('../../src/modules/team/allocations.js');
  C = await import('../../src/modules/team/cost-close.js');
  N = await import('../../src/modules/team/needs.js');
  R = await import('../../src/modules/team/resources.js');
  for (const [id2, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id: id2, name_ar: name, kind: 'delivery', active: 1, created_at: T });
  }
  const mkUser = (uid, role, sector, scope) => db.insert('app_user', { id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_dm', 'department_manager', 'SOL', 'department');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_cons_lead', 'sector_lead', 'CONS', 'sector');
  await mkUser('u_ceo', 'ceo_office', null, 'company');
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات الإدارية', manager_user_id: 'u_cons_lead', active: 1, created_at: T });
  const mkEmp = (eid, dept, sector = 'SOL', uid = null, name = null) => db.insert('employee', { id: eid, user_id: uid, name_ar: name || ('مورد ' + eid), sector_id: sector, department_id: dept,
    job_title: 'استشاري', active: 1, hire_date: '2025-01-01', capacity_pct: 100, created_at: T });
  await mkEmp('e_dm', 'D1', 'SOL', 'u_dm'); await db.update('app_user', 'u_dm', { employee_id: 'e_dm' });
  await mkEmp('e_a', 'D1');
  await mkEmp('e_nodept', null);                                   // موظف قطاع بلا إدارة
  await mkEmp('e_cons', 'D_CONS', 'CONS', null, 'محمد أحمد العلي');
  await db.insert('project', { id: 'P_SOL', name_ar: 'منظومة رصد الحافلات', sector_id: 'SOL', department_id: 'D1', status: 'IN_PROGRESS', start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  await db.insert('project', { id: 'P_CONS', name_ar: 'دراسة تنظيمية', sector_id: 'CONS', department_id: 'D_CONS', status: 'IN_PROGRESS', start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  // تسكين مؤكد لمن بلا إدارة كي تكون له أسطر إقفال
  await A.submitRequest(await ctxOf('u_lead'), { kind: 'new', employeeId: 'e_nodept', target: { kind: 'project', id: 'P_SOL' }, from: K(M), to: K(M), pct: 50 }, {});
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('١) مدير الإدارة لا يؤكّد ولا يصحّح توزيع موظفٍ في قطاعه بلا إدارة — ولا يعاينه ولا يطلب عليه', async () => {
  const dm = await ctxOf('u_dm');
  const ov = await C.periodOverview((await ctxOf('u_lead')).user, { sector: 'SOL', year: Y, month: M });
  const pid = ov.period.id;
  await assert.rejects(async () => C.resourceShares(dm.user, pid, 'e_nodept'), is403, 'القراءة مرفوضة');
  await assert.rejects(async () => C.confirmShares(dm, pid, 'e_nodept', { lines: [{ target_kind: 'sector', shareBp: 10000 }] }), is403, 'والكتابة مرفوضة مثلها');
  assert.equal(await db.get("SELECT id FROM cost_share WHERE period_id = ? AND employee_id = 'e_nodept' AND review_status = 'confirmed'", [pid]), undefined, 'لا سطر مؤكد كُتب');
  await assert.rejects(async () => A.previewChange(dm.user, { kind: 'new', employeeId: 'e_nodept', target: { kind: 'project', id: 'P_SOL' }, from: K(M), pct: 10 }), /خارج/);
  await assert.rejects(async () => A.submitRequest(dm, { kind: 'new', employeeId: 'e_nodept', target: { kind: 'project', id: 'P_SOL' }, from: K(M), pct: 10 }, {}), /خارج/);
  // وأهل إدارته كما كانوا
  const mine = await C.resourceShares(dm.user, pid, 'e_a').catch((e) => e);
  assert.ok(!(mine instanceof Error) || mine.status !== 403, 'موظف إدارته يُفتح له');
});

test('٢) الاحتياج المرفق بطلب التسكين يُقرأ بصلاحية الطالب ويُطابَق مع الوجهة', async () => {
  const consNeed = await N.createNeed(await ctxOf('u_cons_lead'), { source_kind: 'project', source_id: 'P_CONS', role_ar: 'محلل', headcount: 1, fte_pct: 50, from_date: `${K(M)}-01`, to_date: `${K(M)}-30`, certainty: 'confirmed' });
  const lead = await ctxOf('u_lead');
  await assert.rejects(async () => A.submitRequest(lead, { kind: 'new', employeeId: 'e_a', target: { kind: 'project', id: 'P_SOL' }, from: K(M), pct: 20 }, { needId: consNeed.id }), is403, 'احتياج قطاع آخر لا يُرفق');
  const row = await db.get('SELECT status FROM resource_need WHERE id = ?', [consNeed.id]);
  assert.equal(row.status, 'open', 'حالة الاحتياج الأجنبي لم تُمسّ');
  const solNeed = await N.createNeed(lead, { source_kind: 'project', source_id: 'P_SOL', role_ar: 'مهندس', headcount: 1, fte_pct: 50, from_date: `${K(M)}-01`, to_date: `${K(M)}-30`, certainty: 'confirmed' });
  await assert.rejects(async () => A.submitRequest(lead, { kind: 'new', employeeId: 'e_a', target: { kind: 'bucket', id: 'bd' }, from: K(M), pct: 20 }, { needId: solNeed.id }), /لا تطابق مصدر الاحتياج/, 'والوجهة يجب أن تطابق مصدر الاحتياج');
});

test('٣) مرشّحو الاحتياج تحت حدّ القارئ: مدير الإدارة لا يرى موظف القطاع الذي لا يقرؤه', async () => {
  const dm = await ctxOf('u_dm');
  const need = await N.createNeed(dm, { source_kind: 'project', source_id: 'P_SOL', role_ar: 'محلل', headcount: 1, fte_pct: 50, from_date: `${K(M)}-01`, to_date: `${K(M)}-30`, certainty: 'confirmed' });
  const c = await N.candidates(dm.user, need.id, {});
  const ids = c.rows.map((r) => r.employeeId);
  assert.ok(ids.includes('e_a'), 'أهل إدارته مرشحون');
  assert.ok(!ids.includes('e_nodept') && !ids.includes('e_cons'), 'ومن لا يقرؤه لا يظهر بتوفره: ' + ids.join(','));
});

test('٤) قراران متزامنان على الطلب نفسه: الثاني يُقرّ بالتعارض ولا يكتب فوق الأول', async () => {
  const { finishRequest } = await import('../../src/modules/team/allocation-settle.js');
  const lead = await ctxOf('u_lead');
  const r = (await A.submitRequest(await ctxOf('u_cons_lead'), { kind: 'new', employeeId: 'e_cons', target: { kind: 'bucket', id: 'bd' }, from: K(M), pct: 10 }, {})).requests[0];
  const req = await db.get('SELECT * FROM allocation_request WHERE id = ?', [r.id]);
  // الصف انتقل فعلاً — من قرأه «معلّقاً/مطبَّقاً» قبل ذلك لا يكتب عليه
  await db.update('allocation_request', req.id, { status: 'withdrawn' });
  await assert.rejects(async () => finishRequest(lead, req, { status: 'rejected', reason: 'سبب' }), (e) => e.status === 409);
  assert.equal((await db.get('SELECT status FROM allocation_request WHERE id = ?', [req.id])).status, 'withdrawn');
});

test('٥) قراءة الإقفال من موقعٍ آخر لا تُنشئ مسودة ولا تحذف أسطراً', async () => {
  const before_ = Number((await db.get('SELECT COUNT(*) c FROM cost_period')).c);
  const v = await C.periodOverview((await ctxOf('u_cons_lead')).user, { sector: 'CONS', year: Y, month: M, mutate: false });
  assert.equal(v.period, null, 'لا فترة أُنشئت');
  assert.match(v.note_ar || '', /لم تُنشأ مسودة/);
  assert.equal(Number((await db.get('SELECT COUNT(*) c FROM cost_period')).c), before_);
});

test('٦) تحذير تشابه الاسم لا يسمّي موظفي قطاعٍ آخر', async () => {
  const lead = await ctxOf('u_lead');
  const out = await R.createResource(lead, { name_ar: 'محمد أحمد', job_title: 'مستشار', sector_id: 'SOL', department_id: 'D1', resource_type: 'internal', capacity_pct: 100, hire_date: '2026-01-01' });
  const warnings = out.warnings || [];
  assert.ok(!warnings.some((w) => w.includes('العلي')), 'اسم قطاع الاستشارات لا يظهر: ' + JSON.stringify(warnings));
});

test('٧) احتياج بندٍ داخلي لا يُزرع في إدارة قطاعٍ آخر', async () => {
  const lead = await ctxOf('u_lead');
  await assert.rejects(async () => N.createNeed(lead, { source_kind: 'bucket', source_id: 'bd', department_id: 'D_CONS', role_ar: 'محلل', headcount: 1, fte_pct: 50, from_date: `${K(M)}-01`, to_date: `${K(M)}-30`, certainty: 'confirmed' }), /ليست في هذا القطاع/);
});
