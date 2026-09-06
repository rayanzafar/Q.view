// ── سجل الموارد وملف المورد (B1) — حالات القبول T16/T17 وشاشات S02/S03/S05/S07/S08/S09/S10/S11 ──
//
// «المورد منفصل عن حساب الدخول: موظفٌ بلا حساب يُخطَّط عليه (T16)، وتعطيل الحساب لا ينهي العقد،
//  وإنهاء العقد لا يمحو السجلات السابقة (T17)» — الموجّه. وكل رقمٍ هنا من نموذج الطاقة الواحد،
// وكل قراءةٍ بلا مال، وكل كتابةٍ بأثرٍ يقول قبل/بعد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-res-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, R, routes, resolveUser, riyadhDate;
const T = new Date().toISOString();
const dayShift = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let TODAY, YEAR, MONTH, NOW_KEY, NEXT_KEY;
const addMonths = (key, n) => { const y = Number(key.slice(0, 4)); const m = Number(key.slice(5, 7)); const i = y * 12 + (m - 1) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const allYear = (f) => JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), f])));

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

// مفاتيح المال التي يجب ألا تظهر في أي قراءة موارد — تُفحص بالمفتاح على العمق كله.
const MONEY_KEY = /halalas|_sar$|salary|margin|budget|contract_value|invoice|revenue/i;
function moneyKeys(v, path = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => moneyKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (MONEY_KEY.test(k)) out.push(`${path}.${k}`); moneyKeys(x, `${path}.${k}`, out); }
  return out;
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  ({ riyadhDate } = await import('../../src/core/i18n/time.js'));
  R = await import('../../src/modules/team/resources.js');
  routes = await import('../../src/modules/team/team-resources.routes.js');
  TODAY = riyadhDate(); YEAR = Number(TODAY.slice(0, 4)); MONTH = Number(TODAY.slice(5, 7));
  NOW_KEY = TODAY.slice(0, 7); NEXT_KEY = addMonths(NOW_KEY, 1);

  for (const [sid, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id: sid, name_ar: name, kind: 'delivery', active: 1, target_sales_halalas: 99, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة النقل', created_at: T });
  const mkUser = (uid, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_hr', 'hr', null, 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_dm', 'department_manager');
  await mkUser('u_emp', 'consultant');
  await mkUser('u_leave', 'employee');
  await mkUser('u_out', 'employee', 'CONS');
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  const mkEmp = async (eid, { uid = null, dept = 'D_A', sector = 'SOL', job, hire, name, capacity = null, employment = 'أساسي' }) => {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: name, sector_id: sector, department_id: dept, job_title: job,
      hire_date: hire, capacity_pct: capacity, employment_type: employment, salary_halalas: 1234500, active: 1, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: eid });
  };
  await mkEmp('e_dm', { uid: 'u_dm', job: 'مدير إدارة', hire: '2024-01-01', name: 'سلطان المدير' });
  await mkEmp('e_emp', { uid: 'u_emp', job: 'مستشار أول', hire: '2024-06-01', name: 'هادي الشهري' });
  await mkEmp('e_half', { job: 'مستشار نصف دوام', hire: '2025-01-01', name: 'خالد المتعاقد', capacity: 50, employment: 'متعاقد' });
  await mkEmp('e_noacct', { job: 'محلل أعمال', hire: '2025-03-01', name: 'نورة بلا حساب' });
  await mkEmp('e_skill', { dept: 'D_B', job: 'مهندس بيانات', hire: '2025-01-01', name: 'ريان البيانات' });
  await mkEmp('e_leave', { uid: 'u_leave', job: 'منسق', hire: '2025-01-01', name: 'فهد المغادر' });
  await mkEmp('e_out', { uid: 'u_out', dept: 'D_CONS', sector: 'CONS', job: 'استشاري', hire: '2025-01-01', name: 'عمر الاستشاري' });
  await db.insert('resource_capability', { id: 'cap_sql', employee_id: 'e_skill', kind: 'skill', name_ar: 'SQL', level: 'expert', source: 'self', created_at: T });

  await db.insert('project', { id: 'P1', name_ar: 'مشروع منصة النقل الذكي', sector_id: 'SOL', department_id: 'D_A', client_id: 'CL', kind: 'external',
    status: 'IN_PROGRESS', contract_value_halalas: 5000000, budget_halalas: 1000000, margin_pct: 30, revenue_halalas: 2000000, created_at: T });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع تحليلات البيانات', sector_id: 'SOL', department_id: 'D_B', client_id: 'CL', kind: 'external',
    status: 'IN_PROGRESS', contract_value_halalas: 3000000, created_at: T });
  const mkAlloc = (aid, eid, { project = null, bucket = null, pct, status = null }) => db.insert('allocation', {
    id: aid, employee_id: eid, project_id: project, work_bucket: bucket, project_name: bucket ? 'تطوير أعمال' : null,
    sector_id: 'SOL', type: 'member', monthly_json: allYear(pct), year: YEAR, status, created_at: T });
  await mkAlloc('a1', 'e_emp', { project: 'P1', pct: 0.6 });
  await mkAlloc('a2', 'e_emp', { project: 'P2', pct: 0.2, status: 'tentative' });
  await mkAlloc('a3', 'e_half', { project: 'P1', pct: 1 });
  await mkAlloc('a4', 'e_noacct', { bucket: 'bd', pct: 0.4 });
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الرصد البيئي', sector_id: 'SOL', department_id: 'D_A', stage_id: 'LEAD', client_id: 'CL',
    value_halalas: 7000000, owner_user_id: 'u_dm', year: YEAR, stage_changed_at: T, created_at: T });
  await db.insert('membership', { id: 'm1', employee_id: 'e_emp', group_kind: 'opportunity', group_id: 'O1', role_in_group: 'member', allocation_pct: 10, created_at: T });
  await db.insert('milestone', { id: 'ms1', project_id: 'P1', name_ar: 'تسليم المرحلة الأولى', due_date: dayShift(20), status: 'PENDING', created_at: T });
  const mkTask = (tid, title, { util, due, kind = 'project', project = 'P1' }) => db.insert('task', {
    id: tid, title, assignee_user_id: 'u_emp', project_id: project, sector_id: 'SOL', work_kind: kind, status: 'IN_PROGRESS', priority: 'P1',
    due_date: due, utilization_pct: util, created_by: 'u_dm', created_at: T });
  await mkTask('t1', 'إعداد خطة البيانات', { util: 30, due: dayShift(10) });
  await mkTask('t2', 'مراجعة المتطلبات', { util: null, due: dayShift(40), kind: 'internal', project: null });
  await mkTask('t3', 'موعد شخصي', { util: 50, due: dayShift(5), kind: 'personal', project: null });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── الموجّه ──────────────────────────────────────────────────────────────────────────────────
