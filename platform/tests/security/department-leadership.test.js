// ═══ النطاق يتبع القيادة لا الانتماء ═══════════════════════════════════════════════════════
//
// العطل بلسان المالك: «موظفين إدارة الابتكار مو بيانين». والرجل مسمّاه الوظيفي في المنصة نفسها
// «مدير إدارة الابتكار وإدارة الذكاء الاصطناعي والبيانات» — يقود **إدارتين** مكتوبتين باسمه في
// عمود `department.manager_user_id` منذ أول إصدار. لكن سجلّ موظفه يحمل إدارةً واحدة، وكل فحص
// نطاق كان يقارن ذلك العمود المفرد **بمساواة**. فكانت النتيجة إنساناً يقود فريقين ويرى واحداً:
// لوحته تُخفي نصف من يقود، وملف موظفٍ يقوده يُرَدّ عنه بجملة «هذا الشخص خارج إدارتك».
//
// ما يُثبَت هنا — وكلٌّ منه يجب أن يسقط لو رُدَّت المساواة مكان العضوية:
//   ١) قائد إدارتين يرى أهل الإدارتين وعملهما — حالة ريان بعينها.
//   ٢) ومن يقود إدارةً لا ينتمي إليها يراها: القيادة وحدها تكفي، والانتماء ليس شرطاً.
//   ٣) ومن لا يقود شيئاً يبقى على إدارته وحدها بالضبط — لا إدارة مجاورة ولا قطاع.
//   ٤) وقارئٌ بلا انتماء ولا قيادة لا يرى أحداً — فشلٌ آمن، والقطاع مأهول لغيره فالفراغ قرار.
//   ٥) ومدير الإدارة يفتح مركز القطاع وتصله أرقامه (ربح · إيراد · مستهدف)، ولا يفتح لوحة قيادة
//      الشركة، ولا يقرأ راتب أحد.
//   ٦) و`personDossier` تحديداً: قائد الإدارتين يفتح ملف شخصٍ من أيٍّ منهما.
//
// والمستخدم يُقرأ من **مسار الجلسة نفسه** (`resolveUser`) لا من كائن مصنوع في الفحص: مجموعة
// الإدارات تُبنى هناك، فلو لم تُبنَ لسقطت هذه الفحوص — وهو المطلوب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-deptlead-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const db = await import('../../src/core/db/index.js');
const { initRbac, can, canSeeSensitive, scopeReaches, redact } = await import('../../src/core/rbac/index.js');
await initRbac();
const org = await import('../../src/modules/org/org.js');
const tasks = await import('../../src/modules/pmo/tasks.js');
const { resolveUser } = await import('../../src/core/http/context.js');
const { PAGE_ACCESS, seesCompanyPerformance } = await import('../../src/core/policy/pages.js');
const { sectorViewMode, sectorPage } = await import('../../src/web/views/sector.js');
const { sectorDashboard } = await import('../../src/core/reports/metrics.js');
const P = await import('../../src/core/reports/periods.js');
const empAdapter = (await import('../../src/modules/io/adapters/employees.js')).default;

const T = '2026-01-01T00:00:00Z';
const FAR = '2099-01-01T00:00:00.000Z';
const YEAR = 2026;

// أسماء حقيقية الشكل: الفحص يبحث عن **اسم إنسان** في الشاشة لا عن معرّف، فالغياب يُقرأ كما
// يقرؤه المالك حين يقول «سجى مو بيانة».
const RAYAN = 'ريان ظفر (فحص)';
const SAJA = 'سجى لشكر (فحص)';
const HADI = 'هادي كرمي (فحص)';
const AI_ONE = 'زميل الذكاء الاصطناعي (فحص)';
const NEIGHBOUR = 'موظف الإدارة المجاورة (فحص)';
const SOLO = 'مدير الإدارة المجاورة (فحص)';
const OUTSIDER = 'قائد بلا انتماء (فحص)';
const REMOTE_ONE = 'موظف الإدارة المقودة عن بعد (فحص)';
const OTHER_SECTOR = 'موظف قطاع آخر (فحص)';

