// ── حارسان بنيويان لمخالفتين حقيقيتين وقعتا في v5.41 ────────────────────────────────────
// كلتاهما اكتُشفت بفاحص axe في متصفح، وكلتاهما في حقيقتها **خاصية في العلامات** لا سلوكُ
// تصيير — فتُحرَسان هنا حتماً بلا متصفح ولا منفذ ولا قاعدة مشتركة، ويصحّ الفحص ولو كانت
// شجرة العمل تتغيّر تحت جلسةٍ أخرى (تعدد الجلسات على مجلدٍ واحد جعل نتائج المتصفح غير موثوقة).
//
//   ١) aria-hidden-focus: رسمٌ بلا عنوان يُخفى عن قارئ الشاشة، فإن حمل tabindex صار محطَّ
//      تركيزٍ لعنصرٍ مخفيّ — وقعت حين أضاف عملُ التلميح التركيز لكل رسم بلا شرط.
//   ٢) nested-interactive: role="img" يمنع العناصر التفاعلية بداخله، ورسمُ الفقاعات صار يحوي
//      روابط فرصٍ تُنقَر — فوجب أن يصير مجموعةً (role="group").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-a11ymk-'));
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
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('client', { id: 'CL', name_ar: 'جهة', created_at: T });
  await insert('opportunity', { id: 'O1', title_ar: 'فرصة مفتوحة', sector_id: 'SOL', client_id: 'CL',
    year: YEAR, stage_id: 'LEAD', value_halalas: 5_000_000, win_pct: 40, exclude_from_sales: 0,
    stage_changed_at: `${YEAR}-08-01T00:00:00.000Z`, created_at: T });
  await insert('revenue_line', { id: 'rl-1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000, net_amount_halalas: 1_000_000, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('لا عنصر مخفيٌّ عن قارئ الشاشة وهو محطُّ تركيز (aria-hidden-focus)', async () => {
  const html = await sectorPage(ADMIN, { year: String(YEAR) });
  const offenders = [...html.matchAll(/<[a-z]+\b[^>]*aria-hidden="true"[^>]*>/gi)]
    .map((m) => m[0]).filter((tag) => /\btabindex=/.test(tag));
  assert.deepEqual(offenders, [], `عنصر مخفيّ ويقبل التركيز:\n${offenders.join('\n')}`);
});

test('لا عناصر تفاعلية داخل role="img" (nested-interactive)', async () => {
  const html = await sectorPage(ADMIN, { year: String(YEAR) });
  const imgs = [...html.matchAll(/<svg\b[^>]*role="img"[^>]*>([\s\S]*?)<\/svg>/gi)].map((m) => m[1]);
  assert.ok(imgs.length > 0, 'يُفترض وجود رسومٍ معلَّمة كصورة في الصفحة');
  for (const inner of imgs) {
    assert.ok(!/<a\b[^>]*href=/i.test(inner), 'رابط داخل رسمٍ معلَّم role="img"');
    assert.ok(!/<button\b/i.test(inner), 'زر داخل رسمٍ معلَّم role="img"');
    assert.ok(!/\btabindex="0"/.test(inner), 'محطُّ تركيز داخل رسمٍ معلَّم role="img"');
  }
});

test('رسم الفقاعات مجموعةٌ لا صورة، وفقاعاته روابط تُفتح', async () => {
  const html = await sectorPage(ADMIN, { year: String(YEAR) });
  const bub = html.match(/<svg\b[^>]*role="group"[^>]*>[\s\S]*?<\/svg>/i);
  assert.ok(bub, 'مخطط الفقاعات موجود ومعلَّم مجموعةً');
  assert.ok(/<a href="\/app\/opportunity\//.test(bub[0]), 'كل فقاعة رابطٌ إلى فرصتها');
  assert.ok(/aria-label="[^"]+"/.test(bub[0]), 'للمجموعة عنوانٌ منطوق');
});
