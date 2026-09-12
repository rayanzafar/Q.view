// ── حدود قراءة الموارد (B1): T37 الموارد البشرية بلا مال، T38 الموظف داخل ملفه وحده ──────────
//
// «اسم الدور وحده لا يكفي… وإخفاء زرٍّ لا يكفي» (الموجّه §10). فالحدّ هنا يُفحص على الصفوف والحقول
// والعدادات معاً: من يرى الأسماء لا يرى المال، ومن يفتح ملفه لا يفتح ملف زميله، والفلاتر تضيّق
// النطاق ولا توسّعه أبداً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, R, rbac, resolveUser, TODAY, YEAR;
const T = new Date().toISOString();
const allYear = (f) => JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), f])));
const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const MONEY_KEY = /halalas|_sar$|salary|margin|budget|contract_value|invoice|revenue/i;
function moneyKeys(v, path = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => moneyKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (MONEY_KEY.test(k)) out.push(`${path}.${k}`); moneyKeys(x, `${path}.${k}`, out); }
  return out;
}

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  const time = await import('../../src/core/i18n/time.js');
  TODAY = time.riyadhDate(); YEAR = Number(TODAY.slice(0, 4));
  R = await import('../../src/modules/team/resources.js');

  for (const [sid, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id: sid, name_ar: name, kind: 'delivery', active: 1, target_sales_halalas: 4200, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة النقل', created_at: T });
  const mkUser = (uid, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: uid, username: uid, name_ar: 'حساب ' + uid, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_hr', 'hr', null, 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_conslead', 'sector_lead', 'CONS', 'sector');
  await mkUser('u_dm', 'department_manager');
  await mkUser('u_emp', 'consultant');
  await mkUser('u_out', 'employee', 'CONS');
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  const mkEmp = async (eid, { uid = null, dept = 'D_A', sector = 'SOL', job, name, capacity = null }) => {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: name, sector_id: sector, department_id: dept, job_title: job,
      hire_date: '2025-01-01', capacity_pct: capacity, salary_halalas: 1500000, active: 1, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: eid });
  };
  await mkEmp('e_dm', { uid: 'u_dm', job: 'مدير إدارة', name: 'سلطان المدير' });
  await mkEmp('e_emp', { uid: 'u_emp', job: 'مستشار أول', name: 'هادي الشهري' });
  await mkEmp('e_half', { job: 'مستشار نصف دوام', name: 'خالد المتعاقد', capacity: 50 });
  await mkEmp('e_skill', { dept: 'D_B', job: 'مهندس بيانات', name: 'ريان البيانات' });
  await mkEmp('e_out', { uid: 'u_out', dept: 'D_CONS', sector: 'CONS', job: 'استشاري', name: 'عمر الاستشاري' });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع منصة النقل الذكي', sector_id: 'SOL', department_id: 'D_A', client_id: 'CL', kind: 'external',
    status: 'IN_PROGRESS', contract_value_halalas: 5000000, budget_halalas: 1000000, margin_pct: 30, revenue_halalas: 2000000, created_at: T });
  await db.insert('allocation', { id: 'a1', employee_id: 'e_emp', project_id: 'P1', sector_id: 'SOL', type: 'member', monthly_json: allYear(0.6), year: YEAR, created_at: T });
  await db.insert('allocation', { id: 'a2', employee_id: 'e_half', project_id: 'P1', sector_id: 'SOL', type: 'lead', monthly_json: allYear(1), year: YEAR, created_at: T });
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة الرصد البيئي', sector_id: 'SOL', department_id: 'D_A', stage_id: 'LEAD', client_id: 'CL',
    value_halalas: 7000000, owner_user_id: 'u_dm', year: YEAR, stage_changed_at: T, created_at: T });
  await db.insert('membership', { id: 'm1', employee_id: 'e_emp', group_kind: 'opportunity', group_id: 'O1', role_in_group: 'member', allocation_pct: 10, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── T37 ───────────────────────────────────────────────────────────────────────────────────────
test('T37: الموارد البشرية ترى الأسماء شركةً وأسماء الأعمال ونسبها — بلا راتب ولا قيمة مشروع ولا فرصة', async () => {
  const hr = await sess('u_hr');
  assert.equal(rbac.can(hr, 'read', 'project'), false, 'الفرضية: الموارد البشرية بلا منح مشروع');
  assert.equal(rbac.can(hr, 'read', 'salary'), false, 'الفرضية: الراتب مختوم');
  const list = await R.listResources(hr, {});
  assert.equal(list.total, 5, 'الشركة كلها بقطاعيها');
  assert.deepEqual([...new Set(list.rows.map((r) => r.sector_id))].sort(), ['CONS', 'SOL']);
  assert.equal(moneyKeys(list).length, 0, `مال في السجل: ${moneyKeys(list).join(', ')}`);
  const prof = await R.resourceProfile(hr, 'e_emp', {});
  assert.ok(!('salary_halalas' in prof.resource) && !('_redacted_salary_halalas' in prof.resource), 'لا مفتاح راتبٍ ولا أثر حجبه');
  assert.equal(prof.distribution[0].label, 'مشروع منصة النقل الذكي', 'اسم المشروع يصل من خدمة الموارد لا من نطاق المشروع');
  assert.equal(prof.distribution[0].pct, 60);
  const work = await R.linkedWork(hr, 'e_emp', { window: 'current' });
  assert.ok(work.rows.some((r) => r.label === 'مشروع منصة النقل الذكي') && work.rows.some((r) => r.label === 'فرصة الرصد البيئي'));
  const outputs = [prof, work, await R.resourcePreview(hr, 'e_emp', {}), await R.engagement(hr, 'e_emp'), await R.orgResources(hr, { department: 'D_A' }),
    await R.resourceCapabilities(hr, 'e_emp')];
  for (const o of outputs) assert.equal(moneyKeys(o).length, 0, `مال في قراءة موارد: ${moneyKeys(o).join(', ')}`);
  assert.equal(prof.rights.edit, true, 'الموارد البشرية تعدّل صف الموظف (منحها القائم)');
  const tasks = await R.resourceTasks(hr, 'e_emp');
  assert.equal(tasks.available, false, 'لا منح مهامٍ للموارد البشرية — يُقال لا يُخفى');
  assert.ok(tasks.note_ar && !/undefined|null/.test(tasks.note_ar));
});

test('T37ب: سجل التغييرات يُسقط أي مفتاح راتبٍ من الأثر — قبل وبعد وقائمة الأعمدة', async () => {
  await db.insert('audit_log', { id: 'aud_money', at: T, user_id: 'u_admin', username: 'u_admin', role_id: 'admin', action: 'update',
    resource: 'employee', resource_id: 'e_emp', sector_id: 'SOL',
    detail_json: JSON.stringify({ before: { salary_halalas: 1, job_title: 'قديم' }, after: { salary_halalas: 2, job_title: 'جديد' }, reason: 'ترقية' }) });
  await db.insert('audit_log', { id: 'aud_cols', at: T, user_id: 'u_admin', username: 'u_admin', role_id: 'admin', action: 'update',
    resource: 'employee', resource_id: 'e_emp', sector_id: 'SOL', detail_json: JSON.stringify(['salary_halalas', 'updated_at', 'job_title']) });
  const hr = await sess('u_hr');
  const a = await R.resourceAudit(hr, 'e_emp', { filter: 'profile' });
  const money = a.rows.find((r) => r.id === 'aud_money');
  assert.deepEqual(money.before, { job_title: 'قديم' }); assert.deepEqual(money.after, { job_title: 'جديد' }); assert.equal(money.reason, 'ترقية');
  const cols = a.rows.find((r) => r.id === 'aud_cols');
  assert.deepEqual(cols.changed, ['job_title']);
  assert.equal(moneyKeys(a).length, 0);
});

// ── T38 ───────────────────────────────────────────────────────────────────────────────────────
test('T38: الموظف يفتح ملفه هو — ويُرَدّ عن السجل وعن ملف زميله وعن كل قراءةٍ عليه', async () => {
  const me = await sess('u_emp');
  await assert.rejects(() => R.listResources(me, {}), /صلاحية قراءة الفريق/);
  await assert.rejects(() => R.orgResources(me, {}), /صلاحية قراءة الفريق/);
  const mine = await R.resourceProfile(me, 'e_emp', {});
  assert.equal(mine.resource.id, 'e_emp'); assert.equal(mine.rights.self, true); assert.equal(mine.rights.edit, false);
  assert.equal(mine.figures.confirmedPct, 60);
  assert.ok(!('salary_halalas' in mine.resource));
  assert.equal((await R.engagement(me, 'e_emp')).account.userId, 'u_emp');
  assert.equal((await R.linkedWork(me, 'e_emp', { window: 'current' })).rows.length, 2);
  for (const fn of [
    () => R.resourceProfile(me, 'e_half', {}), () => R.resourcePreview(me, 'e_half', {}), () => R.linkedWork(me, 'e_half', {}),
    () => R.engagement(me, 'e_half'), () => R.resourceCapabilities(me, 'e_half'), () => R.resourceAudit(me, 'e_half', {}),
  ]) await assert.rejects(fn, /خارج نطاقك/);
  await assert.rejects(() => R.resourceProfile(me, 'e_nope', {}), /غير موجود/);
});

test('T38ب: الموظف لا يعدّل بياناته ولا طاقته، ويسجّل قدراته هو لا قدرات زميله', async () => {
  const ctx = await ctxOf('u_emp');
  await assert.rejects(() => R.updateResource(ctx, 'e_emp', { job_title: 'مدير' }), /صلاحية تعديل الموظف/);
  await assert.rejects(() => R.setCapacity(ctx, 'e_emp', { capacity_pct: 50, effective_from: TODAY }), /صلاحية تعديل الموظف/);
  const s = await R.upsertCapability(ctx, 'e_emp', { kind: 'skill', name_ar: 'نمذجة البيانات', level: 'practitioner' });
  assert.equal(s.source, 'self'); assert.equal(s.reviewed, false);
  await assert.rejects(() => R.upsertCapability(ctx, 'e_half', { kind: 'skill', name_ar: 'x' }), /لصاحب الملف أو لمن يدير/);
  await assert.rejects(() => R.removeCapability(ctx, 'e_half', 'whatever'), /لصاحب الملف أو لمن يدير/);
  assert.equal((await db.get('SELECT COUNT(*) n FROM resource_capability WHERE employee_id = ?', ['e_half'])).n, 0, 'لم يُكتب شيء لزميله');
});

// ── مدير الإدارة وقائد القطاع ─────────────────────────────────────────────────────────────────
test('مدير الإدارة يرى أهل إدارته وحدهم، يخطّط عليهم مباشرةً ويراجع قدراتهم، ولا يعدّل طاقةً', async () => {
  const dm = await sess('u_dm');
  const list = await R.listResources(dm, {});
  assert.deepEqual(list.rows.map((r) => r.id).sort(), ['e_dm', 'e_emp', 'e_half']);
  assert.equal(list.total, 3, 'العدّاد تحت الحدّ نفسه');
  await assert.rejects(() => R.resourceProfile(dm, 'e_skill', {}), /خارج نطاقك/);
  await assert.rejects(() => R.resourceProfile(dm, 'e_out', {}), /خارج نطاقك/);
  const prof = await R.resourceProfile(dm, 'e_emp', {});
  assert.equal(prof.rights.planning.direct, true, 'من يقود الإدارة يؤكّد التسكين مباشرةً');
  assert.equal(prof.rights.edit, false, 'ولا يملك تعديل صف الموظف');
  const ctx = await ctxOf('u_dm');
  await assert.rejects(() => R.setCapacity(ctx, 'e_emp', { capacity_pct: 50, effective_from: TODAY }), /صلاحية تعديل الموظف/);
  const s = await R.upsertCapability(ctx, 'e_emp', { kind: 'skill', name_ar: 'إدارة أصحاب المصلحة', level: 'advanced' });
  assert.equal(s.reviewed, true); assert.equal(s.reviewed_by, 'u_dm'); assert.equal(s.source, 'manager');
  // الفلاتر تضيّق ولا توسّع: إدارةٌ أخرى تعود بلا صفوف — لا خطأ ولا تسريب.
  assert.equal((await R.listResources(dm, { department: 'D_B' })).total, 0);
  const org = await R.orgResources(dm, { department: 'D_B' });
  assert.deepEqual(org.resources, []); assert.deepEqual(org.shared, []);
  assert.equal(moneyKeys(org).length, 0);
});

test('قائد قطاعٍ آخر لا يبلغ موارد القطاع — وقائد القطاع نفسه يعدّل طاقة أهله', async () => {
  const other = await sess('u_conslead');
  assert.deepEqual((await R.listResources(other, {})).rows.map((r) => r.id), ['e_out']);
  await assert.rejects(() => R.resourceProfile(other, 'e_emp', {}), /خارج نطاقك/);
  const otherCtx = await ctxOf('u_conslead');
  await assert.rejects(() => R.setCapacity(otherCtx, 'e_half', { capacity_pct: 40, effective_from: TODAY }), /صلاحية تعديل الموظف/);
  const lead = await sess('u_lead');
  assert.equal((await R.listResources(lead, {})).total, 4, 'قطاعه كله');
  assert.equal((await R.listResources(lead, { sector: 'CONS' })).total, 4, 'طلب قطاعٍ آخر لا يوسّع نطاقه');
  const r = await R.setCapacity(await ctxOf('u_lead'), 'e_half', { capacity_pct: 40, effective_from: TODAY, note: 'تعديل عقد' });
  assert.equal(r.applied, true); assert.equal(r.capacityPct, 40);
  const aud = await db.get("SELECT user_id FROM audit_log WHERE resource = 'capacity_version' ORDER BY at DESC LIMIT 1");
  assert.equal(aud.user_id, 'u_lead');
});

test('الموارد البشرية تعدّل الطاقة وتراجع القدرات شركةً — والأثر بلا مال', async () => {
  const ctx = await ctxOf('u_hr');
  const r = await R.setCapacity(ctx, 'e_out', { capacity_pct: 80, effective_from: TODAY });
  assert.equal(r.applied, true);
  const s = await R.upsertCapability(ctx, 'e_out', { kind: 'goal', name_ar: 'برنامج القيادة', target_date: `${YEAR + 1}-06-30` });
  assert.equal(s.reviewed_by, 'u_hr'); assert.equal(s.source_ar, 'مراجَع');
  const a = await R.resourceAudit(await sess('u_hr'), 'e_out', { filter: 'all' });
  assert.ok(a.rows.some((x) => x.kind === 'capacity') && a.rows.some((x) => x.kind === 'capability'));
  assert.equal(moneyKeys(a).length, 0);
  const emp = await sess('u_out');
  await assert.rejects(() => R.listResources(emp, {}), /صلاحية قراءة الفريق/);
  assert.equal((await R.resourceCapabilities(emp, 'e_out')).goals.length, 1, 'صاحب الملف يقرأ ما راجعته الموارد البشرية له');
});
