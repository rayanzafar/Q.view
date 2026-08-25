// ── مرشِّحا الإدارة والعميل: يقصّان ما يقبل القصّ، ويُعلنان ما لا يقبله ────────────────────
// القاعدة التي يحرسها هذا الفحص: **لا ترشيحَ صامتٌ ناقص**. أكثرُ من نصف مشاريع القطاع على
// البيانات الحيّة بلا إدارة مسجَّلة، فترشيحٌ بالإدارة يُخفيها بلا قولٍ يترك القارئ يحار لماذا
// لا تُجمَع الأرقام إلى القطاع. ولهذا: خيارُ «بلا إدارة» صريح، وعدُّ المستبعَد معلن، والفصل
// البشري — الذي لا يقبل القصّ بالعميل أصلاً — يحمل وسمه بدل أن يبدو مقصوصاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-filt-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', created_at: T });
  await insert('department', { id: 'D_CITY', name_ar: 'إدارة المدن الذكية', sector_id: 'SOL', created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
  await insert('client', { id: 'CL_B', name_ar: 'جهة باء', created_at: T });
  const opp = (id, extra) => insert('opportunity', { id, title_ar: id, sector_id: 'SOL', year: YEAR,
    stage_id: 'LEAD', value_halalas: 1_000_000, win_pct: 50, exclude_from_sales: 0, created_at: T, ...extra });
  await opp('O_AI_A', { department_id: 'D_AI', client_id: 'CL_A', title_ar: 'فرصة الذكاء ألف', value_halalas: 7_000_000 });
  await opp('O_CITY_B', { department_id: 'D_CITY', client_id: 'CL_B', title_ar: 'فرصة المدن باء', value_halalas: 3_000_000 });
  await opp('O_ORPHAN', { client_id: 'CL_A', title_ar: 'فرصة بلا إدارة', value_halalas: 5_000_000 });  // بلا إدارة
  await insert('project', { id: 'P_ORPHAN', name_ar: 'مشروع بلا إدارة', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-02-01`, client_id: 'CL_A', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const opensSection = (html) => html.slice(html.indexOf('id="sec-panel-com"'), html.indexOf('id="sec-panel-ops"'));

test('بلا ترشيح: كل الفرص حاضرة', async () => {
  const h = opensSection(await sectorPage(ADMIN, { year: String(YEAR), tab: 'com' }));
  for (const t of ['فرصة الذكاء ألف', 'فرصة المدن باء', 'فرصة بلا إدارة']) {
    assert.ok(h.includes(t), `${t} غائبة بلا ترشيح`);
  }
});

test('ترشيحٌ بإدارة: فرصُها وحدها — ولا تتسرّب فرص الإدارة الأخرى', async () => {
  const h = opensSection(await sectorPage(ADMIN, { year: String(YEAR), tab: 'com', dept: 'D_AI' }));
  assert.ok(h.includes('فرصة الذكاء ألف'), 'فرصة الإدارة المختارة حاضرة');
  assert.ok(!h.includes('فرصة المدن باء'), 'فرصة إدارة أخرى تسرّبت');
  assert.ok(!h.includes('فرصة بلا إدارة'), 'فرصة بلا إدارة تسرّبت إلى ترشيح إدارة');
});

test('«بلا إدارة» خيارٌ صريح يعرض ما لم يُسنَد', async () => {
  const h = opensSection(await sectorPage(ADMIN, { year: String(YEAR), tab: 'com', dept: 'none' }));
  assert.ok(h.includes('فرصة بلا إدارة'), 'ما لا إدارة له يظهر تحت «بلا إدارة»');
  assert.ok(!h.includes('فرصة الذكاء ألف'), 'فرصةٌ لها إدارة تسرّبت');
});

test('عند الترشيح بإدارة يُقال كم استُبعِد لعدم وجود إدارة — لا إخفاء صامت', async () => {
  const full = await sectorPage(ADMIN, { year: String(YEAR), tab: 'com', dept: 'D_AI' });
  assert.ok(full.includes('بلا إدارة مسجَّلة'), 'سطر ما يُستبعَد غائب');
  assert.ok(/مشروع واحد|مشروعان|مشاريع/.test(full), 'عدّ المشاريع المستبعَدة غائب');
  // وبلا ترشيح لا يظهر السطر (لا ضجيج حين لا يُخفى شيء)
  const none = await sectorPage(ADMIN, { year: String(YEAR), tab: 'com' });
  assert.ok(!none.includes('بلا إدارة مسجَّلة — لا تظهر هنا'), 'سطر الاستبعاد يظهر بلا ترشيح');
});

test('ترشيحٌ بعميل يقصّ فرصه — والفصل البشري يُعلن أنه لا يُقصّ به', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), tab: 'com', client: 'CL_B' });
  const com = opensSection(h);
  assert.ok(com.includes('فرصة المدن باء'), 'فرصة العميل المختار حاضرة');
  assert.ok(!com.includes('فرصة الذكاء ألف'), 'فرصة عميلٍ آخر تسرّبت');
  assert.ok(h.includes('غير مرشَّح بالعميل'), 'الفصل البشري لا يحمل وسم «غير مرشَّح بالعميل»');
});

test('مرشِّحٌ مجهول يسقط بلا خطأ ولا قصٍّ عشوائي', async () => {
  const bad = await sectorPage(ADMIN, { year: String(YEAR), tab: 'com', dept: '../etc', client: 'nope' });
  const plain = await sectorPage(ADMIN, { year: String(YEAR), tab: 'com' });
  const norm = (x) => x.replace(/spkGrad\d+/g, 'g');
  assert.equal(norm(opensSection(bad)), norm(opensSection(plain)), 'المجهول = بلا ترشيح');
});
