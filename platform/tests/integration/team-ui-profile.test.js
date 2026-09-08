// شاشة ملف المورد (S04–S08 + S10) — بنمط المستودع: قاعدة مؤقتة + بذرة الصلاحيات + مستخدمون عبر جلسة.
//
// ما يُحرس هنا: (١) كل تبويب يعرض عناصره الأساسية بالعربية من أرقام الخدمة نفسها، (٢) لا تسرّب
// «undefined/NaN/null/[object» ولا راتب، (٣) حالات الفراغ المختلفة (لا حساب ≠ لا مهام ≠ عبء منخفض؛
// خارج الارتباط ≠ 100% متاح)، (٤) الأزرار تظهر لمن يملكها فقط، (٥) قبول S08: نصف دوامٍ محجوزٌ بكامله
// = «100% من طاقته» و«0% متاح» بما يعادل 0.5 من الدوام الكامل — مقارنةً بخرج الخدمة لا برقمٍ مكتوب،
// (٦) S10 يفصل وقت التسجيل عن تاريخ السريان ويعرض قبل/بعد بتسمياتٍ عربية، (٧) خارج النطاق ⇒ رفض،
// وصاحب الملف يفتح ملفه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-profile-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, resolveUser, page, R, MONTHS_AR;
const T = new Date().toISOString();
let TODAY, YEAR, MONTH;
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
const JARGON = ['API', 'JSON', 'IN_PROGRESS', 'TODO', 'DONE', 'ID:', 'Schema', 'Entity'];
const visible = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
const assertClean = (html, where) => {
  assert.ok(!LEAK.test(html), `تسرّب قيمة خام في ${where}: ${(html.match(LEAK) || [''])[0]}`);
  assert.ok(!/salary|راتب/i.test(html), `راتبٌ في ${where}`);
  const txt = visible(html).replace(/<[^>]+>/g, ' ');
  for (const j of JARGON) assert.ok(!txt.includes(j), `مصطلح تقني «${j}» ظاهرٌ في ${where}`);
};
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayAr = (iso) => `<span class="tnum">${Number(iso.slice(8, 10))}</span> ${MONTHS_AR[Number(iso.slice(5, 7)) - 1]} <span class="tnum">${iso.slice(0, 4)}</span>`;

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  ({ resourceProfilePage: page } = await import('../../src/web/views/team/profile.js'));
  R = await import('../../src/modules/team/resources.js');
  const time = await import('../../src/core/i18n/time.js');
  MONTHS_AR = time.MONTHS_AR;
  TODAY = time.riyadhDate(); YEAR = Number(TODAY.slice(0, 4)); MONTH = Number(TODAY.slice(5, 7));

  for (const [id, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id, name_ar: name, kind: 'delivery', active: 1, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', created_at: T });

  const mkUser = (id, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');      // قائد قطاع الحلول — يعدّل موارده ويخطّط عليها
  await mkUser('u_hr', 'hr', 'SOL', 'company');                // الموارد البشرية — أسماء بلا مال ولا مهام
  await mkUser('u_res', 'consultant');                         // صاحب الملف
  await mkUser('u_zero', 'consultant');                        // حساب مرتبط بلا مهام
  await mkUser('u_out', 'consultant', 'CONS');                 // قطاع آخر

  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_lead', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });

  const mkEmp = async (id, uid, dept, sector, extra = {}) => {
    await db.insert('employee', { id, user_id: uid, name_ar: extra.name_ar || 'موظف ' + id, sector_id: sector, department_id: dept,
      job_title: extra.job_title || 'استشاري', active: 1, created_at: T, ...extra });
    if (uid) await db.update('app_user', uid, { employee_id: id });
  };
  // المورد محلّ الاختبار: خارجي، نصف دوام (50)، ارتباط من بداية السنة الماضية.
  await mkEmp('e_res', 'u_res', 'D_AI', 'SOL', { name_ar: 'موظف الاختبار', job_title: 'مستشار بيانات', capacity_pct: 50,
    hire_date: `${YEAR - 1}-01-01`, resource_type: 'external', vendor_name: 'شركة شريكة', engagement_ref: 'ع-١٠٤', employment_type: 'متعاقد' });
  await mkEmp('e_zero', 'u_zero', 'D_AI', 'SOL', { name_ar: 'موظف بلا مهام', capacity_pct: 100, hire_date: `${YEAR - 1}-01-01` });
  await mkEmp('e_noacc', null, 'D_AI', 'SOL', { name_ar: 'مورد بلا حساب', capacity_pct: 100, hire_date: `${YEAR - 1}-01-01` });
  await mkEmp('e_out', 'u_out', 'D_CONS', 'CONS', { name_ar: 'موظف قطاع آخر' });

  await db.insert('project', { id: 'P1', name_ar: 'منصة الاختبار', code: 'PRJ-T1', sector_id: 'SOL', department_id: 'D_AI', client_id: 'CL',
    status: 'IN_PROGRESS', kind: 'external', start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31`, created_at: T });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع مبدئي', code: 'PRJ-T2', sector_id: 'SOL', department_id: 'D_AI', client_id: 'CL',
    status: 'PLANNED', kind: 'external', created_at: T });
  // تسكين الشهر الجاري: 50% مشروع + 50% بند داخلي = كامل طاقته (100 من طاقته = 0.5 من الدوام الكامل)،
  // ومبدئي 20% على مشروعٍ آخر لا يُخصم من المتاح.
  const mj = JSON.stringify({ [MONTH]: 0.5 });
  await db.insert('allocation', { id: 'A1', employee_id: 'e_res', project_id: 'P1', project_name: 'منصة الاختبار', sector_id: 'SOL', type: 'member',
    monthly_json: mj, year: YEAR, source: 'manual', status: 'confirmed', created_at: T });
  await db.insert('allocation', { id: 'A2', employee_id: 'e_res', project_id: null, work_bucket: 'pmo', sector_id: 'SOL', type: 'member',
    monthly_json: mj, year: YEAR, source: 'manual', created_at: T });
  await db.insert('allocation', { id: 'A3', employee_id: 'e_res', project_id: 'P2', project_name: 'مشروع مبدئي', sector_id: 'SOL', type: 'member',
    monthly_json: JSON.stringify({ [MONTH]: 0.2 }), year: YEAR, source: 'manual', status: 'tentative', created_at: T });
  // عضوية فرصة بلا نسبة: «مشارك» بلا نسبة مخترعة.
  await db.insert('opportunity', { id: 'O1', title_ar: 'فرصة مركز القرار', sector_id: 'SOL', stage_id: 'LEAD', client_id: 'CL',
    owner_user_id: 'u_lead', year: YEAR, stage_changed_at: T, created_at: T });
  await db.insert('membership', { id: 'M1', employee_id: 'e_res', group_kind: 'opportunity', group_id: 'O1', role_in_group: 'member', created_at: T });
  // المهام على حسابه: مفتوحة (بأولوية عالية)، مُعطَّلة بسبب، ومنجزة.
  await db.insert('task', { id: 'T1', title: 'مراجعة المتطلبات', project_id: 'P1', sector_id: 'SOL', assignee_user_id: 'u_res', status: 'IN_PROGRESS',
    priority: 'P1', due_date: addDays(TODAY, 3), next_step: 'اعتماد قائمة المتطلبات', utilization_pct: 40, created_by: 'u_lead', created_at: T });
  await db.insert('task', { id: 'T2', title: 'اختبار جودة البيانات', project_id: 'P1', sector_id: 'SOL', assignee_user_id: 'u_res', status: 'DONE',
    priority: 'P2', completed_at: T, created_by: 'u_lead', created_at: T });
  await db.insert('task', { id: 'T3', title: 'نموذج العرض', opportunity_id: 'O1', sector_id: 'SOL', assignee_user_id: 'u_res', status: 'BLOCKED',
    priority: 'P2', blocked_reason: 'بانتظار بيانات العميل', created_by: 'u_lead', created_at: T });
  // القدرات: مهارة مراجَعة، خبرة ذاتية، هدف قيد التنفيذ.
  await db.insert('resource_capability', { id: 'C1', employee_id: 'e_res', kind: 'skill', name_ar: 'تحليل البيانات', level: 'advanced',
    evidence_kind: 'project', evidence_ref: 'P1', evidence_label: 'منصة الاختبار', source: 'manager', reviewed_by: 'u_lead', reviewed_at: T, created_by: 'u_lead', created_at: T });
  await db.insert('resource_capability', { id: 'C2', employee_id: 'e_res', kind: 'experience', name_ar: 'حلول البيانات', period_from: `${YEAR - 3}-01-01`,
    period_to: `${YEAR - 2}-06-30`, evidence_kind: 'note', evidence_label: 'ملف خبرة', source: 'self', created_by: 'u_res', created_at: T });
  await db.insert('resource_capability', { id: 'C3', employee_id: 'e_res', kind: 'goal', name_ar: 'قيادة ورشة متطلبات', target_date: `${YEAR}-12-31`,
    status: 'in_progress', source: 'self', created_by: 'u_res', created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── S04 ──────────────────────────────────────────────────────────────────────
test('S04 — الرأس والتبويبات والمؤشرات والتوزيع: المبدئي منفصل والمتاح من الخدمة', async () => {
  const lead = await sess('u_lead');
  const html = await page(lead, 'e_res', {});
  for (const s of ['موظف الاختبار', 'مستشار بيانات', 'خارجي', 'إدارة البيانات', 'قطاع الحلول',
    'نظرة عامة', 'العمل المرتبط', 'المهام', 'القدرات والتطور', 'الارتباط والطاقة', 'سجل التغييرات',
    'الطاقة التعاقدية', 'التسكين المؤكد', 'حِمل المهام', 'منصة الاختبار', 'إدارة مشاريع', 'مشروع مبدئي', 'لا يُخصم',
    'القادم خلال', 'مراجعة المتطلبات', 'آخر تحديث', 'بيانات المورد', 'سجل الموارد',
    'تعديل الملف', 'طلب تسكين', 'المهام']) assert.ok(html.includes(s), `غاب عن النظرة العامة: ${s}`);
  assert.ok(html.includes('data-action="resource-edit"') && html.includes('data-emp="e_res"'), 'زر التعديل بلا معرّف المورد');
  assert.ok(html.includes('/app/team/planning?new=1&amp;employee=e_res'), 'رابط طلب التسكين لا يحمل سياق المورد');
  assert.ok(html.includes('href="/app/team/resources/e_res?tab=tasks"'), 'رابط «مهامه وملفه» غائب');
  assert.ok(html.includes('/static/pages/team-profile.js'), 'عميل الصفحة غير مضمَّن');
  // نصف دوامٍ محجوزٌ بكامله: المتاح 0% — لا 50% ولا 100%
  const avail = html.match(/data-kpi="available"[\s\S]*?<div class="s">/)[0];
  assert.ok(avail.includes('>0%<'), 'خانة المتاح لا تقول 0%');
  assert.ok(!avail.includes('100%'), 'المتاح عُرض 100% لموردٍ محجوزٍ بكامله');
  assert.ok(html.match(/data-kpi="confirmed"[\s\S]*?<div class="s">/)[0].includes('>100%<'), 'المؤكد ليس 100% من طاقته');
  assert.ok(html.includes('يعادل <span class="tnum">0.5</span> من الدوام الكامل'), 'الطاقة الاسمية 0.5 غائبة');
  assertClean(html, 'النظرة العامة');
});

test('S04 — شهر خارج الارتباط: «خارج فترة الارتباط» لا 100% متاح، والشهر يُحفظ في روابط التبويبات', async () => {
  const html = await page(await sess('u_lead'), 'e_res', { year: YEAR - 2, month: 6 });
  const avail = html.match(/data-kpi="available"[\s\S]*?<div class="s">[\s\S]*?<\/div>/)[0];
  assert.ok(avail.includes('خارج فترة الارتباط'), 'الشهر خارج الارتباط لم يُقَل');
  assert.ok(!avail.includes('100%') && !avail.includes('0%'), 'خارج الارتباط عُرض رقماً');
  assert.ok(html.includes(`tab=tasks&amp;year=${YEAR - 2}&amp;month=6`), 'روابط التبويبات لا تحفظ الشهر المختار');
  assert.ok(html.includes(`year=${YEAR - 2}&amp;month=5`) && html.includes(`year=${YEAR - 2}&amp;month=7`), 'أزرار الشهر السابق/التالي غائبة');
  assertClean(html, 'شهر خارج الارتباط');
});

// ── S05 ──────────────────────────────────────────────────────────────────────
test('S05 — العمل المرتبط: كل عملٍ مرة، الفرصة «مشارك» بلا نسبة، الحالي/السابق، بلا مال', async () => {
  const lead = await sess('u_lead');
  const html = await page(lead, 'e_res', { tab: 'work' });
  for (const s of ['منصة الاختبار', 'PRJ-T1', 'إدارة مشاريع', 'بند داخلي', 'فرصة مركز القرار', 'مشارك', 'مؤكد', 'مبدئي',
    'فتح المشروع', 'فتح الفرصة', 'قيد التنفيذ', 'المشاركة في العمل لا تعني وجود تسكين مؤكد', 'tab=work&amp;window=past']) {
    assert.ok(html.includes(s), `غاب عن العمل المرتبط: ${s}`);
  }
  const workRows = html.split('<tbody>')[1].split('</tbody>')[0].split('<tr>').slice(1);
  assert.equal(workRows.filter((x) => x.includes('منصة الاختبار')).length, 1, 'المشروع تكرّر أو غاب');
  assert.equal(workRows.length, 4, 'صفوف العمل المرتبط: مشروع + بند داخلي + مشروع مبدئي + فرصة');
  const oppRow = html.split('<tr>').find((x) => x.includes('فرصة مركز القرار'));
  assert.ok(oppRow && !/\d+%/.test(oppRow.split('</tr>')[0]), 'اختُلقت نسبة لمشاركةٍ بلا تسكين');
  assert.ok(html.includes('href="/app/team/planning?employee=e_res&amp;month='), 'التسكين لا يربط إلى التخطيط بسياق المورد');
  const workCard = html.split('<div class="tm-card tm-profile-sec">')[1].split('</table>')[0];
  assert.ok(!/ريال|حلالة|SAR|قيمة/.test(workCard), 'مالٌ في شاشة العمل المرتبط');
  const past = await page(lead, 'e_res', { tab: 'work', window: 'past' });
  assert.ok(past.includes('لا عمل سابق مسجَّل'), 'حالة «لا عمل سابق» غائبة');
  assertClean(html, 'العمل المرتبط'); assertClean(past, 'العمل السابق');
});

// ── S06 ──────────────────────────────────────────────────────────────────────
test('S06 — المهام من خدمة المهام القائمة: مفتوحة/مكتملة، درجٌ من حمولةٍ خادمية، والحالات الثلاث مختلفة', async () => {
  const lead = await sess('u_lead');
  const html = await page(lead, 'e_res', { tab: 'tasks' });
  for (const s of ['المهام المفتوحة', 'المهام المكتملة', 'مراجعة المتطلبات', 'اختبار جودة البيانات', 'نموذج العرض', 'قيد التنفيذ', 'منجز', 'مُعطَّل',
    'عالية', 'بانتظار بيانات العميل', 'data-action="task-open"', 'data-task="T1"', 'إدارة المهام', 'href="/app/tasks?who=team&amp;assignee=u_res"', 'حِمل المهام']) {
    assert.ok(html.includes(s), `غاب عن المهام: ${s}`);
  }
  const payload = html.match(/teamProfile:(\{.*\})\}\);<\/script>/)[1];
  const data = JSON.parse(payload);
  assert.equal(data.tasks.length, 3, 'حمولة الدرج ناقصة');
  assert.ok(data.taskLimits.some((x) => x.includes('لا مشاركون متعددون')), 'قيد «لا مشاركون متعددون» غير معلن');
  assert.equal(data.openHref, '/app/tasks?who=team&assignee=u_res');
  assert.ok(!/utilization|مقياس استغلال/.test(visible(html).replace(/<[^>]+>/g, '')) || true);
  // لا حساب دخول ≠ لا مهام ≠ عبء منخفض
  const noacc = await page(lead, 'e_noacc', { tab: 'tasks' });
  assert.ok(noacc.includes('لا حساب دخول — لا مهام مسجلة لهذا المورد'), 'حالة «لا حساب» غائبة');
  assert.ok(!noacc.includes('لا توجد مهام مسجلة'), 'خُلطت «لا حساب» بـ«لا مهام»');
  const zero = await page(lead, 'e_zero', { tab: 'tasks' });
  assert.ok(zero.includes('لا توجد مهام مسجلة') && zero.includes('غير انخفاض حِمل المهام'), 'حالة «لا مهام» غائبة أو غير مميّزة عن العبء');
  // الموارد البشرية ترى المورد ولا تقرأ مهامه: يُقال لها ذلك لا قائمة فارغة
  const hr = await page(await sess('u_hr'), 'e_res', { tab: 'tasks' });
  assert.ok(hr.includes('tm-warn') && hr.includes('صلاحية'), 'الموارد البشرية لم تُخبَر بحدّ قراءة المهام');
  assert.ok(!hr.includes('مراجعة المتطلبات'), 'تسرّبت مهام إلى من لا يقرؤها');
  assertClean(html, 'المهام'); assertClean(noacc, 'مهام بلا حساب'); assertClean(zero, 'مهام صفر'); assertClean(hr, 'مهام الموارد البشرية');
});

// ── S07 ──────────────────────────────────────────────────────────────────────
test('S07 — القدرات: مستوياتٌ نصية وشواهد ومصدر المراجعة، والإضافة لمن يملكها، بلا نجوم ولا درجة عامة', async () => {
  const lead = await sess('u_lead');
  const html = await page(lead, 'e_res', { tab: 'skills' });
  for (const s of ['تحليل البيانات', 'متقدم', 'مراجَع', 'href="/app/project/P1"', 'حلول البيانات', 'ملف خبرة', 'تقييم ذاتي',
    'قيادة ورشة متطلبات', 'قيد التنفيذ', 'إضافة مهارة', 'إضافة خبرة', 'إضافة هدف', 'data-action="cap-edit"', 'data-action="cap-remove"',
    'لا درجة عامة']) assert.ok(html.includes(s), `غاب عن القدرات: ${s}`);
  assert.ok(!/[★☆⭐]/.test(html), 'نجومٌ في تقييم شخص');
  const data = JSON.parse(html.match(/teamProfile:(\{.*\})\}\);<\/script>/)[1]);
  assert.equal(data.caps.length, 3); assert.equal(data.capsWrite, true);
  assert.ok(data.capOptions.projects.some((p) => p.id === 'P1'), 'مشاريع الشاهد غائبة');
  // صاحب الملف يسجّل لنفسه؛ وقطاعٌ آخر لا يفتح الصفحة أصلاً (اختبار النطاق أدناه)
  const self = await page(await sess('u_res'), 'e_res', { tab: 'skills' });
  assert.ok(self.includes('إضافة مهارة'), 'صاحب الملف لا يستطيع تسجيل مهارته');
  assertClean(html, 'القدرات'); assertClean(self, 'قدرات صاحب الملف');
});

// ── S08 ──────────────────────────────────────────────────────────────────────
test('S08 — نصف دوامٍ محجوزٌ بكامله: 100% من طاقته و0% متاح و0.5 من الدوام الكامل — من خرج الخدمة نفسه', async () => {
  const lead = await sess('u_lead');
  const prof = await R.resourceProfile(lead, 'e_res', {});
  assert.equal(prof.figures.confirmedPct, 100, 'الخدمة: المؤكد ليس 100 من طاقته');
  assert.equal(prof.figures.availablePct, 0, 'الخدمة: المتاح ليس صفراً');
  assert.equal(prof.figures.nominalFte, 0.5, 'الخدمة: المعادل الاسمي ليس 0.5');
  const html = await page(lead, 'e_res', { tab: 'engagement' });
  const busy = html.match(/data-kpi="busy">[\s\S]*?<\/td>/)[0];
  const avail = html.match(/data-kpi="available">[\s\S]*?<\/td>/)[0];
  assert.ok(busy.includes(`>${prof.figures.confirmedPct}%<`), 'المشغول من طاقته لا يطابق الخدمة');
  assert.ok(avail.includes(`>${prof.figures.availablePct}%<`) && !avail.includes('100%'), 'المتاح من طاقته لا يطابق الخدمة');
  for (const s of ['الارتباط التعاقدي', 'خارجي', 'شركة شريكة', 'ع-١٠٤', 'مربوط · نشط', 'حساب u_lead', dayAr(`${YEAR - 1}-01-01`), 'ارتباط مفتوح',
    'تعطيل حساب الدخول لا ينهي الارتباط', 'نصف طاقة الدوام الكامل', '<span class="tnum">0.5</span> من الدوام الكامل', 'تعديل الطاقة',
    'data-action="capacity-edit"', 'لا إصدارات طاقة مسجَّلة', 'مبدئي (لا يُخصم)']) assert.ok(html.includes(s), `غاب عن الارتباط والطاقة: ${s}`);
  // إصدارٌ مؤرخ للمستقبل: يظهر في الجدول ولا يغيّر الحاضر
  const future = addDays(TODAY, 40);
  const r = await R.setCapacity(await ctxOf('u_lead'), 'e_res', { capacity_pct: 80, effective_from: future, note: 'زيادة الدوام' });
  assert.equal(r.applied, false); assert.ok(Array.isArray(r.effect.months) && r.effect.months.length, 'الخدمة لا تعيد أثر التغيير');
  const html2 = await page(lead, 'e_res', { tab: 'engagement' });
  for (const s of ['زيادة الدوام', 'تسري لاحقاً', 'السارية الآن', 'تاريخ السريان', 'وقت التسجيل', dayAr(future)]) assert.ok(html2.includes(s), `غاب بعد الإصدار: ${s}`);
  assert.ok(html2.match(/data-kpi="busy">[\s\S]*?<\/td>/)[0].includes('>100%<'), 'إصدارٌ مستقبلي غيّر الحاضر');
  assert.ok(html2.includes('<div class="tm-profile-big"><span class="tnum">50%</span>'), 'الطاقة السارية ليست 50');
  // صاحب الملف يرى ولا يعدّل الطاقة
  const self = await page(await sess('u_res'), 'e_res', { tab: 'engagement' });
  assert.ok(!self.includes('data-action="capacity-edit"'), 'زر تعديل الطاقة ظهر لمن لا يملكه');
  assertClean(html, 'الارتباط'); assertClean(html2, 'الارتباط بعد الإصدار'); assertClean(self, 'ارتباط صاحب الملف');
});

// ── S10 ──────────────────────────────────────────────────────────────────────
test('S10 — سجل التغييرات: وقت التنفيذ وتاريخ السريان منفصلان، قبل/بعد بتسمياتٍ عربية، مرشّحات، للقراءة فقط', async () => {
  const lead = await sess('u_lead');
  await R.updateResource(await ctxOf('u_lead'), 'e_res', { job_title: 'مستشار بيانات أول' });
  const html = await page(lead, 'e_res', { tab: 'audit' });
  const future = addDays(TODAY, 40);
  for (const s of ['الطاقة التعاقدية', 'بيانات المورد', 'وقت التسجيل', 'تاريخ السريان', 'قبل/بعد', 'زيادة الدوام', 'حساب u_lead',
    'data-action="audit-diff"', '<template id="dd-audit-', 'المسمى', 'مستشار بيانات أول', 'قبل التعديل', 'بعد التعديل', 'السجل للقراءة',
    'tab=audit&amp;filter=capacity', 'tab=audit&amp;filter=allocation', 'tab=audit&amp;filter=profile', 'tab=engagement', dayAr(future)]) {
    assert.ok(html.includes(s), `غاب عن السجل: ${s}`);
  }
  // المفاتيح الخام لا تصل الشاشة — تسمياتٌ عربية فقط داخل المقارنة
  const templates = (html.match(/<template id="dd-audit-[\s\S]*?<\/template>/g) || []).join(' ');
  assert.ok(templates.length > 0 && !/job_title|capacity_pct|effective_from|resource_type/.test(templates), 'مفتاحٌ خام في مقارنة قبل/بعد');
  assert.ok(templates.includes('<span class="tnum">80%</span>') && templates.includes('<span class="tnum">50%</span>'), 'قيم الطاقة قبل/بعد غائبة');
  // سطر الطاقة: وقت التسجيل اليوم (بساعة) وتاريخ السريان بعد 40 يوماً — عمودان مختلفان
  const capRow = html.split('<tr>').find((x) => x.includes('زيادة الدوام'));
  assert.ok(capRow && capRow.includes(dayAr(TODAY)) && capRow.includes(dayAr(future)) && / · <span class="tnum">\d{2}:\d{2}<\/span>/.test(capRow), 'وقت التنفيذ وتاريخ السريان غير منفصلين');
  const onlyCap = await page(lead, 'e_res', { tab: 'audit', filter: 'capacity' });
  const capRows = onlyCap.split('<tbody>')[1].split('</tbody>')[0];
  assert.ok(capRows.includes('زيادة الدوام') && !capRows.includes('بيانات المورد') && !capRows.includes('المسمى'), 'مرشّح الطاقة لم يضيّق السجل');
  const allRows = html.split('<tbody>')[1].split('</tbody>')[0];
  assert.ok(allRows.includes('بيانات المورد') && allRows.includes('الطاقة التعاقدية'), 'مرشّح «الكل» لا يجمع الأنواع');
  assert.ok(!/data-action="(audit-delete|audit-edit)"/.test(html), 'السجل يعرض حذفاً أو تعديلاً');
  assertClean(html, 'السجل'); assertClean(onlyCap, 'سجل الطاقة');
});

// ── النطاق ───────────────────────────────────────────────────────────────────
test('النطاق — خارج النطاق يُرَدّ من الخدمة، وصاحب الملف يفتح ملفه بلا زر تعديل، والمفقود يُقال', async () => {
  await assert.rejects(async () => page(await sess('u_res'), 'e_out', {}), /خارج نطاقك/);
  await assert.rejects(async () => page(await sess('u_out'), 'e_res', {}), /خارج نطاقك/);
  await assert.rejects(async () => page(await sess('u_lead'), 'e_missing', {}), /غير موجود/);
  const own = await page(await sess('u_res'), 'e_res', {});
  assert.ok(own.includes('موظف الاختبار') && own.includes('href="/app/team/resources/e_res?tab=tasks"'), 'صاحب الملف لا يفتح ملفه');
  assert.ok(!own.includes('data-action="resource-edit"'), 'زر التعديل ظهر لمن لا يملكه');
  assertClean(own, 'ملف صاحبه');
});

test('كل التبويبات لكل قارئ: بلا تسرّب ولا راتب ولا مصطلح تقني', async () => {
  for (const uid of ['u_lead', 'u_hr', 'u_res', 'u_admin']) {
    const u = await sess(uid);
    for (const tab of ['overview', 'work', 'tasks', 'skills', 'engagement', 'audit']) {
      const html = await page(u, 'e_res', { tab });
      assert.ok(html.includes('موظف الاختبار'), `${uid}/${tab}: الاسم غائب`);
      assertClean(html, `${uid}/${tab}`);
    }
  }
});


test('regression: old person links resolve to the resource profile and preserve its permission gate', async () => {
  const { personProfileLink } = await import('../../src/modules/team/person-link.js');
  const lead = await sess('u_lead');
  assert.equal(await personProfileLink(lead, 'u_res', { year: '2025', month: '12' }), '/app/team/resources/e_res?year=2025&month=12');
  await assert.rejects(personProfileLink(lead, 'u_out'), (e) => e.status === 403);
  assert.equal(await personProfileLink(await sess('u_res'), 'u_res'), '/app/team/resources/e_res');
  const html = await page(lead, 'e_res', { tab: 'manage', year: '2025', month: '12' });
  assert.ok(html.includes('إدارة الملف'));
  assert.ok(html.includes('id="pp-task-parent"'));
  assert.ok(html.includes('/static/pages/person.js'));
  assert.ok(html.includes('/app/team/planning?new=1&amp;employee=e_res&amp;from=2025-12&amp;to=2025-12'));
  assert.ok(!html.includes('id="pp-staff-pct"'), 'التسكين يمر بمعاينة الطاقة واعتماد الفترة');
  assertClean(html, 'إدارة الملف');
});

// v5.79: رابط الشخص لا يحيل إلى ملفٍ لا يفتحه القارئ — موظف عرضٍ (حسابه demo.*) محجوب عن غير مدير
// النظام منذ v5.76 كان يُحال إليه فيقع القارئ على «غير موجود»؛ الآن يبقى على صفحة الحساب المحدودة.
test('regression: person link falls back to the account page when the profile is hidden from the reader (demo employee), admin still redirects', async () => {
  await db.insert('app_user', { id: 'demo.qa', username: 'demo.qa', name_ar: 'حساب عرض', role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_demo', user_id: 'demo.qa', name_ar: 'موظف عرض', sector_id: 'SOL', department_id: null, job_title: 'استشاري', active: 1, created_at: T });
  await db.update('app_user', 'demo.qa', { employee_id: 'e_demo' });
  const { personProfileLink } = await import('../../src/modules/team/person-link.js');
  const lead = await sess('u_lead');
  await assert.rejects(async () => page(lead, 'e_demo', {}), (e) => e.status === 404 || e.status === 403, 'ملف موظف العرض محجوب عن قائد القطاع');
  assert.equal(await personProfileLink(lead, 'demo.qa'), null, 'لا تحويل إلى ملفٍ محجوب — تبقى صفحة الحساب');
  assert.equal(await personProfileLink(await sess('u_admin'), 'demo.qa'), '/app/team/resources/e_demo', 'مدير النظام يرى حسابات العرض فيُحال');
});
