// ── شاشات S17–S21: تحليل الاستخدام، فحص الحالة، الاحتياجات، نموذج الاحتياج، مقارنة المرشحين ──
//
// اختبار عرضٍ بنمط المستودع (UI-CONTRACTS §6): قاعدة مؤقتة + migrate + seed-rbac، والمستخدم
// عبر جلسة (resolveUser). ما يُثبَّت هنا:
//   • S17 يعرض التغطية «غير متاحة» دائماً (C8) وحِمل المهام «غير مقاس» لمن بلا نسب، وقالب
//     «تعريف المؤشرات» خامل، والصفوف بترتيب الاسم لا الأداء، وحالة الفراغ عند مرشّحٍ لا يطابق.
//   • S18 يعرض الأدلة والأسئلة ونموذج المتابعة والسطر الصريح «الإشارة لا تعني أن المورد متاح»،
//     وبعد إنشاء متابعةٍ حقيقية يعرض مهمتها ونموذج الإغلاق، ويظهر «متابعة قائمة» في S17.
//   • S19 يعرض الاحتياج بحجمه («مورد واحد × 50% FTE طوال الفترة») والملخص، ودرج S20 لمن ينشئ وحده.
//   • S21 يعرض الشهر خارج الارتباط «خارج الارتباط»، والطلب المعلَّق ظاهراً غير مخصوم (مطابقةً
//     لمخرجات الخدمة)، والتعارض المحتمل 120%، ولوحة الطلب لصاحب الاحتياج وحده.
//   • لا تسرّب: undefined|NaN|[object|null في أي صفحة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-team-ui-an-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, needs, analysis, resolveUser;
const T = new Date().toISOString();
const YEAR = 2026; const MONTH = 10;   // فترة ثابتة: أكتوبر–نوفمبر 2026 — لا تتغيّر بتغيّر ساعة الخادم
const LEAK = /undefined|NaN|\[object|null(?![a-z])/;
const noLeak = (html, where) => assert.ok(!LEAK.test(html), `تسرّب قيمة خام في ${where}: ${(LEAK.exec(html) || [''])[0]} … ${html.slice(Math.max(0, html.search(LEAK) - 80), html.search(LEAK) + 40)}`);
const rowOf = (html, attr, id) => { const m = new RegExp(`<tr[^>]*${attr}="${id}"[\\s\\S]*?<\\/tr>`).exec(html); return m ? m[0] : ''; };

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
let needId;

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  P = await import('../../src/web/pages.js');
  needs = await import('../../src/modules/team/needs.js');
  analysis = await import('../../src/modules/team/analysis.js');

  for (const [id2, name, kind] of [['SOL', 'قطاع الحلول', 'delivery'], ['SUP', 'الخدمات المشتركة', 'support']]) {
    await db.insert('sector', { id: id2, name_ar: name, kind, active: 1, created_at: T });
  }
  await db.insert('client', { id: 'CL', name_ar: 'هيئة البيانات', created_at: T });

  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');       // قائد القطاع — ينشئ الاحتياج ويفتح التحليل
  await mkUser('u_dm', 'department_manager');                    // مدير إدارة البيانات
  await mkUser('u_hr', 'hr', null, 'company');                   // يقرأ ولا ينشئ
  await mkUser('u_pm', 'project_manager');                       // لا يقرأ الموظفين ⇒ لا تحليل
  await mkUser('u_a', 'consultant');                             // حساب «أحمد» — مهام بنسب
  await mkUser('u_b', 'consultant');                             // حساب «بدر» — مهمة بلا نسبة ⇒ غير مقاس

  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL', name_ar: 'إدارة البيانات', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SUP', sector_id: 'SUP', name_ar: 'المساندة', active: 1, created_at: T });

  const mkEmp = async (id2, { uid = null, dept, sector = 'SOL', hire = '2025-01-01', end = null, name, title = 'استشاري' }) => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: name, sector_id: sector, department_id: dept,
      job_title: title, active: 1, hire_date: hire, end_date: end, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkEmp('e_dm', { uid: 'u_dm', dept: 'D_DATA', name: 'مدير البيانات' });
  await mkEmp('e_a', { uid: 'u_a', dept: 'D_DATA', name: 'أحمد المشغول', title: 'محلل بيانات' });
  await mkEmp('e_b', { uid: 'u_b', dept: 'D_DATA', name: 'بدر المقاس', title: 'مهندس بيانات' });
  await mkEmp('e_busy', { dept: 'D_DATA', name: 'سعد المزدحم' });                              // T26: مؤكد 50% + معلَّق 20%
  await mkEmp('e_nov', { dept: 'D_DATA', hire: `${YEAR}-11-01`, name: 'نورة الجديدة' });        // T25: تبدأ في نوفمبر
  await mkEmp('e_sup', { dept: 'D_SUP', sector: 'SUP', name: 'سارة المساندة' });                 // وحدة مساندة ⇒ مؤهلة

  const mkProject = (id2, name, owner) => db.insert('project', { id: id2, name_ar: name, sector_id: 'SOL', department_id: 'D_DATA',
    owner_user_id: owner, client_id: 'CL', status: 'IN_PROGRESS', kind: 'external', created_at: T });
  await mkProject('P1', 'منصة البيانات الوطنية', 'u_lead');
  await mkProject('P0', 'مشروع قائم', 'u_lead');

  const alloc = (id2, emp, proj, pct) => db.insert('allocation', { id: id2, employee_id: emp, project_id: proj, sector_id: 'SOL', type: 'member',
    monthly_json: JSON.stringify({ [MONTH]: pct, [MONTH + 1]: pct }), year: YEAR, created_at: T });
  await alloc('al_a', 'e_a', 'P1', 0.8);
  await alloc('al_b', 'e_b', 'P1', 1);
  await alloc('al_busy', 'e_busy', 'P0', 0.5);
  await db.insert('allocation_request', { id: 'areq_busy', kind: 'new', employee_id: 'e_busy', target_kind: 'project', target_id: 'P1',
    year: YEAR, months_json: JSON.stringify({ [MONTH]: 20, [MONTH + 1]: 20 }), alloc_status: 'confirmed', status: 'pending', requested_by: 'u_dm', created_at: T });

  // المهام: أحمد مهمتان (30% وواحدة بلا نسبة) ⇒ مقاس؛ بدر مهمة واحدة بلا نسبة ⇒ «غير مقاس».
  const task = (id2, uid, pct, title) => db.insert('task', { id: id2, title, project_id: 'P1', sector_id: 'SOL', department_id: 'D_DATA',
    assignee_user_id: uid, status: 'TODO', priority: 'P2', work_kind: 'project', utilization_pct: pct, created_by: 'u_lead', created_at: T });
  await task('t_a1', 'u_a', 30, 'تحليل مصادر البيانات');
  await task('t_a2', 'u_a', null, 'مراجعة النموذج');
  await task('t_b1', 'u_b', null, 'إعداد خط البيانات');

  // المهارات: سعد موثقة (راجعها مديره)، نورة تقييم ذاتي، بدر بلا مهارة.
  await db.insert('resource_capability', { id: 'cap1', employee_id: 'e_busy', kind: 'skill', name_ar: 'تحليل البيانات', level: 'advanced', source: 'manager', reviewed_by: 'u_dm', reviewed_at: T, created_at: T });
  await db.insert('resource_capability', { id: 'cap2', employee_id: 'e_nov', kind: 'skill', name_ar: 'تحليل البيانات', level: 'practitioner', source: 'self', created_at: T });

  const n = await needs.createNeed(await ctxOf('u_lead'), {
    source_kind: 'project', source_id: 'P1', role_ar: 'محلل بيانات', headcount: 1, fte_pct: 50,
    from_date: `${YEAR}-10-01`, to_date: `${YEAR}-11-30`, certainty: 'confirmed',
    // موعد الحسم خلال أسبوع من اليوم الحقيقي ⇒ «بحاجة إلى متابعة» مهما كان يوم التشغيل
    skills: { required: ['تحليل البيانات'], preferred: ['لوحات المؤشرات'] }, decide_by: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), level: 'practitioner',
  });
  needId = n.id;
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── S17 ─────────────────────────────────────────────────────────────────────────
test('S17: التغطية «غير متاحة» دائماً، وحِمل بلا نسب «غير مقاس»، وقالب التعريفات خامل، والترتيب بالاسم', async () => {
  const html = await P.analysisPage(await sess('u_lead'), { year: YEAR, month: MONTH });
  noLeak(html, 'S17');
  assert.ok(html.includes('تحليل الاستخدام'), 'تبويب المسار غائب');
  assert.ok(html.includes('غير متاحة'), 'التغطية المصرح بها لا تُقال «غير متاحة»');
  assert.ok(!/التغطية[^<]{0,40}\d+%/.test(html), 'ظهر رقم للتغطية المالية للفرد');
  assert.ok(html.includes('id="dd-analysis-definitions"'), 'قالب «تعريف المؤشرات» غائب');
  assert.ok(html.includes('data-action="definitions"') && html.includes('تعريف المؤشرات'), 'زر التعريفات غائب');
  const rowB = rowOf(html, 'data-emp', 'e_b');
  assert.ok(rowB.includes('غير مقاس'), 'مهمة بلا نسبة لا تُقرأ «غير مقاس»');
  const rowA = rowOf(html, 'data-emp', 'e_a');
  assert.ok(rowA.includes('80%') && rowA.includes('بلا نسبة مقدَّرة'), 'صف أحمد لا يعرض تسكينه 80% وأساس الحِمل');
  assert.ok(rowA.includes(`href="/app/team/analysis/e_a?year=${YEAR}&amp;month=${MONTH}"`) && rowA.includes('فحص الحالة'), 'رابط «فحص الحالة» لا يحمل الفترة');
  const rowNov = rowOf(html, 'data-emp', 'e_nov');
  assert.ok(rowNov.includes('خارج فترة الارتباط') || rowNov.includes('b-out'), 'الشهر خارج الارتباط يُعرض رقماً');
  // الترتيب بالاسم لا بالأداء
  const pos = ['أحمد المشغول', 'بدر المقاس', 'سعد المزدحم', 'نورة الجديدة'].map((n) => html.indexOf(n));
  assert.ok(pos.every((p) => p > 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), 'الصفوف ليست بترتيب الاسم');
  assert.ok(html.includes('لا ترتيب أداء'), 'لا تصريح بعدم الترتيب');
});

