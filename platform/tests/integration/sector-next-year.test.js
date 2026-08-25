// ── سنةٌ قادمة في منتقي السنوات (طلب أ. حسين ٢، 2026-08-25) ──────────────────────────────
// القاعدة المحروسة: **لا خلط محققٍ بمتوقعٍ في خانة**. السنة القادمة تُعرض بلا سجلّ («لا
// سجلّ بعد» لا صفراً موهماً)، وتوقّعُها «امتداد وتيرة» السنة الجارية معلَناً بعلامته وصيغته،
// وأشهرُها وأرباعها تُنتقى كأي سنة، والمنتقي يسمّيها «قادمة» صراحةً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-nexty-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage } = await import('../../src/web/views/sector.js');

const T = '2026-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear();     // سنة الأساس (الجارية)
const NEXT = YEAR + 1;
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL',
  projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1,
    target_revenue_halalas: 100_000_000, target_sales_halalas: 100_000_000, created_at: T });
  await insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company',
    sector_id: 'SOL', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  // شهران مسجَّلان في السنة الجارية — وتيرةٌ تُمدّ
  await insert('revenue_line', { id: 'RL1', sector_id: 'SOL', year: YEAR, month: 1,
    amount_halalas: 2_300_000_00, net_amount_halalas: 2_000_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL2', sector_id: 'SOL', year: YEAR, month: 2,
    amount_halalas: 4_600_000_00, net_amount_halalas: 4_000_000_00, created_at: T });
  // فرصة مفتوحة مُسنَدة للسنة القادمة — «المجدول» الذي يظهر بجانب الامتداد
  await insert('opportunity', { id: 'O_NEXT', title_ar: 'مشروع العام القادم', sector_id: 'SOL', year: NEXT,
    stage_id: 'LEAD', value_halalas: 10_000_000_00, win_pct: 40, exclude_from_sales: 0, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('منتقي السنوات يسمّي السنة القادمة «قادمة» ويعرضها', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR) });
  assert.ok(h.includes(`سنة ${NEXT} — قادمة`), 'السنة القادمة غائبة عن منتقي السنوات أو بلا وسمها');
});

test('السنة القادمة: لا سجلّ يُختلق، والتوقع امتدادُ وتيرةٍ معلَن، والمجدول بجانبه', async () => {
  const h = await sectorPage(ADMIN, { year: String(NEXT) });
  // بطاقة الإيراد: «لا سجلّ» لا صفرٌ موهم
  assert.ok(h.includes(`لا سجلّ لسنة ${NEXT} بعد`), 'بطاقة الإيراد لا تقول «لا سجلّ بعد»');
  // بطاقة التوقع موسومة بأساسها وصيغتها
  assert.ok(h.includes(`امتداد وتيرة ${YEAR}`), 'وسم «امتداد الوتيرة» غائب');
  assert.ok(h.includes('× 12'), 'صيغة الامتداد (متوسط الشهر × 12) غائبة');
  // المجدول للسنة القادمة من خط الفرص يظهر مرجّحاً (10M × 40% = 4M)
  assert.ok(h.includes(`مبيعات مجدولة لسنة ${NEXT}`), 'سطر المبيعات المجدولة غائب');
  assert.ok(h.includes('4.0M'), 'القيمة المرجّحة للمجدول غائبة');
  // الرسم لا يختلق أعمدة: حالة «لا إيراد مسجَّلاً بعد» الصريحة
  assert.ok(h.includes('لا إيراد مسجَّلاً بعد'), 'حالة الرسم الفارغة الصريحة غائبة');
  // والفترة كلها قادمة — الإعلان قائم
  assert.ok(h.includes('فترة قادمة'), 'إعلان «فترة قادمة» غائب');
});

test('ربعٌ من السنة القادمة يُنتقى، والمتوقع للفترة معلَنٌ بتوزيعه لا محققاً', async () => {
  const h = await sectorPage(ADMIN, { year: String(NEXT), p: 'q2' });
  assert.ok(h.includes('المتوقع في الربع الثاني'), 'متوقع الفترة القادمة غائب عن بطاقة الإيراد');
  assert.ok(h.includes('موزَّعاً بالتساوي'), 'قاعدة التوزيع غير معلنة');
  // ولا قيمة «محقق» تُطبع لسنةٍ لم تأتِ
  const kpi = h.slice(h.indexOf('id="kpi-band"'), h.indexOf('class="exec-band"'));
  assert.ok(kpi.includes('لا سجلّ'), 'بطاقة المحقق فقدت صراحتها في فترة قادمة');
});

test('سنةٌ أبعد من القادمة لا تظهر في المنتقي ولا توقّع لها', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR) });
  assert.ok(!h.includes(`سنة ${NEXT + 1}`), 'سنةٌ أبعد من القادمة تسرّبت إلى المنتقي');
});