const D = {};   // اسم مختصر ⟵ صف الإدارة
const E = {};   // اسم الموظف ⟵ معرّفه
const U = {};   // اسم الحساب ⟵ المستخدم كما يحلّه الخادم فعلاً

const adminCtx = { user: { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
  sector_id: null, department_id: null, projectIds: new Set(), teamIds: new Set() }, ip: '127.0.0.1' };

async function account(id, { role = 'department_manager', sector = 'S1', scope = 'department', name }) {
  await db.insert('app_user', { id, username: id, name_ar: name, role_id: role, sector_id: sector,
    scope, active: 1, must_change_pw: 0, failed_attempts: 0, created_at: T });
  return id;
}
// جلسة حقيقية ثم resolveUser — نقرأ المستخدم من المسار الذي يقرأه الخادم نفسه.
async function asUser(userId) {
  const sid = 'sess_' + userId;
  await db.insert('session', { id: sid, user_id: userId, created_at: T, expires_at: FAR });
  const u = await resolveUser(sid);
  assert.ok(u, `جلسة ${userId} تُحلّ إلى مستخدم`);
  return u;
}
const opens = async (reader, target) => {
  try { await tasks.personDossier(reader, target); return true; } catch { return false; }
};
const rosterNames = async (u) => (await org.staffingRoster(u, {})).roster.map((e) => e.name_ar);
const boardNames = async (u) => (await tasks.teamTasks(u)).map((b) => b.name);

before(async () => {
  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول (فحص)', kind: 'delivery', active: 1,
    sort_order: 1, target_revenue_halalas: 900000000, target_sales_halalas: 1200000000,
    target_margin_pct: 25, created_at: T });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع الاستشارات (فحص)', kind: 'delivery', active: 1,
    sort_order: 2, target_revenue_halalas: 500000000, target_sales_halalas: 600000000, created_at: T });
  await db.insert('revenue_line', { id: 'rev_1', sector_id: 'S1', amount_halalas: 640000000,
    month: 3, year: YEAR, label: 'إيراد محقق', auto: 0, created_at: T });

  // الحسابات أولاً: القيادة تُكتب على الإدارة بمعرّف الحساب.
  await account('u_rayan', { name: RAYAN });
  await account('u_solo', { name: SOLO });
  await account('u_outsider', { name: OUTSIDER });
  await account('u_nowhere', { name: 'حساب بلا موظف (فحص)' });
  await account('u_lead', { role: 'sector_lead', scope: 'sector', name: 'قائد القطاع (فحص)' });
  await account('u_saja', { role: 'employee', scope: 'own', name: SAJA });
  await account('u_hadi', { role: 'employee', scope: 'own', name: HADI });
  await account('u_ai_one', { role: 'employee', scope: 'own', name: AI_ONE });
  await account('u_neighbour', { role: 'employee', scope: 'own', name: NEIGHBOUR });
  await account('u_remote', { role: 'employee', scope: 'own', name: REMOTE_ONE });

  // الإدارات عبر الخدمة (تُدقَّق كأي كتابة): إدارتان يقودهما ريان، وثالثة مجاورة، ورابعة
  // يقودها من لا ينتمي إلى إدارة أصلاً.
  D.inno = await org.createDepartment(adminCtx, { sector_id: 'S1', name_ar: 'إدارة الابتكار (فحص)', manager_user_id: 'u_rayan' });
  D.ai = await org.createDepartment(adminCtx, { sector_id: 'S1', name_ar: 'إدارة الذكاء الاصطناعي والبيانات (فحص)', manager_user_id: 'u_rayan' });
  D.other = await org.createDepartment(adminCtx, { sector_id: 'S1', name_ar: 'إدارة مجاورة (فحص)', manager_user_id: 'u_solo' });
  D.remote = await org.createDepartment(adminCtx, { sector_id: 'S1', name_ar: 'إدارة تُقاد عن بعد (فحص)', manager_user_id: 'u_outsider' });

  const staff = [
    [RAYAN, D.ai.id, 'u_rayan'], [SAJA, D.inno.id, 'u_saja'], [HADI, D.inno.id, 'u_hadi'],
    [AI_ONE, D.ai.id, 'u_ai_one'], [NEIGHBOUR, D.other.id, 'u_neighbour'], [SOLO, D.other.id, 'u_solo'],
    [REMOTE_ONE, D.remote.id, 'u_remote'],
    // يقود إدارةً ولا ينتمي إلى أي إدارة — فصل القيادة عن الانتماء صراحةً.
    [OUTSIDER, null, 'u_outsider'],
  ];
  for (const [name, depId, userId] of staff) {
    const e = await org.createEmployee(adminCtx, { name_ar: name, sector_id: 'S1', department_id: depId, job_title: 'موظف' });
    E[name] = e.id;
    if (userId) await org.linkUserToEmployee(adminCtx, { employeeId: e.id, userId });
  }
  // موظف في قطاع آخر — بدونه لا يُثبت أن الحدّ عند القطاع أيضاً.
  await account('u_s2', { role: 'employee', sector: 'S2', scope: 'own', name: OTHER_SECTOR });
  const eS2 = await org.createEmployee(adminCtx, { name_ar: OTHER_SECTOR, sector_id: 'S2', department_id: null, job_title: 'موظف' });
  await org.linkUserToEmployee(adminCtx, { employeeId: eS2.id, userId: 'u_s2' });

  // مهمة مفتوحة لكل شخص — لوحة الفريق تُبنى من العمل لا من الأسماء وحدها.
  for (const [uid, title] of [['u_saja', 'مهمة الابتكار (فحص)'], ['u_hadi', 'مهمة ثانية للابتكار (فحص)'],
    ['u_neighbour', 'مهمة الإدارة المجاورة (فحص)'], ['u_remote', 'مهمة الإدارة المقودة عن بعد (فحص)'],
    ['u_s2', 'مهمة قطاع آخر (فحص)']]) {
    await db.insert('task', { id: 'tsk_' + uid, title, sector_id: uid === 'u_s2' ? 'S2' : 'S1',
      work_kind: 'internal', assignee_user_id: uid, priority: 'P2', status: 'TODO', created_at: T });
  }

  for (const uid of ['u_rayan', 'u_solo', 'u_outsider', 'u_nowhere', 'u_lead', 'u_saja']) U[uid] = await asUser(uid);
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ═════════════ (٠) التثبيت: بدونه لا سلوك يُفحَص أصلاً ═════════════