test('الموجّه يصدّر المسارات القياسية حرفاً (UI-CONTRACTS §4) ولا يُركَّب بنفسه', () => {
  const paths = routes.teamResourcesRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  for (const p of ['GET /team/resources', 'POST /team/resources', 'GET /team/resources/:id/preview', 'GET /team/resources/:id/profile',
    'GET /team/resources/:id/linked-work', 'GET /team/resources/:id/capabilities', 'POST /team/resources/:id/capabilities',
    'DELETE /team/resources/:id/capabilities/:capId', 'GET /team/resources/:id/engagement', 'POST /team/resources/:id/capacity',
    'PATCH /team/resources/:id', 'GET /team/resources/:id/audit', 'GET /team/org']) {
    assert.ok(paths.includes(p), `المسار ${p} غائب — الموجود: ${paths.join(' · ')}`);
  }
});

// ── S02 ───────────────────────────────────────────────────────────────────────────────────────
test('S02: الترقيم من العدّ الفعلي — ستة موارد في القطاع ⇒ «1–6 من 6» لا «1–1 من 6» (C5)', async () => {
  const admin = await sess('u_admin');
  const r = await R.listResources(admin, { sector: 'SOL' });
  assert.equal(r.total, 6); assert.equal(r.rows.length, 6); assert.equal(r.page, 1); assert.equal(r.pageSize, 25);
  const from = (r.page - 1) * r.pageSize + 1; const to = Math.min(r.page * r.pageSize, r.total);
  assert.equal(`${from}–${to} من ${r.total}`, '1–6 من 6');
  assert.ok(r.basis_ar.includes('الطاقة التعاقدية'), 'أساس المتاح مذكور');
  const p2 = await R.listResources(admin, { sector: 'SOL', page: 2, pageSize: 4 });
  assert.equal(p2.total, 6, 'العدّاد بنفس الشرط مهما كانت الصفحة');
  assert.equal(p2.rows.length, 2, 'الصفحة الثانية تحمل الباقي');
  assert.equal(moneyKeys(r).length, 0, `مال في السجل: ${moneyKeys(r).join(', ')}`);
});

