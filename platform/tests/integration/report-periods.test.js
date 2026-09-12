// تقرير الفترة — العدسات الست، وحُرّاسها، والفرق بين الصفر والغياب، ونسخة الفترة المحفوظة.
//
// الثوابت التي يحرسها هذا الملف (كلها مطالب صريحة من مالك المنتج):
//   ١) **الصفر ليس الغياب.** إدارةٌ لها مهام ولم يُنجَز فيها شيء هذه الفترة تُظهر «0 مقيساً»،
//      وإدارةٌ لا مهمة منسوبة إليها أصلاً تُظهر نصّ غياب لا رقماً. الاختباران متجاوران عمداً.
//   ٢) **لا تقرير يتجاوز صلاحية قارئه.** كل عدسة تُفحص على صفّها هي، لا على وجود منح عام.
//   ٣) **مقياسا الإشغال لا يُخلطان.** «الطاقة» من التسكين الشهري و«الإشغال» من سجل الوقت،
//      قسمان مستقلان ولكلٍّ سطر مصدره — ولا مجموع بينهما.
//   ٤) **النسخة تُكتب فعلاً وتُقرأ.** جدول النسخ قائم منذ أول ترحيلة ولم يُكتب فيه صف قط.
//   ٥) **«القرارات المطلوبة» تحمل هوية سجلّها** لا سطراً مكرراً بلا موضوع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-period-report-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const P = await import('../../src/core/reports/periods.js');
const { buildReport } = await import('../../src/core/reports/engine.js');
const { reportsPage } = await import('../../src/web/views/govern.js');

const T = '2026-01-01T00:00:00Z';
const TODAY = '2026-07-27';          // الاثنين — الأسبوع المكتمل السابق: 19–25 يوليو
const WEEK = { period: 'week', anchor: '2026-07-22', today: TODAY };
const ctx = (user) => ({ user, ip: '127.0.0.1' });
const U = (id, role, sector, scope, extra = {}) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
  projectIds: new Set(extra.projectIds || []), teamIds: new Set(), department_id: extra.department_id || null,
  employee_id: extra.employee_id || null,
});

const admin = U('u_admin', 'admin', null, 'company');
const leadSol = U('u_lead_sol', 'sector_lead', 'SOLUTIONS', 'sector');
const leadCon = U('u_lead_con', 'sector_lead', 'CONSULTING', 'sector');
const deptMgr = U('u_dept', 'department_manager', 'SOLUTIONS', 'sector', { department_id: 'D_SMART' });
const worker = U('u_e1', 'employee', 'SOLUTIONS', 'own', { employee_id: 'E1' });
const otherWorker = U('u_e2', 'employee', 'SOLUTIONS', 'own', { employee_id: 'E2' });
const pmSol = U('u_pm', 'project_manager', 'SOLUTIONS', 'own', { projectIds: ['P1'] });