test('التثبيت: القيادة مكتوبة على الإدارتين، والانتماء واحد كما هو', async () => {
  const led = await db.all('SELECT id FROM department WHERE manager_user_id = ? AND deleted_at IS NULL ORDER BY id', ['u_rayan']);
  assert.deepEqual(led.map((r) => r.id).sort(), [D.inno.id, D.ai.id].sort(), 'إدارتان تحت قيادته');
  assert.equal(U.u_rayan.department_id, D.ai.id, 'وانتماؤه واحد — العمود لم يُمسّ، فمستهلكوه لم يُكسروا');
  assert.deepEqual([...U.u_rayan.departmentIds].sort(), [D.inno.id, D.ai.id].sort(),
    'ومجموعة إداراته = انتماؤه ∪ قيادته');
});

// ═════════════ (١) قائد إدارتين يرى الإدارتين — حالة ريان ═════════════

test('كشف الفريق: قائد الإدارتين يرى أهل الإدارتين معاً', async () => {
  const names = await rosterNames(U.u_rayan);
  for (const n of [SAJA, HADI]) assert.ok(names.includes(n), `${n} من إدارة يقودها ولا ينتمي إليها — وهي الشكوى بعينها`);
  for (const n of [RAYAN, AI_ONE]) assert.ok(names.includes(n), `${n} من إدارة انتمائه`);
});

