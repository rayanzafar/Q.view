// ── بوابات شريط «المال في القطاع» (v5.71) ──────────────────────────────────────────────────
// الشريط يجمع أرقاماً ثلاثةً ليست كلها لكل قارئ: المفوتر خلف قراءة الفواتير، والتكلفة والهامش
// خلف بوابتَي «الكلفة» و«الهامش» المختومتين. وجمعُها في سطرٍ واحد أعلى الشاشة يجعل تسريب
// واحدةٍ منها أسهل وأظهر مما لو بقيت متفرّقة — فهذه الحارة على البوابات نفسها لا على الشكل.
//
// والمنح من مصفوفة المنصة المبذورة (seed-rbac) لا من منحٍ يُخترع هنا:
//   • مدير الإدارة  — كلفةٌ وهامشٌ على مستوى القطاع، ولا فاتورة. ⇒ شريطٌ بلا «المفوتر».
//   • العمليات      — مشاريعُ وتقاريرُ قطاعية، بلا فاتورةٍ ولا كلفةٍ ولا هامش. ⇒ لا شريط أصلاً.
//   • الموظف        — نطاقه «خاصتي»، فيأخذ الوجه الشخصي «قطاعي» ولا شريط فيه.
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
const COST_SHORT = '210K';        // 180 ألف بنوداً + 30 ألفاً مصروفات معتمدة
const INVOICED_SHORT = '444K';    // فاتورتان صادرتان — رقمٌ لا يصادف حصةَ هدفٍ في رسوم الصفحة

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
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000_00, net_amount_halalas: 1_000_000_00, created_at: T });
  await insert('invoice', { id: 'I_ISS', code: 'INV-1', project_id: 'P1', client_id: 'C1',
    amount_halalas: 300_000_00, issue_date: `${YEAR}-03-10`, status: 'ISSUED', created_at: T });
  await insert('invoice', { id: 'I_PAID', code: 'INV-2', project_id: 'P1', client_id: 'C1',
    amount_halalas: 144_000_00, issue_date: `${YEAR}-06-15`, status: 'PAID', created_at: T });
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

test('قائد القطاع يرى الشريط كاملاً — الأساس الذي تُقاس عليه بقية الأدوار', async () => {
  const band = bandOf(await sectorPage(lead, { year: String(YEAR), p: 'y' }));
  assert.ok(band, 'الشريط مُصيَّر لقائد القطاع');
  for (const l of ['الإيراد المحقق', 'المفوتر', 'التكاليف', 'الهامش الإجمالي']) {
    assert.ok(band.includes(l), `«${l}» في شريط القائد`);
  }
  assert.ok(band.includes(COST_SHORT) && band.includes(INVOICED_SHORT), 'أرقام القائد كاملة');
});

test('مدير الإدارة: تكلفةٌ وهامشٌ بلا مفوتر — ولا نافذة فواتير خلفه', async () => {
  const html = await sectorPage(dm, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(dm).mode, 'command', 'مدير الإدارة في وجه القيادة');
  const band = bandOf(html);
  assert.ok(band, 'الشريط مُصيَّر لمدير الإدارة');
  assert.ok(band.includes('التكاليف') && band.includes(COST_SHORT), 'التكلفة بمنحها');
  assert.ok(band.includes('الهامش الإجمالي'), 'الهامش بمنحه');
  assert.ok(!band.includes('المفوتر'), 'لا مفوتر لمن لا يقرأ الفواتير');
  assert.ok(!band.includes(INVOICED_SHORT), 'رقم الفوترة لا يتسرّب في الشريط');
  assert.ok(!band.includes('data-dd="secinv"'), 'لا خليةَ تفتح نافذة الفواتير');
  assert.ok(!html.includes('<template id="dd-secinv">'), 'نافذة الفواتير غير مبنيّة أصلاً');
  assert.ok(html.includes('<template id="dd-seccost">'), 'نافذة التكاليف مبنيّة لمن يملكها');
  // والشبكة تتبع عدد الخلايا الفعلي: ثلاثٌ هنا — عمودٌ رابعٌ فارغٌ يُقرأ خليةً سقطت لا مساحةً لا تلزم
  assert.equal((band.match(/<button type="button" class="mcell"/g) || []).length, 3, 'ثلاث خلايا');
  assert.ok(band.includes('class="mcells" style="--n:3"'), 'ثلاثة أعمدة لثلاث خلايا');
});

test('العمليات: لا شريط أصلاً ولا رقم كلفةٍ في الصفحة كلها', async () => {
  const html = await sectorPage(ops, { year: String(YEAR), p: 'y' });
  const seen = visibleOf(html);
  assert.equal(sectorViewMode(ops).mode, 'command', 'العمليات في وجه القيادة (مشاريعُ وتقارير قطاعية)');
  assert.ok(!html.includes('id="money-band"'), 'لا شريط لمن لا يقرأ فاتورةً ولا كلفة');
  assert.ok(!seen.includes('التكاليف') && !seen.includes('الهامش الإجمالي'), 'لا عنوان كلفةٍ ولا هامش');
  assert.ok(!seen.includes(COST_SHORT), 'رقم التكلفة لا يظهر');
  assert.ok(!seen.includes(INVOICED_SHORT), 'رقم الفوترة لا يظهر');
  assert.ok(!html.includes('<template id="dd-seccost">') && !html.includes('<template id="dd-secinv">'),
    'لا نافذة تفصيلٍ لما لا يُقرأ');
});

test('الموظف: الوجه الشخصي «قطاعي» — لا شريط مالٍ فيه', async () => {
  const html = await sectorPage(emp, { year: String(YEAR), p: 'y' });
  assert.equal(sectorViewMode(emp).mode, 'personal', 'الموظف على الوجه الشخصي');
  assert.ok(!html.includes('id="money-band"'), 'لا شريط مالٍ على الوجه الشخصي');
  const seen = visibleOf(html);
  assert.ok(!seen.includes(COST_SHORT) && !seen.includes(INVOICED_SHORT), 'لا رقم مالٍ قطاعي');
  assert.ok(!html.includes('<template id="dd-seccost">') && !html.includes('<template id="dd-secinv">'),
    'ولا نافذتَي تفصيلهما');
});
