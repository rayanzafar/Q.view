// «صفحتي» تعرض صاحبها ولا تعرض سواه.
//
// هذه هي الخاصية الوحيدة التي تجعل الصفحة بلا بوابة صلاحيات: لا استعلام فيها يتجاوز معرّف
// من يفتحها. فإن تسرّب صفٌّ واحد لغيره صارت شاشةً مفتوحة للجميع تعرض عمل الآخرين — وهو أسوأ
// تسريبٍ ممكن لأن لا أحد يتوقعه من صفحةٍ اسمها «صفحتي».
//
// ويثبّت الملف كذلك ما لا يُرى بالعين: حالة الموعد تُحسب في الخدمة (فتتّحد في كل مكان يعرضها)،
// وموعد المخرج يُشتقّ من شهره آخرَ يومٍ فيه لأنه لا يملك تاريخ يوم، وشبكة التقويم تبدأ الأحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-home-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let home, db;
const T = new Date().toISOString();
const TODAY = '2026-08-12';                 // أربعاء — وسط الأسبوع، بعيدٌ عن حدّي الشهر
const ME = { id: 'u_me', username: 'me', name_ar: 'ريان', role_id: 'employee', scope: 'own', sector_id: 'S1' };
const day = (n) => { const d = new Date(TODAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

before(async () => {
  home = await import('../../src/modules/home/home.js');
  db = await import('../../src/core/db/index.js');
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع', active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: 'جهة', created_at: T });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', is_won: 1, is_lost: 0, sort_order: 9 });

  await db.insert('app_user', { id: 'u_me', username: 'me', role_id: 'employee', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_other', username: 'other', role_id: 'employee', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_me', name_ar: 'ريان', user_id: 'u_me', sector_id: 'S1', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_other', name_ar: 'غيري', user_id: 'u_other', sector_id: 'S1', active: 1, created_at: T });

  await db.insert('project', { id: 'p_mine', name_ar: 'مشروعي', client_id: 'c1', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  await db.insert('project', { id: 'p_theirs', name_ar: 'مشروع غيري', client_id: 'c1', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  const plan = JSON.stringify({ 8: 0.6, 9: 0.4 });
  await db.insert('allocation', { id: 'al_me', employee_id: 'e_me', project_id: 'p_mine', sector_id: 'S1', year: 2026, monthly_json: plan, created_at: T });
  await db.insert('allocation', { id: 'al_them', employee_id: 'e_other', project_id: 'p_theirs', sector_id: 'S1', year: 2026, monthly_json: plan, created_at: T });

  await db.insert('task', { id: 't_late', title: 'متأخرة', project_id: 'p_mine', due_date: day(-4), status: 'TODO', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't_today', title: 'اليوم', project_id: 'p_mine', due_date: TODAY, status: 'TODO', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't_soon', title: 'قريبة', project_id: 'p_mine', due_date: day(5), status: 'TODO', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't_far', title: 'بعيدة', project_id: 'p_mine', due_date: day(40), status: 'TODO', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't_done', title: 'منجزة', project_id: 'p_mine', due_date: day(-1), status: 'DONE', assignee_user_id: 'u_me', created_at: T });
  await db.insert('task', { id: 't_other', title: 'مهمة غيري', project_id: 'p_theirs', due_date: TODAY, status: 'TODO', assignee_user_id: 'u_other', created_at: T });

  await db.insert('milestone', { id: 'ms_mine', name_ar: 'معلمي', project_id: 'p_mine', due_date: day(3), status: 'PLANNED', created_at: T });
  await db.insert('milestone', { id: 'ms_met', name_ar: 'معلم منتهٍ', project_id: 'p_mine', due_date: day(-9), status: 'MET', created_at: T });
  await db.insert('milestone', { id: 'ms_other', name_ar: 'معلم غيري', project_id: 'p_theirs', due_date: day(3), status: 'PLANNED', created_at: T });

  await db.insert('deliverable', { id: 'dv_mine', name_ar: 'مخرجي', project_id: 'p_mine', month: 8, year: 2026, status: 'PENDING', created_at: T });
  await db.insert('deliverable', { id: 'dv_other', name_ar: 'مخرج غيري', project_id: 'p_theirs', month: 8, year: 2026, status: 'PENDING', created_at: T });

  await db.insert('opportunity', { id: 'o_mine', title_ar: 'فرصتي', client_id: 'c1', sector_id: 'S1', stage_id: 'PROPOSAL', owner_user_id: 'u_me', value_halalas: 500000, created_at: T });
  await db.insert('opportunity', { id: 'o_won', title_ar: 'فرصة مكسوبة', client_id: 'c1', sector_id: 'S1', stage_id: 'WON', owner_user_id: 'u_me', value_halalas: 900000, created_at: T });
  await db.insert('opportunity', { id: 'o_other', title_ar: 'فرصة غيري', client_id: 'c1', sector_id: 'S1', stage_id: 'PROPOSAL', owner_user_id: 'u_other', value_halalas: 700000, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ── الخاصية الأولى: لا شيء لغير صاحب الصفحة ──
test('لا يتسرّب صفٌّ واحد لغير صاحب الصفحة — وهي وحدها ما يجعلها بلا بوابة', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  const texts = JSON.stringify([d.tasks, d.opportunities, d.projects, d.milestones, d.deliverables]);
  for (const leak of ['مهمة غيري', 'فرصة غيري', 'مشروع غيري', 'معلم غيري', 'مخرج غيري']) {
    assert.ok(!texts.includes(leak), `تسرّب «${leak}» إلى صفحة شخصٍ آخر`);
  }
  assert.equal(d.employee.id, 'e_me');
});

test('والمنجَز والملغى خارج الطابور — الصفحة عن العمل لا عن أرشيفه', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  assert.ok(!d.tasks.some((t) => t.id === 't_done'), 'مهمة منجزة ما زالت تنتظر');
  assert.ok(!d.milestones.some((m) => m.id === 'ms_met'), 'معلم مُحقَّق ما زال ينتظر');
  assert.ok(!d.opportunities.some((o) => o.id === 'o_won'), 'فرصة مكسوبة ما زالت تُعدّ مفتوحة');
  assert.equal(d.opportunities.length, 1);
});

// ── الخاصية الثانية: حالة الموعد تُحسب مرة واحدة في الخدمة ──
test('حالة الموعد تُحسب في الخدمة لا في الشاشة، فتتّحد أينما عُرضت', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  const by = Object.fromEntries(d.tasks.map((t) => [t.id, t.due_state]));
  assert.equal(by.t_late, 'late');
  assert.equal(by.t_today, 'today');
  assert.equal(by.t_soon, 'soon');
  assert.equal(by.t_far, 'later');
  assert.equal(home.dueState(null, TODAY), 'none');
  assert.equal(home.dueState(day(7), TODAY), 'soon', 'اليوم السابع داخل الأسبوع لا خارجه');
  assert.equal(home.dueState(day(8), TODAY), 'later');
});

// ── الخاصية الثالثة: موعد المخرج مشتقٌّ ومُعلَنٌ أنه تقريبي ──
// المخرج يحمل شهراً وسنة لا تاريخ يوم. فإما أن يُترك بلا موعد — فلا يظهر في تقويم ولا طابور —
// وإما أن يُشتقّ. والاشتقاق صحيحٌ ما دام يُقال للمستخدم صراحةً، وإلا ادّعينا يوماً لم يُتّفق عليه.
test('موعد المخرج يُشتقّ آخرَ يومٍ في شهره، ويُوسم تقريبياً لا يُدَّعى يوماً بعينه', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  const dv = d.deliverables.find((x) => x.id === 'dv_mine');
  assert.equal(dv.due_date, '2026-08-31', 'موعد المخرج ليس آخر يوم في شهره');
  assert.equal(dv.approx, true, 'عُرض موعد المخرج كأنه يومٌ محدَّد');
});

// ── الخاصية الرابعة: الإشغال رقمُ صاحبه وحده ──
test('الإشغال يُجمع من خطط تسكينه هو — لا من تسكين زملائه', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  assert.equal(d.utilization.now, 60, 'نسبة الشهر الجاري لا تطابق خطة تسكينه');
  assert.equal(d.utilization.months[8], 40, 'شهرٌ آخر في الخطة لم يُقرأ');
  assert.equal(d.utilization.months.filter((m) => m > 0).length, 2, 'دخل في الحساب تسكينُ غيره');
});

// ── التحية: ثابتة لكل يوم، وعطلة نهاية الأسبوع تُشكر لا تُستحثّ ──
// كان هذا الفحص يثبّت **عنواناً لكل يوم** («يومٌ للبناء»، «يوم الحسم») — وقد قال المالك عنها
// «كلمات غريبة»، وطلب تحيةً جنب الاسم. فالثابت الآن نبرةُ اليوم (`sub`) لا التحية: التحية
// تتبع الساعة كما يُحيّي الناسُ بعضهم، والعطلة تبقى عطلة.
test('نبرةُ كل يومٍ ثابتة، والتحية تتبع الساعة — والجمعة والسبت عطلة', () => {
  const at = (iso) => home.greetingFor(new Date(iso + 'T09:00:00'));
  assert.equal(at('2026-08-09').weekday, 'الأحد');
  assert.equal(at('2026-08-14').weekend, true, 'الجمعة ليست عطلة');
  assert.equal(at('2026-08-15').weekend, true, 'السبت ليست عطلة');
  assert.equal(at('2026-08-12').weekend, false, 'الأربعاء عُدّ عطلة');
  // الثبات مقصود: التنويع العشوائي يجعل العبارة زينةً تُقرأ مرة، والثبات يجعلها إيقاعاً يُعرف.
  assert.equal(at('2026-08-12').sub, at('2026-08-19').sub, 'نبرة اليوم تتغيّر بين أربعاءين');
  assert.notEqual(at('2026-08-12').sub, at('2026-08-13').sub, 'يومان مختلفان بنبرةٍ واحدة');
  for (let i = 0; i < 7; i++) {
    const g = home.greetingFor(new Date(Date.UTC(2026, 7, 9 + i, 9)));
    assert.ok(g.hi && g.sub && g.weekday && g.wisdom, 'يومٌ بلا تحيةٍ أو نبرةٍ أو كلمة');
  }
});

// ── التقويم ──
test('شبكة الشهر تبدأ الأحد وتضع كل موعدٍ في يومه', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  const g = home.monthGrid(d, { year: 2026, month: 7 });        // أغسطس ٢٠٢٦ (٧ صفرية)
  assert.equal(g.label, 'أغسطس 2026');
  // ١ أغسطس ٢٠٢٦ سبت ⇒ ستّ خانات فارغة قبله في شبكةٍ تبدأ الأحد
  assert.equal(g.cells.filter((c) => c.blank).length, 6, 'الشبكة لا تبدأ الأحد');
  assert.equal(g.cells.filter((c) => !c.blank).length, 31);
  const cell = (n) => g.cells.find((c) => c.day === n);
  assert.equal(cell(12).today, true, 'يوم اليوم غير مُعلَّم');
  assert.ok(cell(12).events.some((e) => e.kind === 'task'), 'موعد اليوم غائب عن خانته');
  assert.ok(cell(31).events.some((e) => e.kind === 'deliverable'), 'المخرج لم يهبط في آخر يوم بشهره');
  assert.ok(cell(22).events.length === 0 && cell(22).weekend, 'يوم بلا موعد حُشِر فيه شيء');
  // العدد المُعلن هو عدد مواعيد الشهر المعروض وحده — يُعرض تحت اسم الشهر، فلا يجوز أن يعدّ
  // ما خارجه: مهمة سبتمبر ومهمة أغسطس ٨ كلتاهما في القائمة، وواحدة فقط تخصّ هذه الشبكة.
  const inAug = (list) => list.filter((r) => String(r.due_date || '').startsWith('2026-08')).length;
  assert.equal(g.total, inAug(d.tasks) + inAug(d.milestones) + inAug(d.deliverables));
  assert.ok(d.tasks.some((t) => String(t.due_date).startsWith('2026-09')), 'الفحص بلا موعدٍ خارج الشهر لا يثبت شيئاً');
});

test('وشهرٌ آخر يُبنى بلا خطأ ولو خلا من كل موعد', async () => {
  const d = await home.myDay(ME, { today: TODAY });
  const g = home.monthGrid(d, { year: 2027, month: 1 });         // فبراير ٢٠٢٧
  assert.equal(g.total, 0);
  assert.equal(g.cells.filter((c) => !c.blank).length, 28);
  assert.ok(g.cells.every((c) => c.blank || c.events.length === 0));
});

// ── من لا شيء له ──
// حسابٌ بلا موظف مرتبط ولا مهام: يجب أن تُبنى صفحته كاملةً بأصفار، لا أن ترمي.
test('حسابٌ بلا عملٍ مسنَد يبني صفحته كاملةً بأصفار ولا يرمي', async () => {
  const empty = { id: 'u_ghost', username: 'ghost', role_id: 'employee', scope: 'own' };
  const d = await home.myDay(empty, { today: TODAY });
  assert.equal(d.employee, null);
  for (const k of ['tasks', 'opportunities', 'projects', 'milestones', 'deliverables']) {
    assert.deepEqual(d[k], [], `${k} ليست فارغة لحسابٍ بلا عمل`);
  }
  assert.equal(d.utilization.now, 0);
  assert.equal(home.monthGrid(d, {}).total, 0);
});