test('لوحة عمل الفريق: الإدارتان تظهران بأهلهما وعملهما', async () => {
  const w = await tasks.teamWorkload(U.u_rayan, { year: YEAR });
  const shown = w.departments.map((d) => d.id).sort();
  assert.deepEqual(shown, [D.inno.id, D.ai.id].sort(), 'إدارتان في لوحة واحدة — كما يقول مسمّاه الوظيفي');
  const people = w.departments.flatMap((d) => d.people.map((p) => p.name));
  for (const n of [SAJA, HADI, AI_ONE]) assert.ok(people.includes(n), `${n} حاضر`);
  assert.equal(people.includes(NEIGHBOUR), false, 'ولا أحد من إدارة لا يقودها');
  assert.equal(people.includes(REMOTE_ONE), false);
});

test('مهام فريقي: مهام الإدارتين تصله، ومهام الإدارة المجاورة لا', async () => {
  const titles = (await tasks.teamTasks(U.u_rayan)).flatMap((b) => b.tasks.map((t) => t.title));
  assert.ok(titles.includes('مهمة الابتكار (فحص)'), 'عمل الإدارة التي يقودها ولا ينتمي إليها');
  assert.ok(titles.includes('مهمة ثانية للابتكار (فحص)'));
  assert.equal(titles.includes('مهمة الإدارة المجاورة (فحص)'), false);
  assert.equal(titles.includes('مهمة قطاع آخر (فحص)'), false, 'ولا توسيع إلى القطاع ولا إلى غيره');
});

test('ملف الشخص: يفتح موظفاً من أيٍّ من إدارتيه، ويُرَدّ عن الإدارة المجاورة', async () => {
  assert.equal(await opens(U.u_rayan, 'u_saja'), true, 'من الإدارة التي يقودها فقط — كان يُرَدّ «خارج إدارتك»');
  assert.equal(await opens(U.u_rayan, 'u_hadi'), true);
  assert.equal(await opens(U.u_rayan, 'u_neighbour'), false, 'إدارة لا يقودها ولا ينتمي إليها');
  assert.equal(await opens(U.u_rayan, 'u_s2'), false, 'ولا قطاع آخر');
  await assert.rejects(() => tasks.personDossier(U.u_rayan, 'u_neighbour'), (e) => {
    assert.match(e.message, /خارج إدارتك/, 'رسالة عربية تقول ما حدث');
    return true;
  });
});

test('تصدير الموظفين يتبع المجموعة نفسها — لا ملف ينقص نصف من يقود', async () => {
  const names = (await empAdapter.fetchRows(U.u_rayan, {})).map((r) => r.name_ar);
  for (const n of [SAJA, HADI, RAYAN, AI_ONE]) assert.ok(names.includes(n), `${n} في الملف`);
  assert.equal(names.includes(NEIGHBOUR), false, 'ولا اسم من إدارة لا يقودها');
  assert.ok((await empAdapter.fetchRows(U.u_rayan, {})).every((r) => !('salary' in r)), 'وبلا عمود راتب');
});

// ═════════════ (٢) القيادة تكفي وحدها — بلا انتماء ═════════════

test('من يقود إدارةً لا ينتمي إليها: يراها كاملةً', async () => {
  assert.equal(U.u_outsider.department_id, null, 'المقدّمة: لا انتماء له إطلاقاً');
  assert.deepEqual([...U.u_outsider.departmentIds], [D.remote.id], 'ومجموعته = ما يقوده وحده');
  const names = await rosterNames(U.u_outsider);
  assert.deepEqual(names, [REMOTE_ONE], 'أهل الإدارة التي يقودها بالضبط — والقيادة وحدها هي السبب');
  assert.equal(await opens(U.u_outsider, 'u_remote'), true);
  assert.equal(await opens(U.u_outsider, 'u_saja'), false, 'وما لا يقوده مغلق');
  assert.deepEqual(await boardNames(U.u_outsider), [REMOTE_ONE]);
});

// ═════════════ (٣) من لا يقود شيئاً: إدارته وحدها بالضبط ═════════════