const section = (report, key) => report.sections.find((s) => s.key === key);
const fig = (sec, label) => sec.figures.find((f) => f.label_ar === label);

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T,
    target_revenue_halalas: 100000000, target_sales_halalas: 200000000 });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  // D_SMART: عمل حقيقي منسوب إليها. D_QUIET: إدارة قائمة بلا إسناد إطلاقاً (حالة الترحيلة 010).
  await insert('department', { id: 'D_SMART', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await insert('department', { id: 'D_QUIET', sector_id: 'SOLUTIONS', name_ar: 'إدارة بلا إسناد', active: 1, created_at: T });
  await insert('department', { id: 'D_CON', sector_id: 'CONSULTING', name_ar: 'مكتب إدارة المشاريع', active: 1, created_at: T });

  await insert('employee', { id: 'E1', name_ar: 'موظف أول', sector_id: 'SOLUTIONS', department_id: 'D_SMART',
    job_title: 'مستشار', active: 1, created_at: T });
  await insert('employee', { id: 'E2', name_ar: 'موظف ثانٍ', sector_id: 'SOLUTIONS', department_id: 'D_SMART',
    job_title: 'محلل', active: 1, created_at: T });
  for (const u of [admin, leadSol, leadCon, deptMgr, worker, otherWorker, pmSol]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, employee_id: u.employee_id || null, active: 1, created_at: T });
  }

  await insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });
  await insert('client', { id: 'C1', name_ar: 'أمانة الرياض', created_at: T });

  await insert('project', { id: 'P1', code: 'P1', name_ar: 'مشروع المدن', sector_id: 'SOLUTIONS',
    department_id: 'D_SMART', client_id: 'C1', owner_user_id: 'u_lead_sol', status: 'IN_PROGRESS',
    rag: 'AMBER', progress_pct: 40, contract_value_halalas: 50000000, created_at: T });
  await insert('project', { id: 'PC1', code: 'PC1', name_ar: 'مشروع استشارات', sector_id: 'CONSULTING',
    owner_user_id: 'u_lead_con', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 10, created_at: T });

  await insert('opportunity', { id: 'O1', code: 'O1', title_ar: 'فرصة المدن الذكية', sector_id: 'SOLUTIONS',
    department_id: 'D_SMART', client_id: 'C1', owner_user_id: 'u_lead_sol', stage_id: 'WON',
    value_halalas: 30000000, win_pct: 100, year: 2026, exclude_from_sales: 0,
    stage_changed_at: '2026-07-22T10:00:00Z', created_at: T });
  await insert('opportunity_stage_history', { id: 'H1', opportunity_id: 'O1', from_stage_id: 'LEAD',
    to_stage_id: 'WON', changed_at: '2026-07-22T10:00:00Z' });

  // فرصتا إدارةٍ أخرى (D_OTHER): الأولى تشارك فيها إدارة المدن الذكية عبر جدول المشاركة —
  // عدسة الفرصة وخياراتها تفتحانها لمدير D_SMART كما تفتحها قائمته؛ والثانية بلا مشاركة تبقى مردودة.
  await insert('department', { id: 'D_OTHER', sector_id: 'SOLUTIONS', name_ar: 'إدارة مجاورة', active: 1, created_at: T });
  await insert('opportunity', { id: 'O_PART', code: 'O2', title_ar: 'فرصة بمشاركة المدن الذكية',
    sector_id: 'SOLUTIONS', department_id: 'D_OTHER', client_id: 'C1', owner_user_id: 'u_lead_sol',
    stage_id: 'LEAD', value_halalas: 20000000, win_pct: 10, year: 2026, stage_changed_at: T, created_at: T });
  await insert('opportunity_department', { opportunity_id: 'O_PART', department_id: 'D_SMART', created_at: T });
  await insert('opportunity', { id: 'O_FOREIGN', code: 'O3', title_ar: 'فرصة الإدارة المجاورة وحدها',
    sector_id: 'SOLUTIONS', department_id: 'D_OTHER', client_id: 'C1', owner_user_id: 'u_lead_sol',
    stage_id: 'LEAD', value_halalas: 15000000, win_pct: 10, year: 2026, stage_changed_at: T, created_at: T });

  // مهمتان منسوبتان إلى D_SMART لكن **لا شيء أُنجز داخل الأسبوع** ⟵ صفر مقيس لا غياب.
  await insert('task', { id: 'T1', project_id: 'P1', sector_id: 'SOLUTIONS', department_id: 'D_SMART',
    title: 'مهمة سابقة منجزة', status: 'DONE', assignee_user_id: 'u_e1',
    completed_at: '2026-06-10T09:00:00Z', created_at: '2026-06-01T09:00:00Z' });
  await insert('task', { id: 'T2', project_id: 'P1', sector_id: 'SOLUTIONS', department_id: 'D_SMART',
    title: 'مهمة معطلة', status: 'BLOCKED', assignee_user_id: 'u_e1', blocked_reason: 'بانتظار رد العميل',
    due_date: '2026-07-21', created_at: '2026-06-02T09:00:00Z' });
  // مهمة القطاع بلا إدارة — تُثبت أن مهام القطاع لا تتسرّب إلى تقارير الإدارات.
  await insert('task', { id: 'T3', project_id: 'P1', sector_id: 'SOLUTIONS', title: 'مهمة أسبوعية منجزة',
    status: 'DONE', assignee_user_id: 'u_e2', completed_at: '2026-07-22T09:00:00Z', created_at: '2026-07-20T09:00:00Z' });

  await insert('deliverable', { id: 'DL1', project_id: 'P1', sector_id: 'SOLUTIONS', name_ar: 'تقرير المرحلة الأولى',
    amount_halalas: 10000000, month: 7, year: 2026, status: 'ACCEPTED',
    delivered_at: '2026-07-21', accepted_at: '2026-07-23', created_at: T });
  await insert('milestone', { id: 'M1', project_id: 'P1', name_ar: 'معلم التسليم', due_date: '2026-07-24', status: 'MET', created_at: T });
  await insert('risk', { id: 'R1', project_id: 'P1', sector_id: 'SOLUTIONS', title: 'تأخر بيانات العميل',
    probability: 'high', impact: 'high', status: 'OPEN', owner_user_id: 'u_e1', created_at: T });

  // تسكين: E1 فوق طاقته في يوليو (130%)، E2 ضمن طاقته (60%).
  await insert('allocation', { id: 'A1', employee_id: 'E1', project_id: 'P1', person_name_ar: 'موظف أول',
    sector_id: 'SOLUTIONS', department_id: 'D_SMART', year: 2026, monthly_json: JSON.stringify({ 7: 1.3, 8: 0.5 }), created_at: T });
  await insert('allocation', { id: 'A2', employee_id: 'E2', project_id: 'P1', person_name_ar: 'موظف ثانٍ',
    sector_id: 'SOLUTIONS', department_id: 'D_SMART', year: 2026, monthly_json: JSON.stringify({ 7: 0.6 }), created_at: T });

  // ساعات داخل الأسبوع: 8 قابلة للفوترة من 12 ⟵ 67%.
  await insert('time_entry', { id: 'TE1', user_id: 'u_e1', project_id: 'P1', entry_date: '2026-07-22',
    hours: 8, billable: 1, work_kind: 'project', created_at: T });
  await insert('time_entry', { id: 'TE2', user_id: 'u_e1', project_id: 'P1', entry_date: '2026-07-23',
    hours: 4, billable: 0, work_kind: 'internal', created_at: T });
  await insert('revenue_line', { id: 'RL1', project_id: 'P1', sector_id: 'SOLUTIONS',
    amount_halalas: 25000000, month: 7, year: 2026, created_at: T });

  await insert('workflow_definition', { id: 'WF1', key: 'opportunity_go_nogo', name_ar: 'قرار المضي في الفرصة',
    target_resource: 'opportunity', created_at: T });
  await insert('approval_request', { id: 'AR1', workflow_id: 'WF1', resource: 'opportunity', resource_id: 'O1',
    requested_by: 'u_e1', amount_halalas: 30000000, sector_id: 'SOLUTIONS', current_step: 1,
    status: 'PENDING', created_at: '2026-07-10T09:00:00Z' });
});