test('S02: البحث بالمهارة يجد صاحبها وحده — ولا يجده غيره بالاسم', async () => {
  const admin = await sess('u_admin');
  const bySkill = await R.listResources(admin, { q: 'sql' });
  assert.deepEqual(bySkill.rows.map((x) => x.id), ['e_skill']);
  assert.equal(bySkill.total, 1, 'العدّاد يتبع البحث نفسه');
  const byJob = await R.listResources(admin, { q: 'مستشار', sector: 'SOL' });
  assert.deepEqual(byJob.rows.map((x) => x.id).sort(), ['e_emp', 'e_half'], 'المسمّى يُبحث فيه أيضاً');
  const none = await R.listResources(admin, { q: 'لا أحد بهذا الاسم' });
  assert.equal(none.total, 0); assert.deepEqual(none.rows, []);
});

test('S02: الفلاتر خادمية — النوع المشتق من نوع التوظيف، والحالة مرفوضة إن لم تُعرف', async () => {
  const admin = await sess('u_admin');
  const ext = await R.listResources(admin, { type: 'external', sector: 'SOL' });
  assert.deepEqual(ext.rows.map((x) => x.id), ['e_half'], 'المتعاقد يُقرأ خارجياً بلا عمودٍ مكتوب');
  assert.equal(ext.rows[0].resourceType_ar, 'خارجي');
  const internal = await R.listResources(admin, { type: 'internal', sector: 'SOL' });
  assert.equal(internal.total, 5);
  await assert.rejects(() => R.listResources(admin, { status: 'whatever' }), /حالة الارتباط غير معروفة/);
  await assert.rejects(() => R.listResources(admin, { from: '2026-13' }), /بصيغة سنة-شهر/);
});

// ── T16 ───────────────────────────────────────────────────────────────────────────────────────
test('T16: مورد بلا حساب دخول يظهر في السجل ويُخطَّط عليه — والمهام «غير مقاسة» لا صفراً مضلِّلاً', async () => {
  const admin = await sess('u_admin');
  const row = (await R.listResources(admin, { sector: 'SOL' })).rows.find((x) => x.id === 'e_noacct');
  assert.ok(row, 'المورد بلا حساب غائب عن السجل');
  assert.equal(row.userId, null);
  assert.equal(row.utilizationPct, 40); assert.equal(row.availablePct, 60); assert.equal(row.band, 'low');
  const prof = await R.resourceProfile(admin, 'e_noacct', {});
  assert.equal(prof.figures.confirmedPct, 40);
  assert.equal(prof.distribution[0].kind, 'bucket'); assert.equal(prof.distribution[0].label, 'تطوير أعمال');
  assert.equal(prof.rights.planning.direct, true, 'مدير النظام يخطّط عليه مباشرةً');
  assert.equal(prof.tabs.tasks.enabled, false); assert.ok(prof.tabs.tasks.note_ar.includes('لا حساب دخول'));
  const pv = await R.resourcePreview(admin, 'e_noacct', {});
  assert.equal(pv.taskLoad.level, 'unmeasured'); assert.equal(pv.taskLoad.linked, false);
  assert.equal(pv.userId, null); assert.equal(pv.canOpenDossier, false);
  assert.equal(pv.planning.direct, true);
});

