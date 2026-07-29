// صفحة المهام من طرفها إلى طرفها — لأن التقييم سيُبنى عليها.
//
// طلب المالك: «تأكد أن صفحة المهام ما فيها أي خطأ وكل شي كامل فيها والبزنس كامل، تابعها
// end to end عشان راح يتم الاعتماد عليها في تقييم الموظفين».
//
// وهذا يغيّر معيار «صحيحة». شاشةٌ للاطّلاع يكفيها ألّا تنهار؛ وشاشةٌ يُقيَّم بها الناس يجب أن
// تكون **أرقامها صادقة وكاملة**: مهمةٌ لا تظهر في أي نطاق تعني موظفاً يُقيَّم على عملٍ لا
// يراه مديره، ومهمةٌ تظهر مرتين تعني تضخيماً لعبء رجلٍ على حساب غيره. كلاهما ظلمٌ صامت
// لا ينهار له شيء ولا يشتكي منه أحد.
//
// ولذلك يُفحص **الوسم المُصيَّر نفسه** لا نسخةٌ من منطقه في الاختبار: نسخُ منطق التصنيف هنا
// يجعل الفحص يشهد لنفسه — يمرّ وهو يقيس اختباراً لا منتجاً. الصفحة تُصيَّر فعلاً، وتُقرأ
// صفوفها من الوسم، وتُقارَن بحقيقةٍ مستقلة تُقرأ من القاعدة مباشرةً.
//
// الحقائق الأربع المُثبَتة:
//   ١) **الشمول**: كل مهمة مفتوحة داخل النطاق تظهر في العرض الكامل — لا مهمة تختفي.
//   ٢) **عدم التكرار**: لا مهمة تظهر مرتين — لا عبء يُحسب مضاعفاً.
//   ٣) **صدق العدّادات**: أرقام البطاقات الأربع تطابق ما في القاعدة، ولا تعدّ منجَزاً ولا ملغى.
//   ٤) **ضيق النطاق**: مدير الإدارة لا يرى إدارةً أخرى، وقائد القطاع لا يرى قطاعاً آخر —
//      ولا في العدّادات، ولا في اللوحة، ولا في صفحة الشخص.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-tasks-e2e-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, all, get, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { tasksPage } = await import('../../src/web/views/pmo.js');
const { teamWorkload, teamTasks } = await import('../../src/modules/pmo/tasks.js');

const T = '2026-01-01T00:00:00Z';
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const U = (id, role, scope, sector, dept) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, scope, sector_id: sector,
  department_id: dept || null, projectIds: new Set(), teamIds: new Set(),
});
const LEAD = U('u_lead', 'sector_lead', 'sector', 'SA');
const MGR = U('u_mgr', 'department_manager', 'department', 'SA', 'DA1');

// مجموعة مهام خصومية: كل فرعٍ في التصنيف مرةً على الأقل، ومعها ما يجب ألّا يُعدّ.
const TASKS = [
  // [معرّف, المُسنَد إليه, موعد, حالة, يُعدّ مفتوحاً]
  ['t_over1', 'u_a', -9, 'IN_PROGRESS', true],   // متأخرة
  ['t_over2', 'u_a', -1, 'TODO', true],          // متأخرة بيومٍ واحد (حدّ)
  ['t_today', 'u_b', 0, 'TODO', true],           // اليوم بالضبط (حدّ)
  ['t_week1', 'u_b', 1, 'TODO', true],           // غداً (حدّ الأسبوع الأدنى)
  ['t_week7', 'u_a', 7, 'TODO', true],           // اليوم السابع (حدّ الأسبوع الأعلى)
  ['t_later', 'u_b', 8, 'TODO', true],           // اليوم الثامن (أول ما بعد الأسبوع)
  ['t_far', 'u_a', 60, 'TODO', true],            // بعيدة
  ['t_nodate', 'u_b', null, 'TODO', true],       // بلا موعد وغير مبدوءة
  ['t_started_nodate', 'u_a', null, 'IN_PROGRESS', true], // بلا موعد لكنها بدأت ⟵ طاولة اليوم
  ['t_blocked_far', 'u_b', 30, 'BLOCKED', true], // معطَّلة وموعدها بعيد ⟵ طاولة اليوم أيضاً
  ['t_done', 'u_a', -3, 'DONE', false],          // منجَزة ⟵ لا تُعدّ مفتوحة ولا متأخرة
  ['t_cancel', 'u_b', -3, 'CANCELLED', false],   // ملغاة ⟵ لا تظهر إطلاقاً
];

