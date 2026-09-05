// شاشات S13–S16 (مصفوفة التسكين، درجا الإضافة والتجاوز، طلبات التسكين) — قبول الشاشة كما في
// الموجّه §11 على قاعدةٍ مؤقتة ببيانات صغيرة:
//   • S13: الأشهر بترتيبها الزمني (الأقدم أولاً في المستند = يميناً في RTL)، الخلية المتجاوزة
//     تحمل `over` وكلمة «تجاوز»، خلية من انتهى ارتباطه «خارج الارتباط»، المبدئي متقطّع ومُسمّى
//     ويختفي بـ?tentative=0، الطلب المعلَّق طبقة «بانتظار الاعتماد»، قالب S14/S15 حاضر، لا تسرّب.
//   • الحجب: قارئٌ بلا حق التخطيط لا يرى «تسكين جديد»؛ ومن لا يقرأ الفريق يرى حالةً مصمَّمة لا عطلاً.
//   • S16: الشرائح الثلاث والعدّاد، لوحة المراجعة بـ«إدارة المورد» (إدارة) و«مدير المورد» (شخص)،
//     أزرار القرار لمن وُجِّه إليه والسحب لصاحبه، و«بانتظار قراري» لا يعرض طلباً بُتّ فيه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-ui-planning-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, alloc, resolveUser, MONTHS_AR;
const T = new Date().toISOString();
// «اليوم» يوم الرياض كما تقرؤه الخدمة (T15) — الشهر الجاري هو أول عمود في المصفوفة الافتراضية.
const TODAY = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const KEY = TODAY.slice(0, 7);
const YEAR = Number(KEY.slice(0, 4)); const MONTH = Number(KEY.slice(5, 7));
const PREV_END = new Date(Date.UTC(YEAR, MONTH - 1, 0)).toISOString().slice(0, 10);   // آخر يوم من الشهر السابق
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
const visible = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
const noLeak = (html, where) => { const v = visible(html); const m = LEAK.exec(v); assert.ok(!m, `تسرّب قيمة خام في ${where}: ${m && m[0]} … ${v.slice(Math.max(0, (m ? m.index : 0) - 80), (m ? m.index : 0) + 40)}`); };
const cellOf = (html, emp, key) => { const m = new RegExp(`<div class="cell[^"]*"[^>]*data-emp="${emp}" data-month="${key}"[\\s\\S]*?<\\/div><\\/td>`).exec(html); return m ? m[0] : ''; };
const rowOf = (html, emp) => { const m = new RegExp(`<tr data-emp="${emp}">[\\s\\S]*?<\\/tr>`).exec(html); return m ? m[0] : ''; };

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
let reqId;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  ({ MONTHS_AR } = await import('../../src/core/i18n/time.js'));
  P = await import('../../src/web/pages.js');
  alloc = await import('../../src/modules/team/allocations.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'هيئة البيانات', created_at: T });
  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');   // قائد القطاع — يملك أمر أهله (تطبيق مباشر)
  await mkUser('u_dm', 'department_manager');               // مدير إدارة البيانات — مراجع الطلبات
  await mkUser('u_ops', 'operations');                      // العمليات — تطلب ولا تملك أمر المورد ⇒ طلب معلَّق
  await mkUser('u_hr', 'hr', null, 'own');                  // قارئٌ للشركة بلا حق تخطيط (لا نطاق ولا منح طلب)
  await mkUser('u_emp', 'employee');                        // موظف بلا قراءة الفريق

  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  const mkEmp = (id2, name, extra = {}) => db.insert('employee', { id: id2, name_ar: name, sector_id: 'SOL', department_id: 'D_DATA',
    job_title: 'محلل بيانات', active: 1, hire_date: '2024-01-01', created_at: T, ...extra });
  await mkEmp('e_full', 'سارة القحطاني', { capacity_pct: 100 });
  await mkEmp('e_half', 'محمد العمري', { capacity_pct: 50 });
  await mkEmp('e_gone', 'ليلى الحربي', { hire_date: '2023-01-01', end_date: PREV_END });
  await mkEmp('e_emp', 'خالد الشمري', { user_id: 'u_emp' });
  await db.update('app_user', 'u_emp', { employee_id: 'e_emp' });

  await db.insert('project', { id: 'P1', name_ar: 'منصة تحليل البيانات', code: 'DAT-01', sector_id: 'SOL', department_id: 'D_DATA',
    client_id: 'CL', status: 'IN_PROGRESS', created_at: T });
  const mk = (id2, emp, name, extra) => db.insert('allocation', { id: id2, employee_id: emp, person_name_ar: name, sector_id: 'SOL',
    type: 'member', year: YEAR, source: 'manual', created_at: T, ...extra });
  // سارة: 100% مشروع + 20% إدارة مشاريع في الشهر الجاري ⇒ 120% تجاوز (يبقى ويُعلَّم — T07)
  await mk('al_p', 'e_full', 'سارة القحطاني', { project_id: 'P1', project_name: 'منصة تحليل البيانات', monthly_json: JSON.stringify({ [MONTH]: 1.0 }) });
  await mk('al_b', 'e_full', 'سارة القحطاني', { project_id: null, work_bucket: 'pmo', project_name: 'إدارة مشاريع', monthly_json: JSON.stringify({ [MONTH]: 0.2 }) });
  // محمد: 30% مبدئي على المشروع — طبقة لا تُخصم (T02)
  await mk('al_t', 'e_half', 'محمد العمري', { project_id: 'P1', project_name: 'منصة تحليل البيانات', monthly_json: JSON.stringify({ [MONTH]: 0.3 }), status: 'tentative' });

  // طلب معلَّق حقيقي عبر الخدمة: العمليات تطلب 20% تطوير أعمال لمحمد ⇒ يُوجَّه إلى مدير الإدارة
  // (على المشروع نفسه تسكينٌ مبدئي قائم — والخدمة ترفض تسكيناً ثانياً على الوجهة نفسها في السنة)
  const r = await alloc.submitRequest(await ctxOf('u_ops'),
    { kind: 'new', employeeIds: ['e_half'], target: { kind: 'bucket', id: 'bd' }, from: KEY, to: KEY, pct: 20, allocStatus: 'confirmed' },
    { idempotencyKey: 'ui-planning-t1' });
  reqId = r.requests[0].id;
  assert.equal(r.requests[0].status, 'pending', 'الطلب لم يُعلَّق — الفحوص التالية تعتمد على طلبٍ بانتظار قرار المدير');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── S13 ─────────────────────────────────────────────────────────────────────────
test('S13: المصفوفة تعرض أشهر الفترة بترتيبها، والتجاوز والمبدئي وخارج الارتباط والمعلَّق كلٌّ بعلامته', async () => {
  const lead = await sess('u_lead');
  const html = await P.planningPage(lead, {});
  noLeak(html, 'S13');
  const first = `${MONTHS_AR[MONTH - 1]} ${YEAR}`;
  const nextIdx = MONTH === 12 ? 0 : MONTH; const nextYear = MONTH === 12 ? YEAR + 1 : YEAR;
  const second = `${MONTHS_AR[nextIdx]} ${nextYear}`;
  assert.ok(html.includes(first) && html.includes(second), 'أشهر الفترة غائبة عن الرأس');
  assert.ok(html.indexOf(`>${first}<`) < html.indexOf(`>${second}<`), 'الأقدم ليس أول الأعمدة — الترتيب الزمني معكوس');
  assert.ok(html.includes('الشهر الحالي'), 'الشهر الجاري غير معلَّم');

  const over = cellOf(html, 'e_full', KEY);
  assert.ok(over.includes('class="cell over"'), 'خلية 120% لا تحمل صنف over');
  assert.ok(over.includes('تجاوز +<span class="tnum">20%</span>'), 'نص التجاوز غائب أو الرقم مختلف: ' + over.slice(0, 300));
  assert.ok(over.includes('data-action="pl-fix"'), 'الخلية المتجاوزة لا تفتح S15');
  assert.ok(over.includes('120%'), 'المؤكد 120% لم يبقَ كما هو (لا تطبيع صامت — T07)');

  const gone = cellOf(html, 'e_gone', KEY) || rowOf(html, 'e_gone');
  assert.ok(rowOf(html, 'e_gone').includes('cell out') && rowOf(html, 'e_gone').includes('خارج الارتباط'), 'منتهي الارتباط لا يظهر «خارج الارتباط»');
  assert.ok(!rowOf(html, 'e_gone').includes('data-action="pl-cell"'), 'خلية خارج الارتباط قابلة للنقر لتسكين مؤكد');

  const half = cellOf(html, 'e_half', KEY);
  assert.ok(half.includes('class="li tent"') && half.includes('· مبدئي'), 'المبدئي ليس متقطّعاً/مسمّى');
  assert.ok(half.includes('بانتظار الاعتماد') && half.includes('class="li pend"'), 'الطلب المعلَّق ليس طبقةً ظاهرة');
  assert.ok(half.includes('متاح <span class="tnum">100%</span>'), 'المبدئي والمعلَّق خُصما من المتاح (T02)');
  assert.ok(rowOf(html, 'e_half').includes('الطاقة <span class="tnum">50%</span>'), 'طاقة نصف الدوام غير معروضة');

  assert.ok(html.includes('id="tpl-pl-new"') && html.includes('id="tpl-pl-fix"'), 'قالبا S14/S15 غائبان');
  assert.ok(html.includes('نوع التسكين المطلوب'), 'تسمية C4 غائبة');
  assert.ok(html.includes('data-action="pl-new"') && html.includes('تسكين جديد'), 'زر «تسكين جديد» غائب عن قائد القطاع');
  assert.ok(/4 موارد/.test(html), 'عدّاد الموارد غائب أو خاطئ');
  assert.ok(html.includes('المتاح محسوب من الطاقة التعاقدية المسجلة'), 'أساس الحساب غير معلن');
  assert.ok(html.includes('data-action="pl-new-res" data-emp="e_full"'), 'الاسم لا يفتح S14 عبر الفترة');
});

test('S13: ?tentative=0 يخفي طبقة المبدئي وحدها', async () => {
  const html = await P.planningPage(await sess('u_lead'), { tentative: '0' });
  noLeak(html, 'S13 بلا مبدئي');
  assert.ok(!html.includes('class="li tent"') && !html.includes('· مبدئي'), 'المبدئي ما زال ظاهراً');
  assert.ok(html.includes('المبدئي مخفي'), 'حالة الإخفاء غير معلنة');
  assert.ok(cellOf(html, 'e_full', KEY).includes('class="cell over"'), 'التجاوز اختفى مع المبدئي');
});

test('S13: بحثٌ بلا نتائج له رسالته وإجراؤه، وفترةٌ معطوبة تعود للافتراضي', async () => {
  const html = await P.planningPage(await sess('u_lead'), { q: 'زبرجد' });
  noLeak(html, 'S13 بحث');
  assert.ok(html.includes('لا نتائج لهذا البحث') && html.includes('امسح البحث'), 'حالة البحث الفارغ غير مصمَّمة');
  const bad = await P.planningPage(await sess('u_lead'), { from: 'x', to: '13' });
  assert.ok(bad.includes(`${MONTHS_AR[MONTH - 1]} ${YEAR}`), 'رابط معطوب لم يعد إلى الشهر الجاري');
});

test('الحجب: قارئٌ بلا حق التخطيط يرى الصفوف بلا زر، ومن لا يقرأ الفريق يرى حالةً مصمَّمة', async () => {
  const hr = await P.planningPage(await sess('u_hr'), {});
  noLeak(hr, 'S13 قارئ');
  assert.ok(hr.includes('سارة القحطاني'), 'القارئ لا يرى الصفوف');
  assert.ok(!hr.includes('data-action="pl-new"') && !hr.includes('تسكين جديد'), 'زر «تسكين جديد» ظاهر لمن لا يملك طلب تسكين');
  assert.ok(!hr.includes('data-action="pl-cell"') && !hr.includes('data-action="pl-fix"'), 'الخلايا قابلة للنقر لمن لا يخطّط');
  const emp = await P.planningPage(await sess('u_emp'), {});
  noLeak(emp, 'S13 موظف');
  assert.ok(emp.includes('لا تملك صلاحية عرض مصفوفة التسكين'), 'الموظف لا يرى حالة «لا صلاحية»');
  assert.ok(!emp.includes('تسكين جديد'), 'الزر ظاهر للموظف');
});

test('S13: الرابط العميق ?new=1 يحمل سياقه للعميل، و?fix=1 كذلك', async () => {
  const html = await P.planningPage(await sess('u_lead'), { new: '1', employee: 'e_full', target: 'project:P1', from: KEY, to: KEY, need: 'need_1' });
  assert.ok(html.includes('"deep":{"open":"new","employee":"e_full","target":"project:P1"'), 'سياق S14 لم يصل إلى العميل');
  assert.ok(html.includes('"need":"need_1"'), 'معرّف الاحتياج غائب');
  const fix = await P.planningPage(await sess('u_lead'), { fix: '1', employee: 'e_full', month: KEY });
  assert.ok(fix.includes('"open":"fix"') && fix.includes(`"month":"${KEY}"`), 'سياق S15 لم يصل');
  const bogus = await P.planningPage(await sess('u_lead'), { new: '1', target: 'weird' });
  assert.ok(bogus.includes('"target":null'), 'وجهة معطوبة مرّت إلى العميل');
});

// ── S16 ─────────────────────────────────────────────────────────────────────────
test('S16: القائمة بشرائحها الثلاث وعدّاد «بانتظار قراري»، والطلب المعلَّق في صفّه', async () => {
  const dm = await sess('u_dm');
  const html = await P.requestsPage(dm, {});
  noLeak(html, 'S16');
  for (const t of ['كل الطلبات', 'طلباتي', 'بانتظار قراري']) assert.ok(html.includes(t), `شريحة «${t}» غائبة`);
  assert.ok(html.includes('<span class="n tnum">(1)</span>'), 'عدّاد «بانتظار قراري» ليس 1');
  assert.ok(html.includes('محمد العمري') && html.includes('تطوير أعمال'), 'صف الطلب غائب');
  assert.ok(html.includes('بانتظار القرار'), 'حالة الطلب غائبة');
  assert.ok(html.includes(`href="/app/team/requests/${reqId}"`), 'الصف لا يفتح الطلب');
  const mine = await P.requestsPage(dm, { filter: 'mine' });
  assert.ok(mine.includes('لم ترفع طلبات بعد'), 'حالة «طلباتي» الفارغة غير مصمَّمة');
  const ops = await P.requestsPage(await sess('u_ops'), { filter: 'mine' });
  assert.ok(ops.includes('محمد العمري'), 'صاحب الطلب لا يجده في «طلباتي»');
});

test('S16: لوحة المراجعة تعرض إدارة المورد كإدارة ومديره كشخص والأثر والأزرار بحسب الحق', async () => {
  const dm = await sess('u_dm');
  const html = await P.requestDetailPage(dm, reqId, {});
  noLeak(html, 'S16 لوحة');
  assert.ok(html.includes('مراجعة طلب محمد العمري'), 'عنوان اللوحة غائب');
  assert.ok(/إدارة المورد<\/td><td>إدارة البيانات/.test(html), '«إدارة المورد» لا تعرض الإدارة');
  assert.ok(/مدير المورد<\/td><td>حساب u_dm/.test(html), '«مدير المورد» لا يعرض الشخص');
  assert.ok(html.includes('الأثر بعد الاعتماد') && html.includes('بعد الاعتماد</th>'), 'جدول الأثر غائب');
  assert.ok(html.includes('data-action="rq-approve"') && html.includes('data-action="rq-return"') && html.includes('data-action="rq-reject"'), 'أزرار القرار غائبة عن المراجع');
  assert.ok(!html.includes('data-action="rq-withdraw"'), 'السحب ظاهر لغير صاحب الطلب');
  assert.ok(html.includes('سبب الإعادة أو الرفض مطلوب'), 'شرط السبب غير معلن');
  const owner = await P.requestDetailPage(await sess('u_ops'), reqId, {});
  noLeak(owner, 'S16 صاحب الطلب');
  assert.ok(owner.includes('data-action="rq-withdraw"') && owner.includes('سحب الطلب'), 'صاحب الطلب لا يجد «سحب الطلب»');
  assert.ok(!owner.includes('data-action="rq-approve"'), 'صاحب الطلب يرى زر الاعتماد');
  const missing = await P.requestDetailPage(dm, 'areq_missing', {});
  assert.ok(missing.includes('تعذّر فتح الطلب'), 'طلبٌ غير موجود لا يعرض حالةً مصمَّمة');
});

test('S16: بعد القرار لا يظهر الطلب تحت «بانتظار قراري» ويصبح العدّاد صفراً', async () => {
  await alloc.decideRequest(await ctxOf('u_dm'), reqId, 'approve', 'موافق');
  const after = await alloc.getRequest(await sess('u_dm'), reqId);
  assert.notEqual(after.status, 'pending', 'الطلب ما زال معلَّقاً بعد القرار');
  const html = await P.requestsPage(await sess('u_dm'), { filter: 'pending_my_decision' });
  noLeak(html, 'S16 بعد القرار');
  assert.ok(html.includes('<span class="n tnum">(0)</span>'), 'العدّاد لم يصبح صفراً');
  assert.ok(html.includes('لا طلبات بانتظار قرارك'), 'حالة الفراغ غائبة');
  assert.ok(!html.includes(`href="/app/team/requests/${reqId}"`), 'طلبٌ بُتّ فيه ما زال تحت «بانتظار قراري»');
});