test('من لا يقود إلا إدارته: لا يرى إدارةً مجاورة ولا القطاع', async () => {
  assert.deepEqual([...U.u_solo.departmentIds], [D.other.id], 'إدارة واحدة — انتماءٌ وقيادةٌ لنفسها');
  const names = await rosterNames(U.u_solo);
  assert.deepEqual(names.slice().sort(), [NEIGHBOUR, SOLO].sort(), 'إدارته بالضبط، لا أكثر');
  for (const n of [SAJA, HADI, AI_ONE, RAYAN]) assert.equal(names.includes(n), false, `${n} خارج نطاقه`);
  assert.equal(await opens(U.u_solo, 'u_saja'), false, 'ولا يفتح ملف من لا يقوده');
  const titles = (await tasks.teamTasks(U.u_solo)).flatMap((b) => b.tasks.map((t) => t.title));
  assert.deepEqual(titles, ['مهمة الإدارة المجاورة (فحص)'], 'وعمل إدارته وحده');
});

test('نطاق القطاع لم يتغيّر: قائد القطاع يرى الإدارات الثلاث ولا يتعدّى قطاعه', async () => {
  const names = await rosterNames(U.u_lead);
  for (const n of [SAJA, HADI, AI_ONE, NEIGHBOUR, RAYAN, OUTSIDER, REMOTE_ONE]) assert.ok(names.includes(n), `${n} داخل قطاعه`);
  assert.equal(names.includes(OTHER_SECTOR), false, 'ولا أحد من قطاع آخر');
});

// ═════════════ (٤) الفشل الآمن: لا انتماء ولا قيادة ⟵ لا أحد ═════════════

test('قارئٌ بلا إدارة ولا قيادة: لا يرى أحداً — والقطاع مأهول لغيره فالفراغ قرار', async () => {
  assert.equal(U.u_nowhere.department_id, null);
  assert.equal(U.u_nowhere.departmentIds.size, 0, 'مجموعة فارغة');
  assert.deepEqual(await rosterNames(U.u_nowhere), [], 'لا صفّ واحد');
  assert.deepEqual(await tasks.teamTasks(U.u_nowhere), []);
  assert.deepEqual((await tasks.teamWorkload(U.u_nowhere, { year: YEAR })).departments, []);
  assert.deepEqual(await empAdapter.fetchRows(U.u_nowhere, {}), [], 'ولا ملف يُصدَّر');
  for (const target of ['u_saja', 'u_neighbour', 'u_s2']) {
    assert.equal(await opens(U.u_nowhere, target), false, 'ولا ملف يُفتح');
  }
  assert.ok((await rosterNames(U.u_lead)).length > 0, 'والقطاع مأهول — فالفراغ أعلاه قرار لا صدفة');
});

// ═════════════ (٥) مركز القطاع بأرقامه — ولا شركة ولا راتب ═════════════

test('مدير الإدارة يفتح مركز القطاع بوجهه القيادي لا بوجهه الشخصي', () => {
  assert.equal(PAGE_ACCESS.sector(U.u_rayan), true, 'الباب مفتوح كما كان');
  assert.equal(sectorViewMode(U.u_rayan).mode, 'command',
    'والغرفة لم تعد فارغة: كان يسقط إلى «قطاعي» فلا ربح ولا إيراد ولا مستهدف');
});