after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── (١) الصفر ليس الغياب ─────────────────────────────────────────────────────

test('إدارة لها مهام ولم تُنجز شيئاً في الفترة: صفر **مقيس** لا غياب', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'department', targetId: 'D_SMART' });
  const tasks = section(r, 'tasks');
  assert.equal(tasks.state, 'data', 'الإدارة لها مهام منسوبة ⟵ القسم مقيس');
  assert.equal(fig(tasks, 'أُنجزت في الفترة').display, '0', 'صفر مقيس يُعرض رقماً');
  assert.equal(fig(tasks, 'أُنجزت في الفترة').absence_ar, undefined);
  assert.equal(fig(tasks, 'مُعطَّلة الآن').display, '1');
});

test('إدارة بلا أي إسناد: غياب منصوص عليه بالعربية — لا صفر واحد في القسم', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'department', targetId: 'D_QUIET' });
  const tasks = section(r, 'tasks');
  assert.equal(tasks.state, 'absent');
  assert.equal(tasks.absence_ar, 'لا مهام منسوبة إلى هذه الإدارة بعد');
  assert.ok(/لم يُنسب بعد/.test(tasks.hint_ar), 'يشرح أن الفراغ إسنادٌ ناقص لا انعدام عمل');
  assert.equal(tasks.figures.length, 0, 'قسم الغياب لا يعرض أرقاماً إطلاقاً');
  // ولا يتسرّب رقم من القطاع إلى الإدارة الصامتة
  for (const key of ['progress', 'capacity', 'utilization']) {
    assert.equal(section(r, key).state, 'absent', `القسم ${key} يجب أن يكون غياباً لا صفراً`);
  }
});

test('الغياب والصفر يُميَّزان داخل القسم الواحد أيضاً (رقم مقابل نصّ غياب)', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'project', targetId: 'P1' });
  const c = section(r, 'contributions');
  const deals = fig(c, 'صفقات فائزة في الفترة');
  assert.equal(deals.display, null, 'المشروع لا يُقاس بالفرص ⟵ غياب لا صفر');
  assert.ok(/الفرصة لا على المشروع/.test(deals.absence_ar));
  assert.equal(fig(c, 'مخرجات مقبولة في الفترة').display, '1', 'المخرجات مقيسة على المشروع');
});

test('الإشغال بلا ساعات داخل الفترة غيابٌ لا صفر (النسبة على قاعدة فارغة لا معنى لها)', async () => {
  const r = await P.buildPeriodReport(admin, { period: 'week', anchor: '2026-06-10', today: TODAY,
    lens: 'person', targetId: 'u_e1' });
  const util = section(r, 'utilization');
  assert.equal(util.state, 'absent');
  assert.equal(util.absence_ar, 'لا ساعات مسجّلة خلال هذه الفترة');
});

