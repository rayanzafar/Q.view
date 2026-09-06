// مركز العمل اليومي — الخدمة والصفحة معاً.
// الصفحة السابقة كانت قائمة مسطّحة بلا مرشّح واحد، ولا لوح، ولا تقويم، وبلا أي عرض لنسبة
// التقدم أو العائق أو الخطوة التالية أو الجهة المرتبطة. هذا الملف يثبّت السلوك الجديد كاملاً:
// العدسات الثلاث، المرشّحات، ظهور الحقول الأربعة، صحة نطاق «مهام فريقي»، وحرّاس الخدمة
// الجديدة (إعادة الربط، سبب التعطيل، محو ختم الإنجاز عند إعادة الفتح).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-wc-'));
process.env.SANAD_DB = join(dir, 'wc.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, update, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const T = await import('../../src/modules/pmo/tasks.js');
const { tasksPage } = await import('../../src/web/views/pmo.js');

const TS = '2026-07-01T00:00:00Z';
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (id, role, sector, scope) => ({ id, role_id: role, sector_id: sector, scope, name_ar: 'مستخدم', projectIds: new Set(), teamIds: new Set() });

const lead = U('w_lead', 'sector_lead', 'S1', 'sector');
// المنفّذ دوره «استشاري»: يقرأ مشاريعه بعضويتها ويملك فرصه — وهو الدور الذي تُبنى له هذه الشاشة.
const emp = U('w_emp', 'consultant', 'S1', 'own');
emp.projectIds = new Set(['WP1']);
const other = U('w_other', 'employee', 'S2', 'own');
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

let tOverdue, tToday, tLater, tNoDate;

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'الحلول', active: 1, sort_order: 1, kind: 'delivery', created_at: TS });
  await insert('sector', { id: 'S2', name_ar: 'الاستشارات', active: 1, sort_order: 2, kind: 'delivery', created_at: TS });
  for (const [id, sec, role] of [['w_lead', 'S1', 'sector_lead'], ['w_emp', 'S1', 'consultant'], ['w_other', 'S2', 'employee']]) {
    await insert('app_user', { id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sec, scope: 'own', active: 1, created_at: TS });
  }
  await insert('project', { id: 'WP1', name_ar: 'مشروع الحلول', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', created_at: TS });
  await insert('project', { id: 'WP2', name_ar: 'مشروع قطاع آخر', sector_id: 'S2', status: 'IN_PROGRESS', rag: 'GREEN', created_at: TS });
  await insert('stage', { id: 'LEAD', name_ar: 'مبدئية', default_win_pct: 10, sort_order: 1, color: '#94a3b8', is_won: 0, is_lost: 0 });
  await insert('opportunity', { id: 'WO1', title_ar: 'فرصة الحلول', sector_id: 'S1', owner_user_id: 'w_emp', stage_id: 'LEAD', year: 2026, created_at: TS });

  tOverdue = await T.quickAddTask(ctx(emp), { title: 'مهمة متأخرة عليّ', due_date: day(-3), priority: 'P0', project_id: 'WP1' });
  tToday = await T.quickAddTask(ctx(emp), { title: 'مهمة اليوم', due_date: today, opportunity_id: 'WO1', next_step: 'اتصال بالعميل صباحاً' });
  tLater = await T.quickAddTask(ctx(emp), { title: 'مهمة بعد أسبوعين', due_date: day(14) });
  tNoDate = await T.quickAddTask(ctx(emp), { title: 'مهمة بلا موعد' });
  await T.updateTask(ctx(emp), tOverdue.id, { progress_pct: 40 });
  // مهمة على شخص من قطاع آخر — لا يجوز أن تظهر في لوحة قائد قطاع الحلول
  await T.quickAddTask(ctx(other), { title: 'مهمة قطاع آخر سرية' });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── الخدمة: المرشّحات ────────────────────────────────────────────────────────
test('نافذة اليوم منتهية: المتأخر والمستحق اليوم وما بدأتَه — لا المتراكم كله', async () => {
  const rows = await T.myTasks(emp, { window: 'today', todayDate: today, openOnly: true });
  const titles = rows.map((r) => r.title);
  assert.ok(titles.includes('مهمة متأخرة عليّ'), 'المتأخر داخل اليوم');
  assert.ok(titles.includes('مهمة اليوم'), 'المستحق اليوم داخل اليوم');
  assert.ok(!titles.includes('مهمة بعد أسبوعين'), 'ما استحقاقه بعد أسبوعين خارج اليوم');
  assert.ok(!titles.includes('مهمة بلا موعد'), 'بلا موعد ليست على طاولة اليوم');
});

test('نافذة «متأخرة» و«بلا موعد» و«هذا الأسبوع» كل منها يعزل ما يخصه', async () => {
  const late = await T.myTasks(emp, { window: 'overdue', todayDate: today });
  assert.deepEqual(late.map((r) => r.title), ['مهمة متأخرة عليّ']);
  const none = await T.myTasks(emp, { window: 'nodate', todayDate: today });
  assert.deepEqual(none.map((r) => r.title), ['مهمة بلا موعد']);
  const week = await T.myTasks(emp, { window: 'week', todayDate: today });
  assert.ok(!week.some((r) => r.title === 'مهمة بعد أسبوعين'), 'ما بعد سبعة أيام خارج الأسبوع');
});

test('مرشّحات الجهة والأولوية والبحث والخطوة التالية تعمل داخل الاستعلام', async () => {
  assert.deepEqual((await T.myTasks(emp, { kind: 'project' })).map((r) => r.title), ['مهمة متأخرة عليّ']);
  assert.deepEqual((await T.myTasks(emp, { kind: 'opportunity' })).map((r) => r.title), ['مهمة اليوم']);
  assert.equal((await T.myTasks(emp, { kind: 'internal' })).length, 2, 'العمل الداخلي = بلا مشروع ولا فرصة');
  assert.deepEqual((await T.myTasks(emp, { priority: 'P0' })).map((r) => r.title), ['مهمة متأخرة عليّ']);
  assert.deepEqual((await T.myTasks(emp, { q: 'بلا موعد' })).map((r) => r.title), ['مهمة بلا موعد']);
  const noStep = await T.myTasks(emp, { flag: 'nostep' });
  assert.ok(!noStep.some((r) => r.title === 'مهمة اليوم'), 'ما له خطوة تالية خارج مرشّح «بلا خطوة»');
});

test('سياق المهمة يأتي مع الصف: اسم المشروع واسم الفرصة واسم المسؤول', async () => {
  const rows = await T.myTasks(emp, {});
  const withPrj = rows.find((r) => r.title === 'مهمة متأخرة عليّ');
  const withOpp = rows.find((r) => r.title === 'مهمة اليوم');
  assert.equal(withPrj.project_name, 'مشروع الحلول');
  assert.equal(withOpp.opportunity_name, 'فرصة الحلول');
  assert.equal(withPrj.assignee_name, 'مستخدم w_emp');
});

// ── الخدمة: الحرّاس الجديدة ──────────────────────────────────────────────────
test('إعادة ربط المهمة بمشروعها صارت ممكنة — وكانت مستحيلة بعد الإنشاء', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'مهمة تُعاد ربطها' });
  const linked = await T.updateTask(ctx(emp), t.id, { project_id: 'WP1' });
  assert.equal(linked.project_id, 'WP1');
  assert.equal(linked.work_kind, 'project');
  const moved = await T.updateTask(ctx(emp), t.id, { opportunity_id: 'WO1' });
  assert.equal(moved.opportunity_id, 'WO1');
  assert.equal(moved.project_id, null, 'الجهة واحدة: اختيار فرصة يمسح المشروع');
  const unlinked = await T.updateTask(ctx(emp), t.id, { project_id: null, opportunity_id: null });
  assert.equal(unlinked.project_id, null);
  assert.equal(unlinked.opportunity_id, null);
});

