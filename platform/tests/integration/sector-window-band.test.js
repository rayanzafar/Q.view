// ── ألسنة الفترة تحكم شريط المؤشرات فعلاً (شكوى المالك: «لا تؤثر فيما تحتها مباشرة») ────
// الحارسان: (١) عرضان بنافذتين مختلفتين يختلفان في منطقة #kpi-band، والنافذة الضيقة تعرض
// فوزها وحده؛ (٢) رسم السنة المركّب لا يتأثر بالألسنة (بياناته سنوية بطبيعتها).
// السنة المعروضة **ماضية** عمداً: حدودها من windowBounds مرساةٌ على آخرها فالفحص حتميٌّ لا
// يتأثر بيوم تشغيله — وهو نفسه انحدارُ علّة الانقلاب since>until التي كانت تصفّر الرقائق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-winband-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2025-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear() - 1; // سنة ماضية — حدود نوافذها حتمية
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 5, is_won: 1, is_lost: 0 });
  await insert('stage', { id: 'LOST', name_ar: 'خسارة', default_win_pct: 0, sort_order: 6, is_won: 0, is_lost: 1 });
  // فوز ديسمبر (داخل «آخر شهر من السنة») بقيمة مميزة، وفوز مارس (خارجه) بقيمة مميزة أخرى
  await insert('opportunity', { id: 'O_DEC', title_ar: 'فوز ديسمبر', sector_id: 'SOL', year: YEAR,
    stage_id: 'WON', value_halalas: 7_770_000_00, exclude_from_sales: 0,
    stage_changed_at: `${YEAR}-12-28T10:00:00.000Z`, created_at: T });
  await insert('opportunity', { id: 'O_MAR', title_ar: 'فوز مارس', sector_id: 'SOL', year: YEAR,
    stage_id: 'WON', value_halalas: 3_330_000_00, exclude_from_sales: 0,
    stage_changed_at: `${YEAR}-03-10T10:00:00.000Z`, created_at: T });
  // إيراد شهري: مارس وديسمبر — لرسم السنة وثبوته عبر الألسنة
  await insert('revenue_line', { id: 'rl-3', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000_00, net_amount_halalas: 1_000_000_00, created_at: T });
  await insert('revenue_line', { id: 'rl-12', sector_id: 'SOL', year: YEAR, month: 12,
    amount_halalas: 2_300_000_00, net_amount_halalas: 2_000_000_00, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const band = (html) => {
  const a = html.indexOf('id="kpi-band"');
  const b = html.indexOf('class="exec-band"');
  assert.ok(a > -1 && b > a, 'منطقة الشريط موجودة قبل شريط القراءة');
  return html.slice(a, b);
};
const comboRegion = (html) => {
  // الرسم صار حيّاً (fig-live + شرائح التقاط) — والتأكيد نفسه: منطقته بايت-ببايت عبر الألسنة
  const m = html.match(/<svg class="fig-svg[^"]*"[^>]*aria-label="الإيراد الشهري والتراكمي[^"]*"[\s\S]*?<\/svg>/);
  assert.ok(m, 'رسم السنة المركّب موجود');
  return m[0];
};

test('نافذتان مختلفتان ⇒ شريطان مختلفان، والنافذة الضيقة تعرض فوزها وحده (سنة ماضية — لا أصفار)', async () => {
  const yearHtml = await sectorPage(ADMIN, { year: String(YEAR), win: 'year' });
  const monthHtml = await sectorPage(ADMIN, { year: String(YEAR), win: 'month' });
  const yb = band(yearHtml), mb = band(monthHtml);
  assert.notEqual(yb, mb, 'الشريط يتغيّر مع اللسان');
  // نافذة «الشهر» على سنة ماضية = ديسمبر: قيمة فوز ديسمبر وحدها (7.8M) — لا فوز مارس
  assert.ok(mb.includes('7.8M'), 'قيمة فوز ديسمبر في شريط نافذة الشهر');
  assert.ok(!mb.includes('11.1M'), 'مجموع السنة لا يظهر في نافذة الشهر');
  // ولسان السنة يجمع الفوزين (7.77M + 3.33M = 11.1M)
  assert.ok(yb.includes('11.1M'), 'مجموع فوزَي السنة في شريط السنة');
  // صدى سنةٍ ماضية لا يوهم بالحاضر
  assert.ok(monthHtml.includes(`في آخر شهر من ${YEAR}`), 'صدى النافذة يسمّي السنة الماضية');
});

test('رسم السنة المركّب لا يتأثر بالألسنة — بياناته سنوية بطبيعتها', async () => {
  const a = comboRegion(await sectorPage(ADMIN, { year: String(YEAR), win: 'year' }));
  const b = comboRegion(await sectorPage(ADMIN, { year: String(YEAR), win: 'week' }));
  assert.equal(a, b, 'رسم السنة بايت-ببايت عبر الألسنة');
});

test('نافذة أسبوعٍ خالية على سنة ماضية: شريطٌ بلا فوز — لا انقلاب ولا تسريب من السنة الجارية', async () => {
  const weekHtml = await sectorPage(ADMIN, { year: String(YEAR), win: 'week' });
  const wb = band(weekHtml);
  // آخر أسبوع من السنة يشمل فوز ديسمبر (28 ديسمبر داخل [24-12، 01-01))
  assert.ok(wb.includes('7.8M'), 'فوز 28 ديسمبر داخل آخر أسبوع من السنة');
  assert.ok(!wb.includes('3.3M'), 'فوز مارس خارج أسبوع النهاية');
});
