// ثلاثة عيوب كانت **مثبَّتة** في حزمة السيناريوهات، وعولجت قبل التفعيل لكل الموظفين.
// تثبيتها كان يقول «هذا خطأ نعرفه ولم نُصلحه»؛ وهذا الملف يقول «أُصلح، وهذه حدوده».
//
//   [SCN-D4] سنة التسكين من ساعة الخادم — فخطة السنة القادمة تُكتب على العام الجاري صامتةً.
//   [SCN-D5] سقف خطوة الاعتماد مخزَّن ولا يُطبَّق — فحوكمة تُبطئ الصغير ولا تُميّز الكبير.
//   [SCN-D8] فرصة مكسوبة تُعاد للترشيح بلا قيد — والمبيعات المعلنة تتغيّر بها بلا أثر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-activation-defects.db');
process.env.SANAD_DB = TEST_DB;

let db, P, W, O;
const T = '2026-01-01T00:00:00Z';
const U = (id, role, sector, scope, extra = {}) => ({ id, username: id, name_ar: 'مستخدم ' + id,
  role_id: role, sector_id: sector, scope, projectIds: new Set(extra.projectIds || []),
  teamIds: new Set(), employee_id: extra.employee_id || null, department_id: null });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const admin = U('u_admin', 'admin', null, 'company');