test('الربط بمشروع خارج النطاق مرفوض برسالة عربية — لا تلويث لوحة قطاع آخر', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'محاولة ربط بعيدة' });
  await assert.rejects(() => T.updateTask(ctx(emp), t.id, { project_id: 'WP2' }), (e) => e.code === 'forbidden');
  await assert.rejects(() => T.updateTask(ctx(emp), t.id, { project_id: 'WP_GHOST' }), /غير موجود/);
});

test('«مُعطَّلة» تتطلب سبباً مكتوباً، ويزول السبب بزوال التعطيل', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'مهمة تتعطل' });
  await assert.rejects(() => T.updateTask(ctx(emp), t.id, { status: 'BLOCKED' }), /سبب التعطيل/);
  const blocked = await T.updateTask(ctx(emp), t.id, { status: 'BLOCKED', blocked_reason: 'بانتظار بيانات العميل' });
  assert.equal(blocked.blocked_reason, 'بانتظار بيانات العميل');
  const free = await T.updateTask(ctx(emp), t.id, { status: 'IN_PROGRESS' });
  assert.equal(free.blocked_reason, null, 'زال التعطيل فزال سببه');
});

test('الخطوة التالية تُحفظ وتُمحى بالفراغ', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'مهمة بخطوة', next_step: 'إرسال المسودة' });
  assert.equal(t.next_step, 'إرسال المسودة');
  const cleared = await T.updateTask(ctx(emp), t.id, { next_step: '   ' });
  assert.equal(cleared.next_step, null);
});

test('إعادة فتح مهمة منجَزة تمحو ختم الإنجاز فلا تُحسب في إنجاز اليوم', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'مهمة تُعاد' });
  const done = await T.updateTask(ctx(emp), t.id, { status: 'DONE' });
  assert.ok(done.completed_at);
  const reopened = await T.updateTask(ctx(emp), t.id, { status: 'TODO' });
  assert.equal(reopened.completed_at, null);
});