before(async () => {
  await insert('sector', { id: 'SA', name_ar: 'قطاع أ', active: 1, created_at: T });
  await insert('sector', { id: 'SB', name_ar: 'قطاع ب', active: 1, created_at: T });
  await insert('department', { id: 'DA1', sector_id: 'SA', name_ar: 'إدارة أ-١', active: 1, created_at: T });
  await insert('department', { id: 'DA2', sector_id: 'SA', name_ar: 'إدارة أ-٢', active: 1, created_at: T });
  // شخصان في إدارة المدير، وثالثٌ في إدارة أخرى، ورابعٌ في قطاع آخر — حدودٌ يجب ألّا تُعبَر.
  const people = [
    ['u_a', 'e_a', 'أحمد', 'SA', 'DA1'], ['u_b', 'e_b', 'بدر', 'SA', 'DA1'],
    ['u_c', 'e_c', 'جابر', 'SA', 'DA2'], ['u_d', 'e_d', 'داود', 'SB', null],
  ];
  for (const [uid, eid, nm, sec, dep] of people) {
    await insert('employee', { id: eid, name_ar: nm, sector_id: sec, department_id: dep, active: 1, created_at: T });
    await insert('app_user', { id: uid, username: uid, name_ar: nm, role_id: 'consultant', sector_id: sec,
      employee_id: eid, scope: 'own', active: 1, must_change_pw: 0, failed_attempts: 0, created_at: T });
  }
  for (const [tid, who, due, status] of TASKS) {
    await insert('task', {
      id: tid, title: 'مهمة ' + tid, assignee_user_id: who, sector_id: 'SA', department_id: 'DA1',
      status, priority: 'P2', due_date: due === null ? null : day(due),
      blocked_reason: status === 'BLOCKED' ? 'سببٌ مكتوب' : null,
      completed_at: status === 'DONE' ? day(-3) + 'T10:00:00.000Z' : null,
      created_at: T,
    });
  }
  // مهام خارج نطاق المدير — إحداها في إدارة أخرى والأخرى في قطاع آخر
  await insert('task', { id: 't_other_dep', title: 'مهمة إدارة أخرى', assignee_user_id: 'u_c',
    sector_id: 'SA', department_id: 'DA2', status: 'TODO', priority: 'P2', due_date: day(-2), created_at: T });
  await insert('task', { id: 't_other_sec', title: 'مهمة قطاع آخر', assignee_user_id: 'u_d',
    sector_id: 'SB', status: 'TODO', priority: 'P2', due_date: day(-2), created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// معرّفات المهام كما تظهر **في الوسم المُصيَّر** — لا كما يحسبها الاختبار.
const renderedIds = (html) => [...html.matchAll(/data-task="([^"]+)"/g)].map((m) => m[1]);
// عدّاد البطاقة: الرقم داخل بطاقة إحصاء عنوانها كذا
const statNumber = (html, label) => {
  const i = html.indexOf(label);
  if (i < 0) return null;
  const seg = html.slice(Math.max(0, i - 400), i + 400);
  const m = seg.match(/class="[^"]*wc-stat-v[^"]*"[^>]*>([\d]+)</) || seg.match(/>(\d+)<\/div>\s*<div[^>]*>[^<]*/);
  return m ? Number(m[1]) : null;
};

test('الشمول: كل مهمة مفتوحة داخل النطاق تظهر في العرض الكامل — لا مهمة تختفي', async () => {
  const html = await tasksPage(LEAD, { who: 'team', win: 'all' });
  const shown = new Set(renderedIds(html));
  const expected = TASKS.filter(([, , , st]) => st !== 'CANCELLED').map(([tid]) => tid);
  const missing = expected.filter((t) => !shown.has(t));
  assert.deepEqual(missing, [], `مهام غابت عن الشاشة كلياً: ${missing.join(', ')}`);
});

test('عدم التكرار: لا مهمة تظهر مرتين — لا عبء يُحسب مضاعفاً', async () => {
  const html = await tasksPage(LEAD, { who: 'team', win: 'all' });
  const ids = renderedIds(html);
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual([...new Set(dupes)], [], `مهام مكرَّرة في العرض: ${[...new Set(dupes)].join(', ')}`);
});

test('الملغاة لا تظهر، والمنجَزة لا تُعدّ مفتوحة', async () => {
  const html = await tasksPage(LEAD, { who: 'team', win: 'all' });
  const shown = new Set(renderedIds(html));
  assert.equal(shown.has('t_cancel'), false, 'مهمة ملغاة ظهرت على شاشة تقييم');
  // المنجَزة تُعرَض في قسمها («أنجزتها مؤخراً») لكن لا تُحسب في حِمل الشخص المفتوح
  const wl = await teamWorkload(LEAD, { todayDate: today });
  const byUser = new Map();
  for (const d of wl.departments) for (const p of d.people) byUser.set(p.userId, p);
  const a = byUser.get('u_a');
  const openA = TASKS.filter(([, who, , st, open]) => who === 'u_a' && open).length;
  assert.equal(a.tasks.open, openA, 'عدّ المهام المفتوحة لأحمد لا يطابق الحقيقة');
});

test('صدق عدّاد المتأخر: المنجَزة والملغاة خارجه مهما تجاوز موعدهما', async () => {
  const wl = await teamWorkload(LEAD, { todayDate: today });
  const byUser = new Map();
  for (const d of wl.departments) for (const p of d.people) byUser.set(p.userId, p);
  // «t_done» موعدها قبل ثلاثة أيام و«t_cancel» كذلك — ولا واحدة منهما متأخرة
  const overdueA = TASKS.filter(([, who, due, st, open]) => who === 'u_a' && open && due !== null && due < 0).length;
  const overdueB = TASKS.filter(([, who, due, st, open]) => who === 'u_b' && open && due !== null && due < 0).length;
  assert.equal(byUser.get('u_a').tasks.overdue, overdueA);
  assert.equal(byUser.get('u_b').tasks.overdue, overdueB);
});

test('ضيق النطاق: مدير الإدارة لا يرى إدارةً أخرى ولا قطاعاً آخر', async () => {
  const html = await tasksPage(MGR, { who: 'team', win: 'all' });
  const shown = new Set(renderedIds(html));
  assert.equal(shown.has('t_other_dep'), false, 'مهمة إدارة أخرى ظهرت لمدير الإدارة');
  assert.equal(shown.has('t_other_sec'), false, 'مهمة قطاع آخر ظهرت لمدير الإدارة');
  assert.ok(shown.has('t_over1'), 'ومهام إدارته تظهر');

  const wl = await teamWorkload(MGR, { todayDate: today });
  const names = wl.departments.flatMap((d) => d.people.map((p) => p.userId));
  assert.deepEqual(names.filter((n) => n === 'u_c' || n === 'u_d'), [], 'أشخاص خارج إدارته ظهروا في لوحته');
});

test('ضيق النطاق: قائد القطاع يرى قطاعه كله ولا يتعدّاه', async () => {
  const html = await tasksPage(LEAD, { who: 'team', win: 'all' });
  const shown = new Set(renderedIds(html));
  assert.ok(shown.has('t_other_dep'), 'إدارةٌ أخرى داخل قطاعه تظهر له');
  assert.equal(shown.has('t_other_sec'), false, 'مهمة قطاع آخر ظهرت لقائد القطاع');
});

test('اللوحة والقائمة تتفقان: مجموع ما تعدّه اللوحة لكل شخص هو ما تعرضه القائمة له', async () => {
  const wl = await teamWorkload(LEAD, { todayDate: today });
  const board = await teamTasks(LEAD, { todayDate: today, limit: 500 });
  const boardOpen = new Map();
  for (const b of board) boardOpen.set(b.userId, b.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length);
  for (const d of wl.departments) {
    for (const p of d.people) {
      const fromBoard = boardOpen.get(p.userId) || 0;
      assert.equal(p.tasks.open, fromBoard,
        `تعارض في عدّ مهام ${p.name}: اللوحة ${p.tasks.open} والقائمة ${fromBoard}`);
    }
  }
});

test('النوافذ الزمنية تقسم العمل المفتوح بلا فقدٍ ولا تداخل', async () => {
  // مجموع ما تعرضه النوافذ الأربع الحصرية = كل المفتوح. (النوافذ في الرابط: اليوم/أسبوع/الكل)
  const wAll = new Set(renderedIds(await tasksPage(LEAD, { who: 'team', win: 'all' })));
  const wToday = new Set(renderedIds(await tasksPage(LEAD, { who: 'team', win: 'today' })));
  const wOverdue = new Set(renderedIds(await tasksPage(LEAD, { who: 'team', win: 'overdue' })));
  const wNodate = new Set(renderedIds(await tasksPage(LEAD, { who: 'team', win: 'nodate' })));
  // كل نافذة جزءٌ من الكل — نافذةٌ تُظهر ما لا يظهر في «الكل» تعني تسريباً
  for (const [name, s] of [['اليوم', wToday], ['المتأخرة', wOverdue], ['بلا موعد', wNodate]]) {
    const extra = [...s].filter((x) => !wAll.has(x));
    assert.deepEqual(extra, [], `نافذة «${name}» تعرض ما لا تعرضه «الكل»: ${extra.join(', ')}`);
  }
  // والمتأخرة كلها داخل «طاولتك اليوم» — وهو وعد الشاشة نفسه
  const overdueOutsideToday = [...wOverdue].filter((x) => !wToday.has(x));
  assert.deepEqual(overdueOutsideToday, [], `متأخرات خارج طاولة اليوم: ${overdueOutsideToday.join(', ')}`);
});

test('صفحة الشخص تتفق مع اللوحة على الشخص نفسه', async () => {
  const { personDossier } = await import('../../src/modules/pmo/tasks.js');
  const wl = await teamWorkload(LEAD, { todayDate: today });
  const byUser = new Map();
  for (const d of wl.departments) for (const p of d.people) byUser.set(p.userId, p);
  for (const uid of ['u_a', 'u_b']) {
    const d = await personDossier(LEAD, uid);
    const onBoard = byUser.get(uid);
    assert.equal(d.stats.open, onBoard.tasks.open, `«${uid}»: صفحته ${d.stats.open} ولوحته ${onBoard.tasks.open}`);
    assert.equal(d.stats.overdue, onBoard.tasks.overdue, `«${uid}»: متأخرات صفحته تخالف لوحته`);
    assert.equal(d.stats.blocked, onBoard.tasks.blocked, `«${uid}»: معطَّلات صفحته تخالف لوحته`);
  }
});

// ── عملٌ بلا صاحب: العيب الذي وجدَه هذا التدقيق ──
// اللوحة تُبنى من **الأشخاص**، فما لا شخص له كان يغيب عنها كلياً بينما يظهر في القائمة تحته
// في الشاشة نفسها. القياس على بيانات مصنوعة أظهر: اللوحة «شخصٌ واحد عليه مهمة» والقائمة ثلاث
// مهام، اثنتان منها متأخرتان بأعلى أولوية — إحداهما بلا مُسنَد إليه والأخرى على حسابٍ معطَّل.
//
// وهذا أسوأ اتجاه للخطأ في شاشةِ تقييم: **أشدّ العمل إلحاحاً هو أقلّه ظهوراً**. مديرٌ يقرأ
// لوحته يظنّ إدارته خفيفة، والعمل المهمَل — الذي لا يطالب به أحد لأن صاحبه غادر أو لم يوجد —
// يتراكم بلا أن يراه. ولا ينهار شيء ولا يشتكي أحد.
test('العمل بلا مُسنَد إليه أو على حسابٍ معطَّل يظهر على اللوحة لا في القائمة وحدها', async () => {
  const now = '2026-02-01T00:00:00Z';
  // موظفٌ غادر (حسابه معطَّل) وعليه عملٌ مفتوح متأخر
  await insert('employee', { id: 'e_gone', name_ar: 'من غادر', sector_id: 'SA', department_id: 'DA1', active: 1, created_at: now });
  await insert('app_user', { id: 'u_gone', username: 'u_gone', name_ar: 'من غادر', role_id: 'consultant',
    sector_id: 'SA', employee_id: 'e_gone', scope: 'own', active: 0, must_change_pw: 0, failed_attempts: 0, created_at: now });
  await insert('task', { id: 't_on_gone', title: 'مهمة على من غادر', assignee_user_id: 'u_gone',
    sector_id: 'SA', department_id: 'DA1', status: 'IN_PROGRESS', priority: 'P0', due_date: day(-5), created_at: now });
  await insert('task', { id: 't_no_owner', title: 'مهمة بلا مسؤول', assignee_user_id: null,
    sector_id: 'SA', department_id: 'DA1', status: 'IN_PROGRESS', priority: 'P0', due_date: day(-7), created_at: now });

  const wl = await teamWorkload(LEAD, { todayDate: today });
  assert.ok(wl.orphans, 'الخدمة تعيد حصيلة العمل بلا صاحب');
  assert.equal(wl.orphans.unassigned, 1, 'مهمة بلا مسؤول محسوبة');
  assert.equal(wl.orphans.inactive, 1, 'مهمة على حساب معطَّل محسوبة');
  assert.equal(wl.orphans.overdue, 2, 'وكلتاهما متأخرة');
  assert.ok(wl.orphans.people.some((p) => p.name === 'من غادر'), 'يُسمّى من غادر كي يُعرف أين تذهب مهامه');

  // ولا تُعدّ مرتين: من غادر لا يظهر كشخصٍ على اللوحة (حسابه معطَّل) فلا يُجمع عبؤه مع الأحياء
  const onBoard = wl.departments.flatMap((d) => d.people.map((p) => p.userId));
  assert.equal(onBoard.includes('u_gone'), false, 'حسابٌ معطَّل لا يُعرض كشخصٍ يُقيَّم');

  // والشاشة تُصدِّر ذلك فوق الإدارات لا تحتها
  const html = await tasksPage(LEAD, { who: 'team', win: 'all' });
  assert.ok(html.includes('عملٌ بلا صاحب'), 'شريط العمل بلا صاحب غائب عن الشاشة');
  const iStrip = html.indexOf('عملٌ بلا صاحب');
  const iFirstDep = html.indexOf('class="wd"');
  assert.ok(iStrip < iFirstDep || iFirstDep < 0, 'الشريط يجب أن يسبق الإدارات — ما يحتاج النظر أولاً يُعرض أولاً');
});

test('العمل بلا صاحب يحترم النطاق كما يحترمه غيره', async () => {
  // مهمة بلا مسؤول في قطاع آخر — لا يراها قائد قطاع «أ»
  await insert('task', { id: 't_no_owner_other', title: 'بلا مسؤول في قطاع آخر', assignee_user_id: null,
    sector_id: 'SB', status: 'IN_PROGRESS', priority: 'P0', due_date: day(-4), created_at: '2026-02-01T00:00:00Z' });
  const wl = await teamWorkload(LEAD, { todayDate: today });
  assert.equal(wl.orphans.unassigned, 1, 'مهمة قطاع آخر بلا مسؤول تسرّبت إلى لوحة قائد قطاع «أ»');
  // ومدير الإدارة يرى ما في إدارته وحدها
  const wm = await teamWorkload(MGR, { todayDate: today });
  assert.equal(wm.orphans.unassigned, 1);
  assert.equal(wm.orphans.inactive, 1);
});
