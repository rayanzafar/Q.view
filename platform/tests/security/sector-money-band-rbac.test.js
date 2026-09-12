// ── بوابات بطاقة «المال في القطاع» بعد إعادة بنائها ────────────────────────────────────────
// البطاقة تجمع ثلاثة أرقامٍ ليست كلها لكل قارئ، ولكلٍّ بوابتُه:
//   • «المتبقي من العقود»  — خلف قراءة **العقود**.
//   • «منجَز لم يُفوتر»    — خلف قراءة **الفواتير** (طرفاه: المتحقق والمفوتر).
//   • «الهامش الإجمالي»    — خلف بوابتَي «الهامش» و«الكلفة» **معاً**: الإيراد معروضٌ فوقه في
//     «نبض القطاع»، فالنسبة وحدها تردّ التكلفة المحجوبة بالطرح.
// والبطاقة نفسها تسقط حين لا يملك القارئ واحدةً من الثلاث.
//
// والمنح من مصفوفة المنصة المبذورة (seed-rbac) لا من منحٍ يُخترع هنا:
//   • قائد القطاع  — عقودٌ وفواتيرُ وكلفةٌ وهامش. ⇒ البطاقة كاملة بخلاياها الثلاث.
//   • مدير الإدارة — كلفةٌ وهامشٌ على مستوى القطاع، ولا عقدَ ولا فاتورة. ⇒ خليّةُ الهامش وحدها.
//   • العمليات     — مشاريعُ وتقاريرُ قطاعية، بلا عقدٍ ولا فاتورةٍ ولا كلفةٍ ولا هامش. ⇒ لا بطاقة.
//   • الموظف       — نطاقه «خاصتي»، فيأخذ الوجه الشخصي «قطاعي» ولا بطاقة فيه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mbrbac-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, close } = await import('../../src/core/db/index.js');
await (await import('../../src/core/rbac/index.js')).initRbac();
const { sectorPage, sectorViewMode } = await import('../../src/web/views/sector.js');

const T = '2024-01-05T00:00:00Z';
const YEAR = new Date().getUTCFullYear() - 1;
const U = (id, role, scope) => ({ id, username: id, name_ar: 'مستخدم ' + id, role_id: role,
  sector_id: 'SOL', scope, projectIds: new Set(['P1']), teamIds: new Set() });

const lead = U('u_lead', 'sector_lead', 'sector');
const dm = U('u_dm', 'department_manager', 'department');
const ops = U('u_ops', 'operations', 'sector');
const emp = U('u_emp', 'employee', 'own');

// أرقامٌ مميّزة: أيُّها ظهر لمن لا يملكه دلّ الفشلُ عليه بعينه — ولا يصادف واحدٌ منها حصةَ
// هدفٍ أو رقمَ رسمٍ آخر في الصفحة.
const BACKLOG_SHORT = '777K';   // متعاقد صافياً 1,777,000 − ما تحقق 1,000,000
const DELTA_SHORT = '444K';     // تحقق 1,000,000 − مفوتر صافياً 556,000
const COST_SHORT = '210K';      // 180 ألف بنوداً + 30 ألفاً مصروفات معتمدة