test('أثر الأيام يعدّ ما أُنجز فعلاً — لا سلاسل ولا نقاط', async () => {
  const t = await T.quickAddTask(ctx(emp), { title: 'مهمة للعدّ' });
  await T.updateTask(ctx(emp), t.id, { status: 'DONE' });
  const trend = await T.completionTrend(emp, { days: 7, today });
  assert.equal(trend.length, 7);
  assert.equal(trend[6].day, today, 'اليوم آخر الشريط');
  assert.ok(trend[6].done >= 1, 'ما أُنجز اليوم يظهر اليوم');
  assert.equal(trend[0].done, 0, 'لا رقم يُخترع ليوم بلا إنجاز');
  await T.updateTask(ctx(emp), t.id, { status: 'TODO' }); // إعادة للحالة كي لا تتأثر بقية الاختبارات
});

test('التحديث الجماعي يقبل الربط الأبوي والخطوة التالية عبر نفس فحص التعديل', async () => {
  const a = await T.quickAddTask(ctx(emp), { title: 'جماعي أ' });
  const b = await T.quickAddTask(ctx(emp), { title: 'جماعي ب' });
  const r = await T.bulkUpdateTasks(ctx(emp), [a.id, b.id], { project_id: 'WP1', next_step: 'مراجعة مشتركة' });
  assert.equal(r.updated, 2);
  assert.equal((await get('SELECT project_id, next_step FROM task WHERE id = ?', [a.id])).project_id, 'WP1');
  assert.equal((await get('SELECT next_step FROM task WHERE id = ?', [b.id])).next_step, 'مراجعة مشتركة');
  // والربط خارج النطاق يفشل لكل صف ولا يمرّ من الباب الجماعي
  const bad = await T.bulkUpdateTasks(ctx(emp), [a.id], { project_id: 'WP2' });
  assert.equal(bad.updated, 0);
  assert.equal(bad.failed.length, 1);
});

// ── الصفحة: العدسات الثلاث والحقول الأربعة والنطاق ───────────────────────────
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

test('العروض الثلاثة تُبنى فعلاً: قائمة ولوح وتقويم', async () => {
  const list = mainOf(await tasksPage(emp, {}));
  assert.ok(list.includes('class="tk-list"'), 'القائمة تعرض صفوف المهام');
  assert.ok(list.includes('خطة اليوم'), 'رأس اليوم موجود');

  const board = mainOf(await tasksPage(emp, { view: 'board' }));
  assert.ok(board.includes('id="tk-board"'), 'اللوح موجود');
  assert.ok(board.includes('data-status="IN_PROGRESS"'), 'أعمدة اللوح حسب الحالة');
  assert.ok(board.includes('draggable="true"'), 'البطاقات قابلة للسحب');

  const cal = mainOf(await tasksPage(emp, { view: 'calendar' }));
  assert.ok(cal.includes('cal-days'), 'شبكة التقويم موجودة');
  assert.ok(cal.includes('الأحد') && cal.includes('السبت'), 'رؤوس أيام الأسبوع عربية كاملة');
  assert.ok(/يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/.test(cal), 'اسم الشهر عربي كامل');
  assert.ok(cal.includes('now-dot'), 'اليوم معلَّم بالنقطة الذهبية الموحدة');
});

test('كل مهمة تعرض المسؤول والحالة والأولوية والاستحقاق والتقدم والعائق والخطوة التالية', async () => {
  await T.updateTask(ctx(emp), tToday.id, { status: 'BLOCKED', blocked_reason: 'بانتظار موافقة العميل' });
  const html = mainOf(await tasksPage(emp, { win: 'all' }));
  assert.ok(html.includes('مهمة متأخرة عليّ'));
  assert.ok(html.includes('40%'), 'نسبة التقدم المخزَّنة تُعرض (لم تكن تُعرض في أي مكان)');
  assert.ok(html.includes('بانتظار موافقة العميل'), 'سبب التعطيل يُعرض');
  assert.ok(html.includes('اتصال بالعميل صباحاً'), 'الخطوة التالية تُعرض');
  assert.ok(html.includes('مشروع الحلول'), 'الجهة المرتبطة (مشروع) تُعرض');
  assert.ok(html.includes('فرصة الحلول'), 'الجهة المرتبطة (فرصة) تُعرض');
  assert.ok(html.includes('data-action="task-status"'), 'الحالة قابلة للتغيير من الصف');
  assert.ok(html.includes('حرجة'), 'الأولوية باسمها لا بلونها فقط');
  assert.ok(html.includes('متأخرة'), 'الاستحقاق بصيغة نسبية مفهومة');
  await T.updateTask(ctx(emp), tToday.id, { status: 'TODO' });
});

test('المرشّحات تعمل من الرابط وتضيّق ما يُعرض فعلاً', async () => {
  const late = mainOf(await tasksPage(emp, { win: 'overdue' }));
  assert.ok(late.includes('مهمة متأخرة عليّ'));
  assert.ok(!late.includes('مهمة بعد أسبوعين'), 'نافذة المتأخر لا تسرّب ما ليس متأخراً');
  const search = mainOf(await tasksPage(emp, { q: 'أسبوعين', win: 'all' }));
  assert.ok(search.includes('مهمة بعد أسبوعين'));
  assert.ok(!search.includes('مهمة متأخرة عليّ'), 'البحث يضيّق النتيجة');
  const nodate = mainOf(await tasksPage(emp, { win: 'nodate' }));
  assert.ok(nodate.includes('مهمة بلا موعد'));
});

