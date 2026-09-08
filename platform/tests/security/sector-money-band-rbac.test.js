// ── بوابات بطاقة «المال في القطاع» (v5.85 — كانت شريطاً بأربع خلايا في v5.71) ───────────────
// البطاقة تجمع ثلاثة أرقامٍ ليست كلها لكل قارئ: «المتبقي من العقود» خلف قراءة العقود، و«الفارق
// بين المنجَز والمفوتر» خلف قراءة الفواتير، و«الهامش» خلف بوابتَي «الكلفة» و«الهامش» المختومتين
// معاً. وجمعُها في بطاقةٍ واحدة أعلى الشاشة يجعل تسريب واحدةٍ منها أسهل وأظهر مما لو بقيت
// متفرّقة — فهذه الحارة على البوابات نفسها لا على الشكل، وتبقى بعد إعادة التشكيل كما كانت.
//
// والمنح من مصفوفة المنصة المبذورة (seed-rbac) لا من منحٍ يُخترع هنا:
//   • قائد القطاع   — عقودٌ وفواتيرُ وكلفةٌ وهامش. ⇒ الخلايا الثلاث.
//   • مدير الإدارة  — كلفةٌ وهامشٌ على مستوى القطاع، بلا عقدٍ ولا فاتورة. ⇒ خليّةُ الهامش وحدها.
//   • العمليات      — مشاريعُ وتقاريرُ قطاعية، بلا شيءٍ من الأربعة. ⇒ لا بطاقة أصلاً.
//   • الموظف        — نطاقه «خاصتي»، فيأخذ الوجه الشخصي «قطاعي» ولا بطاقة فيه.
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

// أرقامٌ مميّزة: أيُّها ظهر لمن لا يملكه دلّ الفشلُ عليه بعينه
const COST_SHORT = '210K';        // 180 ألف بنوداً + 30 ألفاً مصروفات معتمدة — خلف بوابة الكلفة
const INVOICED_SHORT = '444K';    // صافي فاتورتين صادرتين — خلف بوابة الفواتير
const GAP_SHORT = '556K';         // المحقق (مليون) ناقص المفوتر الصافي — خلف بوابة الفواتير
const BACKLOG_SHORT = '1.5M';     // صافي العقد النشط (2.5M) ناقص المحقق — خلف بوابة العقود

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
  await insert('contract', { id: 'K_ACT', code: 'CTR-1', project_id: 'P1', client_id: 'C1', sector_id: 'SOL',
    value_halalas: 3_000_000_00, net_value_halalas: 2_500_000_00, status: 'ACTIVE', created_at: T });
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000_00, net_amount_halalas: 1_000_000_00, created_at: T });
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 345_000_00, net_amount_halalas: 300_000_00, issue_date: `${YEAR}-03-10`,
    status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 165_600_00, net_amount_halalas: 144_000_00, issue_date: `${YEAR}-06-15`,
    status: 'PAID', created_at: T });
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

test('قائد القطاع يرى البطاقة كاملةً — الأساس الذي تُقاس عليه بقية الأدوار', async () => {
  const band = bandOf(await sectorPage(lead, { year: String(YEAR), p: 'y' }));
  assert.ok(band, 'البطاقة مُصيَّرة لقائد القطاع');
  for (const l of ['المتبقي من العقود', 'منجَز لم يُفوتر', 'الهامش الإجمالي']) {
    assert.ok(band.includes(l), `«${l}» في بطاقة القائد`);
  }
  assert.ok(band.includes(BACKLOG_SHORT), 'رقم العقود بمنحه');
  assert.ok(band.includes(GAP_SHORT), 'رقم الفارق بمنحه');
  assert.ok(band.includes(COST_SHORT), 'رقم التكلفة بمنحه');
  assert.equal((band.match(/<button type="button" class="mcell"/g) || []).length, 3, 'ثلاث خلايا');
});

