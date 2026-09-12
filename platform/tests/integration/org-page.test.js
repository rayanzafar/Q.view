// صفحة الهيكل التنظيمي — ما يجب أن يبقى على الشاشة مهما تغيّر ما تحتها.
// المشكلة التي تغلقها هذه الحارة (بلسان المالك: «الهيكل جداً سيء»): الشجرة كانت تعرض أشخاصاً بلا
// عمل — إدارات بأصفار بينما مئات الفرص مكدّسة على القطاع ككتلة واحدة، ولا طريق من الشاشة إلى
// الإصلاح. الاختبارات هنا تحرس الثوابت الخمسة للعرض:
//   ١) بند فحص «مؤجَّل» لا يُقرأ أبداً كبند سليم — التفريق بينهما هو أصل الثقة بالدرجة.
//   ٢) لوحة «غير مُسنَد» تُظهر التباين (٠٪ داخل الإدارات) وتصرف المال بصيغته لا بالهللات الخام.
//   ٣) شاشة الإسناد تُبنى على الخادم: صفوفها موجودة بلا جافاسكربت، وقائمة الإدارات لا تعرض
//      إدارة من قطاع آخر (الخادم يرفضها، فلا نعرض خياراً مرفوضاً سلفاً).
//   ٤) عقدة الإدارة في الشجرة تحمل أرقام عملها + أداة تعيين مسؤول (البند «إدارات بلا مسؤول» كان
//      يُعرض بلا أي طريق لإغلاقه).
//   ٥) لا قيمة خام ولا مصطلح تقني يتسرّب إلى الصفحة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-orgpage-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const { orgTreePage } = await import('../../src/web/views/org.js');

const T = '2026-01-01T00:00:00Z';
const YEAR = 2026;
const U = (id, role, sector, scope) =>
  ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sector, scope,
    projectIds: new Set(), teamIds: new Set() });