test('الإيراد المعترف به لا يُقسَّم على أسبوع — يُقال ذلك نصاً، ويظهر رقماً في الشهر', async () => {
  const w = await P.buildPeriodReport(admin, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  const wf = fig(section(w, 'contributions'), 'إيراد معترف به في الفترة');
  assert.equal(wf.display, null);
  assert.ok(/شهرياً/.test(wf.absence_ar));
  const m = await P.buildPeriodReport(admin, { period: 'month', anchor: '2026-07-15', today: TODAY,
    lens: 'sector', targetId: 'SOLUTIONS' });
  // الإيراد المعترف به صافٍ بعد فصل الضريبة (ترحيلة ٠١٩): ٢٥٠٬٠٠٠ ر.س. إجمالاً ⟵ ٢١٧٬٣٩١ صافياً.
  assert.ok(fig(section(m, 'contributions'), 'إيراد معترف به في الفترة').display.includes('217,391'));
});

test('بند إيراد بلا شهر مسجَّل يُقال صراحةً بدل أن يُسقَط صامتاً', async () => {
  await insert('revenue_line', { id: 'RL_NOM', project_id: 'P1', sector_id: 'SOLUTIONS',
    amount_halalas: 9000000, month: null, year: 2026, created_at: T });
  const r = await P.buildPeriodReport(admin, { period: 'month', anchor: '2026-07-15', today: TODAY,
    lens: 'sector', targetId: 'SOLUTIONS' });
  const c = section(r, 'contributions');
  assert.ok(/بلا شهر مسجَّل/.test(c.note_ar), 'مجموع الفترات لا يقلّ عن إيراد السنة بلا تفسير');
  assert.ok(fig(c, 'إيراد معترف به في الفترة').display.includes('217,391'), 'ولا يُضاف البند المجهول إلى الفترة');
});

// ── (٢) الحُرّاس: لا تقرير يتجاوز صلاحية قارئه ────────────────────────────────

test('عدسة الشركة مغلقة على من لا يقرأ أداء الشركة', async () => {
  await assert.rejects(() => P.buildPeriodReport(leadSol, { ...WEEK, lens: 'company' }),
    (e) => e.status === 403 && /الشركة كاملة/.test(e.message));
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'company' });
  assert.equal(r.target.name_ar, 'الشركة كاملة');
});