before(async () => {
  await insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, sort_order: 1,
    target_revenue_halalas: 200_000_000, target_sales_halalas: 200_000_000, created_at: T });
  for (const u of [lead, dm, ops, emp]) {
    await insert('app_user', { id: u.id, username: u.username, name_ar: u.name_ar, role_id: u.role_id,
      sector_id: 'SOL', scope: u.scope, active: 1, created_at: T });
  }
  await insert('client', { id: 'C1', name_ar: 'وزارة الثقافة', active: 1, created_at: T });
  await insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await insert('project', { id: 'P1', code: 'PRJ-1', name_ar: 'مشروع التحول', sector_id: 'SOL', client_id: 'C1',
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, created_at: T });
  await insert('contract', { id: 'K1', code: 'CN-1', client_id: 'C1', project_id: 'P1', sector_id: 'SOL',
    value_halalas: 2_043_550_00, net_value_halalas: 1_777_000_00, status: 'ACTIVE',
    start_date: `${YEAR}-01-01`, signed_at: `${YEAR}-01-01`, created_at: T });
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000_00, net_amount_halalas: 1_000_000_00, created_at: T });
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 409_400_00, net_amount_halalas: 356_000_00,
    issue_date: `${YEAR}-03-10`, status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 230_000_00, net_amount_halalas: 200_000_00,
    issue_date: `${YEAR}-06-15`, status: 'PAID', created_at: T });
  await insert('cost_line', { id: 'CL3', project_id: 'P1', sector_id: 'SOL', type: 'رواتب',
    amount_halalas: 180_000_00, month: 3, year: YEAR, created_at: T });
  await insert('expense', { id: 'E_APP', project_id: 'P1', sector_id: 'SOL', type: 'سفر',
    amount_halalas: 30_000_00, incurred_month: 3, incurred_year: YEAR, status: 'APPROVED', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ما يقرأه المستخدم فعلاً: الصفحة بلا أوراق الأنماط ولا برمجة المتصفح — فيها تعليقات عربية
// تصف التصميم وليست نصّاً معروضاً، وفحصُها يخلط الشكل بالمضمون (نفس قاعدة sector-role-view).
const visibleOf = (html) => html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ');

const bandOf = (html) => {
  const a = html.indexOf('id="money-band"');
  if (a < 0) return null;
  return html.slice(a, html.indexOf('</section>', a));
};
// الخليّة تُقطع عند وسمها لا عند نوع عنصرها — فتبقى الحارة صادقةً لو تغيّر الوسم من زرٍّ إلى
// عنصرٍ بدورٍ معلَن (وهو ما جرى حين صارت المقاييسُ عناصرَ كتلةٍ داخل الخليّة).
const cellCount = (band) => (band.match(/class="mcell"/g) || []).length;

test('قائد القطاع يرى البطاقة كاملة — الأساس الذي تُقاس عليه بقية الأدوار', async () => {
  const html = await sectorPage(lead, { year: String(YEAR), p: 'y' });
  const band = bandOf(html);
  assert.ok(band, 'البطاقة مُصيَّرة لقائد القطاع');
  for (const l of ['المتبقي من العقود', 'منجَز لم يُفوتر', 'الهامش الإجمالي']) {
    assert.ok(band.includes(l), `«${l}» في بطاقة القائد`);
  }
  assert.equal(cellCount(band), 3, 'ثلاث خلايا');
  assert.ok(band.includes('class="mcells" style="--n:3"'), 'ثلاثة أعمدة لثلاث خلايا');
  assert.ok(band.includes(BACKLOG_SHORT) && band.includes(DELTA_SHORT) && band.includes(COST_SHORT),
    'أرقام القائد كاملة');
  for (const dd of ['seccontracts', 'secunbilled', 'seccost']) {
    assert.ok(band.includes(`data-dd="${dd}"`), `خليّة تفتح ${dd}`);
    assert.ok(html.includes(`<template id="dd-${dd}">`), `ونافذة ${dd} مبنيّة`);
  }
});

test('مدير الإدارة: هامشٌ وكلفةٌ بلا عقدٍ ولا فاتورة — ولا نافذةَ لأيٍّ منهما', async () => {
  const html = await sectorPage(dm, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(dm).mode, 'command', 'مدير الإدارة في وجه القيادة');
  const band = bandOf(html);
  assert.ok(band, 'البطاقة مُصيَّرة لمدير الإدارة');
  assert.ok(band.includes('الهامش الإجمالي') && band.includes(COST_SHORT), 'الهامش والكلفة بمنحهما');
  // ── العقود ──
  assert.ok(!band.includes('المتبقي من العقود'), 'لا خليّةَ عقودٍ لمن لا يقرأ العقود');
  assert.ok(!band.includes(BACKLOG_SHORT), 'رقم المتبقي لا يتسرّب');
  assert.ok(!band.includes('data-dd="seccontracts"'), 'ولا خليّةَ تفتح نافذة العقود');
  assert.ok(!html.includes('<template id="dd-seccontracts">'), 'ونافذة العقود غير مبنيّة أصلاً');
  // ── الفواتير ──
  assert.ok(!band.includes('منجَز لم يُفوتر') && !band.includes('المفوتر قبل الإنجاز'),
    'لا خليّةَ فارقٍ لمن لا يقرأ الفواتير');
  assert.ok(!band.includes(DELTA_SHORT), 'رقم الفارق لا يتسرّب');
  assert.ok(!band.includes('data-dd="secunbilled"'), 'ولا خليّةَ تفتح نافذته');
  assert.ok(!html.includes('<template id="dd-secunbilled">') && !html.includes('<template id="dd-secinv">'),
    'ولا نافذةَ فواتيرَ مبنيّة أصلاً');
  // ── وما يملكه مبنيٌّ له ──
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة لمن يملكها');
  // والشبكة تتبع عدد الخلايا الفعلي: خليّةٌ واحدة هنا — عمودٌ فارغٌ يُقرأ خليّةً سقطت لا مساحةً
  assert.equal(cellCount(band), 1, 'خليّة واحدة');
  assert.ok(band.includes('class="mcells" style="--n:1"'), 'عمودٌ واحد لخليّةٍ واحدة');
});

test('العمليات: لا بطاقة أصلاً ولا رقمَ مالٍ في الصفحة كلها', async () => {
  const html = await sectorPage(ops, { year: String(YEAR), p: 'y' });
  const seen = visibleOf(html);
  assert.equal(sectorViewMode(ops).mode, 'command', 'العمليات في وجه القيادة (مشاريعُ وتقارير قطاعية)');
  assert.ok(!html.includes('id="money-band"'), 'لا بطاقة لمن لا يقرأ عقداً ولا فاتورةً ولا كلفة');
  assert.ok(!seen.includes('المتبقي من العقود') && !seen.includes('منجَز لم يُفوتر')
    && !seen.includes('الهامش الإجمالي'), 'ولا عنوانَ خليّةٍ منها');
  for (const n of [BACKLOG_SHORT, DELTA_SHORT, COST_SHORT]) {
    assert.ok(!seen.includes(n), `الرقم ${n} لا يظهر`);
  }
  for (const dd of ['seccontracts', 'secunbilled', 'secinv', 'seccost']) {
    assert.ok(!html.includes(`<template id="dd-${dd}">`), `لا نافذة ${dd} لما لا يُقرأ`);
  }
});

test('الموظف: الوجه الشخصي «قطاعي» — لا بطاقةَ مالٍ فيه', async () => {
  const html = await sectorPage(emp, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(emp).mode, 'personal', 'الموظف على الوجه الشخصي');
  assert.ok(!html.includes('id="money-band"'), 'لا بطاقةَ مالٍ على الوجه الشخصي');
  const seen = visibleOf(html);
  for (const n of [BACKLOG_SHORT, DELTA_SHORT, COST_SHORT]) {
    assert.ok(!seen.includes(n), `لا رقمَ مالٍ قطاعي (${n})`);
  }
  for (const dd of ['seccontracts', 'secunbilled', 'secinv', 'seccost']) {
    assert.ok(!html.includes(`<template id="dd-${dd}">`), `ولا نافذة ${dd}`);
  }
});
