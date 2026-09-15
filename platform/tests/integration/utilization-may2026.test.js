// «احتاج منك تحدّث اليوتلايزيشن الموجود على الناس بناءً على الملفات المرسلة لقطاع الحلول».
//
// وأخصّ ما يُحرَس هنا ليس الكتابة بل **الامتناع**: المطابقة بالاسم، والاسم ليس مفتاحاً.
// وتسكينٌ على المشروع الخطأ عطلٌ صامت — يظهر في حِمل رجلٍ لا يعمل عليه، ويغيب عمّن يعمل،
// ولا يشتكي منه أحد. فالسكربت يكتب ما يُحسَم، ويترك ما لا يُحسَم **ويقول سببه**.
//
// ويُحرَس معه قراران:
//   • «قطاع الحلول ٤٠٪» ليست مشروعاً بل بقيّةَ وقتٍ محجوزة للقطاع — فلا تُكتب تسكيناً.
//   • التعارض بين المصدرين لا يُرجَّح بلا قرار المالك — يُترك ويُقال.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-util-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, U;
const T = new Date().toISOString();

before(async () => {
  db = await import('../../src/core/db/index.js');
  U = await import('../../scripts/apply-utilization-may2026.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });

  // أسماء الكشف كما وردت — بهمزات وتاء مربوطة تختلف عن المكتوب في الخطة، فيُقاس التطبيع فعلاً.
  const emp = (id2, name) => db.insert('employee', { id: id2, name_ar: name, sector_id: 'SOL',
    active: 1, created_at: T });
  await emp('e_rayan', 'ريان باسم ظفر');
  await emp('e_yaqoub', 'يعقوب سيد أكرم');
  await emp('e_shouq', 'شوق محمد بامشموس');
  await emp('e_ayoub', 'أيوب الزاكي');             // مشروعه ملتبس ⟵ يُقال ولا يُكتب
  await emp('e_amr', 'عمر حمزة عبدالله');          // في قائمة التعارض ⟵ لا يُكتب له شيء
  // اسمان يطابقان «حسين محمد الجفري» جزئياً ولا يطابقه أيٌّ منهما تماماً ⟵ لا حسم.
  // (والمطابقة التامّة تغلب الجزئية عمداً: «يعقوب سيد أكرم» يُحسَم ولو وُجد «يعقوب سيد أكرم
  // الثاني» — وإلا لتعطّل كل اسمٍ في الكشف بمجرد وجود من يشاركه أوّله.)
  await emp('e_h1', 'حسين محمد الجفري الاول');
  await emp('e_h2', 'حسين محمد الجفري الثاني');

  const prj = (id2, name) => db.insert('project', { id: id2, name_ar: name, sector_id: 'SOL',
    status: 'IN_PROGRESS', created_at: T });
  await prj('p_data', 'منصة البيانات السعودية');
  // اسمُ المنصة يختلف عن اسم الكشف اختلافاً لا يقرّبه الاحتواء النصّي: «كاميرات المشاعر
  // المقدسة» ليست جزءاً من «منظومة رصد دخول الحافلات للمشاعر المقدسة» ولا العكس — وهما واحد.
  await prj('p_cam', 'منظومة رصد دخول الحافلات للمشاعر المقدسة');
  // مشروعان يطابقان «الاركاب الذكي» ⟵ لا حسم
  await prj('p_ark1', 'مشروع الإركاب الذكي');
  await prj('p_ark2', 'مشروع الإركاب الذكي — التوسعة');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('التطبيع يجمع الهمزات والتاء المربوطة — «يعقوب سيد أكرم» و«اكرم» اسمٌ واحد', () => {
  assert.equal(U.norm('يعقوب سيد أكرم'), U.norm('يعقوب سيد اكرم'));
  assert.equal(U.norm('المشاعر المقدسه'), U.norm('المشاعر المقدسة'));
});

test('يُكتب ما يُحسَم: الشخص والمشروع مطابقةً واحدة', async () => {
  const r = await U.applyUtilization();
  assert.equal(r.skipped, false);
  assert.ok(r.written.some((w) => w.includes('ريان باسم ظفر') && w.includes('منصة البيانات السعودية')),
    'تسكينٌ محسوم لم يُكتب');
  const a = await db.get(
    'SELECT monthly_json, type, year FROM allocation WHERE employee_id = ? AND project_id = ?',
    ['e_rayan', 'p_data']);
  assert.ok(a, 'لا صفّ تسكين');
  assert.equal(a.year, 2026);
  // المدى يبدأ من مايو: الكشف ثلاثة أشهر أوّلها مايو، فيناير إلى أبريل ماضٍ لم يُرسَل.
  const months = JSON.parse(a.monthly_json);
  assert.equal(months['5'], 0.6, 'النسبة تُكتب كسراً كما تقرؤها المنصة');
  assert.equal(months['12'], 0.6, 'التوزيع الأحدث لا يمتدّ إلى آخر السنة');
  assert.equal(months['1'], undefined, 'اختُرع ماضٍ قبل أول شهرٍ في الكشف');
});

test('ويُترك ما لا يُحسَم ويُقال سببه — لا تخمين على اسمٍ مكرَّر', async () => {
  const r = await U.applyUtilization({ force: true });
  assert.ok(r.notes.some((n) => n.includes('حسين محمد الجفري') && n.includes('أكثر من موظف')),
    'اسمٌ مكرَّر مرّ بصمت');
  assert.ok(r.notes.some((n) => n.includes('الاركاب الذكي') && n.includes('أكثر من مشروع')),
    'مشروعٌ ملتبس مرّ بصمت');
  const none = await db.all('SELECT id FROM allocation WHERE employee_id IN (?,?)', ['e_h1', 'e_h2']);
  assert.deepEqual(none, [], 'كُتب تسكينٌ على اسمٍ لم يُحسَم');
});

// «عمر حمزة» خرج من قائمة التعارض بقرار المالك («حطّه على قطاع تطوير الأعمال»)، ووقتُه كله
// على وحدته فلا تسكينَ مشروعٍ له. والحارس باقٍ: لا يُكتب له صفٌّ من هذا السكربت بحال.
test('ومن حسم المالك وحدته لا يُكتب له تسكين مشروع', async () => {
  await U.applyUtilization({ force: true });
  const none = await db.all('SELECT id FROM allocation WHERE employee_id = ?', ['e_amr']);
  assert.deepEqual(none, [], 'كُتب تسكينُ مشروعٍ لمن وقتُه كله على وحدته');
  assert.ok(!U.PLAN.some((r) => r.person.includes('عمر')), 'عاد عمر إلى خطة تسكين المشاريع');
});

test('و«قطاع الحلول ٤٠٪» لا تُكتب مشروعاً — هي بقيّةُ وقتٍ محجوزة لقطاعه', async () => {
  const bySector = await db.all(
    "SELECT a.id FROM allocation a LEFT JOIN project p ON p.id = a.project_id WHERE p.id IS NULL");
  assert.deepEqual(bySector, [], 'كُتب تسكينٌ بلا مشروع — اختُرع مشروعٌ من سطر قطاع');
  assert.ok(!U.PLAN.some((r) => r.allocations.some(([n]) => n.startsWith('قطاع'))),
    'سطرُ قطاعٍ تسرَّب إلى خطة التسكين');
});

test('ولا يُعاد مع كل إقلاع — وإلا كُتب فوق ما صحّحه المالك بيده', async () => {
  const again = await U.applyUtilization();
  assert.equal(again.skipped, true);
  assert.deepEqual(again.written, []);
});

test('ولا يُكرَّر تسكينٌ قائم عند إعادة التشغيل بالقوّة', async () => {
  const r = await U.applyUtilization({ force: true });
  assert.ok(r.notes.some((n) => n.includes('تسكينٌ قائم')), 'التكرار لم يُمنَع');
  const rows = await db.all('SELECT id FROM allocation WHERE employee_id = ? AND project_id = ?',
    ['e_rayan', 'p_data']);
  assert.equal(rows.length, 1, 'صفٌّ مكرَّر للشخص نفسه على المشروع نفسه');
});

// ── ما سقط في أول تشغيلٍ حيّ ────────────────────────────────────────────────
// المطابقة الأولى اشترطت احتواء **كل** كلمات الكشف في اسم المنصة، والمنصة تحفظ الاسم مختصَراً
// («ريان ظفر» مقابل «ريان باسم ظفر») وأحياناً بلقبٍ قبله («د. أيوب الزاكي»). فسقط ثلاثة عشر من
// أربعة عشر اسماً على قاعدةٍ حيّة. هذا الفحص يثبت الحالتين معاً — ويسقط لو عادت المطابقة اتجاهاً
// واحداً أو نسيت اللقب.
test('الاسم المختصَر في المنصة يطابق الرباعي في الكشف، واللقب لا يُحسَب اسماً', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'sanad-util2-'));
  const prev = process.env.SANAD_DB;
  try {
    assert.deepEqual(U.nameWords('د. أيوب الزاكي'), ['ايوب', 'زاكي'], 'اللقب دخل في الاسم');
    assert.deepEqual(U.nameWords('م/ زكي سفر'), ['زكي', 'سفر']);
    // المطابقة في الاتجاهين على بيانات القاعدة نفسها: نضيف الاسم المختصَر ثم نعيد التشغيل.
    await db.insert('employee', { id: 'e_short', name_ar: 'ريان ظفر', sector_id: 'SOL',
      active: 1, created_at: T });
    await db.run('DELETE FROM allocation WHERE employee_id = ?', ['e_rayan']);
    await db.run('UPDATE employee SET deleted_at = ? WHERE id = ?', [T, 'e_rayan']);
    const r = await U.applyUtilization({ force: true });
    assert.ok(r.written.some((w) => w.includes('ريان ظفر')),
      'الاسم المختصَر في المنصة لم يُطابَق بالرباعي في الكشف');
  } finally { process.env.SANAD_DB = prev; rmSync(dir2, { recursive: true, force: true }); }
});