test('S17: مرشّح إشارة لا يطابق أحداً ⇒ حالة فراغ مصمَّمة ورابط «عرض الكل»؛ ومن لا يقرأ الموظفين يُرفض', async () => {
  const html = await P.analysisPage(await sess('u_lead'), { year: YEAR, month: MONTH, signal: 'internal_high' });
  noLeak(html, 'S17-empty');
  assert.ok(html.includes('لا نتائج لهذه المرشّحات') && html.includes('عرض الكل'));
  const pm = await sess('u_pm');
  await assert.rejects(() => P.analysisPage(pm, { year: YEAR, month: MONTH }), (e) => e.status === 403 && /صلاحية/.test(e.message));
});

// ── S18 ─────────────────────────────────────────────────────────────────────────
test('S18: الأدلة والأسئلة ونموذج المتابعة والسطر الصريح والروابط بسياق الفترة', async () => {
  const html = await P.analysisCasePage(await sess('u_lead'), 'e_a', { year: YEAR, month: MONTH });
  noLeak(html, 'S18');
  assert.ok(html.includes('أحمد المشغول') && html.includes('أكتوبر 2026'));
  assert.ok(html.includes('سبب الإشارة') && html.includes('الأدلة') && html.includes('أسئلة للتحقق'));
  assert.ok(html.includes('التسكين المؤكد') && html.includes('حِمل المهام') && html.includes('مصفوفة التسكين'), 'أدلة بلا مصادر');
  assert.ok(html.includes('data-form="followup"') && html.includes('المسؤول عن المتابعة') && html.includes('حفظ المتابعة'), 'نموذج المتابعة غائب');
  assert.ok(html.includes('الإشارة لا تعني أن المورد متاح'), 'السطر الصريح غائب');
  assert.ok(html.includes(`/app/team/planning?fix=1&amp;employee=e_a&amp;month=${YEAR}-10`), 'رابط اقتراح التعديل بلا سياق');
  assert.ok(html.includes('/app/team/resources/e_a') && html.includes('فتح ملف المورد'));
  assert.ok(html.includes('غير متاحة'), 'التغطية المالية في فحص الحالة ليست «غير متاحة»');
  assert.ok(!html.includes('data-form="close-case"'), 'نموذج الإغلاق ظهر قبل وجود متابعة');
});