// ── S08 ───────────────────────────────────────────────────────────────────────────────────────
test('S08: مستشار 0.5 FTE مسكَّن بكامله = 100% من طاقته والمتاح صفر — و0.5 بوحدات الدوام الكامل', async () => {
  const admin = await sess('u_admin');
  const prof = await R.resourceProfile(admin, 'e_half', { year: YEAR, month: MONTH });
  assert.equal(prof.resource.capacityPct, 50);
  assert.equal(prof.figures.confirmedPct, 100); assert.equal(prof.figures.availablePct, 0);
  assert.equal(prof.figures.capacity.units, 50); assert.equal(prof.figures.units.confirmed, 50); assert.equal(prof.figures.nominalFte, 0.5);
  const row = (await R.listResources(admin, { q: 'خالد' })).rows[0];
  assert.equal(row.capacityPct, 50); assert.equal(row.availablePct, 0); assert.equal(row.utilizationPct, 100); assert.equal(row.band, 'ok');
});

test('S08: إصدار طاقة بتاريخ مستقبلي لا يغيّر الحاضر — ويظهر أثره على الشهر القادم', async () => {
  const ctx = await ctxOf('u_admin');
  const r = await R.setCapacity(ctx, 'e_half', { capacity_pct: 25, effective_from: `${NEXT_KEY}-01`, note: 'تخفيض متفق عليه' });
  assert.equal(r.applied, false); assert.equal(r.capacityPct, 50, 'القيمة السارية اليوم كما هي');
  assert.ok(r.applied_ar.includes('الحاضر كما هو'));
  assert.equal((await db.get('SELECT capacity_pct FROM employee WHERE id = ?', ['e_half'])).capacity_pct, 50);
  const now = await R.resourceProfile(ctx.user, 'e_half', { year: YEAR, month: MONTH });
  assert.equal(now.figures.capacity.units, 50, 'الشهر الجاري بطاقته القديمة');
  const next = await R.resourceProfile(ctx.user, 'e_half', { year: Number(NEXT_KEY.slice(0, 4)), month: Number(NEXT_KEY.slice(5, 7)) });
  assert.equal(next.figures.capacity.units, 25, 'الشهر القادم بالطاقة الجديدة');
  assert.equal(next.figures.capacity.nominalPct, 25);
  const eff = r.effect.months.find((m) => m.key === NEXT_KEY);
  assert.equal(eff.before.capacityUnits, 50); assert.equal(eff.after.capacityUnits, 25, 'الأثر قبل/بعد على الشهر القادم');
  const eng = await R.engagement(ctx.user, 'e_half');
  assert.equal(eng.capacity.currentPct, 50);
  assert.equal(eng.capacity.versions.length, 2, 'إصدار القاعدة + الإصدار الجديد');
  assert.equal(eng.capacity.versions[0].effective_from, '2025-01-01', 'القاعدة من تاريخ التعيين');
  assert.deepEqual(eng.capacity.changes.map((c) => c.pct), [50, 25]);
  assert.equal(eng.capacity.changes[0].current, true); assert.equal(eng.capacity.changes[1].current, false);
});

test('S08: يرفض تاريخاً ناقصاً ونسبةً خارج الحدود — ولا يكتب شيئاً', async () => {
  const ctx = await ctxOf('u_admin');
  const n0 = (await db.get('SELECT COUNT(*) n FROM capacity_version')).n;
  await assert.rejects(() => R.setCapacity(ctx, 'e_half', { capacity_pct: 40 }), /تاريخ سريان الطاقة مطلوب/);
  await assert.rejects(() => R.setCapacity(ctx, 'e_half', { capacity_pct: 140, effective_from: TODAY }), /بين 1 و100/);
  await assert.rejects(() => R.setCapacity(ctx, 'e_half', { capacity_pct: 40, effective_from: '2024-01-01' }), /أسبق من تاريخ التعيين/);
  assert.equal((await db.get('SELECT COUNT(*) n FROM capacity_version')).n, n0);
});

test('S08: إصدارٌ يسري اليوم يحدّث القيمة السارية ويبقي الإصدار المستقبلي بعده', async () => {
  const ctx = await ctxOf('u_admin');
  const r = await R.setCapacity(ctx, 'e_half', { capacity_pct: 40, effective_from: TODAY, note: 'من اليوم' });
  assert.equal(r.applied, true); assert.equal(r.capacityPct, 40);
  assert.equal((await db.get('SELECT capacity_pct FROM employee WHERE id = ?', ['e_half'])).capacity_pct, 40);
  const next = await R.resourceProfile(ctx.user, 'e_half', { year: Number(NEXT_KEY.slice(0, 4)), month: Number(NEXT_KEY.slice(5, 7)) });
  assert.equal(next.figures.capacity.units, 25, 'الإصدار المستقبلي ما زال يحكم الشهر القادم');
});

