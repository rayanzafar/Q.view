// «مركز القطاع» يتغيّر بتغيّر من يفتحه — لا شاشة قائد واحدة للجميع.
//
// العطب الذي تغلقه هذه الحارة (بلسان المالك: «موضوع مركز القطاع يحتاج يكون حسب دور الشخص
// ويتغير دائماً تبعه وكل دور له أكسس وبس يظهر مثلاً الموظف مشاريعه أو مهامه أو فرصه وكذا»):
// الصفحة كانت تُصدِر **مركز قيادة القطاع نفسه** لكل من يُسمح له بفتحها — فيرى الموظف المبتدئ
// والاستشاري مستهدفات القطاع التجارية وقمع فرصه وتحصيله وتركّز عملائه وطاقته كاملة. أرقام
// قرارٍ لا يملكه ولا يستطيع التصرف بها.
//
// ما تحرسه الاختبارات:
//   ١) صفحة الموظف خالية من **كل** رقم قيادي — كل مصطلح يُفحص وحده كي يسمّي الفشلُ المتسرِّبَ.
//   ٢) صفحة قائد القطاع ما زالت تحملها كلها — التفريع لم يُخفِ على من يملك.
//   ٣) الموظف يرى مشاريعه هو لا مشاريع القطاع (ثلاثة مشاريع، مُسكَّن على واحد).
//   ٤) بلا عمل في القطاع ⟵ الحالة المصمَّمة بخطوة تالية، لا لوحة فارغة.
//   ٥) القرار **مشتق من نطاق الصلاحية** لا من قائمة أدوار: دور مُخترَع بنطاق ضيّق يأخذ الوجه
//      الشخصي، والدور نفسه بنطاق قطاعي يأخذ مركز القيادة — بلا لمس أي سطر في الصفحة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-sectorview-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, run, close } = await import('../../src/core/db/index.js');
const { initRbac, effectiveScope } = await import('../../src/core/rbac/index.js');
const { sectorPage, sectorViewMode } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = 2026;
const U = (id, role, sector, scope, projects = []) => ({
  id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
  projectIds: new Set(projects), teamIds: new Set(),
});

const lead = U('u_lead', 'sector_lead', 'SOLUTIONS', 'sector');
const emp = U('u_emp', 'employee', 'SOLUTIONS', 'own', ['P_MINE']);
const cons = U('u_cons', 'consultant', 'SOLUTIONS', 'own', ['P_MINE']);
const fresh = U('u_fresh', 'employee', 'SOLUTIONS', 'own');   // موظف بلا أي عمل في القطاع
// موظف سُكِّن على المشروع من شاشة التسكين (جدول التسكين) بلا عضوية ولا ملكية — الحالة الواقعية
const staffed = { ...U('u_staffed', 'employee', 'SOLUTIONS', 'own'), employee_id: 'E_STAFF' };
const narrow = U('u_narrow', 'field_officer', 'SOLUTIONS', 'own', ['P_MINE']); // دور مُخترَع، نطاق ضيّق
const wide = U('u_wide', 'sector_analyst', 'SOLUTIONS', 'own'); // دور مُخترَع، نطاق قطاعي