test('عدسة القطاع: قائد قطاع لا يفتح قطاعاً آخر', async () => {
  const mine = await P.buildPeriodReport(leadSol, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  assert.equal(mine.target.id, 'SOLUTIONS');
  await assert.rejects(() => P.buildPeriodReport(leadSol, { ...WEEK, lens: 'sector', targetId: 'CONSULTING' }),
    (e) => e.status === 403 && /نطاقك/.test(e.message));
});

test('عدسة الإدارة: لا عبور بين القطاعات، ومدير الإدارة محصور في إدارته', async () => {
  await assert.rejects(() => P.buildPeriodReport(leadSol, { ...WEEK, lens: 'department', targetId: 'D_CON' }),
    (e) => e.status === 403 && /قطاعاً آخر/.test(e.message));
  const own = await P.buildPeriodReport(deptMgr, { ...WEEK, lens: 'department', targetId: 'D_SMART' });
  assert.equal(own.target.id, 'D_SMART');
  await assert.rejects(() => P.buildPeriodReport(deptMgr, { ...WEEK, lens: 'department', targetId: 'D_QUIET' }),
    (e) => e.status === 403 && /إدارتك أنت/.test(e.message));
});

test('عدسة الشخص: تقريره عن نفسه مفتوح، وعن غيره محروس', async () => {
  const self = await P.buildPeriodReport(worker, { ...WEEK, lens: 'person', targetId: 'u_e1' });
  assert.equal(self.target.id, 'u_e1');
  await assert.rejects(() => P.buildPeriodReport(worker, { ...WEEK, lens: 'person', targetId: 'u_e2' }),
    (e) => e.status === 403 && /نفسك/.test(e.message));
  const byLead = await P.buildPeriodReport(leadSol, { ...WEEK, lens: 'person', targetId: 'u_e1' });
  assert.equal(byLead.target.id, 'u_e1');
});

test('منحٌ بنطاق مشروع لا يفتح تقرير شخص ولا إدارة ولا قطاع (لا اجتياز فارغ)', async () => {
  // صفّ الشخص/الإدارة/القطاع لا يحمل معرّف مشروع، فـ`can(u,…,{sector_id})` تجتازه فارغاً لمن
  // منحُه بنطاق «مشروع». الحارس هنا يبدأ من **اتساع** المنح، فينغلق الباب الثلاثة.
  const pm = pmSol;
  await assert.rejects(() => P.buildPeriodReport(pm, { ...WEEK, lens: 'person', targetId: 'u_e1' }),
    (e) => e.status === 403 && /نفسك/.test(e.message));
  await assert.rejects(() => P.buildPeriodReport(pm, { ...WEEK, lens: 'department', targetId: 'D_SMART' }),
    (e) => e.status === 403 && /تبلغ الإدارة/.test(e.message));
  await assert.rejects(() => P.buildPeriodReport(pm, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' }),
    (e) => e.status === 403 && /تبلغ القطاع/.test(e.message));
  // ويبقى ما يخصّه مفتوحاً: مشروعه وتقريره عن نفسه
  assert.equal((await P.buildPeriodReport(pm, { ...WEEK, lens: 'project', targetId: 'P1' })).target.id, 'P1');
  const opts = await P.lensOptions(pm);
  assert.deepEqual(opts.sectors, []);
  assert.deepEqual(opts.departments, []);
  assert.deepEqual(opts.people.map((p) => p.id), ['u_pm'], 'لا يرى في القائمة إلا نفسه');
  assert.equal(opts.defaultScope, 'project:P1', 'يهبط على تقرير يفتحه فعلاً لا على رسالة منع');
});

test('عدستا المشروع والفرصة تُفحصان على صفّهما لا على وجود منح عام', async () => {
  await assert.rejects(() => P.buildPeriodReport(leadCon, { ...WEEK, lens: 'project', targetId: 'P1' }),
    (e) => e.status === 403);
  await assert.rejects(() => P.buildPeriodReport(leadCon, { ...WEEK, lens: 'opportunity', targetId: 'O1' }),
    (e) => e.status === 403);
  assert.equal((await P.buildPeriodReport(leadSol, { ...WEEK, lens: 'project', targetId: 'P1' })).target.id, 'P1');
});

test('عدسة الفرصة تفتح فرصة الإدارة المشارِكة لمديرها وتعرضها في خياراته — والأجنبية مردودة', async () => {
  // قبل السدّ: صفّ العدسة كان يُحمَّل بلا `partner_department_ids` فيُرَدّ مديرُ الإدارة
  // المشارِكة (403) عن فرصةٍ تعرضها قائمتُه وتفتحها صفحتُها، وخيارات العدسة تُرشَّح بفحص
  // الصفّ العاري فتسقط منها. الباب الآن واحد: loadReadableOpportunity + نطاق القائمة نفسه.
  const r = await P.buildPeriodReport(deptMgr, { ...WEEK, lens: 'opportunity', targetId: 'O_PART' });
  assert.equal(r.target.id, 'O_PART');
  const ids = (await P.lensOptions(deptMgr)).opportunities.map((o) => o.id);
  assert.ok(ids.includes('O_PART'), 'فرصة المشاركة غابت عن خيارات العدسة وهي تُفتح');
  assert.ok(ids.includes('O1'), 'فرصة إدارته المسؤولة في الخيارات كما كانت');
  assert.ok(!ids.includes('O_FOREIGN'), 'فرصة إدارةٍ أخرى بلا مشاركة تسرّبت إلى خياراته');
  await assert.rejects(() => P.buildPeriodReport(deptMgr, { ...WEEK, lens: 'opportunity', targetId: 'O_FOREIGN' }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message), 'المردودة تبقى مردودة بالرسالة العربية نفسها');
  // وقائد القطاع كما كان: الفرص الثلاث كلها في خياراته وعدسته
  const leadIds = (await P.lensOptions(leadSol)).opportunities.map((o) => o.id);
  for (const oid of ['O1', 'O_PART', 'O_FOREIGN']) assert.ok(leadIds.includes(oid), `${oid} غابت عن قائد القطاع`);
});

test('هدف غير موجود أو عدسة مجهولة: رسالة عربية مفهومة لا انهيار', async () => {
  await assert.rejects(() => P.buildPeriodReport(admin, { ...WEEK, lens: 'sector', targetId: 'NOPE' }),
    (e) => e.status === 404 && /اختر قطاعاً/.test(e.message));
  await assert.rejects(() => P.buildPeriodReport(admin, { ...WEEK, lens: 'galaxy', targetId: 'X' }),
    (e) => e.status === 400);
  await assert.rejects(() => P.buildPeriodReport(admin, { ...WEEK, lens: 'sector' }),
    (e) => e.status === 400 && /اختر قطاع/.test(e.message));
});

test('قوائم الاختيار لا تعرض ما لا يفتحه القارئ', async () => {
  const forLead = await P.lensOptions(leadSol);
  assert.equal(forLead.company, false);
  assert.deepEqual(forLead.sectors.map((s) => s.id), ['SOLUTIONS']);
  assert.ok(forLead.departments.every((d) => d.id !== 'D_CON'));
  assert.ok(forLead.projects.every((p) => p.id !== 'PC1'));
  const forDept = await P.lensOptions(deptMgr);
  assert.deepEqual(forDept.departments.map((d) => d.id), ['D_SMART'], 'مدير الإدارة يرى إدارته وحدها');
  assert.equal((await P.lensOptions(admin)).company, true);
});

// ── (٣) مقياسا الإشغال منفصلان ومسمّيان ──────────────────────────────────────

test('الطاقة من التسكين والإشغال من سجل الوقت: قسمان مستقلان بمصدرين معلنين', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  const cap = section(r, 'capacity');
  const util = section(r, 'utilization');
  assert.ok(/التسكين الشهري/.test(cap.basis_ar), 'الطاقة تسمّي مصدرها');
  assert.ok(/سجل الوقت/.test(util.basis_ar), 'الإشغال يسمّي مصدره');
  assert.notEqual(cap.basis_ar, util.basis_ar);
  // القيمتان مختلفتان تماماً ولا يجمعهما رقم ثالث في أي مكان من التقرير
  assert.equal(fig(cap, 'متوسط الحمل المخطَّط').display, '95%');   // (130+60)/2
  assert.equal(fig(util, 'نسبة الإشغال القابل للفوترة').display, '67%'); // 8 من 12
  // اتفاق العدد والمعدود من مصدر المنصة الواحد: 12 ⟵ «ساعة» تمييزاً، و8 ⟵ «ساعات» جمعاً
  assert.equal(fig(util, 'ساعات مسجّلة في الفترة').display, '12 ساعة');
  assert.equal(fig(util, 'منها قابلة للفوترة').display, '8 ساعات');
  assert.ok(!r.sections.some((s) => (s.figures || []).some((f) => /الإشغال الكلي|مجموع الإشغال/.test(f.label_ar))));
});

test('الطاقة للقطاع مطابقة لما تحسبه لوحة القطاع (نفس الدالة لا حساب موازٍ)', async () => {
  const { sectorStaffing } = await import('../../src/core/reports/metrics.js');
  const st = await sectorStaffing('SOLUTIONS', 2026);
  const july = st.employees.map((e) => e.months[6]).sort((a, b) => b - a);
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  const cap = section(r, 'capacity');
  assert.deepEqual(july, [130, 60]);
  assert.equal(fig(cap, 'أشخاص لهم تسكين في الفترة').display, '2');
  assert.equal(fig(cap, 'فوق الطاقة في أحد أشهر الفترة').display, '1');
});

test('التعارض يُقاس على مجموع تسكين الشخص لا على حصّة العدسة وحدها', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'project', targetId: 'P1' });
  const cf = section(r, 'conflicts');
  assert.equal(cf.state, 'data');
  assert.equal(fig(cf, 'أشخاص فوق طاقتهم في الفترة').display, '1');
  assert.ok(/مجموع تسكين الشخص/.test(cf.note_ar));
});

