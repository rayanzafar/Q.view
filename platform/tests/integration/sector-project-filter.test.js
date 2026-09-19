// ── مرشِّح المشروع في مركز القطاع: يقصّ ما يحمل بُعد المشروع، ويوسم ما لا يحمله ─────────────
// القاعدة نفسها التي يحرسها فحص مرشِّحَي الإدارة والعميل: **لا ترشيحَ صامتٌ ناقص**. الفرصة لا
// عمودَ مشروعٍ لها في المنصة أصلاً، فالقمع والمبيعات وخط الفرص و«ما تغيّر» تبقى قطاعية تحت
// ترشيح المشروع — وتقول شارتُها «القطاع كله» بدل أن يقرأها القائد كأنها مقصوصة. أما الإيراد
// والفواتير والمخرجات والمشاريع فتُقصّ فعلاً. والمعرّف المجهول يسقط كسائر المرشِّحات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-projfilt-'));
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
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('client', { id: 'CL_A', name_ar: 'جهة ألف', created_at: T });
  // مشروعان لهما إيراد مسجَّل في السنة المعروضة — كلٌّ في شهرٍ مختلف كي يُقرأ القصّ من الرسم
  await insert('project', { id: 'P_ONE', name_ar: 'مشروع المنصة الأولى', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: `${YEAR}-01-15`, department_id: 'D_AI', client_id: 'CL_A', created_at: T });
  await insert('project', { id: 'P_TWO', name_ar: 'مشروع المنصة الثانية', sector_id: 'SOL', status: 'IN_PROGRESS',
    rag: 'AMBER', start_date: `${YEAR}-01-20`, department_id: 'D_AI', client_id: 'CL_A', created_at: T });
  await insert('revenue_line', { id: 'RL_ONE', sector_id: 'SOL', project_id: 'P_ONE', year: YEAR, month: 2,
    amount_halalas: 4_600_000_00, net_amount_halalas: 4_000_000_00, created_at: T });
  await insert('revenue_line', { id: 'RL_TWO', sector_id: 'SOL', project_id: 'P_TWO', year: YEAR, month: 5,
    amount_halalas: 3_450_000_00, net_amount_halalas: 3_000_000_00, created_at: T });
  // فرصةٌ مفتوحة: لا عمود مشروعٍ لها — تبقى قطاعية تحت ترشيح المشروع
  await insert('opportunity', { id: 'O_OPEN', title_ar: 'فرصة بلا مشروع مرتبط', sector_id: 'SOL', year: YEAR,
    stage_id: 'LEAD', value_halalas: 9_000_000, win_pct: 50, exclude_from_sales: 0,
    department_id: 'D_AI', client_id: 'CL_A', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

const comboSvg = (html) => {
  const m = html.match(/<svg class="fig-svg[^"]*"[^>]*aria-label="الإيراد الشهري والتراكمي[^"]*"[\s\S]*?<\/svg>/);
  assert.ok(m, 'رسم الإيقاع موجود');
  return m[0];
};

test('ترشيحٌ بمشروع يقصّ الإيراد إلى بنود ذلك المشروع وحدها', async () => {
  const plain = await sectorPage(ADMIN, { year: String(YEAR) });
  const pv = comboSvg(plain);
  assert.ok(pv.includes('فبراير: 4.0M'), 'بند المشروع الأول على رسم القطاع');
  assert.ok(pv.includes('مايو: 3.0M'), 'بند المشروع الثاني على رسم القطاع');
  const one = await sectorPage(ADMIN, { year: String(YEAR), project: 'P_ONE' });
  const ov = comboSvg(one);
  assert.ok(ov.includes('فبراير: 4.0M'), 'بند المشروع المختار باقٍ');
  assert.ok(ov.includes('مايو: 0'), 'بند مشروعٍ آخر تسرّب إلى الرسم المرشَّح');
  assert.ok(one.includes('حصة من إيراد القطاع'), 'حصة المشروع من إيراد القطاع معلنة');
});

test('المشروع يظهر في مُنتقيه، ورقاقةُ إزالته حاضرة، والمشروع الآخر لم يُحذف من القائمة', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), project: 'P_ONE' });
  assert.ok(h.includes('كل المشاريع'), 'خيار «كل المشاريع» غائب من المُنتقي');
  assert.ok(h.includes('مشروع المنصة الثانية'), 'بقية مشاريع القطاع غابت عن المُنتقي');
  assert.ok(h.includes('إزالة ترشيح المشروع'), 'رقاقةُ إزالة ترشيح المشروع غائبة');
});

