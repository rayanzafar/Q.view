// الفرصة الفائزة «تتحول إلى مشروع» — الربط الذي لم يكن له مسار في المنتج كله.
// العيب الحقيقي: `project.source_opp_id` موجود في المخطط ومعروض في ثلاث شاشات، و`createProject`
// يقبله، لكن **لا مستدعي واحد يمرّره**؛ ونافذة «مشروع جديد» تمرّ عبر createFromIntake الذي لم يكن
// يعرف الفرص أصلاً. فكل فرصة تُربح داخل سند تبقى تعرض «لم يُنشأ مشروع بعد» إلى الأبد.
// والقيد الذي يحرسه هذا الملف: الربط **مرجع لا نسخة** — يُورَث العميل بمعرّفه، ولا تُنسخ قيمة
// الفرصة إلى قيمة العقد أبداً (رقمان مختلفان: ما عُرِض وما وُقِّع)، وفرصة واحدة = مشروع واحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-opp-to-project.db');
process.env.SANAD_DB = TEST_DB;

let db, ids, intake;
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (role, sector, scope) => ({ id: 'u_' + role, username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const admin = U('admin', null, 'company');
const lead = U('sector_lead', 'S1', 'sector');
const other = U('bd_manager', 'S2', 'sector');

const OPP_VALUE = 900000000;      // ٩ ملايين ريال بالهللات — ما عُرِض
const CONTRACT_SAR = 7500000;     // ٧٫٥ مليون ريال — ما وُقِّع (رقم مختلف عمداً)
const YEAR = new Date().getUTCFullYear();   // قائمة الفرص مفلترة بالسنة — بلا سنة لا يعود صف

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  ids = await import('../../src/core/util/ids.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  intake = await import('../../src/modules/intake/intake.js');
  const now = ids.nowIso();
  await db.insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  for (const s of ['S1', 'S2']) await db.insert('sector', { id: s, name_ar: 'قطاع ' + s, active: 1, created_at: now });
  for (const u of [admin, lead, other]) await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: now });
  await db.insert('client', { id: 'C1', name_ar: 'وزارة تجريبية', active: 1, created_at: now });
  await db.insert('opportunity', { id: 'O_WON', title_ar: 'منصة تجريبية', client_id: 'C1', sector_id: 'S1',
    owner_user_id: lead.id, stage_id: 'WON', value_halalas: OPP_VALUE, year: YEAR, stage_changed_at: now, created_at: now });
  await db.insert('opportunity', { id: 'O_OTHER', title_ar: 'فرصة قطاع آخر', client_id: 'C1', sector_id: 'S2',
    owner_user_id: other.id, stage_id: 'WON', value_halalas: OPP_VALUE, year: YEAR, stage_changed_at: now, created_at: now });
  await db.insert('opportunity', { id: 'O_WON2', title_ar: 'فرصة ثانية بنفس العميل', client_id: 'C1', sector_id: 'S1',
    owner_user_id: lead.id, stage_id: 'WON', value_halalas: OPP_VALUE, year: YEAR, stage_changed_at: now, created_at: now });
  // فرصة فائزة تبقى بلا مشروع طوال الملف — هي الحالة التي كانت تعرض النص الميت
  await db.insert('opportunity', { id: 'O_NOPRJ', title_ar: 'فرصة فائزة بلا مشروع', client_id: 'C1', sector_id: 'S1',
    owner_user_id: lead.id, stage_id: 'WON', value_halalas: OPP_VALUE, year: YEAR, stage_changed_at: now, created_at: now });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('المشروع المُنشأ من فرصة يحمل رابطها — كان يُنشأ يتيماً فتبقى الفرصة «بلا مشروع» أبداً', async () => {
  const r = await intake.createFromIntake(ctx(lead), {
    name_ar: 'مشروع منصة تجريبية', source_opp_id: 'O_WON', value_sar: CONTRACT_SAR, status: 'IN_PROGRESS',
  });
  const p = await db.get('SELECT * FROM project WHERE id = ?', [r.project_id]);
  assert.equal(p.source_opp_id, 'O_WON', 'الرابط يُكتب على المشروع');
  assert.equal(r.source_opp_id, 'O_WON', 'ويعود في نتيجة الإنشاء');
});

test('العميل يُورَث بمعرّفه — لا عميل ثانٍ بالاسم نفسه تنقسم أرقامه بين سجلّين', async () => {
  const before = (await db.get('SELECT COUNT(*) n FROM client WHERE deleted_at IS NULL')).n;
  const r = await intake.createFromIntake(ctx(lead), {
    name_ar: 'مشروع يرث العميل', source_opp_id: 'O_WON2', value_sar: 1000, status: 'IN_PROGRESS',
  });
  const p = await db.get('SELECT client_id FROM project WHERE id = ?', [r.project_id]);
  assert.equal(p.client_id, 'C1', 'عميل الفرصة نفسه بمعرّفه');
  assert.equal((await db.get('SELECT COUNT(*) n FROM client WHERE deleted_at IS NULL')).n, before, 'لم يُنشأ عميل جديد');
});

test('قيمة الفرصة لا تُنسخ إلى قيمة العقد — رقمان مختلفان لا يُحتسبان مرتين', async () => {
  const p = await db.get('SELECT contract_value_halalas, source_opp_id FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', ['O_WON']);
  assert.equal(p.contract_value_halalas, CONTRACT_SAR * 100, 'قيمة العقد هي المُدخَلة في النموذج');
  assert.notEqual(p.contract_value_halalas, OPP_VALUE, 'وليست قيمة الفرصة');
  const c = await db.get('SELECT value_halalas FROM contract WHERE project_id = ?', [p.source_opp_id ? (await db.get('SELECT id FROM project WHERE source_opp_id = ?', ['O_WON'])).id : null]);
  assert.equal(c.value_halalas, CONTRACT_SAR * 100, 'والعقد يحمل الرقم نفسه لا قيمة الفرصة');
});

test('فرصة واحدة = مشروع واحد — المحاولة الثانية تُرفض برسالة تسمّي المشروع القائم', async () => {
  await assert.rejects(
    async () => intake.createFromIntake(ctx(lead), { name_ar: 'مشروع مكرر', source_opp_id: 'O_WON', value_sar: 1 }),
    (e) => /مشروع بالفعل/.test(e.message) && /مشروع منصة تجريبية/.test(e.message),
  );
});

test('فرصة غير موجودة تُرفض بعربية واضحة — لا رابط إلى العدم', async () => {
  await assert.rejects(
    async () => intake.createFromIntake(ctx(admin), { name_ar: 'مشروع', source_opp_id: 'O_GHOST', value_sar: 1, sector_id: 'S1' }),
    /الفرصة المصدر غير موجودة/,
  );
});

test('فرصة خارج نطاق المستخدم تُرفض — الربط لا يفتح باباً حول الصلاحيات', async () => {
  await assert.rejects(
    async () => intake.createFromIntake(ctx(other), { name_ar: 'مشروع', source_opp_id: 'O_WON', value_sar: 1 }),
    /نطاق/,
  );
});

// ── القاعدة انقلبت بأمر المالك ───────────────────────────────────────────────
// «المفروض أي شيء في المشاريع موجود في الفرص … ولازم تتأكد أي مشروع مضاف في المشاريع ينضاف
// مكسوباً». فالمشروع بلا فرصة لم يعد حالةً مقبولة: كان يبقى خارج شاشة الفرص أبداً، فلا يظهر
// فوزُه في المبيعات ولا في مقارنة القطاعات ولا يعرف أحدٌ أنه رُبح أصلاً.
test('المشروع بلا فرصة مصدر تُولَد له فرصةٌ مكسوبة — «أي شيء في المشاريع موجود في الفرص»', async () => {
  const r = await intake.createFromIntake(ctx(admin), { name_ar: 'مشروع مستقل', client_name: 'جهة أخرى', sector_id: 'S1', value_sar: 5000 });
  const p = await db.get('SELECT source_opp_id, client_id FROM project WHERE id = ?', [r.project_id]);
  assert.ok(p.source_opp_id, 'الرابط يُكتب — ولم يعد المشروع يتيماً في الفرص');
  assert.ok(p.client_id, 'العميل يُنشأ بالاسم كما في المسار القديم');
  const o = await db.get('SELECT * FROM opportunity WHERE id = ?', [p.source_opp_id]);
  assert.equal(o.stage_id, 'WON', 'وتُسجَّل مكسوبة — المشروع القائم فوزٌ وقع فعلاً');
  assert.equal(o.title_ar, 'مشروع مستقل', 'باسم المشروع نفسه');
  assert.equal(o.value_halalas, 5000 * 100, 'وبقيمته — فلا يظهر فوزٌ بصفر في المبيعات');
  assert.equal(o.client_id, p.client_id, 'وبجهته نفسها بمعرّفها لا باسمٍ ثانٍ');
  assert.equal(o.source, 'project', 'ومعلَّمة بمصدرها: مرآةُ مشروعٍ تتبعه، لا سجلَّ عرضٍ قُدِّم لجهة');
});

test('ومرآةُ المشروع تتبعه: تصحيح قيمته يُصحِّح قيمة فرصته — لا رقمان لعملٍ واحد', async () => {
  const projects = await import('../../src/modules/pmo/projects.js');
  const r = await intake.createFromIntake(ctx(admin), { name_ar: 'مشروع يُصحَّح', sector_id: 'S1', value_sar: 1000 });
  const p0 = await db.get('SELECT source_opp_id FROM project WHERE id = ?', [r.project_id]);
  await projects.updateProject(ctx(admin), r.project_id, { contract_value_sar: 4000, name_ar: 'مشروع بعد التصحيح' });
  const o = await db.get('SELECT title_ar, value_halalas FROM opportunity WHERE id = ?', [p0.source_opp_id]);
  assert.equal(o.value_halalas, 4000 * 100, 'القيمة تتبع المشروع');
  assert.equal(o.title_ar, 'مشروع بعد التصحيح', 'والاسم كذلك');
});

test('ولا تُمَسّ الفرصة التي وُلد منها المشروع — قيمتها ما عُرِض لا ما وُقِّع', async () => {
  const projects = await import('../../src/modules/pmo/projects.js');
  const prj = await db.get('SELECT id FROM project WHERE source_opp_id = ? AND deleted_at IS NULL', ['O_WON']);
  await projects.updateProject(ctx(admin), prj.id, { contract_value_sar: 12345 });
  const o = await db.get('SELECT value_halalas FROM opportunity WHERE id = ?', ['O_WON']);
  assert.equal(o.value_halalas, OPP_VALUE, 'سجلّ ما عُرِض على الجهة لا يُكتب فوقه من صفحة المشروع');
});

test('الواجهة تعرض إجراءً لا نصاً ميتاً — والفرصة المرتبطة تعرض مشروعها', async () => {
  // «لا يُعتبر أي جزء مكتملاً لمجرد وجود واجهة» — والعكس أيضاً: لا يُدَّعى أن الواجهة تعمل بلا تصييرها.
  const { opportunitiesPage } = await import('../../src/web/views/crm.js');
  const html = await opportunitiesPage(admin, { view: 'table', stage: 'WON' });
  assert.ok(!html.includes('لم يُنشأ مشروع بعد'), 'النص الميت اختفى لمن يملك إنشاء المشاريع');
  assert.match(html, /data-action="opp-make-project"[\s\S]{0,120}data-opp="O_NOPRJ"/, 'الفرصة بلا مشروع تعرض زر الإنشاء');
  assert.match(html, /مشروع منصة تجريبية/, 'والفرصة المرتبطة تعرض اسم مشروعها');
});

test('من لا يملك إنشاء المشاريع لا يرى الزر — الإجراء يتبع الصلاحية', async () => {
  const { opportunitiesPage } = await import('../../src/web/views/crm.js');
  const viewer = { id: 'u_viewer', username: 'viewer', role_id: 'viewer', sector_id: 'S1', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
  const html = await opportunitiesPage(viewer, { view: 'table', stage: 'WON' });
  assert.ok(!html.includes('data-action="opp-make-project"'), 'لا زر لمن لا يملك الصلاحية');
  assert.match(html, /لم يُنشأ مشروع بعد/, 'ويبقى النص الخبري وحده');
});

test('صفحة الفرصة تجيب أول سؤال يُسأل عن فرصة رُبحت: أوصلت إلى مشروع؟', async () => {
  const { opportunityDetailPage } = await import('../../src/web/views/opportunity-detail.js');
  const linked = await opportunityDetailPage(admin, 'O_WON');
  assert.match(linked, /المشروع الناتج/, 'البطاقة تظهر للفرصة الفائزة');
  assert.match(linked, /مشروع منصة تجريبية/, 'وتعرض اسم المشروع رابطاً');

  const orphan = await opportunityDetailPage(admin, 'O_NOPRJ');
  assert.match(orphan, /data-action="opp-make-project"[\s\S]{0,120}data-opp="O_NOPRJ"/, 'وتعرض زر الإنشاء حين لا مشروع');
});

test('الإنشاء من فرصة يُدقَّق ويحمل مصدره في السجل', async () => {
  const rows = await db.all("SELECT detail_json FROM audit_log WHERE resource = 'project' AND action = 'create'");
  const details = rows.map((r) => String(r.detail_json || ''));
  assert.ok(details.some((d) => d.includes('from-opportunity') && d.includes('O_WON')), 'سجل التدقيق يذكر الفرصة المصدر');
});