test('مدير الإدارة: هامشٌ وحده — بلا عقودٍ ولا فوترة، ولا نافذة فواتير خلفه', async () => {
  const html = await sectorPage(dm, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(dm).mode, 'command', 'مدير الإدارة في وجه القيادة');
  const band = bandOf(html);
  assert.ok(band, 'البطاقة مُصيَّرة لمدير الإدارة');
  assert.ok(band.includes('الهامش الإجمالي') && band.includes(COST_SHORT), 'الهامش والكلفة بمنحهما');
  // بوابة الفواتير: لا خليّةَ فارقٍ ولا رقمَ فوترةٍ ولا نافذةٌ خلفها
  assert.ok(!band.includes('منجَز لم يُفوتر') && !band.includes('مفوتر قبل الإنجاز'),
    'لا خليّةَ فارقٍ لمن لا يقرأ الفواتير');
  assert.ok(!band.includes(INVOICED_SHORT) && !band.includes(GAP_SHORT), 'رقم الفوترة لا يتسرّب في البطاقة');
  assert.ok(!band.includes('data-dd="secinv"') && !band.includes('data-dd="secunbilled"'),
    'لا خليةَ تفتح نافذةً فاتوريّة');
  assert.ok(!html.includes('<template id="dd-secinv">') && !html.includes('<template id="dd-secunbilled">'),
    'نوافذ الفواتير غير مبنيّة أصلاً');
  // وبوابة العقود: لا خليّةَ متبقٍّ ولا رقمَها
  assert.ok(!band.includes('المتبقي من العقود') && !band.includes(BACKLOG_SHORT),
    'لا رصيدَ عقودٍ لمن لا يقرأ العقود');
  assert.ok(!html.includes('<template id="dd-seccontracts">'), 'ولا نافذةَ سجلّها');
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة لمن يملكها');
  // والشبكة تتبع عدد الخلايا الفعلي: واحدةٌ هنا — عمودٌ فارغٌ يُقرأ خليةً سقطت لا مساحةً لا تلزم
  assert.equal((band.match(/<button type="button" class="mcell"/g) || []).length, 1, 'خليّةٌ واحدة');
  assert.ok(band.includes('class="mcells" style="--n:1"'), 'عمودٌ واحد لخليّةٍ واحدة');
});

test('العمليات: لا بطاقة أصلاً ولا رقم كلفةٍ في الصفحة كلها', async () => {
  const html = await sectorPage(ops, { year: String(YEAR), p: 'y' });
  const seen = visibleOf(html);
  assert.equal(sectorViewMode(ops).mode, 'command', 'العمليات في وجه القيادة (مشاريعُ وتقارير قطاعية)');
  assert.ok(!html.includes('id="money-band"'), 'لا بطاقة لمن لا يقرأ عقداً ولا فاتورةً ولا كلفة');
  assert.ok(!seen.includes('التكاليف') && !seen.includes('الهامش الإجمالي'), 'لا عنوان كلفةٍ ولا هامش');
  assert.ok(!seen.includes('المتبقي من العقود'), 'ولا عنوان رصيد عقود');
  for (const n of [COST_SHORT, INVOICED_SHORT, GAP_SHORT, BACKLOG_SHORT]) {
    assert.ok(!seen.includes(n), `الرقم ${n} لا يظهر`);
  }
  assert.ok(!html.includes('<template id="dd-seccost">') && !html.includes('<template id="dd-secinv">')
    && !html.includes('<template id="dd-secunbilled">') && !html.includes('<template id="dd-seccontracts">'),
  'لا نافذة تفصيلٍ لما لا يُقرأ');
});

test('الموظف: الوجه الشخصي «قطاعي» — لا بطاقة مالٍ فيه', async () => {
  const html = await sectorPage(emp, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(emp).mode, 'personal', 'الموظف على الوجه الشخصي');
  assert.ok(!html.includes('id="money-band"'), 'لا بطاقة مالٍ على الوجه الشخصي');
  const seen = visibleOf(html);
  for (const n of [COST_SHORT, INVOICED_SHORT, GAP_SHORT, BACKLOG_SHORT]) {
    assert.ok(!seen.includes(n), `لا رقم مالٍ قطاعي: ${n}`);
  }
  assert.ok(!html.includes('<template id="dd-seccost">') && !html.includes('<template id="dd-secinv">')
    && !html.includes('<template id="dd-secunbilled">') && !html.includes('<template id="dd-seccontracts">'),
  'ولا نوافذ تفصيلها');
});