test('S18: بعد متابعةٍ حقيقية تظهر مهمتها ونموذج الإغلاق، ويظهر «متابعة قائمة» في S17', async () => {
  const c = await analysis.createFollowup(await ctxOf('u_lead'), 'e_a', {
    year: YEAR, month: MONTH, action_ar: 'مراجعة عبء العمل مع مدير المشروع', ownerUserId: 'u_lead', dueDate: `${YEAR}-10-15`, note: 'تأكيد الاحتياج الفعلي',
  });
  assert.ok(c.task && c.task.id, 'المتابعة لم تنشئ مهمة');
  const html = await P.analysisCasePage(await sess('u_lead'), 'e_a', { year: YEAR, month: MONTH });
  noLeak(html, 'S18-case');
  assert.ok(html.includes(c.task.title), 'عنوان مهمة المتابعة غائب');
  assert.ok(html.includes('حساب u_lead'), 'اسم المسؤول غائب');
  assert.ok(html.includes('data-form="close-case"') && html.includes('تأكيد التفسير وإغلاق الحالة'), 'نموذج الإغلاق غائب');
  assert.ok(html.includes('/app/person/u_lead'), 'رابط مهام المسؤول غائب');
  assert.ok(!html.includes('data-form="followup"'), 'نموذج متابعةٍ ثانٍ ظهر مع متابعة قائمة');
  const table = await P.analysisPage(await sess('u_lead'), { year: YEAR, month: MONTH });
  assert.ok(rowOf(table, 'data-emp', 'e_a').includes('متابعة قائمة'), 'S17 لا يعلّم المورد ذا المتابعة');
});