before(async () => {
  // دوران مُخترَعان بعد إقلاع المنصة — ليسا في أي قائمة داخل الكود، والقرار يجب أن يعرفهما.
  for (const [id, ar] of [['field_officer', 'مسؤول ميداني'], ['sector_analyst', 'محلل قطاع']]) {
    await insert('role', { id, name_ar: ar, name_en: id, is_system: 0, created_at: T });
  }
  await insert('sector', {
    id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', color: '#244A99', active: 1, sort_order: 1,
    target_revenue_halalas: 900_000_000, target_sales_halalas: 700_000_000, created_at: T,
  });
  for (const u of [lead, emp, cons, fresh, staffed, narrow, wide]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', ['u_lead', 'SOLUTIONS']);
  const grant = (role, resource, action, scope) =>
    run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', [role, resource, action, scope]);
  await grant('field_officer', 'project', 'read', 'project');   // مشاريعه وحدها
  await grant('field_officer', 'task', 'read', 'own');
  await grant('sector_analyst', 'project', 'read', 'sector');   // القطاع كله
  await grant('sector_analyst', 'opportunity', 'read', 'sector');
  await initRbac();

  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0, color: '#94a3b8' });

  // ثلاثة مشاريع في القطاع؛ الموظف مُسكَّن على واحد فقط
  await insert('project', { id: 'P_MINE', code: 'PRJ-1', name_ar: 'مشروع أنا عليه', sector_id: 'SOLUTIONS',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, contract_value_halalas: 500_000_00, created_at: T });
  await insert('project', { id: 'P_OTHER1', code: 'PRJ-2', name_ar: 'مشروع بعيد عني', sector_id: 'SOLUTIONS',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'AMBER', progress_pct: 10, created_at: T });
  await insert('project', { id: 'P_OTHER2', code: 'PRJ-3', name_ar: 'مشروع ثالث لا يخصني', sector_id: 'SOLUTIONS',
    client_id: 'C1', status: 'IN_PROGRESS', rag: 'RED', progress_pct: 5, created_at: T });
  await insert('milestone', { id: 'M1', project_id: 'P_MINE', name_ar: 'تسليم المرحلة الأولى',
    status: 'PENDING', due_date: '2026-08-15', created_at: T });

  // تسكين حقيقي من شاشة التسكين: سجل في جدول التسكين بلا عضوية ولا ملكية
  await insert('employee', { id: 'E_STAFF', name_ar: 'موظف مُسكَّن', sector_id: 'SOLUTIONS', active: 1, created_at: T });
  await insert('allocation', { id: 'A1', employee_id: 'E_STAFF', person_name_ar: 'موظف مُسكَّن', project_id: 'P_MINE',
    project_name: 'مشروع أنا عليه', sector_id: 'SOLUTIONS', type: 'member', year: YEAR,
    monthly_json: '{"1":1}', source: 'manual', created_at: T });

  // مهام: اثنتان للموظف داخل القطاع (إحداهما متأخرة)، وواحدة لغيره كي لا تتسرّب
  await insert('task', { id: 'T_LATE', title: 'تحديث خطة الاختبار', sector_id: 'SOLUTIONS', project_id: 'P_MINE',
    assignee_user_id: 'u_emp', status: 'TODO', priority: 'P1', due_date: '2026-01-02', created_at: T });
  await insert('task', { id: 'T_SOON', title: 'إعداد محضر الاجتماع', sector_id: 'SOLUTIONS',
    assignee_user_id: 'u_emp', status: 'IN_PROGRESS', priority: 'P2', due_date: '2026-12-30', created_at: T });
  await insert('task', { id: 'T_DONE', title: 'مهمة منتهية لا تشغل القائمة', sector_id: 'SOLUTIONS',
    assignee_user_id: 'u_emp', status: 'DONE', priority: 'P2', created_at: T });
  await insert('task', { id: 'T_OTHER', title: 'مهمة زميل آخر', sector_id: 'SOLUTIONS',
    assignee_user_id: 'u_lead', status: 'TODO', priority: 'P0', due_date: '2026-01-03', created_at: T });

  // فرص: واحدة للاستشاري، وأخرى لقائد القطاع (يقرؤها الاستشاري؟ لا — نطاقه «خاصتي»)
  await insert('opportunity', { id: 'O_MINE', code: 'OPP-1', title_ar: 'فرصة الاستشاري نفسه', sector_id: 'SOLUTIONS',
    client_id: 'C1', stage_id: 'LEAD', owner_user_id: 'u_cons', value_halalas: 250_000_00, win_pct: 20,
    year: YEAR, next_action: 'جدولة اجتماع إغلاق', created_at: T });
  await insert('opportunity', { id: 'O_LEAD', code: 'OPP-2', title_ar: 'فرصة قائد القطاع', sector_id: 'SOLUTIONS',
    client_id: 'C1', stage_id: 'LEAD', owner_user_id: 'u_lead', value_halalas: 900_000_00, win_pct: 40,
    year: YEAR, created_at: T });

  // إيراد ومستهدف كي يكون لمركز القيادة ما يعرضه فعلاً (وإلا صار غياب الأرقام بلا معنى)
  await insert('revenue_line', { id: 'R1', project_id: 'P_MINE', sector_id: 'SOLUTIONS', year: YEAR, month: 1,
    amount_halalas: 300_000_00, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ما يقرأه المستخدم فعلاً: جسم الصفحة بلا أوراق الأنماط وبرمجة المتصفح. القوالب العامة في
// layout.js تحمل تعليقات عربية داخل <style> ليست نصاً معروضاً — فحصها يخلط الشكل بالمضمون.
function mainOf(html) {
  const s = html.indexOf('<main');
  const e = html.indexOf('</main>');
  assert.ok(s >= 0 && e > s, 'الصفحة تُبنى داخل قالب المنصة');
  return html.slice(html.indexOf('>', s) + 1, e)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ');
}

// أرقام القيادة السبعة — كل واحد يُفحص وحده كي يقول الفشلُ **أيَّها** تسرّب.
const LEADERSHIP = [
  ['المستهدف', 'مستهدف القطاع'],
  // أسماء بطاقات مركز القيادة v5 — تدخل قائمة المنع كي لا تتسرب بأسمائها الجديدة
  ['الأداء مقابل الخطة', 'الأداء مقابل الهدف'],
  ['طاقة الفريق', 'طاقة فريق القطاع'],
  ['تغطية خط الفرص', 'تغطية خط الفرص'],
  ['نسبة التحقق', 'نسبة تحقق الهدف'],
  ['الإيقاع مقابل الخطة', 'الإيراد مقابل الهدف'],
  ['قمع الفرص', 'قمع فرص القطاع'],
  ['التحصيل', 'التحصيل'],
  ['أعمار المستحقات', 'أعمار المستحقات'],
  ['المستخلص المتأخر', 'المستخلص المتأخر'],
  ['الطاقة الاستيعابية', 'طاقة القطاع'],
  ['الإشغال', 'إشغال فريق القطاع'],
  ['العملاء', 'تركّز عملاء القطاع'],
  ['الهامش', 'هامش الربح'],
  ['التكلفة', 'الكلفة'],
];
const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/, /\bID:/];
const clean = (html, where) => {
  for (const rx of NO_LEAK) assert.ok(!rx.test(html), `${where}: تسرّب ${rx} إلى الصفحة`);
};

// ═══════════════ (١) الموظف لا يرى رقماً قيادياً واحداً ═══════════════

test('صفحة الموظف: لا مستهدف ولا قمع فرص ولا تحصيل ولا طاقة ولا كلفة — كل مصطلح يُفحص وحده', async () => {
  const body = mainOf(await sectorPage(emp, { year: YEAR }));
  for (const [term, human] of LEADERSHIP) {
    assert.ok(!body.includes(term), `تسرّب إلى شاشة الموظف: ${human} («${term}»)`);
  }
  assert.ok(!body.includes('مركز قيادة'), 'ولا حتى العنوان يعِده بشاشة قيادة');
});

test('صفحة الاستشاري: النظافة نفسها — التفريع بالنطاق لا بالدور', async () => {
  const body = mainOf(await sectorPage(cons, { year: YEAR }));
  for (const [term, human] of LEADERSHIP) {
    assert.ok(!body.includes(term), `تسرّب إلى شاشة الاستشاري: ${human} («${term}»)`);
  }
});

// ═══════════════ (٢) قائد القطاع لم يخسر شيئاً ═══════════════

test('صفحة قائد القطاع: مركز القيادة كما هو — التفريع لم يُخفِ على من يملك', async () => {
  const html = await sectorPage(lead, { year: YEAR });
  clean(html, 'مركز القيادة');
  const body = mainOf(html);
  // أسماء v5: «الأداء مقابل الخطة» خلفاً لـ«الإيقاع»، و«قدرة الفريق» خلفاً لبطاقة «الطاقة».
  for (const term of ['المستهدف', 'قمع الفرص', 'الأداء مقابل الخطة', 'طاقة الفريق', 'الإشغال', 'العملاء']) {
    assert.ok(body.includes(term), `اختفى عن قائد القطاع: ${term}`);
  }
  assert.match(html, /مركز قيادة قطاع الحلول/, 'وعنوانها عنوان قيادة');
});

// ═══════════════ (٣) مشاريعه هو لا مشاريع القطاع ═══════════════

test('الموظف يرى المشروع الذي هو عليه فقط — لا مشاريع القطاع الأخرى', async () => {
  const html = await sectorPage(emp, { year: YEAR });
  clean(html, 'قطاعي — الموظف');
  const body = mainOf(html);
  assert.ok(body.includes('مشروع أنا عليه'), 'مشروعه حاضر باسمه');
  assert.ok(!body.includes('مشروع بعيد عني'), 'ومشروع القطاع الآخر غائب');
  assert.ok(!body.includes('مشروع ثالث لا يخصني'), 'والثالث كذلك');
  assert.ok(body.includes('تسليم المرحلة الأولى'), 'وخطوته التالية على مشروعه ظاهرة');
});

test('من سُكِّن على مشروع من شاشة التسكين يراه — ولو لم يملكه ولم يُسجَّل عضواً فيه', async () => {
  // لا مسار في المنتج يكتب «عضوية مشروع»، والتسكين هو ما تكتبه شاشة التسكين فعلاً. الاكتفاء
  // بنطاق الصلاحية وحده كان سيُظهر شاشة فارغة لمن يعمل على المشروع منذ شهور.
  const body = mainOf(await sectorPage(staffed, { year: YEAR }));
  assert.ok(body.includes('مشروع أنا عليه'), 'مشروعه المُسكَّن عليه ظاهر');
  assert.ok(!body.includes('مشروع بعيد عني'), 'ولا مشاريع القطاع الأخرى');
  assert.ok(!body.includes('مشروع ثالث لا يخصني'), 'ولا الثالث');
  for (const [term, human] of LEADERSHIP) {
    assert.ok(!body.includes(term), `تسرّب إلى شاشة المُسكَّن: ${human}`);
  }
});

test('مهامه هو، الأكثر إلحاحاً أولاً، وبطريق إلى «مهامي»', async () => {
  const body = mainOf(await sectorPage(emp, { year: YEAR }));
  assert.ok(body.includes('تحديث خطة الاختبار'), 'مهمته المتأخرة ظاهرة');
  assert.ok(body.includes('إعداد محضر الاجتماع'), 'ومهمته القادمة كذلك');
  assert.ok(!body.includes('مهمة زميل آخر'), 'ولا مهمة زميله');
  assert.ok(!body.includes('مهمة منتهية لا تشغل القائمة'), 'والمنجزة لا تزاحم المفتوح');
  assert.ok(body.indexOf('تحديث خطة الاختبار') < body.indexOf('إعداد محضر الاجتماع'), 'المتأخرة قبل البعيدة');
  assert.match(body, /href="\/app\/tasks"/, 'وطريق واضح إلى «مهامي»');
});

test('هوية القطاع: اسمه ومن يقوده — كي يعرف أين يقف', async () => {
  const body = mainOf(await sectorPage(emp, { year: YEAR }));
  assert.ok(body.includes('قطاع الحلول'), 'اسم القطاع');
  assert.ok(body.includes('مستخدم u_lead'), 'ومن يقوده');
});

// ═══════════════ (٤) الفرص: تُسأل الصلاحية ولا تُفترض ═══════════════

test('الاستشاري يرى فرصه هو — والموظف لا يرى قسم الفرص أصلاً', async () => {
  const consBody = mainOf(await sectorPage(cons, { year: YEAR }));
  assert.ok(consBody.includes('فرصة الاستشاري نفسه'), 'فرصته هو حاضرة');
  assert.ok(!consBody.includes('فرصة قائد القطاع'), 'وفرصة غيره غائبة');
  assert.ok(consBody.includes('جدولة اجتماع إغلاق'), 'مع خطوتها التالية');

  const empBody = mainOf(await sectorPage(emp, { year: YEAR }));
  assert.ok(!empBody.includes('فرصي في هذا القطاع'), 'الموظف لا يقرأ الفرص فلا قسم لها عنده');
  assert.ok(!empBody.includes('فرصة الاستشاري نفسه'), 'ولا فرصة أحد');
});

// ═══════════════ (٥) الحالة المصمَّمة ═══════════════

test('من لا عمل له في القطاع بعد: حالة مصمَّمة بخطوة تالية، لا لوحة فارغة', async () => {
  const html = await sectorPage(fresh, { year: YEAR });
  clean(html, 'قطاعي — بلا عمل');
  const body = mainOf(html);
  assert.match(body, /class="empty-state"/, 'الحالة المصمَّمة لا فراغ');
  assert.ok(body.includes('لا عمل مسجَّل لك في قطاع الحلول بعد'), 'تقول ما الحال بلغته');
  assert.ok(body.includes('مستخدم u_lead'), 'وتدلّه على من يسأل');
  assert.match(body, /<a class="btn btn-primary" href="\/app\/tasks">[^<]+<\/a>/, 'وخطوة تالية قابلة للنقر');
  assert.ok(body.includes('قطاع الحلول'), 'وهوية قطاعه تبقى ظاهرة');
});

// ═══════════════ (٦) القرار مشتق من النطاق لا من قائمة أدوار ═══════════════

test('دور مُخترَع بنطاق ضيّق يأخذ الوجه الشخصي — بلا ذكر اسمه في أي سطر', async () => {
  assert.equal(effectiveScope(narrow, 'read', 'project'), 'project', 'نطاقه مشاريعه');
  assert.equal(sectorViewMode(narrow).mode, 'personal');
  const body = mainOf(await sectorPage(narrow, { year: YEAR }));
  for (const [term, human] of LEADERSHIP) {
    assert.ok(!body.includes(term), `تسرّب إلى دور ضيّق النطاق: ${human}`);
  }
  assert.ok(body.includes('مشروع أنا عليه'), 'ويرى مشروعه هو');
  assert.ok(!body.includes('مشروع بعيد عني'), 'لا مشاريع القطاع');
});

test('الدور المُخترَع نفسه بنطاق قطاعي يأخذ مركز القيادة — الشرط نطاقي لا اسمي', async () => {
  assert.equal(effectiveScope(wide, 'read', 'project'), 'sector');
  assert.equal(sectorViewMode(wide).mode, 'command');
  const body = mainOf(await sectorPage(wide, { year: YEAR }));
  assert.ok(body.includes('قمع الفرص'), 'يرى قمع الفرص');
  assert.ok(body.includes('المستهدف') || body.includes('الهدف'), 'ويرى المستهدف');
});

test('can() بلا صف هدف لا تصلح للسؤال النطاقي — والقرار لا يعتمد عليها', async () => {
  const { can } = await import('../../src/core/rbac/index.js');
  // الموظف «يقرأ المشاريع» بمعنى وجود المنح، ونطاقه مع ذلك مشاريعه هو لا القطاع.
  assert.equal(can(emp, 'read', 'project'), true, 'المنح موجود');
  assert.equal(effectiveScope(emp, 'read', 'project'), 'project', 'والنطاق ضيّق');
  assert.equal(sectorViewMode(emp).mode, 'personal', 'فالقرار يتبع النطاق لا وجود المنح');
});

// ═══════════════ (٧) جذر العطب في محرّك الصلاحيات ═══════════════

test('نطاق «خاصتي» يعود «خاصتي» لا «بلا صلاحية» — وإلا اختفت فرص صاحبها عنه', async () => {
  // كانت المقارنة داخل effectiveScope تبدأ من رتبة «خاصتي» نفسها فلا يتجاوزها منحٌ بها،
  // فتعود null فيترجمها مرشّح القوائم إلى «لا صفوف إطلاقاً»: الاستشاري يملك فرصه ولا يرى منها شيئاً.
  assert.equal(effectiveScope(cons, 'read', 'opportunity'), 'own');
  const { listOpportunities } = await import('../../src/modules/crm/opportunities.js');
  const rows = await listOpportunities(cons, { sector: 'SOLUTIONS' });
  assert.deepEqual(rows.map((o) => o.id), ['O_MINE'], 'فرصه هو — لا صفر ولا فرص غيره');
});
