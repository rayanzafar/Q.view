// ── مركز القطاع يعدّ مشاريع السنة المعروضة لا كل التاريخ (v5.29) ─────────────
//
// «المشاريع الموجودة في صحة التنفيذ مو نفسها الموجودة في صفحة المشاريع — والموجود في صفحة
// المشاريع حالياً هو الصحيح. مثلاً الجيوبارك وتجربة العميل عسير كلها قديمة» — بلسان المالك
// (2026-08-16). كانت عدسة «صحة التنفيذ» و«على المسار» و«تحتاج تدخلاً» عمياء عن السنة رغم
// أن رأس الصفحة يقولها، فتسلّلت مشاريع مستوردة بلا تواريخ ولا إيراد إلى مشهد 2026.
//
// الحارس هنا **التكافؤ**: ما يعدّه المركز لسنةٍ هو حرفياً ما تعرضه صفحة المشاريع لنفس
// السنة (قاعدة projectYearClause الواحدة) — لا نسخة ثانية من القاعدة تنحرف بأول تعديل.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-sechealthyear-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');
const { sectorDashboard } = await import('../../src/core/reports/metrics.js');
const projects = await import('../../src/modules/pmo/projects.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = 2026;
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('client', { id: 'CL', name_ar: 'جهة حالية', created_at: T });
  await insert('client', { id: 'CL_OLD', name_ar: 'جهة قديمة', created_at: T });
  // مشروعان حاليان: أخضر بتواريخ 2026، وأحمر بتواريخ 2026 (يحتاج تدخلاً)
  await insert('project', { id: 'P_NOW', name_ar: 'منظومة رصد دخول الحافلات', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-02-01', end_date: '2026-11-30',
    client_id: 'CL', created_at: T });
  await insert('project', { id: 'P_RED', name_ar: 'مشروع حرج حالي', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'RED', start_date: '2026-03-01', end_date: null,
    client_id: 'CL', created_at: T });
  // مشروع بلا تواريخ لكن له إيراد مسجَّل في السنة — «يخص السنة» بالإيراد
  await insert('project', { id: 'P_REV', name_ar: 'خدمات مدارة بلا تواريخ', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'GREEN', start_date: null, end_date: null, created_at: T });
  await insert('revenue_line', { id: 'rl1', project_id: 'P_REV', sector_id: 'SOL', year: YEAR,
    month: 3, amount_halalas: 5_000_000, created_at: T });
  // المستوردان القديمان: بلا تواريخ وبلا إيراد — عين حالة الجيوبارك وتجربة عسير
  await insert('project', { id: 'P_OLD', name_ar: 'الجيوبارك القديم', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'GREEN', start_date: null, end_date: null, created_at: T });
  await insert('project', { id: 'P_OLD_RED', name_ar: 'قديم حرج', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'RED', start_date: null, end_date: null,
    client_id: 'CL_OLD', created_at: T });
  // ومشروع انتهى في سنةٍ سابقة — التواريخ تُخرجه من 2026 كما تُخرجه من صفحتها
  await insert('project', { id: 'P_2025', name_ar: 'مشروع انتهى 2025', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'AMBER', start_date: '2025-01-10', end_date: '2025-12-20', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('التكافؤ: ما يعدّه المركز لسنةٍ هو ما تعرضه صفحة المشاريع لنفس السنة', async () => {
  const sd = await sectorDashboard(ADMIN, 'SOL', { year: YEAR });
  const ragTotal = (sd.rag.GREEN || 0) + (sd.rag.AMBER || 0) + (sd.rag.RED || 0);
  const pageRows = await projects.listProjects(ADMIN, { sector: 'SOL', year: YEAR, status: 'IN_PROGRESS' });
  assert.equal(ragTotal, pageRows.length, 'عدّ الصحة خالف قائمة الصفحة — قاعدتان لا قاعدة');
  assert.equal(ragTotal, 3, 'حاليان + صاحب الإيراد — لا القديمان ولا منتهي 2025');
  assert.deepEqual({ GREEN: sd.rag.GREEN || 0, AMBER: sd.rag.AMBER || 0, RED: sd.rag.RED || 0 },
    { GREEN: 2, AMBER: 0, RED: 1 });
  assert.equal(sd.projects.IN_PROGRESS, 3, 'عدّ الحالات بنفس العدسة');
});

test('نافذة «على المسار»: الحاليان يظهران والجيوبارك القديم لا — كما قرّر المالك', async () => {
  const html = await sectorPage(ADMIN, { sector: 'SOL', year: YEAR });
  const green = html.split('sec-health-GREEN').slice(1).join(' ');
  assert.ok(green.includes('منظومة رصد دخول الحافلات'), 'مشروع السنة غاب عن نافذته');
  assert.ok(green.includes('خدمات مدارة بلا تواريخ'), 'صاحب إيراد السنة من مشاريعها ولو بلا تواريخ');
  assert.ok(!html.includes('الجيوبارك القديم'), 'القديم بلا تواريخ ولا إيراد تسلّل إلى مشهد السنة');
  assert.ok(!html.includes('مشروع انتهى 2025'), 'المنتهي قبل السنة ليس من مشهدها');
});

test('«تحتاج تدخلاً» بنفس العدسة: الحرج الحالي يُدرج والحرج القديم لا', async () => {
  const html = await sectorPage(ADMIN, { sector: 'SOL', year: YEAR });
  assert.ok(html.includes('مشروع حرج حالي'), 'الحرج الحالي غاب عن نظر القائد');
  assert.ok(!html.includes('قديم حرج'), 'حرجٌ قديم بلا تواريخ ولا إيراد زاحم قرارات السنة');
});

test('وسنةٌ أخرى تعرض أهلها: منظور 2025 يُظهر منتهي 2025 ولا يُظهر مشاريع 2026 الصِرفة', async () => {
  const sd = await sectorDashboard(ADMIN, 'SOL', { year: 2025 });
  assert.equal(sd.rag.AMBER || 0, 1, 'منتهي 2025 من مشهد 2025');
  assert.equal(sd.rag.RED || 0, 0, 'حرج 2026 (بدأ 2026-03) ليس من مشهد 2025');
  // والقديم بلا تواريخ وبلا إيراد ليس من مشهد أي سنة — يُدار من صفحة المشاريع بكل السنوات
  assert.equal((sd.rag.GREEN || 0), 0, 'بلا تواريخ ولا إيراد لا يُنسب لسنة');
});