test('«مهام فريقي» عدسة أولى للمدير، ومحجوبة عن الموظف، ولا تتجاوز نطاقها', async () => {
  const empHtml = mainOf(await tasksPage(emp, { who: 'team' }));
  assert.ok(!empHtml.includes('الفريق حسب الإدارة'), 'الموظف لا يرى لوحة الفريق أصلاً');

  const leadHtml = mainOf(await tasksPage(lead, { who: 'team', win: 'all' }));
  assert.ok(leadHtml.includes('مهام فريقي'), 'العدسة معروضة للمدير');
  // اللوحة صارت مجمَّعة بالإدارة (المدير يدير إدارةً لا قائمة أفراد)، والخاصية المحروسة هي
  // الإطار نفسه لا عنوانه: ترتيبٌ بالاحتياج، وتصريحٌ بأنها ليست مقارنة بين الأشخاص.
  assert.ok(leadHtml.includes('الفريق حسب الإدارة'), 'اللوحة مجمَّعة بالإدارة');
  assert.ok(leadHtml.includes('لا مقارنة بين الأشخاص'), 'الإطار مساعدة لا مقارنة');
  assert.ok(leadHtml.includes('مهمة متأخرة عليّ'), 'مهام قطاعه ظاهرة');
  assert.ok(!leadHtml.includes('مهمة قطاع آخر سرية'), 'لا تسريب من قطاع آخر إلى لوحة الفريق');
});

test('«الفرص اللي عليّ» تظهر داخل مركز العمل من خدمة الفرص نفسها', async () => {
  const html = mainOf(await tasksPage(emp, {}));
  assert.ok(html.includes('الفرص اللي عليّ'), 'القسم موجود');
  assert.ok(html.includes('فرصة الحلول'), 'فرصة الشخص نفسه معروضة');
  // القسم يعرض فرص صاحب الصفحة وحده — لا فرص من يقرأ نطاقاً أوسع
  const oppsBlockOf = (h) => { const i = h.indexOf('class="card wc-opps"'); return i < 0 ? '' : h.slice(i, h.indexOf('</section>', i)); };
  assert.ok(oppsBlockOf(html).includes('فرصة الحلول'), 'الفرصة داخل قسم «الفرص اللي عليّ» نفسه');
  const leadBlock = oppsBlockOf(mainOf(await tasksPage(lead, {})));
  assert.ok(leadBlock.includes('لا فرص باسمك بعد'), 'قائد القطاع يرى فرصه هو — لا فرص فريقه في هذا القسم');
});

test('التغيير الجماعي له واجهة فعلية — لا خدمة معلَّقة بلا مستدعٍ', async () => {
  const html = mainOf(await tasksPage(emp, { win: 'all' }));
  assert.ok(html.includes('class="tk-sel"'), 'مربّعات تحديد على الصفوف');
  assert.ok(html.includes('data-action="task-bulk"'), 'زر التطبيق الجماعي موجود');
  assert.ok(html.includes('id="tk-bulk"'), 'شريط الإجراءات الجماعية موجود');
});

test('الإضافة السريعة تحمل الجهة والمسؤول والموعد والخطوة — لا ثلاثة حقول', async () => {
  const html = mainOf(await tasksPage(lead, {}));
  assert.ok(html.includes('id="qa-parent"'), 'اختيار الجهة المرتبطة');
  assert.ok(html.includes('id="qa-assignee"'), 'اختيار المسؤول لمن يملك الإسناد');
  assert.ok(html.includes('id="qa-due"'), 'تاريخ الاستحقاق');
  assert.ok(html.includes('id="qa-next"'), 'الخطوة التالية');
  const empHtml = mainOf(await tasksPage(emp, {}));
  assert.ok(!empHtml.includes('id="qa-assignee"'), 'من لا يملك الإسناد لا يُعرض له اختيار المسؤول');
});