// ── «قرّب الأسماء وشوف المناسب» ─────────────────────────────────────────────
// أسماء المشاريع في كشف الرواتب ليست أسماءها في السجلّ، والاحتواء النصّي كان يسقط على أول
// اختلاف صياغة. والتقريب لا يُلغي قاعدة الامتناع: تعادلٌ في القمة يبقى بلا حسم.
test('التقريب يصل بين تسميتين لمشروعٍ واحد بلا احتواء نصّي', async () => {
  assert.deepEqual(U.projectWords('كاميرات المشاعر المقدسة').sort(), ['كاميرات', 'مشاعر', 'مقدسه'].sort());
  // أداة التعريف ولواصقها تُنزَع: «للمشاعر» و«المشاعر» و«مشاعر» كلمةٌ واحدة.
  assert.ok(U.projectWords('منظومة رصد دخول الحافلات للمشاعر المقدسة').includes('مشاعر'));
  // والكلمات العامّة تُسقَط كي لا يتشابه كل اسمين بلا معنى.
  assert.ok(!U.projectWords('مشروع تطوير أعمال').includes('مشروع'));

  await U.applyUtilization({ force: true });
  // والفحص على القاعدة لا على قائمة «كُتب»: تشغيلاتٌ سابقة في هذا الملف كتبته فعلاً، فيُقرأ
  // «تسكينٌ قائم» لا «كُتب» — والمقصود أن الصفّ **موجود** لا في أيّ تشغيلٍ كُتب.
  const rows = await db.all(
    'SELECT id FROM allocation WHERE project_id = ? AND deleted_at IS NULL', ['p_cam']);
  assert.ok(rows.length >= 1, 'التسميتان لم تلتقيا رغم أنهما مشروع واحد');
});