const admin = U('u_admin', 'admin', null, 'company');
const leadSol = U('u_lead_sol', 'sector_lead', 'SOLUTIONS', 'sector');

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
  await insert('department', { id: 'D_SMART', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await insert('department', { id: 'D_DATA', sector_id: 'SOLUTIONS', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  await insert('department', { id: 'D_PMO', sector_id: 'CONSULTING', name_ar: 'مكتب إدارة المشاريع', active: 1, created_at: T });
  for (const u of [admin, leadSol]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('employee', { id: 'E1', name_ar: 'سارة الحربي', sector_id: 'SOLUTIONS', department_id: 'D_SMART', active: 1, created_at: T });
  await insert('employee', { id: 'E2', name_ar: 'خالد العتيبي', sector_id: 'SOLUTIONS', department_id: null, active: 1, created_at: T });
  // ١٠٥ فرص مكدّسة على القطاع بلا إدارة — نفس شكل البيئة الحيّة، بقيمة معلومة
  for (let i = 1; i <= 105; i++) {
    await insert('opportunity', { id: 'O' + i, code: 'OPP-' + i, title_ar: 'فرصة رقم ' + i, sector_id: 'SOLUTIONS',
      department_id: null, stage_id: 'LEAD', value_halalas: 100_000_000, win_pct: 30, year: YEAR, created_at: T });
  }
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع بلا إدارة', sector_id: 'SOLUTIONS',
    department_id: null, status: 'IN_PROGRESS', contract_value_halalas: 50_000_000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const NO_LEAK = [/undefined/, /\bNaN\b/, /\[object/, /\bID:/];
const clean = (html, where) => {
  for (const rx of NO_LEAK) assert.ok(!rx.test(html), `${where}: تسرّب ${rx} إلى الصفحة`);
};

test('بطاقة صحة الهيكل: درجة واحدة كبيرة + عنوان + بنود مرتبة، والبند المؤجَّل لا يُقرأ سليماً', async () => {
  const html = await orgTreePage(admin, {});
  clean(html, 'الصفحة الرئيسية');
  assert.match(html, /class="oh-num tnum">\d+<\/div>/, 'الدرجة رقم واحد بارز');
  assert.match(html, /درجة اكتمال الهيكل/, 'للرقم تسمية تقول معناه');
  assert.match(html, /ملاحظات على الهيكل التنظيمي|الهيكل التنظيمي مكتمل/, 'عنوان الفحص من الخدمة نفسها');
  // ثمانية بنود قرار كاملة، وكل بند مشتعل قابل للفتح على سجلاته وتلميح إصلاحه
  assert.equal((html.match(/class="oh-chk oh-/g) || []).length, 8, 'ثمانية بنود قرار');
  assert.match(html, /ما يُغلق هذا البند/, 'كل بند مشتعل يحمل ما يُغلقه');
  assert.match(html, /موظفون بلا إدارة/, 'بند الموظفين بلا إدارة يظهر');

  // نطاق القطاع ⟵ بند «فرص بلا قطاع» يصير مؤجَّلاً: يجب أن يقول «مؤجَّل» لا «مكتمل»
  const scoped = await orgTreePage(leadSol, {});
  clean(scoped, 'صفحة قائد القطاع');
  const later = scoped.match(/<div class="oh-chk oh-later">[\s\S]*?<\/div>\s*<\/div>/g) || [];
  assert.ok(later.length >= 1, 'البند غير المقيس يظهر كبند مؤجَّل');
  assert.match(later[0], /مؤجَّل/, 'يُقرأ «مؤجَّل»');
  assert.ok(!/مكتمل ✓/.test(later[0]), 'البند المؤجَّل لا يحمل علامة الاكتمال أبداً');
});

test('لوحة «غير مُسنَد»: التباين ظاهر بالنسبة والمال بصيغته لا بالهللات', async () => {
  const html = await orgTreePage(admin, { year: YEAR });
  // القطع بنهاية القسم نفسه لا ببداية القسم التالي: ربطُ الاختبار بترتيب الأقسام يجعل أي
  // إعادة ترتيب في الصفحة تُسقطه كأن الميزة تعطّلت، وهي لم تُمسّ.
  // القسم صار مطويّاً (details) بعد ملاحظة المالك أن التشخيص كان يزاحم الهيكل نفسه — والعدد
  // يبقى مكتوباً في عنوان الطيّة فلا يختفي بطيّها. القطع عند نهاية الطيّة لا عند نهاية قسم.
  const from = html.indexOf('id="unassigned"');
  const card = html.slice(from, html.indexOf('</details>', from));
  assert.match(html.slice(from, html.indexOf('</summary>', from)), /بانتظار الإسناد/,
    'العدد المعلَّق مقروء قبل الفتح');
  assert.match(card, /لا شيء منها داخل الإدارات/, 'التباين مكتوب لا مستنتج: لا فرصة واحدة داخل إدارة');
  assert.match(card, /class="tnum ua-open">105</, 'عدد الفرص المعلّقة كما هو');
  assert.match(card, /ر\.س\./, 'المال بصيغة العملة');
  assert.ok(!card.includes('10500000000'), 'لا هللات خام على الشاشة');
  assert.match(card, /شاشة الإسناد/, 'من اللوحة طريق مباشر إلى الإصلاح');
});

test('أرقام الإدارة في الشجرة: العدد الحيّ يُقال والصفر يُطوى، والنداء في وضع التعديل وحده', async () => {
  // تحوّل مقصود عن السلوك الأول («الصفر يُقال صراحةً») بعد ملاحظة المالك أن الشاشة مزدحمة
  // وغير واضحة: صفٌّ يقول «فرص ٠ · مشاريع ٠» على كل إدارة يدفن العدد الوحيد الذي يهمّ (الفريق)،
  // ونداءُ «أسنِد» بالأصفر فوق كل إدارة كان أعلى صوتٍ في شاشةٍ غايتها القراءة. فالصفر يُطوى،
  // وعدد الفريق يبقى دائماً — والنداء إجراءٌ فمكانه وضع التعديل.
  const html = await orgTreePage(admin, { year: YEAR });
  const tree = html.slice(html.indexOf('id="tree"'));
  const at = tree.indexOf('إدارة المدن الذكية');
  const node = tree.slice(at, tree.indexOf('</summary>', at));
  assert.ok(!/فرص<\/span> <span class="ot-count tnum">0</.test(node), 'الصفر لا يُطبع في وضع القراءة');
  assert.match(node, /فريق<\/span> <span class="ot-count tnum">1</, 'عدد الفريق داخل العقدة دائماً');
  assert.ok(!node.includes('أسنِد عملاً'), 'وضع القراءة بلا نداء إجراء');

  const ed = await orgTreePage(admin, { year: YEAR, edit: '1' });
  const eTree = ed.slice(ed.indexOf('id="tree"'));
  const eAt = eTree.indexOf('إدارة المدن الذكية');
  assert.match(eTree.slice(eAt, eTree.indexOf('</summary>', eAt)), /أسنِد عملاً/,
    'وضع التعديل يحمل نداء الإسناد لإدارةٍ بلا عمل');
});

test('أهل الإدارة يظهرون بأسمائهم داخل العقدة — الهيكل ناسٌ لا صناديق', async () => {
  const html = await orgTreePage(admin, { year: YEAR });
  // القطع عند بداية القسم التالي: فحص الجودة أسفل الصفحة يسرد الموظفين بلا إدارة بأسمائهم عن
  // قصد، فقراءة الصفحة كاملةً تجعل نفي «غير المسنَد من الشجرة» يفشل على سلوكٍ صحيح.
  const tree = html.slice(html.indexOf('id="tree"'), html.indexOf('id="unassigned"'));
  assert.match(tree, /class="ot-people"/, 'لكل إدارة عامرة لوحُ أشخاصها');
  assert.match(tree, /class="ot-pn">سارة الحربي</, 'الاسم مكتوب لا معدود');
  assert.ok(!tree.includes('>خالد العتيبي<'), 'ومن لا إدارة له لا يُنسب إلى إدارة');
  assert.match(tree, /class="ot-plabel"/, 'وللوح عنوانٌ يقول كم هم');
});

test('تعيين مسؤول الإدارة متاح من العقدة نفسها لمن يملك الهيكل — ومقروء لغيره', async () => {
  // القراءة صارت الوضع الافتراضي وأدوات التحرير خلف زرّ (edit=1). فالوضع الافتراضي يُفحص
  // بخلوّه من الأدوات، ووضع التحرير بوجودها — والصلاحية تُفحص في الاثنين.
  const plain = await orgTreePage(admin, {});
  assert.ok(!/data-action-change="dep-manager"/.test(plain), 'وضع القراءة يخلو من أدوات التحرير');
  assert.match(plain, /بلا مسؤول معيَّن/, 'ويبقى الاسم مقروءاً');
  assert.match(plain, /تعديل الهيكل/, 'وفيه مدخلٌ ظاهر إلى وضع التعديل');

  const html = await orgTreePage(admin, { edit: '1' });
  assert.match(html, /data-action-change="dep-manager"/, 'أداة تعيين المسؤول موجودة');
  assert.match(html, /<option value="" selected>بلا مسؤول معيَّن<\/option>/, 'الحالة الفارغة تبقى بنصّها وتصير قابلة للتغيير');
  assert.match(html, /aria-label="مسؤول الإدارة"/, 'للأداة تسمية يقرأها قارئ الشاشة');
  // من لا يملك تعديل الهيكل يرى الاسم نصاً فقط
  const viewer = U('u_view', 'hr', null, 'company');
  const ro = await orgTreePage(viewer, {});
  assert.ok(!/data-action-change="dep-manager"/.test(ro), 'بلا صلاحية إدارة الهيكل: لا أداة تعيين');
  assert.match(ro, /بلا مسؤول معيَّن/, 'ويبقى النص مقروءاً كما كان');
});

test('شاشة الإسناد تُبنى على الخادم: صفوف حقيقية وقائمة إدارات القطاع وحده', async () => {
  const html = await orgTreePage(admin, { fix: 'SOLUTIONS', kind: 'opportunity', year: YEAR });
  clean(html, 'شاشة الإسناد');
  // الصفوف موجودة في HTML نفسه (تُقرأ بلا جافاسكربت)، وسقف الدفعة محترم
  const rows = html.match(/<tr data-row="/g) || [];
  assert.equal(rows.length, 100, 'تُعرض دفعة واحدة قابلة للتنفيذ (١٠٠ صفاً)');
  assert.match(html, /تُعرض أول <span class="tnum">100<\/span> فقط/, 'الاقتطاع مُعلن لا صامت');
  assert.match(html, /data-action="asg-apply"/, 'زر الإسناد الجماعي');
  // قائمة الإدارات: إدارات هذا القطاع فقط — لا خيار سيرفضه الخادم
  const picker = html.slice(html.indexOf('id="asg-dep"'), html.indexOf('</select>', html.indexOf('id="asg-dep"')));
  assert.match(picker, /D_SMART/);
  assert.match(picker, /D_DATA/);
  assert.ok(!picker.includes('D_PMO'), 'إدارة قطاع آخر لا تُعرض إطلاقاً');
  // ولا يقع خيار «إدارة قطاع آخر» في أي مكان من الشاشة
  assert.ok(!html.includes('مكتب إدارة المشاريع'), 'لا اسم إدارة من خارج القطاع على الشاشة');
});

test('شاشة الإسناد: نوع بلا سجلات ⟵ حالة فارغة مصمَّمة، لا جدول أعمى', async () => {
  const html = await orgTreePage(admin, { fix: 'CONSULTING', kind: 'project', year: YEAR });
  clean(html, 'شاشة إسناد فارغة');
  assert.match(html, /class="empty-state"/, 'حالة فارغة مصمَّمة');
  assert.match(html, /لا مشاريع بلا إدارة في قطاع الاستشارات/, 'نصّها يقول أين ولماذا');
  assert.match(html, /رجوع للهيكل/, 'وفيها خطوة تالية');
});

test('قطاع غير موجود: رسالة عربية واضحة بدل انهيار الصفحة', async () => {
  const html = await orgTreePage(admin, { fix: 'NO_SUCH_SECTOR', kind: 'opportunity' });
  clean(html, 'قطاع غير موجود');
  assert.match(html, /تعذّر فتح شاشة الإسناد/, 'عنوان الخطأ');
  assert.match(html, /القطاع غير موجود/, 'سبب الخادم كما هو');
  assert.match(html, /رجوع للهيكل/, 'وطريق للخروج');
});
