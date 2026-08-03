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
  await prj('p_cam', 'منظومة رصد دخول الحافلات — كاميرات المشاعر المقدسة');
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
  assert.equal(JSON.parse(a.monthly_json)['1'], 0.6, 'النسبة تُكتب كسراً كما تقرؤها المنصة');
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

test('والتعارض بين المصدرين يُقال ولا يُرجَّح', async () => {
  const r = await U.applyUtilization({ force: true });
  assert.ok(r.notes.some((n) => n.includes('عمر حمزة') && n.includes('يُحسم من شاشة التسكين')),
    'التعارض حُسم بلا قرار المالك');
  const none = await db.all('SELECT id FROM allocation WHERE employee_id = ?', ['e_amr']);
  assert.deepEqual(none, [], 'كُتب تسكينٌ لشخصٍ توزيعه متعارض');
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
    assert.deepEqual(U.nameWords('د. أيوب الزاكي'), ['ايوب', 'الزاكي'], 'اللقب دخل في الاسم');
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
