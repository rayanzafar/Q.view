// «وفي برضو مكان المهام أضيف شي اسمه مهام شخصية، وأضيف مكان الواحد يكتب فيه النوت ويكون بشكل
// جميل، والنوت يكون بناءً على اليوم أو يكون في قائمة يكتب موضوع ويكتب فيه نوت وكذا»
// — بلسان المالك.
//
// وهذا الملف يحرس **الوعد** لا الميزة: «شخصية» و«ملاحظاتي» كلمتان تحملان تعهّداً صريحاً بأن
// ما يُكتب تحتهما لا يُقرأ خارج حساب صاحبه. وتسرّبٌ واحد يُبطل الميزة كلها — لا لأنها تعطّلت،
// بل لأن أحداً لن يكتب فيها شيئاً بعد أن يعرف أنها تُقرأ. ولذلك أكثرُ فحوص هذا الملف فحوصُ
// حجب: من يرى ماذا، ومن يكتب أين.
//
// وقرارٌ بنيويّ يُحرَس هنا أيضاً: **لا جدول للمهمة الشخصية**. عمود `work_kind` قائم في جدول
// المهام منذ الترحيلة ٠٠١ بقائمة قيم مفتوحة، فالمهمة الشخصية صفٌّ في الجدول نفسه — والفحص
// يثبت ذلك صراحةً كي لا يُضاف جدولٌ لاحقاً بحجّة أنه «كان مفقوداً».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-pnotes-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, notes, P;
const T = new Date().toISOString();
const TODAY = T.slice(0, 10);

// صاحب الدفتر: استشاري عادي — نطاق منحه «خاصتي»، وهو الحالة التي يعيشها أكثر المستخدمين.
const ME = { id: 'u_me', username: 'me', name_ar: 'سارة', role_id: 'consultant', sector_id: 'SOL', scope: 'own' };
// والقارئ الآخر **مدير النظام**: أوسع حساب في المنصة. لو حُجب عنه فقد حُجب عن كل من دونه —
// واختيارُ حسابٍ ضعيف هنا كان سيجعل الفحص يمرّ لضعف القارئ لا لقوة الحارس.
const BOSS = { id: 'u_boss', username: 'boss', name_ar: 'مدير النظام', role_id: 'admin', sector_id: 'SOL', scope: 'company' };
const CTX_ME = { user: ME, ip: '1' };
const CTX_BOSS = { user: BOSS, ip: '1' };