// ── S10 ───────────────────────────────────────────────────────────────────────────────────────
test('S10: سجل التغييرات يعرض قبل/بعد والفاعل والسبب لكل إصدار طاقة', async () => {
  const admin = await sess('u_admin');
  const a = await R.resourceAudit(admin, 'e_half', { filter: 'capacity' });
  assert.ok(a.rows.length >= 2, 'سطران على الأقل');
  const latest = a.rows[0];
  assert.equal(latest.kind, 'capacity'); assert.equal(latest.ref.kind, 'capacity_version');
  assert.equal(latest.before.capacity_pct, 50); assert.equal(latest.after.capacity_pct, 40);
  assert.equal(latest.after.effective_from, TODAY);
  assert.equal(latest.reason, 'من اليوم');
  assert.equal(latest.actor.name, 'حساب u_admin');
  assert.ok(latest.action_ar.includes('الطاقة'), latest.action_ar);
  const all = await R.resourceAudit(admin, 'e_half', { filter: 'all' });
  assert.ok(all.rows.some((r) => r.kind === 'capacity'));
  await assert.rejects(() => R.resourceAudit(admin, 'e_half', { filter: 'money' }), /مرشّح السجل/);
  const raw = await db.all("SELECT * FROM audit_log WHERE resource = 'capacity_version' ORDER BY at");
  assert.ok(raw.length >= 2 && raw.every((r) => r.user_id === 'u_admin'), 'كل كتابةٍ بأثرٍ وفاعل');
});

// ── T17 ───────────────────────────────────────────────────────────────────────────────────────
test('T17: تعطيل الحساب لا يمسّ الارتباط، وأرشفة بتاريخ مغادرة تحفظ التاريخ وتُبقي الأشهر السابقة', async () => {
  const ctx = await ctxOf('u_admin');
  await db.update('app_user', 'u_leave', { active: 0 });
  const e1 = await R.engagement(ctx.user, 'e_leave');
  assert.equal(e1.account.linked, true); assert.equal(e1.account.active, false);
  assert.equal(e1.status, 'active', 'تعطيل الحساب لا ينهي العقد');
  assert.equal((await db.get('SELECT active FROM employee WHERE id = ?', ['e_leave'])).active, 1);

  const END = dayShift(-30);
  const u = await R.updateResource(ctx, 'e_leave', { end_date: END });
  assert.equal(u.resource.end_date, END); assert.equal(u.resource.active, false);
  assert.equal(u.resource.engagement.status, 'ended'); assert.equal(u.resource.engagement.status_ar, 'منتهي الارتباط');
  const ended = await R.listResources(ctx.user, { status: 'ended', sector: 'SOL' });
  assert.deepEqual(ended.rows.map((x) => x.id), ['e_leave']);
  const active = await R.listResources(ctx.user, { status: 'active', sector: 'SOL' });
  assert.ok(!active.rows.some((x) => x.id === 'e_leave'), 'المنتهي لا يُعرض على رأس العمل');
  assert.equal(ended.rows[0].availablePct, null); assert.equal(ended.rows[0].availability_ar, 'خارج فترة الارتباط');
  const past = await R.resourceProfile(ctx.user, 'e_leave', { year: 2025, month: 3 });
  assert.equal(past.figures.state, 'full', 'الأشهر قبل المغادرة طاقتها قائمة');
  const later = addMonths(END.slice(0, 7), 2);
  const afterEnd = await R.resourceProfile(ctx.user, 'e_leave', { year: Number(later.slice(0, 4)), month: Number(later.slice(5, 7)) });
  assert.equal(afterEnd.figures.state, 'out');
  const audit = await R.resourceAudit(ctx.user, 'e_leave', { filter: 'profile' });
  const mine = audit.rows.find((r) => r.before && 'end_date' in r.before);
  assert.ok(mine, 'سطر قبل/بعد لتاريخ المغادرة');
  assert.equal(mine.before.end_date, null); assert.equal(mine.after.end_date, END); assert.equal(mine.after.active, 0);
});

