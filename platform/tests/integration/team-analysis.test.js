// ── تحليل الاستخدام وفحص الحالة والمتابعة والعمل والالتزامات — S12/S17/S18 ─────────────────
//
// حالات القبول من الموجّه: T23 (المهمة تُعدّ مرةً واحدة)، T24 (مهام بلا نسب ⇒ حِمل غير مقاس،
// والتغطية المالية للفرد غير متاحة — C8)، متابعةٌ تنشئ مهمة حقيقية ولا تتكرر، وإغلاق الحالة
// يسجّل الفاعل. ومعها قواعد الإشارات السبع من §7.2 كلٌّ بمورده، وحدود النطاق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-analysis-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, analysis, commitments, resolveUser;
const T = new Date().toISOString();
const YEAR = 2026; const MONTH = 10;   // شهر التحليل مثبَّت: أكتوبر 2026
const P = { year: YEAR, month: MONTH };

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const count = async (table, where = '1=1', params = []) => Number((await db.get(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`, params)).n);
const rowOf = (r, id2) => r.rows.find((x) => x.employeeId === id2);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  analysis = await import('../../src/modules/team/analysis.js');
  commitments = await import('../../src/modules/team/commitments.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'هيئة البيانات', created_at: T });
  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_dm', 'department_manager');    // مدير D1
  await mkUser('u_dm2', 'department_manager');   // مدير D2
  for (const u of ['u_a', 'u_b', 'u_c', 'u_d', 'u_f', 'u_g', 'u_h']) await mkUser(u, 'consultant');
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D2', sector_id: 'SOL', name_ar: 'إدارة الذكاء', manager_user_id: 'u_dm2', active: 1, created_at: T });

  const mkEmp = async (id2, { uid = null, dept = 'D1', hire = '2025-01-01', end = null, name }) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: name, sector_id: 'SOL', department_id: dept,
      job_title: 'استشاري', active: 1, hire_date: hire, end_date: end, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_dm', { uid: 'u_dm', name: 'مدير البيانات' });
  await mkEmp('e_dm2', { uid: 'u_dm2', dept: 'D2', name: 'مدير الذكاء' });
  await mkEmp('e_a', { uid: 'u_a', name: 'أحمد العلي' });        // 100% + حِمل منخفض ⇒ تسكين يحتاج مراجعة
  await mkEmp('e_b', { uid: 'u_b', name: 'بدر الحربي' });        // 30% + حِمل مرتفع ⇒ التزامات لا تعكسها الخطة
  await mkEmp('e_c', { uid: 'u_c', name: 'نورة القحطاني' });     // 60% بند داخلي من 100% ⇒ مراجعة الأولويات؛ مهام بلا نسب ⇒ غير مقاس (T24)
  await mkEmp('e_d', { uid: 'u_d', name: 'دلال السبيعي' });      // 80% + حِمل مرتفع ⇒ راجع توازن الالتزامات
  await mkEmp('e_e', { name: 'عمر بلا حساب' });                  // 50% أكتوبر–ديسمبر + طلب معلَّق نوفمبر ⇒ تحقق من الطلب القادم
  await mkEmp('e_f', { uid: 'u_f', name: 'فيصل المنتهي تسكينه' }); // 50% أكتوبر ونوفمبر فقط ⇒ فرصة تخطيط
  await mkEmp('e_g', { uid: 'u_g', end: `${YEAR}-09-30`, name: 'غازي المغادر' }); // غادر قبل الشهر ⇒ بيانات غير مكتملة
  await mkEmp('e_h', { uid: 'u_h', dept: 'D2', name: 'هند الذكاء' }); // 50% + حِمل متوسط ⇒ لا تعارض ظاهر

  await db.insert('project', { id: 'P1', name_ar: 'منصة البيانات الوطنية', sector_id: 'SOL', department_id: 'D1', owner_user_id: 'u_dm',
    client_id: 'CL', status: 'IN_PROGRESS', kind: 'external', code: 'PRJ-1', created_at: T });
  await db.insert('milestone', { id: 'MS1', project_id: 'P1', name_ar: 'تسليم النموذج الأولي', due_date: `${YEAR}-10-20`, status: 'PENDING', created_at: T });
  await db.insert('milestone', { id: 'MS2', project_id: 'P1', name_ar: 'معلم مضى', due_date: `${YEAR}-09-01`, status: 'MET', created_at: T });

  const alloc = (id2, emp, months, { project = 'P1', bucket = null } = {}) => db.insert('allocation', {
    id: id2, employee_id: emp, project_id: bucket ? null : project, work_bucket: bucket, sector_id: 'SOL', type: 'member',
    monthly_json: JSON.stringify(months), year: YEAR, created_at: T });
  await alloc('al_a', 'e_a', { 10: 1, 11: 1, 12: 1 });
  await alloc('al_b', 'e_b', { 10: 0.3, 11: 0.3 });
  await alloc('al_c1', 'e_c', { 10: 0.6, 11: 0.6 }, { bucket: 'bd' });
  await alloc('al_c2', 'e_c', { 10: 0.4, 11: 0.4 });
  await alloc('al_d', 'e_d', { 10: 0.8, 11: 0.8, 12: 0.8 });
  await alloc('al_e', 'e_e', { 10: 0.5, 11: 0.5, 12: 0.5 });
  await alloc('al_f', 'e_f', { 10: 0.5, 11: 0.5 });
  await alloc('al_h', 'e_h', { 10: 0.5, 11: 0.5, 12: 0.5 });
  await db.insert('allocation_request', { id: 'areq_e', kind: 'new', employee_id: 'e_e', target_kind: 'bucket', target_id: 'pmo',
    year: YEAR, months_json: JSON.stringify({ 11: 20 }), alloc_status: 'confirmed', status: 'pending', requested_by: 'u_dm', created_at: T });

  const task = (id2, uid, { title, pct = null, status = 'TODO', due = null, project = 'P1', kind = 'project', blocked = null, approval = null, opp = null }) =>
    db.insert('task', { id: id2, title, work_kind: kind, project_id: kind === 'project' ? project : null, opportunity_id: opp,
      sector_id: kind === 'personal' ? null : 'SOL', department_id: kind === 'personal' ? null : 'D1', assignee_user_id: uid,
      priority: 'P2', status, due_date: due, utilization_pct: pct, blocked_reason: blocked, approval_state: approval, created_at: T, created_by: uid });
  await task('t_a1', 'u_a', { title: 'مراجعة النموذج', pct: 20, due: `${YEAR}-10-25` });
  await task('t_a_personal', 'u_a', { title: 'دفتري الخاص', pct: 90, kind: 'personal' });                  // لا تُعدّ ولا تُعرض
  await task('t_a_pending', 'u_a', { title: 'مهمة تنتظر اعتماداً', pct: 90, approval: 'PENDING' });       // لا تُعدّ ولا تُعرض
  await task('t_a_done', 'u_a', { title: 'مهمة منجزة', pct: 90, status: 'DONE' });                         // لا تُعدّ
  await task('t_b1', 'u_b', { title: 'تجهيز البيانات', pct: 50, due: `${YEAR}-10-05` });
  await task('t_b2', 'u_b', { title: 'تنظيف البيانات', pct: 50, status: 'BLOCKED', blocked: 'بانتظار صلاحية الوصول', due: `${YEAR}-10-12` });
  await task('t_b3', 'u_b', { title: 'توثيق المخطط', pct: 30, kind: 'internal', project: null });
  await task('t_c1', 'u_c', { title: 'مهمة بلا نسبة ١' });
  await task('t_c2', 'u_c', { title: 'مهمة بلا نسبة ٢', due: `${YEAR}-11-02` });
  await task('t_d1', 'u_d', { title: 'تطوير اللوحة', pct: 60 });
  await task('t_d2', 'u_d', { title: 'اختبار اللوحة', pct: 60, due: `${YEAR}-09-28` });                    // متأخرة
  await task('t_h1', 'u_h', { title: 'تحليل الأثر', pct: 30, due: `${YEAR}-10-30` });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── S17: الجدول والإشارات ────────────────────────────────────────────────────
test('T24: مهام بلا أي نسبة ⇒ حِمل «غير مقاس» لا صفر، والتغطية المالية للفرد «غير متاحة» دائماً', async () => {
  const r = await analysis.utilizationTable(await sess('u_dm'), P);
  const c = rowOf(r, 'e_c');
  assert.equal(c.taskLoad.level, 'unmeasured'); assert.equal(c.taskLoad.level_ar, 'غير مقاس');
  assert.equal(c.taskLoad.open, 2); assert.equal(c.taskLoad.unsized, 2); assert.equal(c.taskLoad.pct, 0);
  assert.ok(c.taskLoad.basis_ar.includes('غير مقاس') && c.taskLoad.basis_ar.includes('أقل من 40'), c.taskLoad.basis_ar);
  for (const row of r.rows) {
    assert.deepEqual([row.coverage.state, row.coverage.state_ar], ['unavailable', 'غير متاحة']);
    assert.ok(row.coverage.note_ar.includes('لا يوجد منهج معتمد'));
  }
  const e = rowOf(r, 'e_e');
  assert.equal(e.taskLoad.level, 'unmeasured');
  assert.ok(e.taskLoad.basis_ar.includes('لا حساب دخول'));
});

test('قواعد الإشارات §7.2 — كلُّ موردٍ إشارتُه الأولى المنطبقة وقاعدتُها مكتوبة', async () => {
  const r = await analysis.utilizationTable(await sess('u_admin'), P);
  const sig = (id2) => rowOf(r, id2).signal.key;
  assert.equal(sig('e_a'), 'high_alloc_low_load');
  assert.equal(sig('e_b'), 'low_alloc_high_load');
  assert.equal(sig('e_c'), 'internal_high');
  assert.equal(sig('e_d'), 'high_load_pressure');
  assert.equal(sig('e_g'), 'data_missing');
  assert.equal(sig('e_f'), 'capacity_freeing');
  assert.equal(sig('e_e'), 'check_upcoming');
  assert.equal(sig('e_h'), 'none');
  assert.equal(rowOf(r, 'e_a').signal.label_ar, 'تسكين يحتاج مراجعة');
  assert.equal(rowOf(r, 'e_h').signal.label_ar, 'لا يوجد تعارض ظاهر');
  assert.ok(rowOf(r, 'e_c').signal.rule_ar.includes('60%'));
  assert.ok(rowOf(r, 'e_g').signal.why_ar.includes(`${YEAR}-09-30`));
  // الأرقام الثلاثة لا تُخلط: المؤكد، القابل للفوترة، والحِمل — كلٌّ باسمه
  const c = rowOf(r, 'e_c');
  assert.equal(c.confirmedPct, 100); assert.equal(c.billablePct, 40); assert.equal(c.internalPct, 60);
  assert.equal(rowOf(r, 'e_b').taskLoad.pct, 130); assert.equal(rowOf(r, 'e_b').taskLoad.level, 'high');
  assert.equal(rowOf(r, 'e_a').taskLoad.pct, 20, 'الشخصية والمعلَّقة والمنجزة لا تدخل الحِمل');
  assert.equal(rowOf(r, 'e_g').confirmedPct, null, 'خارج الارتباط فراغٌ لا صفر');
  // «لا تعارض ظاهر»: هند، والمديران بلا تسكين ولا مهام — وليس أحدٌ من أصحاب الإشارات
  assert.deepEqual(r.rows.filter((x) => x.signal.key === 'none').map((x) => x.employeeId).sort(), ['e_dm', 'e_dm2', 'e_h']);
  assert.equal(r.counts.bySignal.none, 3);
  assert.ok(r.definitions_ar.some((d) => d.includes('غير متاحة')));
  // المرشّح بالإشارة خادمي
  const only = await analysis.utilizationTable(await sess('u_admin'), { ...P, signal: 'capacity_freeing' });
  assert.deepEqual(only.rows.map((x) => x.employeeId), ['e_f']);
  await assert.rejects(async () => analysis.utilizationTable(await sess('u_admin'), { ...P, signal: 'nope' }), /غير معروفة/);
  await assert.rejects(async () => analysis.utilizationTable(await sess('u_admin'), { year: YEAR, month: 13 }), /الشهر رقم/);
});

test('النطاق: مدير الإدارة يرى أهل إدارته وحدهم، ومن لا يقرأ الفريق يُردّ، والإدارة الغريبة تُرفض', async () => {
  const dm = await analysis.utilizationTable(await sess('u_dm'), P);
  assert.ok(!dm.rows.some((x) => x.employeeId === 'e_h'), 'موظف إدارةٍ أخرى ظهر في جدول مديرٍ لا يقودها');
  assert.ok(dm.rows.some((x) => x.employeeId === 'e_a'));
  const dm2 = await analysis.utilizationTable(await sess('u_dm2'), P);
  assert.deepEqual(dm2.rows.map((x) => x.employeeId).sort(), ['e_dm2', 'e_h']);
  await assert.rejects(async () => analysis.utilizationTable(await sess('u_a'), P), /صلاحية عرض الفريق/);
  await assert.rejects(async () => analysis.utilizationTable(await sess('u_dm'), { ...P, department: 'D2' }), /خارج نطاقك/);
  await assert.rejects(async () => analysis.caseDetail(await sess('u_dm2'), 'e_a', P), /خارج نطاقك/);
});

// ── S18: فحص الحالة والمتابعة ────────────────────────────────────────────────
let caseId, taskId;
test('المتابعة مهمة حقيقية في نظام المهام: عمل داخلي، باسم المورد والإشارة، مسنَدة لصاحبها بموعدها — ولا تتكرر', async () => {
  const d = await analysis.caseDetail(await sess('u_dm'), 'e_a', P);
  assert.equal(d.signal.key, 'high_alloc_low_load');
  assert.equal(d.followup, null);
  assert.ok(d.evidence.length >= 5 && d.evidence.every((e) => e.title_ar && e.value_ar && e.source?.label_ar));
  assert.ok(d.evidence.some((e) => e.title_ar === 'التغطية المالية' && e.value_ar.includes('غير متاحة')));
  assert.ok(d.questions_ar.length >= 2);
  const tasksBefore = await count('task');
  const f = await analysis.createFollowup(await ctxOf('u_dm'), 'e_a', { ...P, action_ar: 'راجع التسكين', ownerUserId: 'u_dm', dueDate: `${YEAR}-10-15`, note: 'المهام غير مسجلة بنسبها' });
  caseId = f.id; taskId = f.task.id;
  assert.equal(f.existing, false); assert.equal(f.status, 'open');
  assert.equal(await count('task'), tasksBefore + 1, 'لم تُكتب مهمة حقيقية');
  const t = await db.get('SELECT * FROM task WHERE id = ?', [taskId]);
  assert.equal(t.work_kind, 'internal'); assert.equal(t.project_id, null); assert.equal(t.approval_state, null);
  assert.equal(t.assignee_user_id, 'u_dm'); assert.equal(t.due_date, `${YEAR}-10-15`);
  assert.ok(t.title.includes('أحمد العلي') && t.title.includes('تسكين يحتاج مراجعة') && t.title.startsWith('راجع التسكين'), t.title);
  assert.ok(t.description.includes('المهام غير مسجلة بنسبها'));
  const c = await db.get('SELECT * FROM analysis_case WHERE id = ?', [caseId]);
  assert.equal(c.employee_id, 'e_a'); assert.equal(c.year, YEAR); assert.equal(c.month, MONTH); assert.equal(c.signal, 'high_alloc_low_load');
  assert.equal(c.task_id, taskId); assert.equal(c.owner_user_id, 'u_dm'); assert.equal(c.created_by, 'u_dm');
  assert.equal(JSON.parse(c.evidence_json).confirmedPct, 100);
  // النداء المكرر يعيد الحالة القائمة ولا يكتب مهمة ثانية
  const again = await analysis.createFollowup(await ctxOf('u_dm'), 'e_a', { ...P, action_ar: 'راجع التسكين مرة أخرى', ownerUserId: 'u_dm' });
  assert.equal(again.id, caseId); assert.equal(again.existing, true); assert.equal(again.task.id, taskId);
  assert.equal(await count('task'), tasksBefore + 1, 'التكرار كتب مهمة ثانية');
  assert.equal(await count('analysis_case', 'employee_id = ?', ['e_a']), 1);
  // والأثر: إنشاء الحالة وإنشاء المهمة كلاهما مكتوب بفاعله
  const ac = await db.get("SELECT user_id, action FROM audit_log WHERE resource = 'analysis_case' AND resource_id = ?", [caseId]);
  assert.deepEqual([ac.user_id, ac.action], ['u_dm', 'create']);
  const at = await db.get("SELECT user_id FROM audit_log WHERE resource = 'task' AND resource_id = ?", [taskId]);
  assert.equal(at.user_id, 'u_dm');
  // وتظهر في الجدول وفي فحص الحالة
  const r = await analysis.utilizationTable(await sess('u_dm'), P);
  assert.equal(rowOf(r, 'e_a').hasCase, true); assert.equal(rowOf(r, 'e_a').caseId, caseId);
  const d2 = await analysis.caseDetail(await sess('u_dm'), 'e_a', P);
  assert.equal(d2.followup.id, caseId); assert.equal(d2.followup.task.id, taskId); assert.equal(d2.followup.task.status_ar, 'قيد الانتظار');
});

test('من لا يملك إسناد المهمة لا يفتح حالة — حارس المهام نفسه، ولا صفّ حالةٍ يبقى بعد الرفض', async () => {
  const before = await count('analysis_case');
  // الاستشاري لا يقرأ زميله أصلاً
  await assert.rejects(async () => analysis.createFollowup(await ctxOf('u_a'), 'e_b', { ...P, ownerUserId: 'u_a' }), /خارج نطاقك/);
  // ومدير الإدارة لا يُسنِد إلى حسابٍ لا وجود له — والمعاملة تتراجع كاملة
  await assert.rejects(async () => analysis.createFollowup(await ctxOf('u_dm'), 'e_b', { ...P, ownerUserId: 'u_ghost' }), /غير موجود/);
  assert.equal(await count('analysis_case'), before, 'بقيت حالة بلا مهمة');
});

test('إغلاق الحالة بتفسير يسجّل الفاعل، ويُقرأ الفاعل من فحص الحالة — ولا إغلاق بلا تفسير أو من غريب', async () => {
  await assert.rejects(async () => analysis.closeCase(await ctxOf('u_dm'), caseId, { explanation: '' }), /اكتب تفسير الإغلاق/);
  await assert.rejects(async () => analysis.closeCase(await ctxOf('u_a'), caseId, { explanation: 'تبيّن' }), /خارج نطاقك|لصاحب المتابعة/);
  await assert.rejects(async () => analysis.closeCase(await ctxOf('u_dm'), 'acase_none', { explanation: 'تبيّن' }), /غير موجودة/);
  const closed = await analysis.closeCase(await ctxOf('u_dm'), caseId, { explanation: 'المهام سُجّلت بنسبها وتبيّن أن التسكين صحيح' });
  assert.equal(closed.status, 'closed'); assert.equal(closed.status_ar, 'مغلقة');
  assert.equal(closed.note, 'المهام سُجّلت بنسبها وتبيّن أن التسكين صحيح');
  assert.equal(closed.closedBy, 'u_dm'); assert.ok(closed.closedAt);
  const a = await db.get("SELECT user_id, detail_json FROM audit_log WHERE resource = 'analysis_case' AND resource_id = ? AND action = 'close'", [caseId]);
  assert.equal(a.user_id, 'u_dm');
  assert.equal(JSON.parse(a.detail_json).closed_by, 'u_dm');
  const d = await analysis.caseDetail(await sess('u_dm'), 'e_a', P);
  assert.equal(d.followup.status, 'closed'); assert.equal(d.followup.closedBy, 'u_dm'); assert.equal(d.followup.closedByName, 'حساب u_dm');
  await assert.rejects(async () => analysis.closeCase(await ctxOf('u_dm'), caseId, { explanation: 'مرة أخرى' }), /مغلقة فعلاً/);
  // المهمة تبقى لصاحبها — الإغلاق لا يُنجزها عنه
  assert.equal((await db.get('SELECT status FROM task WHERE id = ?', [taskId])).status, 'TODO');
  // وإن تجدّدت الإشارة تُفتح الحالة نفسها من جديد بمهمةٍ جديدة — لا صفٌّ ثانٍ بالمفتاح نفسه
  const re = await analysis.createFollowup(await ctxOf('u_dm'), 'e_a', { ...P, action_ar: 'راجع مجدداً', ownerUserId: 'u_dm' });
  assert.equal(re.id, caseId); assert.equal(re.reopened, true); assert.equal(re.status, 'open'); assert.notEqual(re.task.id, taskId);
  assert.equal(await count('analysis_case', 'employee_id = ?', ['e_a']), 1);
});

// ── S12: العمل والالتزامات ───────────────────────────────────────────────────
test('T23: المهمة تُعدّ مرةً واحدة — في صفّ عملها بحسب العمل وفي صفّ مسؤولها بحسب المورد؛ بلا شخصية ولا معلَّقة', async () => {
  const today = `${YEAR}-10-10`;
  // مهام المتابعة التي أنشأتها الاختبارات السابقة مهامٌّ حقيقية لمدير الإدارة (عمل داخلي) — فتظهر هنا بحقّ
  const followupIds = (await db.all("SELECT id FROM task WHERE work_kind = 'internal' AND assignee_user_id = 'u_dm' AND deleted_at IS NULL ORDER BY id")).map((r) => r.id);
  assert.equal(followupIds.length, 2, 'مهمتا المتابعة (الأولى والمعاد فتحها) غير موجودتين');
  const EXPECTED_TASKS = 8 + followupIds.length;
  const w = await commitments.teamCommitments(await sess('u_dm'), { ...P, by: 'work', todayDate: today });
  const all = w.rows.flatMap((r) => r.tasks.map((t) => t.id));
  assert.equal(all.length, new Set(all).size, 'مهمة عُدّت مرتين');
  assert.ok(!all.includes('t_a_personal') && !all.includes('t_a_pending') && !all.includes('t_a_done'), 'الشخصية أو المعلَّقة أو المنجزة ظهرت');
  const p1 = w.rows.find((r) => r.work.kind === 'project' && r.work.id === 'P1');
  assert.equal(p1.work.status_ar, 'قيد التنفيذ');
  assert.deepEqual(p1.tasks.map((t) => t.id).sort(), ['t_a1', 't_b1', 't_b2', 't_c1', 't_c2', 't_d1', 't_d2'].sort());
  assert.equal(p1.confirmedPct, 100 + 30 + 40 + 80 + 50 + 50, 'مجموع نسب المسكَّنين على P1 في نطاق المدير');
  assert.ok(p1.team.some((m) => m.employeeId === 'e_a' && m.pct === 100));
  assert.ok(!p1.team.some((m) => m.employeeId === 'e_h'), 'موظف إدارةٍ أخرى ظهر في فريق العمل');
  assert.deepEqual(p1.blockers.map((b) => [b.id, b.blocked_reason]), [['t_b2', 'بانتظار صلاحية الوصول']]);
  assert.deepEqual([p1.nextCommitment.kind, p1.nextCommitment.id, p1.nextCommitment.due, p1.nextCommitment.late], ['task', 't_b2', `${YEAR}-10-12`, false]);
  assert.equal(p1.lateCount, 2, 't_b1 وt_d2 متأخرتان عن 10 أكتوبر');
  const bd = w.rows.find((r) => r.work.kind === 'bucket' && r.work.id === 'bd');
  assert.equal(bd.work.label, 'تطوير أعمال'); assert.equal(bd.confirmedPct, 60); assert.equal(bd.tasks.length, 0);
  const internal = w.rows.find((r) => r.work.kind === 'internal');
  assert.deepEqual(internal.tasks.map((t) => t.id).sort(), ['t_b3', ...followupIds].sort());
  assert.equal(w.counts.tasks, EXPECTED_TASKS); assert.equal(w.counts.blocked, 1);
  for (const r of w.rows) for (const k of Object.keys(r.work)) assert.ok(!/halalas|budget|value/i.test(k));

  const byRes = await commitments.teamCommitments(await sess('u_dm'), { ...P, by: 'resource', todayDate: today });
  const all2 = byRes.rows.flatMap((r) => r.tasks.map((t) => t.id));
  assert.equal(all2.length, new Set(all2).size);
  assert.equal(all2.length, EXPECTED_TASKS);
  const dmRow = byRes.rows.find((r) => r.resource.employeeId === 'e_dm');
  assert.deepEqual(dmRow.tasks.map((t) => t.id).sort(), followupIds, 'مهام المتابعة في صفّ مديرها بحسب المورد');
  const b = byRes.rows.find((r) => r.resource.employeeId === 'e_b');
  assert.deepEqual(b.tasks.map((t) => t.id).sort(), ['t_b1', 't_b2', 't_b3']);
  assert.equal(b.confirmedPct, 30); assert.equal(b.blockers.length, 1);
  assert.deepEqual(b.works.map((x) => [x.kind, x.id, x.pct]), [['project', 'P1', 30]]);
  const a = byRes.rows.find((r) => r.resource.employeeId === 'e_a');
  assert.deepEqual([a.nextCommitment.kind, a.nextCommitment.id], ['milestone', 'MS1'], 'المعلم المستحق 20 أكتوبر أقرب من مهمة 25 أكتوبر');
  const e = byRes.rows.find((r) => r.resource.employeeId === 'e_e');
  assert.equal(e.hasAccount, false); assert.equal(e.tasks.length, 0); assert.equal(e.confirmedPct, 50);
  const g = byRes.rows.find((r) => r.resource.employeeId === 'e_g');
  assert.equal(g.engagement, 'out'); assert.equal(g.confirmedPct, null);
  await assert.rejects(async () => commitments.teamCommitments(await sess('u_a'), P), /صلاحية عرض الفريق/);
  await assert.rejects(async () => commitments.teamCommitments(await sess('u_dm'), { ...P, by: 'sideways' }), /وجه العرض/);
});