// ── S19 + S20 ───────────────────────────────────────────────────────────────────
test('S19: الاحتياج بحجمه والملخص والمتابعة، ودرج S20 لمن ينشئ وحده', async () => {
  const lead = await P.needsPage(await sess('u_lead'), {});
  noLeak(lead, 'S19');
  assert.ok(lead.includes('محلل بيانات') && lead.includes('منصة البيانات الوطنية'));
  assert.ok(lead.includes('مورد واحد × 50% FTE طوال الفترة'), 'حجم الطلب بلا وحدة');
  assert.ok(lead.includes('احتياج مؤكد') && lead.includes('احتياج مبدئي'), 'الملخص غائب');
  assert.ok(lead.includes('0.5 FTE') && lead.includes('وحدات دوام كامل لكل شهر'), 'الذروة الشهرية بلا وحدة معلنة');
  assert.ok(lead.includes('غير مغطى'), 'حالة التغطية غائبة');
  assert.ok(lead.includes(`href="/app/team/needs/${needId}"`) && lead.includes('عرض المرشحين'));
  assert.ok(lead.includes('بحاجة إلى متابعة'), 'موعد القرار القريب ليس في المتابعات');
  assert.ok(lead.includes('id="tm-need-form"') && lead.includes('data-action="need-new"') && lead.includes('إضافة احتياج'), 'درج S20 غائب عن المنشئ');
  assert.ok(lead.includes('value="P1"'), 'منتقي المشروع بلا مشاريع نطاقه');
  assert.ok(lead.includes('حفظ الاحتياج لا يحجز مورداً'), 'تنبيه «لا يحجز» غائب');
  assert.ok(lead.includes(`data-action="need-edit" data-id="${needId}"`) && lead.includes('data-action="need-cancel"'), 'أزرار التعديل والإلغاء لصاحب الاحتياج غائبة');

  const hr = await P.needsPage(await sess('u_hr'), {});
  noLeak(hr, 'S19-hr');
  assert.ok(hr.includes('محلل بيانات'), 'الموارد البشرية لا ترى الاحتياج');
  assert.ok(!hr.includes('id="tm-need-form"') && !hr.includes('data-action="need-new"'), 'درج الإنشاء ظهر لمن لا ينشئ');
  assert.ok(!hr.includes('data-action="need-edit"'), 'زر التعديل ظهر لمن لا يعدّل');

  const none = await P.needsPage(await sess('u_lead'), { from: `${YEAR + 1}-01`, to: `${YEAR + 1}-02` });
  noLeak(none, 'S19-empty');
  assert.ok(none.includes('لا نتائج لهذه المرشّحات'), 'حالة الفراغ عند مرشّحٍ لا يطابق');
  const cons = await sess('u_a');
  await assert.rejects(() => P.needsPage(cons, {}), (e) => e.status === 403 && /صلاحية/.test(e.message));
});