test('ما لا بُعدَ مشروعٍ له يحمل شارة «القطاع كله» لا رقماً يبدو مرشَّحاً', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), project: 'P_ONE' });
  assert.ok(h.includes('الفرص لا تُنسَب لمشروع في المنصة فتبقى قطاعية'),
    'الفصل التجاري لم يُعلن أنه قطاعي تحت ترشيح المشروع');
  assert.ok(h.includes('فرصة بلا مشروع مرتبط'), 'فرص القطاع اختفت تحت ترشيح المشروع بدل أن تُوسَم');
  assert.ok((h.match(/القطاع كله/g) || []).length >= 2, 'شارات «القطاع كله» غائبة');
  // وبلا ترشيحٍ لا شارة للفصل التجاري (لا ضجيج حين لا يُخفى شيء)
  const plain = await sectorPage(ADMIN, { year: String(YEAR) });
  assert.ok(!plain.includes('الفرص لا تُنسَب لمشروع في المنصة فتبقى قطاعية'), 'الشارة تظهر بلا ترشيح');
});

test('المشروع يبقى في كل رابط: الرقائق والألسنة والفترة تحمله معها', async () => {
  const h = await sectorPage(ADMIN, { year: String(YEAR), project: 'P_TWO', tab: 'ops' });
  assert.ok(h.includes('project=P_TWO'), 'روابط الصفحة لا تحمل المشروع المختار');
  // رابطُ فترةٍ بعينه يحمل المشروع والفصل معاً
  assert.ok(/[?&]p=q2(&|")/.test(h) && h.includes('tab=ops'), 'روابط الفترة فقدت الفصل');
  // كل رقاقة فترةٍ تحمل حالة الصفحة كاملةً. ويخرج من الفحص قصداً رابطان: «كل المشاريع»
  // ورقاقةُ الإزالة — وظيفتهما إسقاطُ المشروع؛ ومحوّلُ القطاع يُسقطه أيضاً لأن معرّف مشروعٍ
  // لا ينتمي إلى القطاع الذي يُنتقل إليه.
  const links = h.match(/\/app\/sector\?[^"']+/g) || [];
  const periodLinks = links.filter((l) => /[?&]p=(ytd|q[1-4]|m\d)/.test(l));
  assert.ok(periodLinks.length >= 17, 'رقائق الفترة (حتى اليوم + أربعة أرباع + اثنا عشر شهراً) ناقصة');
  assert.ok(periodLinks.every((l) => l.includes('project=P_TWO')), 'رقاقةُ فترةٍ أسقطت المشروع');
  assert.ok(periodLinks.every((l) => l.includes('tab=ops')), 'رقاقةُ فترةٍ أسقطت الفصل');
});

test('معرّف مشروعٍ مجهول — أو مشروعُ قطاعٍ آخر — يسقط بلا خطأ ولا قصٍّ عشوائي', async () => {
  const bad = await sectorPage(ADMIN, { year: String(YEAR), project: '../etc' });
  const plain = await sectorPage(ADMIN, { year: String(YEAR) });
  const norm = (x) => x.replace(/spkGrad\d+/g, 'g').replace(/[a-z]+Grad\d+/g, 'g');
  assert.equal(norm(bad), norm(plain), 'المجهول = بلا ترشيح');
  assert.ok(!bad.includes('إزالة ترشيح المشروع'), 'رقاقةُ ترشيحٍ ظهرت لمعرّفٍ مرفوض');
});