test('حالة الفراغ مصمَّمة: يوم مُغلق يقول ما بقي وأين يذهب القارئ', async () => {
  const lonely = U('w_lonely', 'consultant', 'S1', 'own');
  await insert('app_user', { id: 'w_lonely', username: 'w_lonely', name_ar: 'وحيد', role_id: 'consultant', sector_id: 'S1', scope: 'own', active: 1, created_at: TS });
  const html = mainOf(await tasksPage(lonely, {}));
  assert.ok(html.includes('empty-state'), 'حالة فراغ مصمَّمة لا شاشة بيضاء');
  assert.ok(html.includes('لا مهام'), 'نص يشرح الفراغ');
  assert.ok(!/undefined|NaN|\[object/.test(html), 'لا تسريب قيم تقنية في حالة الفراغ');
});

test('لا قيمة تقنية تتسرب إلى أي عرض من العروض', async () => {
  for (const opts of [{}, { view: 'board' }, { view: 'calendar' }, { win: 'all' }, { who: 'team' }]) {
    const html = await tasksPage(lead, opts);
    const main = mainOf(html);
    assert.ok(!/undefined|NaN|\[object/.test(main), 'عرض نظيف: ' + JSON.stringify(opts));
    assert.ok(!/\bTODO\b|\bIN_PROGRESS\b|\bBLOCKED\b/.test(main.replace(/<[^>]*>/g, ' ')), 'لا قيمة مخزَّنة خام في النص المعروض: ' + JSON.stringify(opts));
  }
});

// ── الفصل بين الرؤية والكتابة على لوحة الفريق ────────────────────────────────
// كان الباب كله مشروطاً بمنح **تعديل** المهام، فيُرَدّ «المدير المباشر» ٤٠٣ على الشاشة
// الوحيدة التي وُجد الدور من أجلها — وكل منحه قراءةٌ بنطاق إدارته.
test('المدير المباشر يفتح لوحة فريقه بمنح القراءة — ولا يكتب فيها', async () => {
  await insert('department', { id: 'DEP1', sector_id: 'S1', name_ar: 'إدارة التنفيذ', active: 1, created_at: TS });
  await insert('employee', { id: 'EMPX', name_ar: 'منفّذ', sector_id: 'S1', department_id: 'DEP1', active: 1, created_at: TS });
  await insert('employee', { id: 'EMPM', name_ar: 'مدير مباشر', sector_id: 'S1', department_id: 'DEP1', active: 1, created_at: TS });
  await insert('app_user', { id: 'w_lm', username: 'w_lm', name_ar: 'مدير مباشر', role_id: 'line_manager',
    sector_id: 'S1', scope: 'own', employee_id: 'EMPM', active: 1, created_at: TS });
  await insert('app_user', { id: 'w_member', username: 'w_member', name_ar: 'عضو الإدارة', role_id: 'employee',
    sector_id: 'S1', scope: 'own', employee_id: 'EMPX', active: 1, created_at: TS });
  const member = U('w_member', 'employee', 'S1', 'own');
  await T.quickAddTask(ctx(member), { title: 'مهمة عضو الإدارة', due_date: today });

  const lm = U('w_lm', 'line_manager', 'S1', 'own');
  lm.department_id = 'DEP1';
  const board = await T.teamTasks(lm, {});
  assert.ok(board.length >= 1, 'المدير المباشر يقرأ مهام إدارته — كان يُرَدّ');
  assert.ok(board.flatMap((b) => b.tasks).some((t) => t.title === 'مهمة عضو الإدارة'));

  const access = T.teamTasksAccess(lm);
  assert.equal(access.canRead, true);
  assert.equal(access.canWrite, false, 'الكتابة تبقى على منح التعديل وحده');
  // ولا يكتب فعلياً: الخدمة ترفض تعديل مهمة غيره
  const foreignTask = board.flatMap((b) => b.tasks).find((t) => t.title === 'مهمة عضو الإدارة');
  await assert.rejects(() => T.updateTask(ctx(lm), foreignTask.id, { priority: 'P0' }), (e) => e.code === 'forbidden');
  const bulk = await T.bulkUpdateTasks(ctx(lm), [foreignTask.id], { priority: 'P0' });
  assert.equal(bulk.updated, 0, 'ولا من الباب الجماعي');
});

test('الموظف بنطاق «خاصتي» يبقى ممنوعاً تماماً من لوحة الفريق', async () => {
  await assert.rejects(() => T.teamTasks(other, {}), (e) => e.code === 'forbidden');
  assert.equal(T.teamTasksAccess(other).canRead, false);
  // والاستشاري (قراءته بنطاق «مشروع» وتعديله «خاصتي») يبقى كما كان: ممنوع، بلا توسعة
  assert.equal(T.teamTasksAccess(emp).canRead, false, 'لا توسعة لنطاق المشروع إلى القطاع');
});

test('قارئ إدارته مجهولة يحصل على لوحة فارغة لا لوحة القطاع', async () => {
  const orphan = U('w_orphan', 'line_manager', 'S1', 'own');
  const board = await T.teamTasks(orphan, {});
  assert.deepEqual(board, [], 'المجهول يُستبعد ولا يُدرج — فشل آمن كما كان');
});

test('الصفحة تعرض لوحة الفريق للمدير المباشر بصيغة اطّلاع بلا أدوات كتابة', async () => {
  const lm = U('w_lm', 'line_manager', 'S1', 'own');
  lm.department_id = 'DEP1';
  const html = await tasksPage(lm, { who: 'team', win: 'all' });
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.ok(main.includes('مهام فريقي'), 'العدسة متاحة له');
  assert.ok(main.includes('مهمة عضو الإدارة'), 'ويقرأ مهام إدارته');
  assert.ok(main.includes('عرض للاطّلاع'), 'ويُقال له لماذا لا يستطيع التعديل');
  assert.ok(!main.includes('data-action="task-status"'), 'لا قوائم تغيير حالة');
  assert.ok(!main.includes('id="tk-bulk"'), 'ولا شريط تغيير جماعي');
  assert.ok(!main.includes('class="tk-sel"'), 'ولا مربّعات تحديد');
  assert.ok(!/undefined|NaN|\[object/.test(main));
});

// ── من أين جاءت المهمة (٠٣٠): من أسندها يظهر لمن أُسندت إليه ─────────────────
test('مهمة أسندها غيرك تعرض «أسندها فلان» — ومهمتك بيدك لا تعرضه', async () => {
  await T.quickAddTask(ctx(lead), { title: 'مهمة من القائد', assignee_user_id: 'w_emp' });
  const mine = await T.myTasks(emp, { win: 'all' });
  const assigned = mine.find((r) => r.title === 'مهمة من القائد');
  assert.equal(assigned.creator_name, 'مستخدم w_lead', 'اسم من أسندها لا يصل مع الصف');

  const html = mainOf(await tasksPage(emp, { win: 'all' }));
  assert.ok(html.includes('أسندها مستخدم w_lead'), 'الصف لا يقول من أسند المهمة');
  assert.ok(html.includes('data-creator-name="مستخدم w_lead"'), 'اسم المُسنِد لا يصل إلى المحرِّر');
  assert.ok(!html.includes('أسندها مستخدم w_emp'), 'مهمة كتبها صاحبها لنفسه تعرض «أسندها» بلا معنى');
});

test('لوح المحرِّر يحمل موضع «اعتمدها فلان» — يظهر حين يكون للمهمة معتمِد', async () => {
  const html = await tasksPage(emp, { win: 'all' });
  assert.ok(html.includes('data-f="prov-approver"'), 'لا موضع للمعتمِد في المحرِّر');
  assert.ok(html.includes('اعتمدها'), 'نص «اعتمدها» غائب عن قالب المحرِّر');
  assert.ok(html.includes('data-f="prov-creator"'), 'لا موضع للمُسنِد في المحرِّر');
});

// ── حراسة المدخلات في الخادم لا الشاشة وحدها (KI-044 + KI-047) ────────────────
test('تاريخٌ بغير صيغة القاعدة يُردّ برسالة عربية — لا يُخزَّن فيصنع مهمةً شبحاً', async () => {
  for (const bad of ['2026-8-15', '08/15/2026', 'غداً إن شاء الله', '2026-13-40']) {
    await assert.rejects(() => T.quickAddTask(ctx(emp), { title: 'مهمة بتاريخ معطوب', due_date: bad }),
      /بصيغة غير مقروءة/, `قُبل التاريخ «${bad}»`);
  }
  const ok = await T.quickAddTask(ctx(emp), { title: 'مهمة بتاريخ سليم', due_date: '2026-08-15' });
  assert.equal(ok.due_date, '2026-08-15');
  await assert.rejects(() => T.updateTask(ctx(emp), ok.id, { due_date: '15-08-2026' }), /بصيغة غير مقروءة/);
  const cleared = await T.updateTask(ctx(emp), ok.id, { due_date: '' });
  assert.equal(cleared.due_date, null, 'الفراغ مسحٌ مشروع للموعد لا خطأ');
});

test('وعنوان المهمة مسقوف في الخادم — ألف حرفٍ لا تدخل من الباب المباشر', async () => {
  await assert.rejects(() => T.quickAddTask(ctx(emp), { title: 'م'.repeat(201) }), /أطول من اللازم/);
  const t = await T.quickAddTask(ctx(emp), { title: 'م'.repeat(200) });
  assert.equal(t.title.length, 200);
  await assert.rejects(() => T.updateTask(ctx(emp), t.id, { title: 'م'.repeat(300) }), /أطول من اللازم/);
});

// ── هويّة عناصر التحكّم في الصفّ: الحارس ضدّ انزلاق القيم المستعادة ──────────────
// المتصفّح يحفظ قيم عناصر النماذج ويعيدها بعد إعادة التحميل، وما لا اسم له يُعاد **بموضعه**.
// وصفحة المهام تُعيد تحميل نفسها بعد كل تغيير حالة، والمهمة المنجَزة تنتقل إلى درج «أنجزتها»
// في آخر القائمة — فتنزلق كل قيمةٍ بعدها صفّاً واحداً وتحطّ «منجز» على المهمة التالية وهي في
// نطاقها لم تتغيّر. ومن حاول إنجاز تلك التالية لم يستطع: قائمتها تعرض «منجز» أصلاً فلا يقع
// تغيير، فيضطرّ إلى نقلها إلى حالةٍ أخرى ثم إعادتها. الاسم المشتقّ من معرّف المهمة يمنع ذلك.
test('لكل قائمة حالة ومربّع تحديد اسمٌ مشتقٌّ من معرّف مهمّته — لا يُستعاد على صفّ غيره', async () => {
  const html = await tasksPage(emp, { win: 'all' });
  const sels = [...html.matchAll(/<select[^>]*class="tk-status"[^>]*>/g)].map((m) => m[0]);
  const boxes = [...html.matchAll(/<input[^>]*class="tk-sel"[^>]*>/g)].map((m) => m[0]);
  assert.ok(sels.length >= 3, `الصفحة لم تعرض صفوفاً تكفي للفحص (${sels.length})`);
  assert.equal(sels.length, boxes.length, 'لكل صفٍّ قائمةٌ ومربّع');

  const ids = new Set();
  for (const tag of [...sels, ...boxes]) {
    const id = /\sid="([^"]+)"/.exec(tag)?.[1];
    const nm = /\sname="([^"]+)"/.exec(tag)?.[1];
    assert.ok(id && nm && id === nm, `عنصرٌ بلا هويّة ثابتة: ${tag}`);
    assert.match(tag, /autocomplete="off"/, `عنصرٌ يقبل الاستعادة: ${tag}`);
    assert.ok(!ids.has(id), `هويّة مكرّرة تُبطل الغرض: ${id}`);
    ids.add(id);
  }
  // والهويّة من معرّف المهمة لا من ترتيبها في القائمة
  for (const t of [tOverdue, tToday, tLater, tNoDate]) {
    assert.ok(html.includes(`id="tk-st-${t.id}"`), `لا قائمة حالة باسم المهمة ${t.id}`);
    assert.ok(html.includes(`id="tk-sel-${t.id}"`), `لا مربّع تحديد باسم المهمة ${t.id}`);
  }
});