test('تقرير الشخص يحمل تنويه الحوكمة: الإشغال سعة تشغيلية لا تقييم فردي', async () => {
  const r = await P.buildPeriodReport(leadSol, { ...WEEK, lens: 'person', targetId: 'u_e1' });
  assert.ok(/سعة تشغيلية لا تقييم فردي/.test(section(r, 'utilization').note_ar));
});

// ── (٤) النسخة المحفوظة: تُكتب وتُقرأ وتُقارَن ────────────────────────────────

test('إصدار التقرير يكتب صفاً في سجل النسخ ويترك أثراً في سجل التدقيق', async () => {
  const before = (await get('SELECT COUNT(*) n FROM report_snapshot')).n;
  const saved = await P.savePeriodSnapshot(ctx(admin), { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  assert.equal((await get('SELECT COUNT(*) n FROM report_snapshot')).n, before + 1);

  const row = await get('SELECT * FROM report_snapshot WHERE id = ?', [saved.id]);
  assert.equal(row.period_label, 'أسبوع 19–25 يوليو 2026');
  assert.equal(row.scope_ref, 'sector#SOLUTIONS#week#2026-07-19');
  assert.equal(row.created_by, 'u_admin');
  assert.ok(row.html.includes('أسبوع 19–25 يوليو 2026'));
  assert.ok(JSON.parse(row.data_json).sections.length === 8);

  const aud = await get(`SELECT * FROM audit_log WHERE resource = 'report' AND resource_id = ?`, [saved.id]);
  assert.ok(aud, 'كل كتابة لها سطر تدقيق');
  assert.equal(aud.action, 'create');
  assert.equal(aud.user_id, 'u_admin');
  assert.equal(JSON.parse(aud.detail_json).lens, 'sector');
  assert.equal(JSON.parse(aud.detail_json).from, '2026-07-19');
});

test('النسخة تُفتح لاحقاً بمحتواها، وتظهر في قائمة نسخ الجهة نفسها', async () => {
  const saved = await P.savePeriodSnapshot(ctx(admin), { period: 'month', anchor: '2026-07-15', today: TODAY,
    lens: 'sector', targetId: 'SOLUTIONS' });
  const back = await P.readPeriodSnapshot(admin, saved.id);
  assert.equal(back.period_label, 'يوليو 2026');
  assert.ok(back.html.includes('يوليو 2026'));
  assert.equal(back.data.lens, 'sector');
  const list = await P.listPeriodSnapshots(admin, { lens: 'sector', targetId: 'SOLUTIONS' });
  assert.ok(list.some((s) => s.id === saved.id));
  assert.ok(list.every((s) => s.period_label));
  await assert.rejects(() => P.readPeriodSnapshot(admin, 'rsnap_ghost'), (e) => e.status === 404);
});

test('النسخة المحفوظة لا تفتح باباً: صلاحية العدسة تُفحص من جديد عند القراءة', async () => {
  const saved = await P.savePeriodSnapshot(ctx(admin), { ...WEEK, lens: 'company' });
  await assert.rejects(() => P.readPeriodSnapshot(leadSol, saved.id), (e) => e.status === 403);
  const secSnap = await P.savePeriodSnapshot(ctx(admin), { ...WEEK, lens: 'sector', targetId: 'CONSULTING' });
  await assert.rejects(() => P.readPeriodSnapshot(leadSol, secSnap.id), (e) => e.status === 403);
});

test('المقارنة بالفترة السابقة: بلا نسخة محفوظة تقول ذلك صراحةً، ومعها تعرض الفروق', async () => {
  const rQuiet = await P.buildPeriodReport(admin, { ...WEEK, lens: 'department', targetId: 'D_QUIET' });
  const none = await P.comparePreviousSnapshot(admin, rQuiet);
  assert.equal(none.available, false);
  assert.ok(/لا نسخة محفوظة/.test(none.message_ar));
  assert.equal(none.deltas, undefined, 'لا فروق مخترعة عند غياب النسخة');

  // الأسبوع التالي مقابل نسخة الأسبوع المحفوظة سلفاً في اختبار سابق
  const next = await P.buildPeriodReport(admin, { period: 'week', anchor: '2026-07-29', today: TODAY,
    lens: 'sector', targetId: 'SOLUTIONS' });
  const cmp = await P.comparePreviousSnapshot(admin, next);
  assert.equal(cmp.available, true);
  assert.equal(cmp.period_label, 'أسبوع 19–25 يوليو 2026');
  assert.ok(cmp.deltas.some((d) => d.label_ar === 'صفقات فائزة في الفترة' && d.before === '1' && d.after === '0'));
});

// ── (٥) القرارات المطلوبة تحمل هوية سجلّها ───────────────────────────────────

test('«القرارات المطلوبة» تسمّي السجل ومبلغه بدل سطر مكرر بلا موضوع', async () => {
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  const dec = section(r, 'decisions');
  assert.equal(fig(dec, 'طلبات بانتظار قرار').display, '1');
  assert.equal(dec.rows[0].title, 'فرصة: فرصة المدن الذكية');
  assert.ok(/منتظر \d+ يوماً/.test(dec.rows[0].meta));
});

test('الموجز التنفيذي: القرارات لم تعد نصاً واحداً مكرراً', async () => {
  await insert('approval_request', { id: 'AR2', workflow_id: 'WF1', resource: 'project', resource_id: 'P1',
    requested_by: 'u_e1', amount_halalas: 0, sector_id: 'SOLUTIONS', current_step: 1,
    status: 'PENDING', created_at: '2026-07-11T09:00:00Z' });
  const data = await buildReport('weekly_exec_brief', admin, {});
  assert.equal(data.decisions.length, 2);
  assert.equal(new Set(data.decisions).size, 2, 'كل قرار يقول موضوعه — لا تكرار حرفي');
  assert.ok(data.decisions.some((d) => d.includes('فرصة المدن الذكية')));
  assert.ok(data.decisions.some((d) => d.includes('مشروع المدن')));
});

test('القرارات المعلّقة لا تعبر القطاعات في بريد من نافذته قطاع واحد', async () => {
  await insert('approval_request', { id: 'AR3', workflow_id: 'WF1', resource: 'project', resource_id: 'PC1',
    requested_by: 'u_lead_con', amount_halalas: 0, sector_id: 'CONSULTING', current_step: 1,
    status: 'PENDING', created_at: '2026-07-12T09:00:00Z' });
  const r = await P.buildPeriodReport(leadSol, { ...WEEK, lens: 'sector', targetId: 'SOLUTIONS' });
  assert.ok(section(r, 'decisions').rows.every((d) => !d.title.includes('مشروع استشارات')));
});

// ── (٦) الشاشة: التقرير يظهر فوراً وبلا نصوص تقنية ───────────────────────────

test('شاشة التقارير تعرض تقرير الفترة مباشرةً مع بقاء وحدة الجدولة', async () => {
  const html = await reportsPage(admin, {});
  assert.ok(html.includes('تقرير الفترة'));
  assert.ok(html.includes('جدولة تقرير جديد'), 'وحدة الجدولة القائمة لم تُستبدل');
  assert.ok(html.includes('سجل الرسائل الصادرة'));
  assert.ok(/الربع الثالث|يوليو|أسبوع/.test(html), 'اسم الفترة العربي ظاهر');
  for (const bad of ['undefined', 'NaN', '[object Object]', '>null<']) {
    assert.ok(!html.includes(bad), `تسريب نص تقني: ${bad}`);
  }
});

test('الشاشة تلتزم الفترة والجهة المطلوبتين في الرابط', async () => {
  const html = await reportsPage(admin, { period: 'quarter', scope: 'sector:SOLUTIONS' });
  assert.ok(html.includes('الربع الثالث 2026'));
  assert.ok(html.includes('قطاع الحلول'));
  const wk = await reportsPage(admin, { period: 'week', anchor: '2026-07-19', scope: 'department:D_QUIET' });
  assert.ok(wk.includes('لا مهام منسوبة إلى هذه الإدارة بعد'), 'الغياب يصل إلى الشاشة نصاً');
});

test('الشاشة لا تنهار على جهة خارج الصلاحية بل تشرح السبب وتبقي بقية الصفحة', async () => {
  const html = await reportsPage(leadSol, { scope: 'sector:CONSULTING' });
  assert.ok(html.includes('تعذّر عرض هذا التقرير'));
  assert.ok(html.includes('جدولة تقرير جديد'));
});

test('كل قسم في كل عدسة إما رقم مقيس أو نصّ غياب — لا ثالث', async () => {
  const cases = [['company', null], ['sector', 'SOLUTIONS'], ['department', 'D_SMART'], ['department', 'D_QUIET'],
    ['person', 'u_e1'], ['project', 'P1'], ['opportunity', 'O1']];
  for (const [lens, targetId] of cases) {
    for (const kind of ['week', 'month', 'quarter']) {
      const r = await P.buildPeriodReport(admin, { period: kind, anchor: '2026-07-22', today: TODAY, lens, targetId });
      assert.equal(r.sections.length, 8, `${lens}/${kind}: الأقسام الثمانية كاملة`);
      for (const s of r.sections) {
        assert.ok(['data', 'absent'].includes(s.state));
        if (s.state === 'absent') assert.ok(s.absence_ar && s.absence_ar.length > 5, `${lens}/${s.key}: نص غياب مطلوب`);
        else {
          for (const f of s.figures) {
            const ok = f.display != null ? typeof f.display === 'string' : !!f.absence_ar;
            assert.ok(ok, `${lens}/${s.key}/${f.label_ar}: إما قيمة نصية أو سبب غياب`);
            assert.ok(!/undefined|NaN|null/.test(String(f.display ?? '')), `${lens}/${s.key}: قيمة تقنية مسرَّبة`);
          }
        }
      }
      const doc = P.renderPeriodReport(r);
      assert.ok(doc.html.includes(r.period.label_ar));
      assert.ok(!/undefined|NaN/.test(doc.html.replace(/[a-z-]+:\s*undefined/g, '')));
    }
  }
});

test('المستند المطبوع يهرّب النصوص القادمة من البيانات', async () => {
  await insert('task', { id: 'TX', project_id: 'P1', sector_id: 'SOLUTIONS', department_id: 'D_SMART',
    title: '<img src=x onerror=alert(1)>', status: 'BLOCKED', assignee_user_id: 'u_e1',
    blocked_reason: '"><b>خطر</b>', created_at: '2026-06-03T09:00:00Z' });
  const r = await P.buildPeriodReport(admin, { ...WEEK, lens: 'department', targetId: 'D_SMART' });
  const html = P.renderPeriodReport(r).html;
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
  const page = await reportsPage(admin, { scope: 'department:D_SMART' });
  assert.ok(!page.includes('<img src=x'));
});