test('واسمٌ حسمه المالك يُقرأ من قائمة المرادفات لا بالتقريب', () => {
  assert.equal(U.PROJECT_ALIASES['التخطيط والاقتصاد'], 'منصة البيانات السعودية');
});

test('والتعادل في القمة يبقى بلا حسم — التقريب لا يُلغي الامتناع', async () => {
  const r = await U.applyUtilization({ force: true });
  assert.ok(r.notes.some((n) => n.includes('الاركاب الذكي') && n.includes('أكثر من مشروع')),
    'مشروعان متعادلان حُسم أحدهما بلا سبب');
});

test('واسمٌ لم يُحسَم يُقال معه أقرب ما في السجل — لا «لم أجد» عارية', async () => {
  const r = await U.applyUtilization({ force: true });
  const miss = r.notes.find((n) => n.includes('كاميرات محبس الجن'));
  assert.ok(miss, 'الاسم غير المحسوم لم يُذكر أصلاً');
  assert.ok(miss.includes('أقرب ما في السجل'),
    'قيل «لا مشروع بهذا الاسم» بلا دليل — فيتحوّل العطل إلى بحثٍ يدوي');
});

// ── الفرع الذي سقط حيّاً ولم يمرّ به فحص ────────────────────────────────────
// تصحيحُ المدى لم يكن يقع في الفحوص إطلاقاً: القاعدة تُبنى نظيفةً فتُكتب الصفوف بالمدى الجديد
// مباشرةً، فلا يمرّ أحدٌ بفرع «صفٌّ قديم بمدى السنة». وعلى القاعدة الحيّة مرّ فسقط السكربت كله
// على عمودٍ لا وجود له (`allocation` بلا `updated_at`). فالفحص هنا يزرع الحالة القديمة صراحةً.
test('تصحيح المدى يعمل على صفٍّ قديم — ولا يكتب عموداً لا وجود له', async () => {
  const uniform = JSON.stringify(Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i + 1, 0.6])));
  await db.run('DELETE FROM allocation WHERE employee_id = ?', ['e_short']);
  await db.insert('allocation', {
    id: 'a_legacy', employee_id: 'e_short', project_id: 'p_data', project_name: 'منصة البيانات السعودية',
    person_name_ar: 'ريان ظفر', sector_id: 'SOL', type: 'member', year: 2026,
    monthly_json: uniform, created_at: T,
  });
  const r = await U.applyUtilization({ force: true });
  assert.ok(r.notes.some((n) => n.includes('صُحِّح المدى')), 'لم يُصحَّح صفٌّ قديم بمدى السنة');
  const after = JSON.parse((await db.get(
    'SELECT monthly_json FROM allocation WHERE id = ?', ['a_legacy'])).monthly_json);
  assert.equal(after['1'], undefined, 'بقي يناير بعد التصحيح');
  assert.equal(after['5'], 0.6, 'ضاعت النسبة في التصحيح');
});