// ── منتقي الجهة: بحثٌ بالاسم والرمز، والقيمة تبقى حيث يقرؤها الحفظ ─────────────
test('منتقي الجهة قائمةٌ خلفيّة بمعرّفها المعهود، وخياراتها تحمل الرمز للبحث', async () => {
  await update('project', 'WP1', { code: 'SOL-26-09' });
  const html = await tasksPage(emp, { win: 'all' });
  // المعرّف الذي يقرؤه الحفظ في الصفحة وفي صفحة الشخص لم يتغيّر
  assert.match(html, /<select id="qa-parent" name="qa-parent"/, 'تغيّر معرّف منتقي الجهة فانقطع عنه الحفظ');
  assert.match(html, /id="qa-parent-q"[^>]*role="combobox"/, 'لا حقل بحث فوق منتقي الجهة');
  // الترميز `p:`/`o:`/`me` هو ما يفكّه parentPatch — تغييره يكسر الربط بصمت
  assert.ok(html.includes('value="p:WP1"') && html.includes('value="o:WO1"') && html.includes('value="me"'));
  // الرمز مبذول للبحث ومعروضٌ قبل الاسم
  assert.match(html, /data-code="SOL-26-09"/, 'رمز المشروع غير قابل للبحث');
  assert.ok(html.includes('SOL-26-09 — مشروع الحلول'), 'الرمز لا يسبق الاسم في نصّ الخيار');
});