let PERSONAL_ID, WORK_ID, NOTE_ID;
const PERSONAL_TITLE = 'مراجعة خطتي الشخصية للربع القادم';
const WORK_TITLE = 'تجهيز محضر اجتماع الجهة';

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  notes = await import('../../src/modules/pmo/notes.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  for (const u of [ME, BOSS]) {
    await db.insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  // مهمتان لنفس الشخص: واحدة شخصية وواحدة عمل. وجودُ الثانية شرطٌ لصحّة الفحص كله — بدونها
  // قد يمرّ الحجب لأن المدير لا يرى شيئاً أصلاً لا لأن الشخصية محجوبة عنه وحدها.
  PERSONAL_ID = (await tasks.quickAddTask(CTX_ME, { title: PERSONAL_TITLE, work_kind: 'personal', due_date: TODAY })).id;
  WORK_ID = (await tasks.quickAddTask(CTX_ME, { title: WORK_TITLE, due_date: TODAY })).id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── المهمة الشخصية: بنيتها ─────────────────────────────────────────────────────
test('المهمة الشخصية صفٌّ في جدول المهام نفسه — لا جدول جديد ولا قطاع ولا إدارة', async () => {
  const row = await db.get('SELECT * FROM task WHERE id = ?', [PERSONAL_ID]);
  assert.equal(row.work_kind, 'personal', 'نوع العمل لم يُكتب — الميزة كلها قائمة عليه');
  assert.equal(row.assignee_user_id, ME.id);
  assert.equal(row.project_id, null, 'مهمة شخصية معلَّقة على مشروع تظهر في شاشة ذلك المشروع');
  assert.equal(row.opportunity_id, null);
  // القطاع والإدارة يسقطان عمداً: حجبٌ ببنية الصفّ **زائداً** شرط الاستعلام، لا طبقة واحدة —
  // فلو غفل حارسٌ يوماً لم تدخل الشخصية تجميع قطاعٍ ولا لوحة إدارة على أي حال.
  assert.equal(row.sector_id, null, 'قطاعٌ على مهمة شخصية يُدخلها تجميع القطاع');
  assert.equal(row.department_id, null);
});

test('وتظهر لصاحبها في مهامه، وعلى شاشة المهام معلَّمةً بأنها له وحده', async () => {
  const mine = await tasks.myTasks(ME, { todayDate: TODAY });
  assert.ok(mine.some((t) => t.id === PERSONAL_ID), 'صاحبها لا يراها في مهامه');
  const html = await P.tasksPage(ME, {});
  assert.ok(html.includes(PERSONAL_TITLE), 'المهمة الشخصية غائبة عن شاشة صاحبها');
  // الوعد يُقال في وجه صاحبها وهو ينظر إليها، لا يُكتفى بحجبها عن غيره في الخلفية.
  assert.ok(html.includes('مهمة شخصية'), 'لا علامة تقول إن هذه المهمة له وحده');
  assert.ok(html.includes('تظهر لك وحدك'), 'الشاشة لا تقول لمن تظهر هذه المهمة');
});

test('ومرشّح «عمل داخلي» لا يبتلعها — والمجموعتان لا تتقاطعان', async () => {
  // كلتاهما بلا جهة مرتبطة، فلولا الاستثناء الصريح لعرض عمودُ العمل الداخلي دفترَ صاحبه.
  const internal = await tasks.myTasks(ME, { kind: 'internal', todayDate: TODAY });
  assert.ok(!internal.some((t) => t.id === PERSONAL_ID), 'الشخصية ظهرت داخل «عمل داخلي»');
  const personal = await tasks.myTasks(ME, { kind: 'personal', todayDate: TODAY });
  assert.deepEqual(personal.map((t) => t.id), [PERSONAL_ID], 'مرشّح «شخصية» لا يعزلها وحدها');
});

// ── المهمة الشخصية: الحجب (بيت القصيد) ────────────────────────────────────────
test('ولا يراها غيره — ولو كان مدير النظام: لا في لوحة الفريق ولا في ملفه ولا في شاشته', async () => {
  const team = await tasks.teamTasks(BOSS, { includeDone: true, todayDate: TODAY });
  const teamIds = team.flatMap((p) => p.tasks.map((t) => t.id));
  assert.ok(teamIds.includes(WORK_ID), 'مهمة العمل غائبة عن لوحة الفريق — الفحص يقيس لا شيء');
  assert.ok(!teamIds.includes(PERSONAL_ID), 'المهمة الشخصية ظهرت في لوحة الفريق');

  // ملفُ الشخص أسهل طريقٍ إلى دفتر زميل: رابطٌ واحد باسمه. فالشرط على **من يقرأ** لا على من يُقرأ.
  const asBoss = await tasks.personDossier(BOSS, ME.id);
  assert.ok(asBoss.tasks.some((t) => t.id === WORK_ID), 'ملف الشخص لا يعرض عمله أصلاً');
  assert.ok(!asBoss.tasks.some((t) => t.id === PERSONAL_ID), 'ملف الشخص كشف مهمته الشخصية لمديره');
  const asSelf = await tasks.personDossier(ME, ME.id);
  assert.ok(asSelf.tasks.some((t) => t.id === PERSONAL_ID), 'صاحب الملف لا يرى مهامه الشخصية في ملفه');

  // والعدّ كذلك: رقمٌ يقول «عليه اثنتان» ولوحةٌ تعرض واحدة سؤالٌ بلا جواب.
  const wl = await tasks.teamWorkload(BOSS, { todayDate: TODAY });
  const me = wl.departments.flatMap((d) => d.people).find((p) => p.userId === ME.id);
  assert.equal(me.tasks.open, 1, 'عدّاد حِمل الفريق يحسب المهمة الشخصية');

  // وأخيراً الشاشة نفسها — لا الخدمة وحدها: النصّ هو ما يقع تحت عين القارئ.
  const html = await P.tasksPage(BOSS, { who: 'team' });
  assert.ok(html.includes(WORK_TITLE), 'شاشة مهام الفريق لا تعرض عمل الفريق — الفحص يقيس لا شيء');
  assert.ok(!html.includes(PERSONAL_TITLE), 'عنوان المهمة الشخصية طُبع في شاشة مدير النظام');
});

test('ولا يعدّلها غيره — والردّ «غير موجودة» لا «خارج نطاقك»', async () => {
  // الصياغة مقصودة: «خارج نطاقك» تؤكّد أن لفلانٍ مهمةً شخصية بهذا المعرّف، وهي بذاتها كشفٌ
  // صغير لما وُعد بستره.
  await assert.rejects(() => tasks.updateTask(CTX_BOSS, PERSONAL_ID, { status: 'DONE' }),
    (e) => /غير موجودة/.test(e.message) && !/نطاق/.test(e.message));
  const row = await db.get('SELECT status FROM task WHERE id = ?', [PERSONAL_ID]);
  assert.equal(row.status, 'TODO', 'الحالة تغيّرت رغم الرفض');
  // ومهمة العمل نفسها يعدّلها المدير كما كان — الحارس شرطٌ على الشخصية لا تضييقٌ عام.
  await tasks.updateTask(CTX_BOSS, WORK_ID, { priority: 'P1' });
  assert.equal((await db.get('SELECT priority FROM task WHERE id = ?', [WORK_ID])).priority, 'P1');
});

test('ولا تُسنَد إلى زميل — لا عند إنشائها ولا بعده', async () => {
  await assert.rejects(() => tasks.quickAddTask(CTX_ME,
    { title: 'مهمة شخصية مدفوعة لغيري', work_kind: 'personal', assignee_user_id: BOSS.id }),
  (e) => /الشخصية/.test(e.message), 'قُبِل إنشاء مهمة شخصية باسم شخص آخر');
  await assert.rejects(() => tasks.updateTask(CTX_ME, PERSONAL_ID, { assignee_user_id: BOSS.id }),
    (e) => /الشخصية/.test(e.message), 'قُبِل دفع مهمة شخصية إلى قائمة شخص آخر');
});

// انحدارٌ حقيقي وقع في التصميم قبل إصلاحه: محرِّر المهمة يرسل «بلا مشروع وبلا فرصة» في كل
// حفظ، فكانت المهمة تُصنَّف «عملاً داخلياً» بمجرد أن يفتح صاحبها تفاصيلها ويحفظ — فتصير
// مقروءةً لمديره بلا أن يطلب ذلك أحد، وبلا أن يظهر التحوّل في أي مكان. أخطر ما في العطل صمتُه.
test('وحفظُ تفاصيلها لا يقلبها عملاً داخلياً بصمت', async () => {
  await tasks.updateTask(CTX_ME, PERSONAL_ID,
    { title: PERSONAL_TITLE, project_id: null, opportunity_id: null, next_step: 'أكتب الخطة' });
  const row = await db.get('SELECT work_kind FROM task WHERE id = ?', [PERSONAL_ID]);
  assert.equal(row.work_kind, 'personal', 'انقلبت المهمة الشخصية عملاً داخلياً بمجرد الحفظ');
  const team = await tasks.teamTasks(BOSS, { includeDone: true, todayDate: TODAY });
  assert.ok(!team.flatMap((p) => p.tasks.map((t) => t.id)).includes(PERSONAL_ID),
    'وظهرت في لوحة الفريق بعد الحفظ');
});

// ── الملاحظات ─────────────────────────────────────────────────────────────────
test('الملاحظة تُكتب بموضوعها ونصّها فتظهر في دفتر صاحبها', async () => {
  const n = await notes.createNote(CTX_ME, {
    subject: 'اجتماع الترسية مع الجهة',
    body: 'طلبوا تفصيل منهجية الترحيل.\nوالموعد المقترح للتسليم بعد أسبوعين.',
  });
  NOTE_ID = n.id;
  const list = await notes.myNotes(ME, {});
  const found = list.find((x) => x.id === NOTE_ID);
  assert.ok(found, 'الملاحظة لم تظهر في الدفتر بعد كتابتها');
  assert.equal(found.subject, 'اجتماع الترسية مع الجهة');
  assert.ok(/منهجية الترحيل/.test(found.body), 'النصّ لم يُحفظ');
  // اليوم يُكتب تلقائياً — وهو ما يجعل «النوت بناءً على اليوم» قراءةً من النموذج نفسه
  // بلا جدولٍ ثانٍ ولا شاشةٍ ثانية.
  assert.equal(found.note_date, TODAY, 'الملاحظة بلا يوم — فلا تُجمَّع بأيامها في الشاشة');
});

test('وموضوعٌ فارغ يُرَدّ برسالة تقول ماذا يُكتب لا أن الحقل مطلوب', async () => {
  await assert.rejects(() => notes.createNote(CTX_ME, { subject: '   ', body: 'نصّ بلا موضوع' }),
    (e) => /موضوع/.test(e.message) && /مثل/.test(e.message));
});

test('والتعديل يغيّرها فعلاً — والتثبيت يرفعها إلى أعلى الدفتر', async () => {
  await notes.updateNote(CTX_ME, NOTE_ID, { subject: 'اجتماع الترسية — محدَّث', body: 'اتُّفق على التسليم بعد ثلاثة أسابيع.' });
  const after1 = (await notes.myNotes(ME, {})).find((x) => x.id === NOTE_ID);
  assert.equal(after1.subject, 'اجتماع الترسية — محدَّث');
  assert.ok(/ثلاثة أسابيع/.test(after1.body));
  assert.ok(after1.updated_at, 'التعديل بلا ختم زمني');

  // ملاحظةٌ أحدث يوماً تسبق الأقدم — فإن ثُبِّتت الأقدم صعدت فوقها. الترتيب هو ما يجعل الدفتر
  // مقروءاً بعد مئة ملاحظة، فيُفحَص لا يُفترَض.
  const later = await notes.createNote(CTX_ME, { subject: 'ملاحظة لاحقة', note_date: '2099-01-01' });
  assert.equal((await notes.myNotes(ME, {}))[0].id, later.id, 'الأحدث يوماً ليس في الأعلى');
  await notes.updateNote(CTX_ME, NOTE_ID, { pinned: true });
  assert.equal((await notes.myNotes(ME, {}))[0].id, NOTE_ID, 'المثبَّتة لم تصعد إلى أعلى الدفتر');
});

test('والحذف يخفيها ولا يمحوها — والأثر مكتوب في كل كتابة', async () => {
  const doomed = await notes.createNote(CTX_ME, { subject: 'مسوّدة تُحذف' });
  await notes.deleteNote(CTX_ME, doomed.id);
  const row = await db.get('SELECT deleted_at FROM personal_note WHERE id = ?', [doomed.id]);
  assert.ok(row, 'مُحي الصفّ فعلياً بدل إخفائه');
  assert.ok(row.deleted_at, 'لا ختم إخفاء على الملاحظة المحذوفة');
  assert.ok(!(await notes.myNotes(ME, {})).some((x) => x.id === doomed.id), 'المحذوفة ما زالت تُقرأ');
  for (const action of ['create', 'update', 'delete']) {
    const a = await db.get(`SELECT id FROM audit_log WHERE resource = 'personal_note' AND action = ?`, [action]);
    assert.ok(a, `كتابةٌ من نوع «${action}» على الملاحظات بلا أثر`);
  }
});

test('ولا يقرأ أحدٌ دفتر غيره ولا يكتب فيه — ولو كان مدير النظام', async () => {
  // هذا هو الفحص الذي تقوم عليه الميزة: كلمة «ملاحظاتي» تعهّدٌ، وتسرّبٌ واحد يُبطله كله.
  assert.deepEqual(await notes.myNotes(BOSS, {}), [], 'دفتر مدير النظام يعرض ملاحظات غيره');
  await assert.rejects(() => notes.updateNote(CTX_BOSS, NOTE_ID, { subject: 'تعديل من غير صاحبها' }),
    (e) => /غير موجودة/.test(e.message), 'كتب مدير النظام في دفتر موظفة');
  await assert.rejects(() => notes.deleteNote(CTX_BOSS, NOTE_ID),
    (e) => /غير موجودة/.test(e.message), 'حذف مدير النظام ملاحظةً ليست له');
  // والصفّ سليم بعد المحاولتين — الرفض رفضٌ لا تراجعٌ بعد كتابة.
  const row = await db.get('SELECT subject, deleted_at FROM personal_note WHERE id = ?', [NOTE_ID]);
  assert.equal(row.subject, 'اجتماع الترسية — محدَّث');
  assert.equal(row.deleted_at, null);
});

// ── الشاشة ────────────────────────────────────────────────────────────────────
test('وشاشة الملاحظات تُبنى وتعرض ما كُتب، وفيها متّسع للكتابة', async () => {
  const html = await P.notesPage(ME, {});
  assert.ok(html.includes('اجتماع الترسية — محدَّث'), 'الملاحظة محفوظة ولا تُعرض');
  assert.ok(/ثلاثة أسابيع/.test(html), 'نصّ الملاحظة غائب عن الشاشة');
  assert.ok(html.includes('nn-subject') && html.includes('nn-body'), 'لا مكان لكتابة ملاحظة جديدة');
  assert.ok(html.includes('nt-editor'), 'لا محرِّر لتعديل ملاحظة قائمة');
  assert.ok(html.includes('/static/pages/notes.js'), 'الشاشة بلا طبقة تفاعلها — أزرارٌ لا تفعل شيئاً');
  // «بناءً على اليوم» — القراءة الثانية التي طلبها المالك، مأخوذةً من العمود نفسه.
  assert.ok(html.includes('اليوم'), 'الملاحظات غير مجمَّعة بأيامها');
});

test('وشاشة الملاحظات لا تعرض دفتر غير صاحبها', async () => {
  const html = await P.notesPage(BOSS, {});
  assert.ok(!html.includes('اجتماع الترسية'), 'موضوع ملاحظة موظفة طُبع في شاشة مدير النظام');
  assert.ok(!/ثلاثة أسابيع/.test(html), 'نصّ ملاحظة موظفة طُبع في شاشة مدير النظام');
  assert.ok(html.includes('دفترك فارغ بعد'), 'لا حالة فراغ مصمَّمة — الشاشة تبدو معطَّلة لا خالية');
});

test('والشريط يصل بين المهام والملاحظات في الاتجاهين — لا طريق بلا عودة', async () => {
  const t = await P.tasksPage(ME, {});
  assert.ok(t.includes('/app/tasks?who=notes'), 'لا مدخل إلى الملاحظات من شاشة المهام');
  assert.ok(t.includes('ملاحظاتي'), 'اسم العدسة غائب عن الشريط');
  const n = await P.notesPage(ME, {});
  assert.ok(/href="\/app\/tasks"/.test(n), 'لا طريق عودة من الملاحظات إلى المهام');
});

// المسار نفسه هو ما يصل إليه المتصفّح: خدمةٌ سليمة خلف عنوانٍ غير مركَّب تعني ٤٠٤ في وجه
// المستخدم وحزمةً خضراء عندنا — وهي الثغرة التي أوقعت «صورة المال على المشروع» من قبل.
test('ومسار الملاحظات مركَّب فعلاً تحت واجهة البرمجة لا مبنيّاً وحده', async () => {
  const { apiRouter } = await import('../../src/modules/api.routes.js');
  const paths = [];
  const walk = (layer) => {
    if (layer.route) paths.push(layer.route.path);
    else if (layer.handle && layer.handle.stack) layer.handle.stack.forEach(walk);
  };
  apiRouter.stack.forEach(walk);
  assert.ok(paths.includes('/notes'), 'موجّه الملاحظات غير مركَّب في api.routes.js');
  assert.ok(paths.includes('/notes/:id'), 'مسار تعديل الملاحظة وحذفها غير مركَّب');
});