// ── S07 ───────────────────────────────────────────────────────────────────────────────────────
test('S07: التقييم الذاتي بلا مراجعة، ومراجعة المدير تُكتب باسمه، وتعديل صاحبه يُسقطها', async () => {
  const self = await ctxOf('u_emp');
  const s1 = await R.upsertCapability(self, 'e_emp', { kind: 'skill', name_ar: 'تحليل البيانات', level: 'advanced' });
  assert.equal(s1.source, 'self'); assert.equal(s1.reviewed, false); assert.equal(s1.level_ar, 'متقدم');
  const mgr = await ctxOf('u_dm');
  const s2 = await R.upsertCapability(mgr, 'e_emp', { id: s1.id, kind: 'skill', name_ar: 'تحليل البيانات', level: 'expert', evidence_kind: 'project', evidence_ref: 'P1' });
  assert.equal(s2.id, s1.id); assert.equal(s2.reviewed, true); assert.equal(s2.reviewed_by, 'u_dm'); assert.equal(s2.source_ar, 'مراجَع');
  assert.equal(s2.evidence.label, 'مشروع منصة النقل الذكي', 'الشاهد يُقرأ من سجله الأصلي');
  const s3 = await R.upsertCapability(self, 'e_emp', { id: s1.id, kind: 'skill', name_ar: 'تحليل البيانات المتقدم', level: 'expert' });
  assert.equal(s3.reviewed, false, 'المحتوى تغيّر فسقطت المراجعة');
  await R.upsertCapability(self, 'e_emp', { kind: 'goal', name_ar: 'شهادة إدارة المشاريع', target_date: dayShift(120) });
  await R.upsertCapability(mgr, 'e_emp', { kind: 'experience', name_ar: 'مشروع النقل البحري', period_from: '2023-01-01', period_to: '2023-12-31', evidence_kind: 'note', evidence_label: 'مرجع العميل' });
  await assert.rejects(() => R.upsertCapability(self, 'e_emp', { kind: 'skill', name_ar: 'x', level: 'guru' }), /مستوى المهارة/);
  await assert.rejects(() => R.upsertCapability(self, 'e_emp', { kind: 'experience', name_ar: 'x', period_from: '2024-05-01', period_to: '2024-01-01' }), /أسبق من بدايتها/);
  const caps = await R.resourceCapabilities(await sess('u_admin'), 'e_emp');
  assert.equal(caps.skills.length, 1); assert.equal(caps.goals.length, 1); assert.equal(caps.experiences.length, 1);
  assert.equal(caps.goals[0].status_ar, 'مخطَّط');
  const found = await R.listResources(await sess('u_admin'), { q: 'تحليل البيانات' });
  assert.ok(found.rows.some((x) => x.id === 'e_emp'), 'المهارة الجديدة تُبحث فوراً');
  await R.removeCapability(self, 'e_emp', s1.id);
  assert.equal((await R.resourceCapabilities(await sess('u_admin'), 'e_emp')).skills.length, 0);
  const rows = await db.all("SELECT action, user_id FROM audit_log WHERE resource = 'resource_capability' ORDER BY at");
  assert.ok(rows.length >= 5 && rows.some((r) => r.action === 'delete') && rows.every((r) => r.user_id), 'كل كتابةٍ بأثر وفاعل');
});

// ── S05 / S03 ─────────────────────────────────────────────────────────────────────────────────
test('S05: العمل المرتبط — كل عملٍ مرةً واحدة (مشروع/بند/فرصة) مع دوره وفترته وحالته، بلا مال', async () => {
  const admin = await sess('u_admin');
  const w = await R.linkedWork(admin, 'e_emp', { window: 'current' });
  assert.deepEqual(w.rows.map((r) => r.key).sort(), ['opportunity:O1', 'project:P1', 'project:P2']);
  const p1 = w.rows.find((r) => r.key === 'project:P1');
  assert.equal(p1.allocation.status, 'confirmed'); assert.equal(p1.allocation.billable, true); assert.equal(p1.currentPct, 60);
  assert.equal(p1.period.from, `${YEAR}-01`); assert.equal(p1.period.to, `${YEAR}-12`); assert.equal(p1.work.status_ar, 'قيد التنفيذ');
  const p2 = w.rows.find((r) => r.key === 'project:P2');
  assert.equal(p2.allocation.status_ar, 'مبدئي');
  const o1 = w.rows.find((r) => r.key === 'opportunity:O1');
  assert.equal(o1.membership.pct, 10); assert.equal(o1.allocation, null); assert.equal(o1.work.open, true);
  assert.equal(moneyKeys(w).length, 0, `مال في العمل المرتبط: ${moneyKeys(w).join(', ')}`);
  assert.equal((await R.linkedWork(admin, 'e_emp', { window: 'past' })).rows.length, 0);
  await assert.rejects(() => R.linkedWork(admin, 'e_emp', { window: 'future' }), /نافذة العمل/);
});

