// ── الاحتياجات القادمة ومقارنة المرشحين — S19/S20/S21 (وحدة الفريق والموارد) ──────────────
//
// حالات القبول من الموجّه: T25 (مرشح متاح نوفمبر فقط ⇒ فجوة أكتوبر)، T26 (50% مؤكد + طلب 20%
// + احتياج 50% ⇒ تعارض محتمل 120% والمتاح 50%)، «تسجيل الاحتياج لا يحجز»، وطلبٌ مكرر يُرفض
// برسالةٍ تسمّي الطلب القائم. ومعها حدود الصلاحية والتحقق الخادمي من المصدر والفترة والنسب.
//
// طلب التسكين نفسه (allocations.submitRequest) يُبنى في حارةٍ أخرى؛ هنا تُختبر فحوصُ هذه
// الخدمة التي تسبقه — والتكرار يُكتشف من صفوف allocation_request المدرَجة مباشرةً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-needs-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, needs, resolveUser;
const T = new Date().toISOString();
const YEAR = 2026;   // فترة الاحتياج مثبَّتة: أكتوبر–نوفمبر 2026 — لا تتغيّر بتغيّر ساعة الخادم

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const count = async (table, where = '1=1', params = []) => Number((await db.get(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`, params)).n);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  needs = await import('../../src/modules/team/needs.js');

  for (const [id2, name, kind] of [['SOL', 'قطاع الحلول', 'delivery'], ['CONS', 'قطاع الاستشارات', 'delivery'], ['SUP', 'الخدمات المشتركة', 'support']]) {
    await db.insert('sector', { id: id2, name_ar: name, kind, active: 1, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'هيئة البيانات', created_at: T });

  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_dm', 'department_manager');                  // مدير إدارة البيانات
  await mkUser('u_dm2', 'department_manager');                 // مدير إدارة الذكاء
  await mkUser('u_pm', 'project_manager');                     // مدير المشروع P1
  await mkUser('u_cons', 'consultant');                        // استشاري — لا منح احتياجات
  await mkUser('u_hr', 'hr', null, 'company');
  await mkUser('u_conslead', 'sector_lead', 'CONS', 'sector');

  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء', manager_user_id: 'u_dm2', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SUP', sector_id: 'SUP', name_ar: 'المساندة', active: 1, created_at: T });

  const mkEmp = async (id2, { uid = null, dept, sector = 'SOL', hire = '2025-01-01', end = null, name = null, title = 'استشاري' }) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: name || 'موظف ' + id2, sector_id: sector, department_id: dept,
      job_title: title, active: 1, hire_date: hire, end_date: end, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_dm', { uid: 'u_dm', dept: 'D_DATA' });
  await mkEmp('e_dm2', { uid: 'u_dm2', dept: 'D_AI' });
  await mkEmp('e_pm', { uid: 'u_pm', dept: 'D_DATA' });
  await mkEmp('e_nov', { dept: 'D_DATA', hire: `${YEAR}-11-01`, name: 'نورة الجديدة' });        // T25: تبدأ في نوفمبر
  await mkEmp('e_busy', { dept: 'D_DATA', name: 'أحمد المشغول' });                              // T26
  await mkEmp('e_ai', { dept: 'D_AI', name: 'خالد الذكاء' });
  await mkEmp('e_sup', { dept: 'D_SUP', sector: 'SUP', name: 'سارة المساندة' });                 // وحدة مساندة ⇒ مؤهلة
  await mkEmp('e_cons', { dept: 'D_CONS', sector: 'CONS', name: 'فهد الاستشارات' });            // قطاع آخر ⇒ خارج الأهلية
  await mkEmp('e_left', { dept: 'D_DATA', end: `${YEAR}-06-30`, name: 'غادر قبل الفترة' });      // خارج الارتباط طوال الفترة

  const mkProject = (id2, name, sector, dept, owner) => db.insert('project', { id: id2, name_ar: name, sector_id: sector, department_id: dept,
    owner_user_id: owner, client_id: 'CL', status: 'IN_PROGRESS', kind: 'external', created_at: T });
  await mkProject('P1', 'منصة البيانات الوطنية', 'SOL', 'D_DATA', 'u_pm');
  await mkProject('P0', 'مشروع قائم', 'SOL', 'D_DATA', 'u_lead');
  await mkProject('P2', 'حوكمة الاستشارات', 'CONS', 'D_CONS', 'u_conslead');
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة تحليلات', sector_id: 'SOL', department_id: 'D_DATA', stage_id: 'LEAD',
    client_id: 'CL', value_halalas: 100, owner_user_id: 'u_lead', year: YEAR, stage_changed_at: T, created_at: T });

  // T26: أحمد مسكَّن 50% على مشروعٍ قائم في أكتوبر ونوفمبر، وله طلب تسكين معلَّق 20% على P1.
  await db.insert('allocation', { id: 'al_busy', employee_id: 'e_busy', project_id: 'P0', sector_id: 'SOL', type: 'member',
    monthly_json: JSON.stringify({ 10: 0.5, 11: 0.5 }), year: YEAR, created_at: T });
  await db.insert('allocation_request', { id: 'areq_busy', kind: 'new', employee_id: 'e_busy', target_kind: 'project', target_id: 'P1',
    year: YEAR, months_json: JSON.stringify({ 10: 20, 11: 20 }), alloc_status: 'confirmed', status: 'pending', requested_by: 'u_dm', created_at: T });

  // المهارات: أحمد SQL موثقة (راجعها مديره)، نورة SQL تقييم ذاتي، خالد بلا SQL.
  await db.insert('resource_capability', { id: 'cap1', employee_id: 'e_busy', kind: 'skill', name_ar: 'SQL', level: 'advanced', source: 'manager', reviewed_by: 'u_dm', reviewed_at: T, created_at: T });
  await db.insert('resource_capability', { id: 'cap2', employee_id: 'e_nov', kind: 'skill', name_ar: 'sql', level: 'practitioner', source: 'self', created_at: T });
  await db.insert('resource_capability', { id: 'cap3', employee_id: 'e_ai', kind: 'skill', name_ar: 'نمذجة البيانات', level: 'expert', source: 'manager', reviewed_by: 'u_dm2', reviewed_at: T, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const NEED = { source_kind: 'project', source_id: 'P1', role_ar: 'محلل بيانات', headcount: 1, fte_pct: 50,
  from_date: `${YEAR}-10-01`, to_date: `${YEAR}-11-30`, certainty: 'confirmed', skills: { required: ['SQL'] }, decide_by: `${YEAR}-09-20` };
let needId;

// ── S20: تسجيل الاحتياج ─────────────────────────────────────────────────────
test('حفظ الاحتياج لا يحجز: لا تسكين ولا طلب يُكتب، والحجم بلسانٍ واضح، والأثر مكتوب', async () => {
  const allocsBefore = await count('allocation'); const reqsBefore = await count('allocation_request');
  const n = await needs.createNeed(await ctxOf('u_lead'), NEED);
  needId = n.id;
  assert.equal(n.demand_ar, 'مورد واحد × 50% من الدوام الكامل طوال الفترة');
  assert.equal(n.status, 'open');
  assert.equal(n.certainty_ar, 'مؤكد');
  assert.equal(n.source.label, 'منصة البيانات الوطنية');
  assert.deepEqual(n.period.months, [`${YEAR}-10`, `${YEAR}-11`]);
  assert.equal(n.coverage.status, 'uncovered');
  assert.equal(await count('allocation'), allocsBefore, 'تسجيل الاحتياج كتب تسكيناً');
  assert.equal(await count('allocation_request'), reqsBefore, 'تسجيل الاحتياج كتب طلباً');
  const a = await db.get("SELECT user_id, action FROM audit_log WHERE resource = 'resource_need' AND resource_id = ? ORDER BY at DESC", [n.id]);
  assert.equal(a?.action, 'create'); assert.equal(a?.user_id, 'u_lead');
});

test('التحقق الخادمي: الفترة والنسبة والعدد والمصدر — كلٌّ برسالته', async () => {
  const ctx = await ctxOf('u_lead');
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, from_date: `${YEAR}-12-01` }), /بداية الفترة بعد نهايتها/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, from_date: '2026-13-01' }), /بصيغة سنة-شهر-يوم/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, fte_pct: 0 }), /نسبة الطاقة المطلوبة/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, fte_pct: 120 }), /نسبة الطاقة المطلوبة/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, headcount: 0 }), /عدد الموارد/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, role_ar: '  ' }), /الدور المطلوب/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, source_kind: 'bucket', source_id: 'marketing' }), /بند العمل الداخلي/);
  await assert.rejects(async () => needs.createNeed(ctx, { ...NEED, source_kind: 'project', source_id: 'P_NONE' }), /غير موجود/);
});

test('المصدر ضمن صلاحية القارئ: الاستشاري بلا منح، ومدير المشروع على مشروعه وحده ولا بند داخلي له', async () => {
  await assert.rejects(async () => needs.createNeed(await ctxOf('u_cons'), NEED), /يتطلب صلاحية/);
  await assert.rejects(async () => needs.createNeed(await ctxOf('u_pm'), { ...NEED, source_id: 'P2' }), /خارج نطاق/);
  await assert.rejects(async () => needs.createNeed(await ctxOf('u_pm'), { ...NEED, source_kind: 'bucket', source_id: 'bd' }), /مدير الإدارة أو قائد القطاع/);
  const mine = await needs.createNeed(await ctxOf('u_pm'), { ...NEED, role_ar: 'مهندس بيانات', headcount: 2, fte_pct: 100 });
  assert.equal(mine.demand_ar, 'موردان × 100% من الدوام الكامل طوال الفترة');
  // وقائد قطاعٍ آخر لا يفتح احتياج الحلول
  await assert.rejects(async () => needs.getNeed(await sess('u_conslead'), mine.id), /خارج نطاقك/);
  // وبند داخلي بيد قائد القطاع يصحّ — قطاعه قطاع البند
  const b = await needs.createNeed(await ctxOf('u_lead'), { ...NEED, source_kind: 'bucket', source_id: 'bd', role_ar: 'مستشار عروض', fte_pct: 30 });
  assert.equal(b.source.label, 'تطوير أعمال'); assert.equal(b.sector_id, 'SOL');
});

// ── S21: مقارنة المرشحين ────────────────────────────────────────────────────
test('T25: مرشح متاح في نوفمبر فقط ⇒ فجوة في أكتوبر، والأهلية قطاع العمل ووحدات المساندة', async () => {
  const r = await needs.candidates(await sess('u_lead'), needId);
  assert.equal(r.need.id, needId);
  assert.deepEqual(r.months.map((m) => m.key), [`${YEAR}-10`, `${YEAR}-11`]);
  const ids = r.rows.map((x) => x.employeeId);
  assert.ok(ids.includes('e_sup'), 'موظف وحدة المساندة مورد مشترك — غاب عن المرشحين');
  assert.ok(!ids.includes('e_cons'), 'موظف قطاعٍ آخر ظهر مرشحاً');
  const nov = r.rows.find((x) => x.employeeId === 'e_nov');
  assert.deepEqual(nov.availability.map((a) => [a.key, a.availablePct]), [[`${YEAR}-10`, null], [`${YEAR}-11`, 100]]);
  assert.ok(nov.fit_ar.includes('متاح في نوفمبر فقط — فجوة في أكتوبر'), nov.fit_ar.join(' | '));
  assert.equal(nov.eligible, true); assert.equal(nov.coversAllMonths, false); assert.deepEqual(nov.gapMonths, [`${YEAR}-10`]);
  const left = r.rows.find((x) => x.employeeId === 'e_left');
  assert.equal(left.eligible, false);
  assert.ok(left.fit_ar.includes('خارج فترة الارتباط طوال الفترة المطلوبة'));
  assert.ok(r.rows.every((x) => !('fitScore' in x) && !('score' in x)), 'لا نسبة ملاءمة رقمية');
  assert.ok(r.basis_ar.includes('الطاقة التعاقدية'));
});

test('T26: 50% مؤكد + طلب معلَّق 20% + احتياج 50% ⇒ تعارض محتمل 120% والمتاح 50%، والمعلَّق منفصل', async () => {
  const r = await needs.candidates(await sess('u_lead'), needId);
  const busy = r.rows.find((x) => x.employeeId === 'e_busy');
  const oct = busy.availability[0];
  assert.equal(oct.availablePct, 50, 'المتاح يُخصم منه المؤكد وحده');
  assert.equal(oct.confirmedPct, 50); assert.equal(oct.pendingPct, 20); assert.equal(oct.potentialPct, 120);
  assert.equal(busy.potentialOverPct, 120);
  assert.deepEqual(busy.pendingRequests.map((p) => [p.id, p.pct, p.label]), [['areq_busy', 20, 'منصة البيانات الوطنية']]);
  assert.ok(busy.fit_ar.some((s) => s.includes('تعارض محتمل 120%')), busy.fit_ar.join(' | '));
  assert.ok(busy.fit_ar.includes('يغطي الطاقة'), busy.fit_ar.join(' | '));
  assert.equal(busy.coversAllMonths, true);
  // الترتيب: من يغطي كل الأشهر قبل من عنده فجوة، ومن لا ارتباط له آخراً
  const order = r.rows.map((x) => x.employeeId);
  assert.ok(order.indexOf('e_busy') < order.indexOf('e_nov'));
  assert.equal(order[order.length - 1], 'e_left');
});

test('المهارات بحالة توثيقها: موثقة / تحتاج تأكيداً / غير مسجلة — والنقص يُقال في الجملة', async () => {
  const r = await needs.candidates(await sess('u_lead'), needId);
  const st = (id2) => r.rows.find((x) => x.employeeId === id2).skills.map((s) => [s.name, s.state]);
  assert.deepEqual(st('e_busy'), [['SQL', 'verified']]);
  assert.deepEqual(st('e_nov'), [['SQL', 'needs_confirmation']]);   // «sql» بحروفٍ صغيرة تُطابق
  assert.deepEqual(st('e_ai'), [['SQL', 'missing']]);
  assert.ok(r.rows.find((x) => x.employeeId === 'e_ai').fit_ar.includes('نقص في مهارة موثقة: SQL'));
  assert.ok(r.rows.find((x) => x.employeeId === 'e_nov').fit_ar.includes('مهارة تحتاج تأكيداً: SQL'));
  assert.ok(r.rows.find((x) => x.employeeId === 'e_busy').fit_ar.includes('المهارات المطلوبة موثقة'));
  // مرشّحا الإدارة والبحث خادميان
  const only = await needs.candidates(await sess('u_lead'), needId, { department: 'D_AI' });
  assert.deepEqual(only.rows.map((x) => x.employeeId).sort(), ['e_ai', 'e_dm2']);
  const q = await needs.candidates(await sess('u_lead'), needId, { q: 'نورة' });
  assert.deepEqual(q.rows.map((x) => x.employeeId), ['e_nov']);
});

test('المرشحون خلف بوابة الفريق: من لا يقرأ الموظفين لا يقارن، ومن لا يقرأ الاحتياج لا يفتحه', async () => {
  await assert.rejects(async () => needs.candidates(await sess('u_pm'), needId), /صلاحية عرض الفريق/);
  await assert.rejects(async () => needs.candidates(await sess('u_conslead'), needId), /خارج نطاقك/);
});

// ── S21: طلب التسكين من مرشح — فحوص ما قبل submitRequest ─────────────────────
test('طلبٌ معلَّق للاحتياج نفسه والمورد نفسه يُرفض برسالةٍ تسمّي الطلب القائم', async () => {
  await db.insert('allocation_request', { id: 'areq_dup', kind: 'new', employee_id: 'e_ai', target_kind: 'project', target_id: 'P1',
    year: YEAR, months_json: JSON.stringify({ 10: 50, 11: 50 }), alloc_status: 'confirmed', status: 'pending', need_id: needId,
    requested_by: 'u_lead', created_at: T });
  const reqsBefore = await count('allocation_request');
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), needId, 'e_ai', { pct: 50 }),
    (e) => e.status === 400 && /طلب تسكين معلَّق/.test(e.message) && e.message.includes('خالد الذكاء') && !/areq_/.test(e.message));
  assert.equal(await count('allocation_request'), reqsBefore, 'الرفض كتب طلباً');
  // والفحوص الأخرى قبل الحجز: النسبة، ونوع التسكين، والمرشح
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), needId, 'e_nov', { pct: 0 }), /نسبة التسكين المطلوبة/);
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), needId, 'e_nov', { allocStatus: 'maybe' }), /مؤكد» أو «مبدئي/);
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), needId, 'e_none'), /غير موجود/);
  // ومن لا يملك الاحتياج لا يطلب عليه
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_dm2'), needId, 'e_nov'), /خارج نطاقك|لصاحبه/);
});

test('احتياجٌ على فرصة لا يُطلب عليه تسكين — الفرصة بلا تسكين شهري', async () => {
  const o = await needs.createNeed(await ctxOf('u_lead'), { ...NEED, source_kind: 'opportunity', source_id: 'O1', role_ar: 'كاتب عرض' });
  assert.equal(o.source.label, 'فرصة تحليلات');
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), o.id, 'e_nov'), /مسجَّل على فرصة/);
});

// ── S19: القائمة والتغطية والنطاق ───────────────────────────────────────────
test('القائمة بنطاق القارئ: مدير إدارة البيانات يرى احتياجها، ومدير الذكاء لا، والموارد البشرية ترى الشركة بلا مال', async () => {
  const dm = await needs.listNeeds(await sess('u_dm'));
  assert.ok(dm.rows.some((r) => r.id === needId), 'احتياج إدارته غائب عن قائمته');
  const dm2 = await needs.listNeeds(await sess('u_dm2'));
  assert.ok(!dm2.rows.some((r) => r.id === needId), 'احتياج إدارةٍ أخرى ظهر لمديرٍ لا يقودها');
  // «اليوم» مربوط: بعد موعد القرار (20 سبتمبر) وقبل بداية الفترة — فالاحتياج متابعةٌ فائتة
  const hr = await needs.listNeeds(await sess('u_hr'), { todayDate: `${YEAR}-09-25` });
  assert.ok(hr.rows.some((r) => r.id === needId));
  for (const r of hr.rows) for (const k of Object.keys(r)) assert.ok(!/halalas|salary|budget|value/i.test(k), `حقل مالي تسرّب: ${k}`);
  await assert.rejects(async () => needs.listNeeds(await sess('u_cons')), /يتطلب صلاحية/);
  // التغطية تُقرأ من الطلبات المرتبطة: الطلب المعلَّق ⇒ «بانتظار اعتماد» باسم الطلب
  const row = hr.rows.find((r) => r.id === needId);
  assert.equal(row.coverage.status, 'pending'); assert.equal(row.coverage.status_ar, 'بانتظار اعتماد');
  assert.equal(row.coverage.requestId, 'areq_dup'); assert.equal(row.coverage.gapPct, 50); assert.equal(row.coverage.pendingPct, 50);
  const fu = hr.followups.find((f) => f.needId === needId);
  assert.ok(fu, 'موعد القرار الفائت بلا تغطية ليس في المتابعات');
  assert.equal(fu.kind, 'decision_overdue'); assert.ok(fu.reason_ar.includes(`${YEAR}-09-20`));
  // وقبل موعد القرار بأيام: «موعد القرار» لا «فائت»؛ وبعيداً عنه ولا بداية قريبة: لا متابعة
  const due = await needs.listNeeds(await sess('u_hr'), { todayDate: `${YEAR}-09-10` });
  assert.equal(due.followups.find((f) => f.needId === needId)?.kind, 'decision_due');
  const far = await needs.listNeeds(await sess('u_hr'), { todayDate: `${YEAR}-08-01` });
  assert.equal(far.followups.find((f) => f.needId === needId), undefined);
  assert.equal(hr.summary.confirmed >= 1, true);
  // المرشّحات خادمية: فترة لا تتقاطع ⇒ لا صفوف
  const none = await needs.listNeeds(await sess('u_hr'), { from: `${YEAR + 1}-01-01`, to: `${YEAR + 1}-02-01` });
  assert.equal(none.rows.length, 0);
  const cert = await needs.listNeeds(await sess('u_hr'), { certainty: 'tentative' });
  assert.equal(cert.rows.length, 0);
});

test('التعديل لصاحبه أو لمن يدير إدارته أو قطاعه — والأثر يحمل قبل/بعد', async () => {
  const u = await needs.updateNeed(await ctxOf('u_dm'), needId, { fte_pct: 60, certainty: 'tentative' });
  assert.equal(u.demand_ar, 'مورد واحد × 60% من الدوام الكامل طوال الفترة');
  assert.equal(u.certainty_ar, 'مبدئي');
  const a = await db.get("SELECT detail_json FROM audit_log WHERE resource = 'resource_need' AND resource_id = ? AND action = 'update' ORDER BY at DESC", [needId]);
  const d = JSON.parse(a.detail_json);
  assert.equal(d.before.fte_pct, 50); assert.equal(d.after.fte_pct, 60);
  await assert.rejects(async () => needs.updateNeed(await ctxOf('u_dm2'), needId, { fte_pct: 70 }), /لصاحبه أو لمن يدير/);
  await assert.rejects(async () => needs.updateNeed(await ctxOf('u_dm'), needId, { status: 'cancelled' }), /الإلغاء له زرّه/);
  // تعديلٌ بلا تغيير لا يكتب أثراً
  const before = await count('audit_log', "resource = 'resource_need' AND resource_id = ?", [needId]);
  await needs.updateNeed(await ctxOf('u_dm'), needId, { fte_pct: 60 });
  assert.equal(await count('audit_log', "resource = 'resource_need' AND resource_id = ?", [needId]), before);
});

test('الإلغاء يُمنع ما دام طلبٌ معلَّق مرتبطاً به، ويمضي بعد سحبه — ثم لا يُعدَّل ولا يُطلب عليه', async () => {
  await assert.rejects(async () => needs.cancelNeed(await ctxOf('u_lead'), needId), /طلب تسكين معلَّق/);
  await db.update('allocation_request', 'areq_dup', { status: 'withdrawn' });
  const c = await needs.cancelNeed(await ctxOf('u_lead'), needId, { reason: 'تغيّر نطاق المشروع' });
  assert.equal(c.status, 'cancelled'); assert.equal(c.status_ar, 'ملغى');
  const a = await db.get("SELECT user_id, detail_json FROM audit_log WHERE resource = 'resource_need' AND resource_id = ? AND action = 'cancel'", [needId]);
  assert.equal(a.user_id, 'u_lead'); assert.equal(JSON.parse(a.detail_json).reason, 'تغيّر نطاق المشروع');
  await assert.rejects(async () => needs.updateNeed(await ctxOf('u_lead'), needId, { fte_pct: 70 }), /ملغى/);
  await assert.rejects(async () => needs.requestFromCandidate(await ctxOf('u_lead'), needId, 'e_nov'), /ملغى/);
  // الملغى خارج القائمة الافتراضية ويظهر بطلبٍ صريح
  assert.ok(!(await needs.listNeeds(await sess('u_hr'))).rows.some((r) => r.id === needId));
  assert.ok((await needs.listNeeds(await sess('u_hr'), { status: 'cancelled' })).rows.some((r) => r.id === needId));
  const again = await needs.cancelNeed(await ctxOf('u_lead'), needId);
  assert.equal(again.already, true);
});