test('وتصله أرقام الربح والإيراد والمستهدف فعلاً', async () => {
  assert.equal(canSeeSensitive(U.u_rayan, 'margin'), true, 'الربح — قرار مالك صريح');
  assert.equal(canSeeSensitive(U.u_rayan, 'cost'), true, 'والكلفة');
  const sd = await sectorDashboard(U.u_rayan, 'S1', { year: YEAR });
  assert.equal(sd.revenue_halalas, 640000000, 'الإيراد المحقق برقمه');
  assert.equal(sd.target_revenue_halalas, 900000000, 'والمستهدف');
  assert.equal(sd.target_sales_halalas, 1200000000, 'ومستهدف المبيعات');
  const html = await sectorPage(U.u_rayan, { year: YEAR });
  assert.ok(!/undefined|\bNaN\b|\[object/.test(html), 'الشاشة بلا تسرّب قيم');
  assert.ok(html.includes('6,400,000') || html.includes('6.4'), 'ورقم الإيراد يظهر في الشاشة');
});

test('ولا يفتح لوحة قيادة الشركة — الاتساع في أرقام قطاعه لا في الشركة', () => {
  assert.equal(seesCompanyPerformance(U.u_rayan), false, 'الحدّ الذي لا يُعبَر');
  assert.equal(PAGE_ACCESS.ceo(U.u_rayan), false);
  assert.equal(PAGE_ACCESS.portfolio(U.u_rayan), false);
});

test('ولا يقرأ راتب أحد — الختم لا يُفتح مهما اتّسعت مسؤوليته', async () => {
  assert.equal(canSeeSensitive(U.u_rayan, 'salary'), false);
  assert.equal(can(U.u_rayan, 'read', 'salary'), false);
  const row = redact(U.u_rayan, 'employee', { id: E[SAJA], name_ar: SAJA, salary_halalas: 1800000 });
  assert.equal(row.salary_halalas, null, 'الراتب محجوب حتى عمّن يقود صاحبه');
  const d = await tasks.personDossier(U.u_rayan, 'u_saja');
  assert.equal(JSON.stringify(d).includes('salary'), false, 'ولا يتسرّب من ملف الشخص');
});

// ═════════════ (٦) عدسة التقارير على المحور نفسه ═════════════

test('تقرير الإدارة: كلتا إدارتيه مقروءتان، والمجاورة لا', () => {
  assert.equal(P.departmentReadable(U.u_rayan, D.inno), true, 'التي يقودها ولا ينتمي إليها');
  assert.equal(P.departmentReadable(U.u_rayan, D.ai), true);
  assert.equal(P.departmentReadable(U.u_rayan, D.other), false, 'إدارة لا يقودها');
  assert.equal(P.departmentReadable(U.u_solo, D.inno), false, 'ومن لا يقود إلا إدارته لا يقرأ غيرها');
  assert.equal(P.departmentReadable(U.u_nowhere, D.inno), false, 'والفراغ لا يُقرأ توسعةً');
});

// ═════════════ (٧) محرّك القرار نفسه: عضوية لا مساواة ═════════════

test('فحص النطاق يقرأ المجموعة، ومن يركّب مستخدماً بلا مجموعة يُقرأ كما كان بالضبط', () => {
  assert.equal(scopeReaches(U.u_rayan, 'department', { department_id: D.inno.id }), true);
  assert.equal(scopeReaches(U.u_rayan, 'department', { department_id: D.ai.id }), true);
  assert.equal(scopeReaches(U.u_rayan, 'department', { department_id: D.other.id }), false);
  // توافق: أدوات الفحص والسيناريوهات تركّب كائن مستخدم بلا مجموعة — يُقرأ بإدارة انتمائه وحدها.
  const legacy = { id: 'x', sector_id: 'S1', department_id: D.ai.id };
  assert.equal(scopeReaches(legacy, 'department', { department_id: D.ai.id }), true);
  assert.equal(scopeReaches(legacy, 'department', { department_id: D.inno.id }), false);
  const homeless = { id: 'y', sector_id: 'S1', department_id: null };
  assert.equal(scopeReaches(homeless, 'department', { department_id: D.ai.id }), false, 'فشلٌ آمن');
});

// ═════════════ (٨) كتابات التثبيت مدقَّقة ═════════════

test('كل إدارة أُنشئت في هذا الفحص تركت سطر تدقيق باسم من أنشأها', async () => {
  const rows = await db.all("SELECT * FROM audit_log WHERE resource = 'department' AND action = 'create' ORDER BY at, id");
  assert.equal(rows.length, 4, 'سطر لكل إدارة');
  assert.ok(rows.every((r) => r.user_id === 'u_admin' && r.sector_id === 'S1'));
  const ids = rows.map((r) => r.resource_id).sort();
  assert.deepEqual(ids, [D.inno.id, D.ai.id, D.other.id, D.remote.id].sort());
  // والربط بين الحساب والموظف مدقَّق على الطرفين — بدونه لا تُعرف إدارة القارئ أصلاً
  const link = await db.all("SELECT * FROM audit_log WHERE resource = 'app_user' AND resource_id = ?", ['u_rayan']);
  assert.ok(link.length >= 1, 'ربط حساب قائد الإدارتين مدقَّق');
});
