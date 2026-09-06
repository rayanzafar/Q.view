// ── مُنتقي الفترة يحكم شريط المؤشرات فعلاً (شكوى المالك: «لا تؤثر فيما تحتها مباشرة») ────
// الحارسان: (١) عرضان بفترتين مختلفتين يختلفان في منطقة #kpi-band، والفترة الضيقة تعرض
// ما وقع فيها وحده؛ (٢) رسم الإيقاع **يتقرّب إلى الفترة المختارة**: أشهرُها وحدها أعمدةً،
// والهدف حصةً بالتناسب — قلبٌ مقصود لحارسٍ قديم كان يثبّت الرسم سنوياً بايت-ببايت
// (قرار أ. حسين 2026-08-25: «الرسم لا يُعاد تصييره — أريده يتغيّر فعلاً»).
// السنة المعروضة **ماضية** عمداً فالفترات كلها تقويمية منتهية والفحص حتميٌّ لا يتأثر بيوم تشغيله.
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
  await insert('budget', { id: 'SOL-annual', sector_id: 'SOL', fiscal_year: YEAR, target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
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

// عدّاد معرّفات التدرّج في layout.js تراكميّ عبر التصييرات، فأي مقارنة بايت-ببايت بين عرضين
// في العملية نفسها تفشل لسببٍ لا علاقة له بالبيانات. نُسوّي المعرّف قبل المقارنة.
const norm = (h) => h.replace(/spkGrad\d+/g, 'spkGrad');
const band = (html) => {
  const a = html.indexOf('id="kpi-band"');
  const b = html.indexOf('class="exec-band"');
  assert.ok(a > -1 && b > a, 'منطقة الشريط موجودة قبل شريط القراءة');
  return html.slice(a, b);
};
const comboRegion = (html) => {
  const m = html.match(/<svg class="fig-svg[^"]*"[^>]*aria-label="الإيراد الشهري والتراكمي[^"]*"[\s\S]*?<\/svg>/);
  assert.ok(m, 'رسم الإيقاع المركّب موجود');
  return m[0];
};
// أعمدة الرسم وحدها (شرائح الالتقاط الشفافة rects أيضاً — تُستبعد بفئتها)
const comboBars = (svg) => [...svg.matchAll(/<rect(?![^>]*fig-hit)[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]);

test('فترتان مختلفتان ⇒ شريطان مختلفان، وشهرٌ بعينه يعرض فوزه وحده', async () => {
  const yearHtml = await sectorPage(ADMIN, { year: String(YEAR), p: 'y' });
  const decHtml = await sectorPage(ADMIN, { year: String(YEAR), p: 'm12' });
  const yb = norm(band(yearHtml)), db = norm(band(decHtml));
  assert.notEqual(yb, db, 'الشريط يتغيّر مع الفترة');
  assert.ok(db.includes('7.8M'), 'فوز ديسمبر في شريط ديسمبر');
  assert.ok(!db.includes('11.1M'), 'مجموع السنة لا يظهر في شهرٍ بعينه');
  assert.ok(yb.includes('11.1M'), 'مجموع فوزَي السنة في شريط السنة');
  // والصدى يسمّي الفترة تقويمياً لا «منذ شهر»
  assert.ok(decHtml.includes(`في ديسمبر ${YEAR}`), 'صدى الفترة تقويمي');
});

test('مارس يعرض فوزه وحده — والفترة التقويمية لا تتدحرج', async () => {
  const mar = band(await sectorPage(ADMIN, { year: String(YEAR), p: 'm3' }));
  assert.ok(mar.includes('3.3M'), 'فوز مارس في شريط مارس');
  assert.ok(!mar.includes('7.8M'), 'فوز ديسمبر خارج مارس');
});

test('رسم الإيقاع يتقرّب إلى الفترة: أشهرُها وحدها، والهدف حصةً بالتناسب', async () => {
  const y = comboRegion(await sectorPage(ADMIN, { year: String(YEAR), p: 'y' }));
  assert.equal(comboBars(y).length, 12, 'رسم السنة اثنا عشر عموداً');
  // ربعٌ ⇒ ثلاثة أعمدة بأشهره وحدها، وقيم مارس فيها (صافي بند مارس = 1M)
  const q1 = comboRegion(await sectorPage(ADMIN, { year: String(YEAR), p: 'q1' }));
  const q1bars = comboBars(q1);
  assert.equal(q1bars.length, 3, 'رسم الربع ثلاثة أعمدة لا اثنا عشر');
  assert.ok(q1bars.some((t) => t.startsWith('مارس') && t.includes('1.0M')), 'صافي مارس على عموده في الربع الأول');
  assert.ok(!q1.includes('ديسمبر'), 'ديسمبر خارج رسم الربع الأول');
  // وحصة الربع من الهدف السنوي (مليون ريال) = 250 ألفاً — معلَنة على الرسم لا الهدف كاملاً
  assert.ok(q1.includes('250K'), 'خط الهدف حصة الربع (الهدف ÷ 12 × 3)');
  // شهرٌ ⇒ عمود واحد بقيمته
  const m12 = comboRegion(await sectorPage(ADMIN, { year: String(YEAR), p: 'm12' }));
  const m12bars = comboBars(m12);
  assert.equal(m12bars.length, 1, 'رسم الشهر عمود واحد');
  assert.ok(m12bars[0].startsWith('ديسمبر') && m12bars[0].includes('2.0M'), 'صافي ديسمبر على عموده');
  // والصفحة تقول صراحةً أن «السنة» تعيد الرسم كاملاً
  const q1Html = await sectorPage(ADMIN, { year: String(YEAR), p: 'q1' });
  assert.ok(q1Html.includes('تعيد الاثني عشر شهراً'), 'إعلان العودة إلى رسم السنة');
});

test('الربع الرابع ثلاثة أشهر: يضمّ ديسمبر ولا يضمّ مارس', async () => {
  const q4 = band(await sectorPage(ADMIN, { year: String(YEAR), p: 'q4' }));
  assert.ok(q4.includes('7.8M'), 'فوز ديسمبر داخل الربع الرابع');
  assert.ok(!q4.includes('3.3M'), 'فوز مارس خارج الربع الرابع');
  const q1 = band(await sectorPage(ADMIN, { year: String(YEAR), p: 'q1' }));
  assert.ok(q1.includes('3.3M'), 'فوز مارس داخل الربع الأول');
  assert.ok(!q1.includes('7.8M'), 'فوز ديسمبر خارج الربع الأول');
});

test('فترةٌ مجهولة تسقط إلى السنة بلا خطأ في وجه القارئ', async () => {
  const bad = norm(band(await sectorPage(ADMIN, { year: String(YEAR), p: '../etc' })));
  const y = norm(band(await sectorPage(ADMIN, { year: String(YEAR), p: 'y' })));
  assert.equal(bad, y, 'المجهول = السنة');
});