// ── KI-075: المنجَز يُقرأ بتاريخ إنجازه لا بموعدٍ فات ──────────────────────────
// كان `dueLabel` وحده يحكم على كل بطاقة، وهو لا ينظر إلى الحالة إطلاقاً — فالمهمة المنجَزة
// تظهر «متأخرة N يوماً» ورقمها يكبر كل يوم إلى الأبد. ثلاثة أسطح كانت تتناقض على المهمة
// نفسها: القائمة تطبع تاريخاً خاماً، واللوح يطبع تأنيباً، والتقويم وحده يصدق.
test('KI-075: مهمة منجَزة متأخرة الموعد لا تُوسم «متأخرة» — لا في القائمة ولا في اللوح', async () => {
  // موعدها مضى بأيام ثم أُنجزت اليوم: أسوأ حالة — الموعد يقول «متأخرة» والحقيقة أنها انتهت.
  const done = await T.quickAddTask(ctx(emp), { title: 'مهمة أُنجزت بعد موعدها', due_date: day(-9), project_id: 'WP1' });
  await T.updateTask(ctx(emp), done.id, { status: 'DONE' });

  const row = (html) => {
    const i = html.indexOf(`data-task="${done.id}"`);
    assert.ok(i > 0, 'المهمة المنجَزة غائبة عن الصفحة');
    return html.slice(i, i + 900);
  };
  const listCard = row(mainOf(await tasksPage(emp, { win: 'all' })));
  assert.ok(!listCard.includes('متأخرة'), 'القائمة ما زالت تُوسم المنجَز متأخراً');
  assert.ok(listCard.includes('أُنجزت'), 'القائمة لا تقول متى أُنجزت');

  const boardCard = row(mainOf(await tasksPage(emp, { view: 'board', win: 'all' })));
  assert.ok(!boardCard.includes('متأخرة'), 'اللوح ما زال يُوسم المنجَز متأخراً — علّة KI-075 بعينها');
  assert.ok(boardCard.includes('أُنجزت اليوم'), 'اللوح لا يقول «أُنجزت اليوم» للمنجَز اليوم');

  // والمفتوحة المتأخرة تبقى متأخرة — الإصلاح لا يُسكِت التأخير الحقيقي
  const stillLate = mainOf(await tasksPage(emp, { view: 'board', win: 'all' }));
  const openCard = stillLate.slice(stillLate.indexOf(`data-task="${tOverdue.id}"`));
  assert.ok(openCard.slice(0, 900).includes('متأخرة'), 'المهمة المفتوحة المتأخرة فقدت وسمها');
});

