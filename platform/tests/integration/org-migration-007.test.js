// الترحيلة 007 على قاعدة **مُرحَّلة سلفاً** — لا على قاعدة جديدة فارغة.
// الترحيلات مجمَّدة بعد النشر، والقاعدة الحيّة اليوم عليها 001…006 وفيها قطاعات وإدارات ومشاريع.
// لذلك الاختبار الحقيقي ليس «هل تُنشأ الجداول من الصفر» بل: هل تُطبَّق الموجة على قاعدة عامرة
// بلا كسر صف واحد، وهل تتوقف عن إعادة التطبيق بعدها.
// ملاحظة: `ALTER TABLE … ADD COLUMN` لا يقبل IF NOT EXISTS على SQLite، فالإدمبوتنسي مضمون على
// مستوى الملف عبر جدول schema_migration الذي يسجّله scripts/migrate.js — وهذا ما يُثبت هنا.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WAVE = '007_org_attribution.sql';
const dir = mkdtempSync(join(tmpdir(), 'sanad-mig007-'));
process.env.SANAD_DB = join(dir, 'legacy.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = join(ROOT, 'migrations');
const T = '2026-07-01T00:00:00.000Z';

// (١) قاعدة تشبه الحيّة: كل الترحيلات قبل الموجة مطبَّقة ومسجَّلة، وفيها بيانات فعلية.
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const before007 = files.slice(0, files.indexOf(WAVE));
{
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(process.env.SANAD_DB);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of before007) {
    raw.exec(readFileSync(join(MIG, f), 'utf8'));
    raw.prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)').run(f, T);
  }
  raw.prepare('INSERT INTO sector (id, name_ar, active, sort_order, created_at) VALUES (?, ?, 1, 1, ?)')
    .run('SOLUTIONS', 'قطاع الحلول', T);
  raw.prepare('INSERT INTO department (id, sector_id, name_ar, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .run('dep_smart', 'SOLUTIONS', 'إدارة المدن الذكية', T);
  raw.prepare('INSERT INTO project (id, name_ar, sector_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('P_old', 'مشروع قائم قبل الموجة', 'SOLUTIONS', 'IN_PROGRESS', T);
  raw.close();
}

const { migrate } = await import('../../scripts/migrate.js');
const { get, all, run, close } = await import('../../src/core/db/index.js');

before(async () => { await migrate(); });
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('الموجة تُطبَّق على القاعدة العامرة ولا يُفقد أي صف قائم', async () => {
  const applied = await get('SELECT version FROM schema_migration WHERE version = ?', [WAVE]);
  assert.ok(applied, 'الموجة مسجَّلة بعد تطبيقها');
  const p = await get('SELECT id, name_ar, sector_id, department_id FROM project WHERE id = ?', ['P_old']);
  assert.equal(p.name_ar, 'مشروع قائم قبل الموجة', 'الصف القديم كما هو');
  assert.equal(p.department_id, null, 'العمود الجديد اختياري — لا قيمة مفروضة على التاريخ');
  const d = await get('SELECT name_ar FROM department WHERE id = ?', ['dep_smart']);
  assert.equal(d.name_ar, 'إدارة المدن الذكية');
});

// الموجة تمسّ ثلاثة أعمدة وأربعة فهارس ولا شيء غيرها. هذا الاختبار يحرس النطاق نفسه: أي جدول
// أو عمود إضافي يتسلّل إلى 007 لاحقاً يُسقِطه — فالترحيلات مجمَّدة بعد النشر، والتوسّع الصامت
// فيها أغلى من أي مراجعة.
test('نطاق الموجة محصور: لا جدول شركة ولا أعمدة تأريخ فعّال', async () => {
  const tables = (await all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  assert.ok(!tables.includes('company'), 'لا جدول «شركة» — تمثيل الكيانات المستقلة قرار مالك بموجة خاصة');
  const secCols = (await all("SELECT name FROM pragma_table_info('sector')")).map((r) => r.name);
  assert.ok(!secCols.includes('company_id'), 'لا عمود شركة على القطاع');
  const depCols = (await all("SELECT name FROM pragma_table_info('department')")).map((r) => r.name);
  for (const c of ['valid_from', 'valid_to'])
    assert.ok(!depCols.includes(c), `لا عمود ${c}: التأريخ الفعّال سطرٌ لكل نسخة لا عمودا تاريخ على السطر الحالي`);
});

test('إدخال قائم لا يذكر الأعمدة الجديدة يظل يعمل — توافق خلفي كامل', async () => {
  await run('INSERT INTO project (id, name_ar, sector_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
    ['P_new', 'مشروع بعد الموجة', 'SOLUTIONS', 'IN_PROGRESS', T]);
  const p = await get('SELECT department_id FROM project WHERE id = ?', ['P_new']);
  assert.equal(p.department_id, null, 'لا عمود إلزامي يكسر أي شاشة أو استيراد قائم');
  // والنسبة إلى إدارة قائمة تُقبل
  await run('UPDATE project SET department_id = ? WHERE id = ?', ['dep_smart', 'P_new']);
  assert.equal((await get('SELECT department_id FROM project WHERE id = ?', ['P_new'])).department_id, 'dep_smart');
});

test('الفهارس الأربعة على عمود الإدارة قائمة — نمط «كل أعمال هذه الإدارة»', async () => {
  const names = (await all("SELECT name FROM sqlite_master WHERE type = 'index'")).map((r) => r.name);
  for (const ix of ['ix_project_dept', 'ix_opp_dept', 'ix_alloc_dept', 'ix_emp_dept']) {
    assert.ok(names.includes(ix), `الفهرس ${ix} قائم`);
  }
});

test('إعادة التشغيل لا تعيد تطبيق الموجة — ولا ينكسر عمود', async () => {
  await migrate();
  await migrate();
  const rows = await all('SELECT version FROM schema_migration WHERE version = ?', [WAVE]);
  assert.equal(rows.length, 1, 'سطر تسجيل واحد مهما تكرّر التشغيل');
  // الإدمبوتنسي هنا على مستوى الملف لا الجملة (schema_migration)، لأن SQLite لا تعرف
  // ADD COLUMN IF NOT EXISTS أصلاً — فالحارس الحقيقي هو أن الصفوف والأعمدة بقيت سليمة.
  assert.equal((await get('SELECT department_id FROM project WHERE id = ?', ['P_new'])).department_id, 'dep_smart');
});