test('S03: المعاينة — الأرقام من النموذج، والقادم يضمّ المهام والمعالم بلا الشخصية، والفرصة بنسبتها', async () => {
  const admin = await sess('u_admin');
  const pv = await R.resourcePreview(admin, 'e_emp', {});
  assert.equal(pv.figures.confirmedPct, 60); assert.equal(pv.figures.availablePct, 40); assert.equal(pv.figures.tentativePct, 20);
  assert.equal(pv.taskLoad.pct, 30); assert.equal(pv.taskLoad.unsized, 1); assert.equal(pv.taskLoad.open, 2); assert.equal(pv.taskLoad.level, 'low');
  assert.ok(pv.upcoming.length <= 5);
  assert.ok(pv.upcoming.some((u) => u.kind === 'task' && u.title === 'إعداد خطة البيانات'));
  assert.ok(pv.upcoming.some((u) => u.kind === 'milestone' && u.title === 'تسليم المرحلة الأولى'));
  assert.ok(!pv.upcoming.some((u) => u.title === 'موعد شخصي'), 'المهمة الشخصية لا تخرج من حساب صاحبها');
  assert.ok(pv.working.some((x) => x.kind === 'opportunity' && x.pct === 10 && x.label === 'فرصة الرصد البيئي'));
  assert.equal(pv.canOpenDossier, true); assert.equal(pv.userId, 'u_emp');
  assert.equal(moneyKeys(pv).length, 0);
  const prof = await R.resourceProfile(admin, 'e_emp', { tab: 'tasks' });
  assert.equal(prof.tasks.available, true);
  assert.deepEqual(prof.tasks.tasks.map((t) => t.title).sort(), ['إعداد خطة البيانات', 'مراجعة المتطلبات'], 'مهامه من ملف الشخص القائم');
  assert.equal(moneyKeys(prof).length, 0);
});

// ── S11 ───────────────────────────────────────────────────────────────────────────────────────
test('S11: الهيكل الإداري — شجرة بلا مستهدفات مالية، وموارد الإدارة، والمسكَّنون على مشاريع إدارات أخرى', async () => {
  const admin = await sess('u_admin');
  const o = await R.orgResources(admin, { department: 'D_A' });
  assert.equal(o.tree.length, 2);
  assert.equal(moneyKeys(o).length, 0, `مال في الهيكل: ${moneyKeys(o).join(', ')}`);
  assert.ok(!('target_sales_halalas' in o.tree[0]));
  const dA = o.tree.find((s) => s.id === 'SOL').departments.find((d) => d.id === 'D_A');
  assert.equal(dA.manager_name, 'حساب u_dm'); assert.equal(dA.employees, 5);
  assert.equal(o.department.name_ar, 'إدارة الابتكار');
  assert.deepEqual(o.resources.map((r) => r.id).sort(), ['e_dm', 'e_emp', 'e_half', 'e_leave', 'e_noacct']);
  assert.equal(o.shared.length, 1);
  assert.equal(o.shared[0].employeeId, 'e_emp'); assert.equal(o.shared[0].project.label, 'مشروع تحليلات البيانات');
  assert.equal(o.shared[0].project.department_name, 'إدارة البيانات'); assert.equal(o.shared[0].status_ar, 'مبدئي');
  const filtered = await R.orgResources(admin, { department: 'D_A', q: 'خالد' });
  assert.deepEqual(filtered.resources.map((r) => r.id), ['e_half']);
  await assert.rejects(() => R.orgResources(admin, { department: 'D_NONE' }), /الإدارة غير موجودة/);
});