// ── S21 ─────────────────────────────────────────────────────────────────────────
test('S21: خارج الارتباط كما هو، والمعلَّق ظاهر غير مخصوم مطابقاً للخدمة، والتعارض المحتمل 120%', async () => {
  const [html, svc] = await Promise.all([
    P.needCandidatesPage(await sess('u_lead'), needId, {}),
    needs.candidates(await sess('u_lead'), needId, {}),
  ]);
  noLeak(html, 'S21');
  const busy = svc.rows.find((r) => r.employeeId === 'e_busy');
  assert.equal(busy.availability[0].availablePct, 50); assert.equal(busy.pendingRequests[0].pct, 20); assert.equal(busy.potentialOverPct, 120);
  const rowBusy = rowOf(html, 'data-emp', 'e_busy');
  assert.ok(rowBusy.includes('>50%</span>'), 'المتاح في الصفحة لا يطابق الخدمة (50%)');
  assert.ok(!rowBusy.includes('>30%</span>'), 'المعلَّق خُصم من المتاح');
  assert.ok(rowBusy.includes('منصة البيانات الوطنية') && rowBusy.includes('20%') && rowBusy.includes('لا يُخصم'), 'الطلب المعلَّق غير ظاهر بنسبته');
  assert.ok(rowBusy.includes('تعارض محتمل: الإجمالي المحتمل 120%'), 'التعارض المحتمل غائب');
  assert.ok(rowBusy.includes('موثقة'), 'حالة المهارة نصاً غائبة');
  const rowNov = rowOf(html, 'data-emp', 'e_nov');
  assert.ok(rowNov.includes('خارج الارتباط'), 'الشهر خارج الارتباط لا يُقال');
  assert.ok(rowNov.includes('تحتاج تأكيداً'), 'المهارة الذاتية لا تُقال «تحتاج تأكيداً»');
  const rowB = rowOf(html, 'data-emp', 'e_b');
  assert.ok(rowB.includes('غير مسجلة'), 'المهارة الغائبة لا تُقال');
  assert.ok(!/\d+%\s*ملاءمة|ملاءمة\s*\d+%/.test(html), 'ظهرت نسبة ملاءمة رقمية');
  assert.ok(html.includes('id="tm-cd-panel"') && html.includes('إعداد طلب التسكين') && html.includes('نوع التسكين المطلوب'), 'لوحة الطلب غائبة عن صاحب الاحتياج');
  assert.ok(html.includes('طلب توفير مورد خارجي') && !/تكلفة\s*\d/.test(html), 'البديل الخارجي بلا إجراء أو بتكلفة مخترعة');
  assert.ok(html.includes('سارة المساندة'), 'مورد وحدة المساندة غائب');

  const hr = await P.needCandidatesPage(await sess('u_hr'), needId, {});
  noLeak(hr, 'S21-hr');
  assert.ok(!hr.includes('id="tm-cd-panel"'), 'لوحة الطلب ظهرت لمن لا يملك الاحتياج');

  const none = await P.needCandidatesPage(await sess('u_lead'), needId, { q: 'لا أحد بهذا الاسم' });
  noLeak(none, 'S21-empty');
  assert.ok(none.includes('لا نتائج للبحث'), 'حالة فراغ البحث');
});
