// الترحيلة وصفُّ تتبّعها معاً — أو لا شيء منهما.
//
// كان المُرحِّل ينفّذ ملف الترحيلة ثم يكتب صفَّ تتبّعها في نداءين متتاليَين بلا معاملةٍ
// تجمعهما. وانقطاعٌ بينهما — قتلُ حاوية، إعادة تشغيلٍ في منتصف النشر — يترك العمود مضافاً
// والترحيلة غير مسجَّلة؛ فيُعاد تشغيل الملف في الإقلاع التالي فيفشل بـ«عمودٌ مكرَّر»، وفشلُ
// الترحيلة قاتلٌ عمداً في `boot.sh`. أي أن الأثر ليس ميزةً ناقصة بل **بيئةٌ لا تُقلع**.
//
// وهو ليس افتراضاً: رأس الترحيلة 035 يحمل إجراء علاجٍ يدوي مكتوباً لهذه الحالة بعينها،
// والترحيلة 036 تجنّبت `ALTER TABLE` كلها هرباً منه. وهذه الموجة تضيف خمس جُملِ `ALTER`.
//
// والفحص هنا يثبت الآليّة نفسها لا نصَّ الكود وحده: **تعريفُ المخطط يتراجع مع المعاملة**.
// لو لم يتراجع لكان الضمّ زينةً بلا أثر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-migatom-'));
process.env.SANAD_DB = join(dir, 'm.db');

let db;
before(async () => { db = await import('../../src/core/db/index.js'); });
after(() => rmSync(dir, { recursive: true, force: true }));

const missing = async (table) => {
  try { await db.get(`SELECT 1 FROM ${table} LIMIT 1`); return false; }
  catch { return true; }
};

test('تعريفُ المخطط يتراجع مع المعاملة — وهي الآليّة التي يقوم عليها الضمّ كله', async () => {
  await assert.rejects(() => db.tx(async () => {
    await db.exec('CREATE TABLE probe_rollback (id TEXT)');
    throw new Error('انقطاعٌ بين الجملتين');
  }));
  assert.ok(await missing('probe_rollback'), 'بقي جدولٌ أنشأته معاملةٌ تراجعت — فالضمّ لا يحمي شيئاً');
});

test('وملفُّ ترحيلةٍ يفشل في منتصفه لا يترك نصفه مطبَّقاً', async () => {
  await assert.rejects(() => db.tx(async () => {
    await db.exec('CREATE TABLE probe_half (id TEXT); INSERT INTO لا_وجود_له (id) VALUES (1);');
  }));
  assert.ok(await missing('probe_half'), 'طُبِّق نصفُ ملفِّ ترحيلةٍ فاشل');
});

test('وصفُّ التتبّع لا يُكتب حين تفشل ترحيلته', async () => {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  await assert.rejects(() => db.tx(async () => {
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', ['999_probe.sql', '2026-01-01T00:00:00.000Z']);
    throw new Error('فشلت الترحيلة بعد تسجيلها');
  }));
  const row = await db.get('SELECT version FROM schema_migration WHERE version = ?', ['999_probe.sql']);
  assert.equal(row, undefined, 'سُجِّلت ترحيلةٌ لم تُطبَّق — والإقلاع التالي يتخطّاها فيبقى المخطط ناقصاً صامتاً');
});

// حارسٌ بنيوي: الآليّة أعلاه صحيحة، لكنها لا تنفع إن لم يستعملها المُرحِّل.
test('والمُرحِّل يضمّ الجملتين فعلاً — لا يكفي أن تصحّ الآليّة وحدها', () => {
  const src = readFileSync(new URL('../../scripts/migrate.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const i = src.indexOf('await tx(');
  assert.ok(i > 0, 'انفكّ الضمّ — عادت الترحيلة وصفُّها نداءين بلا معاملة');
  const body = src.slice(i, src.indexOf('});', i));
  assert.match(body, /await exec\(pgify/, 'تنفيذُ الملف خارج المعاملة');
  assert.match(body, /INSERT INTO schema_migration/, 'صفُّ التتبّع خارج المعاملة');
});