// وما مسّه المالك بيده لا يُصحَّح: الشكل يختلف عمّا يكتبه السكربت، فيُترك.
test('ولا يُكتب فوق ما عدّله المالك من شاشة التسكين', async () => {
  await db.run('UPDATE allocation SET monthly_json = ? WHERE id = ?',
    [JSON.stringify({ 5: 0.25, 6: 0.25 }), 'a_legacy']);
  await U.applyUtilization({ force: true });
  const after = JSON.parse((await db.get(
    'SELECT monthly_json FROM allocation WHERE id = ?', ['a_legacy'])).monthly_json);
  assert.deepEqual(after, { 5: 0.25, 6: 0.25 }, 'كُتب فوق تعديلٍ يدوي');
});

// آخر ما سقط حيّاً: أداة التعريف على اسم العائلة. الكشف «هادي احمد الكرمي» والمنصة «هادي كرمي»
// — كلمتان مختلفتان في المقارنة وهما اسمٌ واحد، فسقطت مطابقته بعد أن صحّ كل شيء آخر فيه.
test('وأداة التعريف على اسم العائلة لا تفصل الاسم عن نفسه', () => {
  assert.deepEqual(U.nameWords('هادي احمد الكرمي'), ['هادي', 'احمد', 'كرمي']);
  assert.deepEqual(U.nameWords('هادي كرمي'), ['هادي', 'كرمي']);
  // ولا تُمسَخ الأسماء القصيرة: النزع مشروطٌ بطول الكلمة.
  assert.deepEqual(U.nameWords('علي'), ['علي']);
});
