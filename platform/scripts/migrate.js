// Apply SQL migrations in order; idempotent (tracked in schema_migration).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { exec, get, run, tx, close } from '../src/core/db/index.js';
import { ROOT, config, assertProdDatabase } from '../src/core/config.js';
import { nowIso } from '../src/core/util/ids.js';

// The .sql migrations are authored for SQLite; translate the three type differences for Postgres.
const pgify = (sql) => (config.databaseUrl
  ? sql.replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bREAL\b/g, 'DOUBLE PRECISION').replace(/\bBLOB\b/g, 'BYTEA')
  : sql);

export async function migrate() {
  // قبل أول كتابة، لا بعد اثنتي عشرة خطوةَ بذرٍ في القاعدة الخطأ: `assertProdSecrets` يعمل
  // عند بناء التطبيق — أي في آخر سطرٍ من سكربت الإقلاع — وقد أنشأ المخطط كاملاً قبله.
  assertProdDatabase();
  await exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = resolve(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    const done = await get('SELECT version FROM schema_migration WHERE version = ?', [f]);
    if (done) continue;
    // ── الترحيلة وصفُّ تتبّعها في معاملةٍ واحدة ──
    // كانا نداءين متتاليَين بلا معاملة، فانقطاعٌ بينهما (قتلُ حاوية، إعادة تشغيل في منتصف
    // النشر) يترك العمود مضافاً والترحيلة غير مسجَّلة. وعند الإقلاع التالي يُعاد تشغيل الملف
    // فيفشل بـ«عمودٌ مكرَّر» — و`ADD COLUMN IF NOT EXISTS` تعرفها Postgres ولا تعرفها SQLite
    // فلا تُكتب في المجموعة المحمولة. وفشلُ الترحيلة قاتلٌ عمداً في `boot.sh`، فالنتيجة بيئةٌ
    // لا تُقلع أصلاً — لا ميزةٌ ناقصة. (علاجُه اليدوي موثَّقٌ في رأس الترحيلة 035، و036
    // تجنّبت `ALTER TABLE` كلها هرباً منه.)
    // والمحرّكان كلاهما يجعل تعريف المخطط داخل المعاملة، و`pgQuery` يقرأ اتصال المعاملة —
    // فالضمّ محمول: إمّا الترحيلة وصفُّها معاً، أو لا شيء منهما.
    await tx(async () => {
      await exec(pgify(readFileSync(resolve(dir, f), 'utf8')));
      await run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, nowIso()]);
    });
    applied++;
    console.log('applied migration', f);
  }
  console.log(applied ? `✓ ${applied} migration(s) applied` : '✓ schema up to date');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => close()).catch((e) => { console.error('migrate failed:', e); process.exit(1); });
}
