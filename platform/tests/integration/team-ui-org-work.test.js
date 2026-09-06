// ── S11 الهيكل الإداري + S12 العمل والالتزامات — اختبارات الواجهة (UI-CONTRACTS §6) ─────────────
//
// بيانات صغيرة معزولة: قطاعان، ثلاث إدارات، خمسة موارد (اثنان بلا حساب دخول)، مشروعٌ تتبع
// إدارته «الذكاء» وعليه تسكينان من إدارتين مختلفتين، وأربع مهام: جارية، متعطلة، منجزة (لا تُعدّ)،
// وشخصية (لا تُعدّ). المؤكَّد هنا: (1) الشجرة بأعدادها ضمن النطاق وصفوف الإدارة المختارة والارتباط
// المشترك مرةً واحدة والتبويب «سجل الموارد» لا «سجل إداري»؛ (2) S12 يعرض المشروع مرةً ومهمتيه
// الجاريتين مرةً لكلٍّ ويتصالح ملخصه مع صفوفه في الوجهين؛ (3) حالات الفراغ؛ (4) النطاق يُحترم
// (مدير إدارة لا يقرأ إدارة غيره)؛ (5) لا تسرّب لقيم خام.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-ui-org-work-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, resolveUser, orgPage, workPage;
const T = new Date().toISOString();
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
const count = (html, re) => (html.match(re) || []).length;
const kpi = (html, key) => { const m = html.match(new RegExp(`data-kpi="${key}">(\\d+)<`)); return m ? Number(m[1]) : null; };
let TODAY, YEAR, MONTH, KEY;
const isoPlus = (days) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  const { riyadhDate } = await import('../../src/core/i18n/time.js');
  ({ teamOrgPage: orgPage } = await import('../../src/web/views/team/org.js'));
  ({ teamWorkPage: workPage } = await import('../../src/web/views/team/work.js'));
  // «اليوم» يوم الرياض كما تقرؤه الخدمات (T15) — فالتسكين يُبذر على سنة الرياض وكل أشهرها.
  TODAY = riyadhDate(); YEAR = Number(TODAY.slice(0, 4)); MONTH = Number(TODAY.slice(5, 7));
  KEY = `${YEAR}-${String(MONTH).padStart(2, '0')}`;

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1, created_at: T });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, sort_order: 2, created_at: T });
  const mkUser = (id, role, scope = 'own') => db.insert('app_user', { id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: 'SOL', scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'company');
  await mkUser('u_a1', 'consultant');
  await mkUser('u_i1', 'consultant');
  await mkUser('u_dm', 'department_manager');
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي والبيانات', manager_user_id: 'u_admin', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  const mkEmp = async (id, { name, dept, sector = 'SOL', user = null, job, type = 'أساسي' }) => {
    await db.insert('employee', { id, user_id: user, name_ar: name, sector_id: sector, department_id: dept, job_title: job, employment_type: type, active: 1, created_at: T });
    if (user) await db.update('app_user', user, { employee_id: id });
  };
  await mkEmp('e_a1', { name: 'مورد الذكاء الأول', dept: 'D_AI', user: 'u_a1', job: 'مستشار ذكاء اصطناعي' });
  await mkEmp('e_a2', { name: 'مورد الذكاء الثاني', dept: 'D_AI', job: 'محلل بيانات', type: 'متعاقد' });
  await mkEmp('e_i1', { name: 'مورد الابتكار', dept: 'D_INNOV', user: 'u_i1', job: 'مستشار ابتكار' });
  await mkEmp('e_dm', { name: 'مدير الابتكار', dept: 'D_INNOV', user: 'u_dm', job: 'مدير إدارة' });
  await mkEmp('e_c1', { name: 'مورد الاستشارات', dept: 'D_CONS', sector: 'CONS', job: 'مستشار' });

  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', created_at: T });
  await db.insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'منصة البيانات الوطنية', sector_id: 'SOL', department_id: 'D_AI',
    client_id: 'CL', status: 'IN_PROGRESS', kind: 'external', created_at: T });
  const all12 = (v) => JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, v])));
  await db.insert('allocation', { id: 'A1', employee_id: 'e_a1', project_id: 'P1', type: 'member', monthly_json: all12(0.5), year: YEAR, created_at: T });
  await db.insert('allocation', { id: 'A2', employee_id: 'e_i1', project_id: 'P1', type: 'member', monthly_json: all12(0.3), year: YEAR, status: 'confirmed', created_at: T });
  await db.insert('allocation', { id: 'A3', employee_id: 'e_i1', work_bucket: 'bd', type: 'member', monthly_json: all12(0.2), year: YEAR, created_at: T });

  const mkTask = (id, data) => db.insert('task', { id, work_kind: 'project', priority: 'P2', status: 'TODO', created_at: T, created_by: 'u_admin', ...data });
  await mkTask('t1', { project_id: 'P1', assignee_user_id: 'u_a1', title: 'مراجعة متطلبات المنصة', due_date: isoPlus(5), utilization_pct: 30 });
  await mkTask('t2', { project_id: 'P1', assignee_user_id: 'u_i1', title: 'اختبار نموذج التنبؤ', status: 'BLOCKED', blocked_reason: 'بانتظار بيانات الاختبار من العميل', due_date: isoPlus(9) });
  await mkTask('t3', { project_id: 'P1', assignee_user_id: 'u_a1', title: 'إعداد بيئة التطوير', status: 'DONE', completed_at: T });
  await mkTask('t4', { assignee_user_id: 'u_a1', work_kind: 'personal', title: 'مهمة شخصية لا تُعدّ على الفريق', due_date: isoPlus(2) });
  await db.insert('milestone', { id: 'M1', project_id: 'P1', name_ar: 'تسليم النموذج الأولي', due_date: isoPlus(12), status: 'PENDING', created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── S11 ──────────────────────────────────────────────────────────────────────────────────────────
test('S11: الشجرة بأعدادها، وصفوف الإدارة المختارة، والارتباط المشترك مرةً واحدة، والتبويب «سجل الموارد»', async () => {
  const html = await orgPage(await sess('u_admin'), { department: 'D_INNOV' });
  assert.doesNotMatch(html, LEAK, 'تسرّبت قيمة خام إلى الصفحة');
  assert.ok(html.includes('سجل الموارد'), 'تبويب العودة «سجل الموارد» غائب');
  assert.ok(!html.includes('سجل إداري'), 'نُسخت تسمية الصورة «سجل إداري» رغم نصّ الموجّه');
  // الشجرة: القطاعان والإدارات الثلاث بأعدادها ضمن النطاق (مدير النظام يرى الشركة)
  for (const name of ['قطاع الحلول', 'قطاع الاستشارات', 'إدارة الذكاء الاصطناعي والبيانات', 'إدارة الابتكار', 'إدارة الاستشارات']) {
    assert.ok(html.includes(name), `العقدة «${name}» غائبة من الشجرة`);
  }
  assert.match(html, /data-dep="D_AI" data-count="2"/, 'عدد إدارة الذكاء');
  assert.match(html, /data-dep="D_INNOV" data-count="2" aria-current="page"/, 'الإدارة المختارة مميّزة وعددها صحيح');
  assert.match(html, /data-dep="D_CONS" data-count="1"/, 'عدد إدارة الاستشارات');
  assert.match(html, /data-sector="SOL" data-count="4"/, 'عدد قطاع الحلول = مجموع إداراته');
  assert.match(html, /data-sector="CONS" data-count="1"/);
  assert.ok(html.includes('href="/app/team/org?department=D_AI"'), 'اختيار الإدارة لا يمرّ بالرابط');
  // صفوف الإدارة المختارة وحدها
  assert.equal(count(html, /data-emp="e_i1"/g), 1);
  assert.equal(count(html, /data-emp="e_dm"/g), 1);
  assert.equal(count(html, /data-emp="e_a1"/g), 0, 'مورد إدارة أخرى تسرّب إلى قائمة الإدارة المختارة');
  assert.ok(html.includes('مستشار ابتكار') && html.includes('/app/team/resources/e_i1'), 'صف المورد لا يقود إلى ملفه');
  assert.ok(html.includes('متاح <span class="tnum">50%</span>'), 'رقاقة التوفر للشهر الجاري (100 − 50) غائبة');
  assert.ok(html.includes('على رأس العمل'), 'رقاقة الارتباط غائبة');
  // الارتباطات المشتركة: مورد الابتكار على مشروع إدارة الذكاء — مرةً واحدة، وإدارته الأساسية لا تتغيّر
  assert.ok(html.includes('ارتباطات تشغيلية مشتركة'));
  assert.equal(count(html, /data-shared="e_i1"/g), 1, 'المورد المشترك يُعدّ مرةً واحدة');
  assert.equal(count(html, /data-shared="e_dm"/g), 0, 'مورد بلا تسكين خارجي ظهر في المشتركة');
  assert.ok(html.includes('منصة البيانات الوطنية') && html.includes('/app/project/P1'), 'مشروع الارتباط المشترك بلا رابط');
  assert.ok(html.includes('لا يغيّر الإدارة الأساسية'));
  assert.ok(html.includes('<b class="tnum">30%</b> هذا الشهر'), 'نسبة الشهر الجاري للارتباط المشترك');
});

test('S11: إدارةٌ بلا ارتباطات مشتركة تقولها باسمها، والنوع الخارجي يظهر رقاقةً', async () => {
  const html = await orgPage(await sess('u_admin'), { department: 'D_AI' });
  assert.doesNotMatch(html, LEAK);
  assert.equal(count(html, /data-emp="e_a[12]"/g), 2);
  assert.ok(html.includes('خارجي'), 'المورد المتعاقد لا يُعرض خارجياً');
  assert.ok(html.includes('لا ارتباطات مشتركة'));
  assert.equal(count(html, /data-shared="/g), 0);
});

test('S11: بلا إدارة مختارة ⇒ «اختر إدارة من الهيكل»؛ وبحثٌ بلا نتائج رسالته مختلفة مع مخرج', async () => {
  const none = await orgPage(await sess('u_admin'), {});
  assert.doesNotMatch(none, LEAK);
  assert.ok(none.includes('اختر إدارة من الهيكل'));
  assert.equal(count(none, /data-emp="/g), 0);
  const miss = await orgPage(await sess('u_admin'), { department: 'D_AI', q: 'لا-أحد-بهذا-الاسم' });
  assert.doesNotMatch(miss, LEAK);
  assert.ok(miss.includes('لا نتائج تطابق البحث') && miss.includes('امسح البحث'));
  assert.ok(!miss.includes('لا موارد في هذه الإدارة'), 'فراغ البحث خُلط بفراغ الإدارة');
  const hit = await orgPage(await sess('u_admin'), { department: 'D_AI', q: 'محلل' });
  assert.equal(count(hit, /data-emp="/g), 1, 'البحث الخادمي لا يرشّح');
  assert.ok(hit.includes('value="محلل"'), 'قيمة البحث لا تبقى في الحقل');
});

test('S11: مدير إدارة يرى أعداد إدارته وحدها، وإدارة غيره «خارج نطاقك» بلا رابط', async () => {
  const dm = await sess('u_dm');
  const html = await orgPage(dm, { department: 'D_INNOV' });
  assert.doesNotMatch(html, LEAK);
  assert.match(html, /data-dep="D_INNOV" data-count="2"/);
  assert.match(html, /data-dep="D_AI" data-scope="out"/, 'إدارة خارج النطاق عُرضت بعددها');
  assert.ok(!html.includes('href="/app/team/org?department=D_AI"'), 'رابطٌ يفتح على رفض');
  assert.equal(count(html, /data-emp="/g), 2);
  const other = await orgPage(dm, { department: 'D_AI' });
  assert.doesNotMatch(other, LEAK);
  assert.ok(other.includes('هذه الإدارة خارج نطاقك'));
  assert.equal(count(other, /data-emp="/g), 0, 'صفوف إدارة خارج النطاق تسرّبت');
});

// ── S12 ──────────────────────────────────────────────────────────────────────────────────────────
test('S12 حسب العمل: المشروع مرةً واحدة، مهمتاه الجاريتان مرةً لكلٍّ، والملخص يتصالح مع الصفوف', async () => {
  const html = await workPage(await sess('u_admin'), { year: YEAR, month: MONTH, by: 'work' });
  assert.doesNotMatch(html, LEAK, 'تسرّبت قيمة خام إلى الصفحة');
  assert.ok(html.includes('حسب العمل') && html.includes('حسب المورد'), 'مبدّل الوجهين غائب');
  assert.equal(count(html, /data-work="project:P1"/g), 1, 'المشروع يظهر مرةً واحدة');
  assert.equal(count(html, /data-work="bucket:bd"/g), 1, 'بند العمل الداخلي صفٌّ مستقل');
  assert.equal(count(html, /data-task="t1"/g), 1);
  assert.equal(count(html, /data-task="t2"/g), 1);
  assert.equal(count(html, /data-task="t3"/g), 0, 'المهمة المنجزة عُدّت');
  assert.equal(count(html, /data-task="t4"/g), 0, 'المهمة الشخصية عُدّت على الفريق');
  // الملخص = ما في الصفوف
  assert.equal(kpi(html, 'tasks'), 2);
  assert.equal(kpi(html, 'tasks'), count(html, /data-task="/g), 'عدّاد المهام لا يطابق صفوفها');
  assert.equal(kpi(html, 'blocked'), 1);
  assert.equal(kpi(html, 'works'), 2);
  assert.equal(kpi(html, 'works'), count(html, /data-work="/g), 'عدّاد الأعمال لا يطابق صفوفها');
  assert.equal(kpi(html, 'resources'), 5, 'الموارد ضمن النطاق');
  assert.ok(html.includes('منهم <span class="tnum">2</span> على عمل أو مهمة'), 'المرتبطون بعمل هذا الشهر');
  // Σ المؤكد على المشروع 50 + 30 = 80% بوحدةٍ معلنة
  assert.ok(html.includes('<b class="tnum">80%</b>'), 'إجمالي التسكين المؤكد للمشروع');
  assert.ok(html.includes('<span class="tnum">0.8</span> دوام كامل'), 'وحدة الدوام الكامل غائبة');
  assert.ok(html.includes('إجمالي التسكين المؤكد'));
  // العائق والالتزام القادم والروابط
  assert.ok(html.includes('بانتظار بيانات الاختبار من العميل'), 'سبب التعطّل غائب');
  assert.ok(html.includes('عائق واحد'), 'عدّاد العوائق على الصف');
  assert.ok(html.includes('مراجعة متطلبات المنصة'), 'الالتزام القادم غائب');
  assert.ok(html.includes(`/app/team/planning?target=project:P1&amp;from=${KEY}&amp;to=`), 'رابط «عرض التوزيع» بسياق العمل والفترة');
  assert.ok(html.includes('href="/app/project/P1"'), 'رابط السجل الأصلي');
  assert.ok(html.includes('تطوير أعمال') && html.includes('لا سجل مستقل له'), 'البند الداخلي بلا صفحة سجل يُقال');
  assert.ok(html.includes('/app/team/resources/e_a1'), 'مسؤول المهمة يقود إلى ملفه');
  assert.ok(!/ر\.س|ريال|halalas/.test(html), 'مال في شاشة الالتزامات');
});

test('S12 حسب المورد: الانعكاس يعرض الشخص وأعماله ومهامه، ويتصالح مع الوجه الأول', async () => {
  const html = await workPage(await sess('u_admin'), { year: YEAR, month: MONTH, by: 'resource' });
  assert.doesNotMatch(html, LEAK);
  assert.equal(count(html, /data-resource="/g), 5, 'كل الموارد ضمن النطاق صفوف');
  assert.equal(count(html, /data-resource="e_i1"/g), 1);
  assert.equal(count(html, /data-task="t2"/g), 1);
  assert.equal(count(html, /data-task="t1"/g), 1);
  assert.equal(count(html, /data-task="t3"|data-task="t4"/g), 0);
  assert.equal(kpi(html, 'tasks'), 2);
  assert.equal(kpi(html, 'blocked'), 1);
  assert.equal(kpi(html, 'works'), 2, 'أعداد الأعمال تتصالح بين الوجهين');
  assert.equal(kpi(html, 'resources'), 5);
  assert.ok(html.includes('منصة البيانات الوطنية') && html.includes('تطوير أعمال'), 'أعمال المورد');
  assert.ok(html.includes('لا حساب دخول'), 'مورد بلا حساب دخول يُقال سببه بدل «لا مهام»');
  assert.ok(html.includes('لا توجد مهام مسجلة'), 'من له حساب بلا مهام ⇒ «لا توجد مهام مسجلة»');
  assert.ok(html.includes('/app/team/resources/e_i1'), 'صف المورد يقود إلى ملفه');
  assert.ok(html.includes('/app/team/planning?q='), 'رابط التوزيع من المورد');
});

test('S12: فراغٌ صادق — إدارةٌ بلا تسكين ولا مهام تقول ذلك وتقود إلى التخطيط', async () => {
  const html = await workPage(await sess('u_admin'), { year: YEAR, month: MONTH, department: 'D_CONS', by: 'work' });
  assert.doesNotMatch(html, LEAK);
  assert.equal(count(html, /data-work="/g), 0);
  assert.ok(html.includes('لا تسكين ولا مهام جارية'));
  assert.ok(html.includes('/app/team/planning?from='), 'حالة الفراغ بلا خطوة تالية');
  assert.equal(kpi(html, 'resources'), 1);
  assert.equal(kpi(html, 'tasks'), 0);
});

test('S12: مدير إدارة يقرأ إدارته وحدها، وإدارة غيره تُرفض من الخدمة برسالة عربية', async () => {
  const dm = await sess('u_dm');
  await assert.rejects(() => workPage(dm, { year: YEAR, month: MONTH, department: 'D_AI', by: 'work' }), /خارج نطاقك/);
  const html = await workPage(dm, { year: YEAR, month: MONTH, by: 'work' });
  assert.doesNotMatch(html, LEAK);
  assert.equal(count(html, /data-work="project:P1"/g), 1);
  assert.equal(count(html, /data-task="t2"/g), 1);
  assert.equal(count(html, /data-task="t1"/g), 0, 'مهمة موردٍ خارج النطاق تسرّبت');
  assert.equal(kpi(html, 'tasks'), 1);
  assert.equal(kpi(html, 'resources'), 2);
  assert.ok(!html.includes('إدارة الذكاء الاصطناعي والبيانات —'), 'فلتر الإدارات يعرض إدارةً خارج النطاق');
  await assert.rejects(() => workPage(dm, { by: 'nonsense' }), /بحسب العمل أو بحسب المورد/);
});