// ── S09 ───────────────────────────────────────────────────────────────────────────────────────
test('S09: التعديل عبر النموذج يكتب قبل/بعد في السجل ويحترم قاعدة الجهة للشريك', async () => {
  const ctx = await ctxOf('u_admin');
  const u = await R.updateResource(ctx, 'e_noacct', { job_title: 'محلل أعمال أول', resource_type: 'external', vendor_name: 'مكتب استشاري' });
  assert.equal(u.resource.resourceType, 'external'); assert.equal(u.resource.vendor_name, 'مكتب استشاري'); assert.equal(u.resource.job_title, 'محلل أعمال أول');
  const a = await R.resourceAudit(ctx.user, 'e_noacct', { filter: 'profile' });
  const row = a.rows.find((r) => r.before && 'job_title' in r.before);
  assert.ok(row, 'سطر قبل/بعد للتعديل');
  assert.equal(row.before.job_title, 'محلل أعمال'); assert.equal(row.after.job_title, 'محلل أعمال أول'); assert.equal(row.after.resource_type, 'external');
  assert.ok(!('salary_halalas' in row.after) && !('salary_halalas' in row.before));
  await assert.rejects(() => R.updateResource(ctx, 'e_noacct', { resource_type: 'partner', vendor_name: '' }), /الجهة الشريكة/);
  await assert.rejects(() => R.updateResource(ctx, 'e_noacct', { department_id: 'D_CONS' }), /ليست تحت القطاع/);
  await assert.rejects(() => R.updateResource(ctx, 'e_noacct', { resource_type: 'alien' }), /نوع المورد غير معروف/);
});

test('S09: الإنشاء يغلّف إنشاء الموظف، يكتب النوع والطاقة بإصدارها، ويحذّر من الاسم القريب بلا دمج', async () => {
  const ctx = await ctxOf('u_admin');
  const c1 = await R.createResource(ctx, { name_ar: 'محمد أحمد الشهري', sector_id: 'SOL', department_id: 'D_A', resource_type: 'external',
    vendor_name: 'شركة التقنية', capacity_pct: 50, hire_date: TODAY, job_title: 'مطوّر' });
  assert.deepEqual(c1.warnings, []);
  assert.equal(c1.resource.resourceType_ar, 'خارجي'); assert.equal(c1.resource.capacityPct, 50); assert.equal(c1.resource.employment_type, 'متعاقد');
  const v = await db.get('SELECT * FROM capacity_version WHERE employee_id = ?', [c1.resource.id]);
  assert.equal(v.capacity_pct, 50); assert.equal(v.effective_from, TODAY);
  const c2 = await R.createResource(ctx, { name_ar: 'محمد أحمد القحطاني', sector_id: 'SOL', department_id: 'D_A' });
  assert.ok(c2.warnings.length >= 1 && c2.warnings[0].includes('محمد أحمد الشهري'), `لا تحذير تشابه: ${c2.warnings}`);
  assert.notEqual(c2.resource.id, c1.resource.id, 'تحذيرٌ لا دمج');
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'محمد أحمد الشهري', sector_id: 'SOL' }), /مستخدم بالفعل/);
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'جهة شريكة', sector_id: 'SOL', resource_type: 'partner' }), /الجهة الشريكة/);
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'خطأ الإدارة', sector_id: 'SOL', department_id: 'D_CONS' }), /ليست تحت القطاع/);
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'طاقة خاطئة', sector_id: 'SOL', capacity_pct: 0 }), /بين 1 و100/);
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'بلا قطاع' }), /اختر القطاع/);
  await assert.rejects(() => R.createResource(ctx, { name_ar: 'قطاع وهمي', sector_id: 'NOPE' }), /القطاع المختار غير موجود/);
  const rows = await db.all("SELECT action, detail_json FROM audit_log WHERE resource = 'employee' AND resource_id = ? ORDER BY at", [c1.resource.id]);
  assert.ok(rows.some((r) => r.action === 'create'), 'أثر إنشاء الموظف من خدمته');
  assert.ok(rows.some((r) => r.action === 'update' && JSON.parse(r.detail_json).after.resource_type === 'external'), 'أثر حقول المورد');
  assert.equal(moneyKeys(c1).length, 0);
});