// وصفٌّ منجَزٌ بلا ختم إنجاز **لا يُعرض أصلاً** في «مهامي»: نافذة الأربعة عشر يوماً تشترط
// `completed_at IS NOT NULL` (tasks.js:86)، فيسقط الصفّ القديم من القائمة واللوح معاً بلا أثر.
// يُثبَّت هنا بوصفه سلوكاً قائماً — لا مُصلَحاً — كي لا يُقرأ اختفاؤه لاحقاً على أنه علّة الوسم.
// (الحدّ نفسه غير مُعلَن للمستخدم — KI-078.) وفرعُ «أُنجزت بلا تاريخ» في الوسم يبقى حارساً
// لصفحة الشخص، فهي تقرأ مهام الشخص بلا هذه النافذة.
test('KI-075/078: منجَزةٌ بلا ختم إنجاز تسقط من الصفحة كلها — لا تُوسم متأخرة', async () => {
  const t2 = await T.quickAddTask(ctx(emp), { title: 'منجزة بلا ختم', due_date: day(-5), project_id: 'WP1' });
  await T.updateTask(ctx(emp), t2.id, { status: 'DONE' });
  await update('task', t2.id, { completed_at: null });          // صفٌّ قديم كُتب قبل وجود الختم
  for (const view of ['list', 'board']) {
    const html = mainOf(await tasksPage(emp, { view, win: 'all' }));
    assert.ok(!html.includes(`data-task="${t2.id}"`), `صفٌّ بلا ختم ظهر في عرض ${view} خلافاً لشرط النافذة`);
  }
  // والأهم: لم يظهر في أي مكانٍ موسوماً «متأخرة»
  const board = mainOf(await tasksPage(emp, { view: 'board', win: 'all' }));
  assert.ok(!board.includes('منجزة بلا ختم'), 'ظهر عنوانها رغم سقوط صفّها');
});

// ── KI-076: اللوح يحلّ محل الصفحة، لا يُكدَّس تحتها ───────────────────────────
// بلاغ المالك حرفياً: «الكانبان في مهام فريقي… لا يحلّ محلّ ما في الصفحة». السبب أن
// لوح الأشخاص كان مشروطاً بالعدسة وحدها (`who === 'team'`) بلا نظرٍ إلى العرض، فيُرسم
// كاملاً ثم يُلحق به الكانبان تحته. ولم يكن أيُّ اختبارٍ يجمع العدستين مع العرض.
test('KI-076: في عرض اللوح يحلّ شريط الخلاصة محل لوح الأشخاص — ولا يجتمعان', async () => {
  // العلامة هي ترويسة القسم نفسها، لا مجرد العبارة: نصُّ رابط العودة في الشريط يحوي العبارة
  // ذاتها، فالفحص عليها وحدها يُطابق الشريطَ نفسه ويكذب.
  const HEAD = '<span class="tk-sec-title">الفريق حسب الإدارة</span>';
  const list = mainOf(await tasksPage(lead, { who: 'team' }));
  assert.ok(list.includes(HEAD), 'لوح الأشخاص غائب عن عرض القائمة — موضعه الصحيح');

  const board = mainOf(await tasksPage(lead, { who: 'team', view: 'board' }));
  assert.ok(board.includes('id="tk-board"'), 'الكانبان غائب عن عرض اللوح');
  assert.ok(!board.includes(HEAD), 'لوح الأشخاص ما زال مكدَّساً فوق الكانبان — علّة KI-076');
  assert.ok(board.includes('فريقك:'), 'لا شريط خلاصة يُبقي القارئ على اتجاهه');
  assert.match(board, /لوح الفريق حسب الإدارة في عرض القائمة/, 'لا طريق عودة إلى لوح الأشخاص');

  const cal = mainOf(await tasksPage(lead, { who: 'team', view: 'calendar' }));
  assert.ok(!cal.includes(HEAD), 'لوح الأشخاص مكدَّس فوق التقويم أيضاً');
  assert.ok(cal.includes('cal-days'), 'التقويم غائب');
});

test('task dates reject impossible calendar days on create and update without changing the task', async () => {
  for (const invalid of ['2026-02-30', '2025-02-29', '2026-04-31']) {
    await assert.rejects(T.quickAddTask(ctx(emp), { title: 'تاريخ غير صالح', due_date: invalid }), /التاريخ|تاريخ/);
  }
  const valid = await T.quickAddTask(ctx(emp), { title: 'موعد كبيس صالح', due_date: '2028-02-29' });
  assert.equal(valid.due_date, '2028-02-29');
  await assert.rejects(T.updateTask(ctx(emp), valid.id, { due_date: '2026-02-30', title: 'يجب ألا يتغير' }), /التاريخ|تاريخ/);
  await assert.rejects(T.updateTask(ctx(emp), valid.id, { start_date: '2026-04-31' }), /التاريخ|تاريخ/);
  const after = await get('SELECT title, due_date, start_date FROM task WHERE id=?', [valid.id]);
  assert.equal(after.title, valid.title);
  assert.equal(after.due_date, valid.due_date);
  assert.equal(after.start_date, valid.start_date);
});