const bd = U('u_bd', 'bd_manager', 'S1', 'sector');

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  P = await import('../../src/modules/pmo/projects.js');
  W = await import('../../src/modules/workflow/engine.js');
  O = await import('../../src/modules/crm/opportunities.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع التجربة', active: 1, created_at: T });
  // الحسابان يُكتبان في القاعدة لا في الذاكرة وحدها: الفوز صار يُولّد مشروعاً يُسجَّل مالكه،
  // ومالكٌ لا وجود له يُسقط الكتابة على قيد المفتاح الأجنبي — وهو قيدٌ صحيح لا يُلتفّ عليه.
  for (const u of [admin, bd]) {
    await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  for (const [sid, n, w, won, lost] of [['LEAD', 'رصد', 10, 0, 0], ['WON', 'فوز', 100, 1, 0], ['LOST', 'خسارة', 0, 0, 1]])
    await db.insert('stage', { id: sid, name_ar: n, default_win_pct: w, sort_order: 1, is_won: won, is_lost: lost });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع', sector_id: 'S1', status: 'ACTIVE', created_at: T });
  await db.insert('employee', { id: 'E1', name_ar: 'موظف', sector_id: 'S1', active: 1, created_at: T });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

// ── [SCN-D4] سنة التسكين ────────────────────────────────────────────────────
test('سنة التسكين تُقبل من الطلب — خطة السنة القادمة صارت ممكنة', async () => {
  const y = new Date().getUTCFullYear();
  await P.assignEmployee(ctx(admin), 'P1', { employeeId: 'E1', pct: 50, fromMonth: 1, toMonth: 6, year: y + 1 });
  const row = await db.get('SELECT year FROM allocation WHERE project_id=? AND employee_id=? AND deleted_at IS NULL', ['P1', 'E1']);
  assert.equal(Number(row.year), y + 1, 'كانت تُكتب سنة الخادم دائماً — فلا خطة لسنة قادمة');
});

test('التكرار يُقاس داخل السنة — نفس الشخص على نفس المشروع في سنتين ليس تكراراً', async () => {
  const y = new Date().getUTCFullYear();
  await P.assignEmployee(ctx(admin), 'P1', { employeeId: 'E1', pct: 30, fromMonth: 1, toMonth: 3, year: y });
  const rows = await db.all('SELECT year FROM allocation WHERE project_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY year', ['P1', 'E1']);
  assert.equal(rows.length, 2, 'سنتان مختلفتان ⟵ تسكينان');
  await assert.rejects(
    () => P.assignEmployee(ctx(admin), 'P1', { employeeId: 'E1', pct: 10, year: y }),
    /على هذا المشروع في سنة/, 'والتكرار داخل السنة نفسها ما زال مرفوضاً');
});

test('سنة خارج المدى تُرَدّ برسالة تقول المدى — لا تُكتب ولا تُصحَّح بالتخمين', () => {
  const y = new Date().getUTCFullYear();
  assert.equal(P.resolveAllocationYear(null), y, 'الغياب ⟵ السنة الجارية');
  assert.equal(P.resolveAllocationYear(String(y + 2)), y + 2, 'نصّاً كان أو رقماً');
  assert.throws(() => P.resolveAllocationYear(y + 9), /خارج المدى المسموح/);
  assert.throws(() => P.resolveAllocationYear(y - 5), /خارج المدى المسموح/);
  assert.throws(() => P.resolveAllocationYear('العام القادم'), /سنة صحيحة/);
});

// ── [SCN-D5] سقف خطوة الاعتماد ──────────────────────────────────────────────
test('الخطوة ذات السقف لا تسري إلا فوق سقفها — والخطوة بلا سقف تسري دائماً', async () => {
  await db.insert('workflow_definition', { id: 'WF1', key: 'exp', name_ar: 'اعتماد المصروف',
    target_resource: 'expense', active: 1, created_at: T });
  await db.insert('approval_step', { id: 'ST1', workflow_id: 'WF1', step_order: 1,
    name_ar: 'مدير الإدارة', approver_role: 'department_manager', min_amount_halalas: 0 });
  await db.insert('approval_step', { id: 'ST2', workflow_id: 'WF1', step_order: 2,
    name_ar: 'المالية فوق ١٠٬٠٠٠ ريال', approver_role: 'ceo_office', min_amount_halalas: 1000000 });

  const small = await W.nextApplicableStep('WF1', 2, 500000);       // ٥٬٠٠٠ ريال
  assert.equal(small, null, 'مبلغ دون السقف لا يبلغ خطوة المالية — كان يقف عندها دائماً');
  const big = await W.nextApplicableStep('WF1', 2, 5000000);         // ٥٠٬٠٠٠ ريال
  assert.equal(big.id, 'ST2', 'وفوق السقف تسري');
  const always = await W.nextApplicableStep('WF1', 1, 1);
  assert.equal(always.id, 'ST1', 'والخطوة بلا سقف تسري لأي مبلغ');
});

test('الطلب يبدأ عند أول خطوة منطبقة — ويُغلق إن لم تنطبق خطوة أصلاً', async () => {
  await db.insert('workflow_definition', { id: 'WF2', key: 'big', name_ar: 'اعتماد الكبير',
    target_resource: 'expense', active: 1, created_at: T });
  await db.insert('approval_step', { id: 'ST3', workflow_id: 'WF2', step_order: 1,
    name_ar: 'فوق مليون', approver_role: 'ceo_office', min_amount_halalas: 100000000 });
  const none = await W.nextApplicableStep('WF2', 1, 50000);
  assert.equal(none, null, 'مسارٌ كل خطواته فوق المبلغ ⟵ لا خطوة منطبقة، فلا تعليق بلا نهاية');
});

// ── [SCN-D8] التراجع عن الفوز ───────────────────────────────────────────────
test('التراجع عن الفوز يستوجب سبباً مكتوباً — ويُسجَّل بقيمته في التدقيق', async () => {
  await db.insert('opportunity', { id: 'OPP1', title_ar: 'فرصة', sector_id: 'S1', stage_id: 'LEAD',
    value_halalas: 250000000, year: 2026, created_at: T });
  await db.update('opportunity', 'OPP1', { stage_id: 'WON' });

  await assert.rejects(() => O.moveStage(ctx(admin), 'OPP1', 'LEAD'), /اكتب سبب التراجع/,
    'كانت تعود بضغطة واحدة والمبيعات المعلنة تتغيّر بلا أثر');
  await assert.rejects(() => O.moveStage(ctx(admin), 'OPP1', 'LEAD', '   '), /اكتب سبب التراجع/,
    'وفراغٌ ليس سبباً');

  await O.moveStage(ctx(admin), 'OPP1', 'LEAD', 'العميل ألغى الترسية');
  const aud = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource='opportunity' AND resource_id='OPP1' AND action='update' ORDER BY at DESC LIMIT 1");
  const d = JSON.parse(aud.detail_json);
  assert.equal(d.won_reversal, true, 'التراجع حدثٌ مميَّز لا تغيير مرحلة عادياً');
  assert.equal(d.value_halalas, 250000000, 'وبقيمته — فالمبيعات تنقص بهذا الرقم');
  assert.equal(d.reason_ar, 'العميل ألغى الترسية');
});

test('التقدّم إلى الفوز لا يستوجب شيئاً — القيد على التراجع وحده', async () => {
  // الفرصة **فرصته هو**: منذ قلب الرؤية (٢٠٢٦-٠٨) لا يحرّك BD إلا فرصه المملوكة — والفحص
  // هنا عن قيد التراجع لا عن النطاق، فيُعطى صفاً يملكه أصلاً.
  await db.insert('opportunity', { id: 'OPP2', title_ar: 'فرصة ٢', sector_id: 'S1', stage_id: 'LEAD',
    value_halalas: 100000, year: 2026, owner_user_id: 'u_bd', created_at: T });
  const r = await O.moveStage(ctx(bd), 'OPP2', 'WON');
  assert.equal(r.stage_id, 'WON', 'الطريق إلى الأمام مفتوح كما كان');
});

test('فرصة أنتجت مشروعاً فيه عمل لا يُتراجَع عن فوزها — ويُدَلّ على المشروع بالاسم', async () => {
  await db.insert('opportunity', { id: 'OPP3', title_ar: 'فرصة ٣', sector_id: 'S1', stage_id: 'LEAD',
    value_halalas: 900000, year: 2026, created_at: T });
  await O.moveStage(ctx(admin), 'OPP3', 'WON');
  // المشروع يُولَد مع الفوز، ويُسمّى باسم فرصته. ثم يبدأ العمل فيه — ومن هنا يصير التراجع
  // مناقضاً لعملٍ قائم لا تصحيحاً لضغطةٍ خاطئة.
  const prj = await db.get('SELECT id, name_ar FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', ['OPP3']);
  assert.ok(prj, 'الفوز يُولّد مشروعاً — «أي فرصة توصل مكسوبة على طول تنعكس مشروعاً»');
  assert.equal(prj.name_ar, 'فرصة ٣', 'باسم فرصته حتى يُعاد تسميته من صفحته');
  await db.insert('deliverable', { id: 'D9', project_id: prj.id, name_ar: 'مخرَج أول', status: 'DRAFT', created_at: T });
  await assert.rejects(() => O.moveStage(ctx(admin), 'OPP3', 'LEAD', 'سبب مكتوب'),
    /مرتبطة بمشروع «فرصة ٣»[\s\S]*لم يُحذف أي سجل/, 'التراجع يناقض عملاً قائماً — والسبب المكتوب لا يكفي هنا');
});

test('حتى المشروع الجديد محفوظ عند محاولة التراجع عن الفوز', async () => {
  await db.insert('opportunity', { id: 'OPP4', title_ar: 'فرصة ٤', sector_id: 'S1', stage_id: 'LEAD',
    value_halalas: 400000, year: 2026, created_at: T });
  await O.moveStage(ctx(admin), 'OPP4', 'WON');
  const seed = await db.get('SELECT id FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', ['OPP4']);
  assert.ok(seed, 'وُلد المشروع مع الفوز');
  await assert.rejects(() => O.moveStage(ctx(admin), 'OPP4', 'LEAD', 'أُغلقت بالخطأ'), /لم يُحذف أي سجل/);
  assert.equal((await db.get('SELECT stage_id FROM opportunity WHERE id = ?', ['OPP4'])).stage_id, 'WON');
  assert.ok(await db.get('SELECT id FROM project WHERE id = ? AND deleted_at IS NULL', [seed.id]));
});
