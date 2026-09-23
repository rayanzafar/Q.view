// ── بوابات مال القطاع على الشاشة الواحدة (v6.10) ───────────────────────────────────────────
// كانت هذه الحارة تفحص «بطاقة المال» بخلاياها الثلاث في وسم الخادم. الشاشة أُعيد بناؤها:
// لا بطاقةَ مُصيَّرةً على الخادم ولا نوافذَ `dd-*`؛ الأرقام كلها تصل في حزمةٍ واحدة
// (`<script type="application/json" id="cc-data">`) ويرسمها المتصفّح. فالخليّة الأمنية نفسها
// تبقى — **ما لا يقرؤه القارئ لا يصل جهازَه أصلاً** — لكنها تُقاس على الحزمة لا على الوسم:
// ظهورُ رقمٍ في `cc-data` تسريبٌ ولو لم يُرسم قط، لأن من يفتح مصدر الصفحة يقرؤه.
//
// والأدوار الأربعة كما كانت، من مصفوفة المنصة المبذورة (seed-rbac) لا من منحٍ يُخترع هنا:
//   • قائد القطاع  — كلفةٌ وهامش. ⇒ سطور التكلفة والهامش في الحزمة (الأساس الذي يُقاس عليه).
//   • مدير الإدارة — كلفةٌ وهامشٌ على مستوى القطاع. ⇒ يصله ما يملكه.
//   • العمليات     — بلا كلفةٍ ولا هامش. ⇒ لا رقمَ كلفةٍ ولا مفتاحَ هامشٍ في الحزمة كلها.
//   • الموظف       — نطاقه «خاصتي»، فيأخذ الوجه الشخصي «قطاعي» ولا حزمةَ مالٍ فيه أصلاً.
//
// ما سقط من الحارة القديمة عمداً: خليّتا «المتبقي من العقود» و«منجَز لم يُفوتر». لم تعودا
// بوّابتين مستقلّتين في الشاشة الجديدة — الرقمان يتبعان قراءة **المشاريع** نفسها في
// `command-center.js`، فلا توليفةَ «يقرأ المشاريع ولا يقرأ عقودها» تُفحص. والراتب والخطة
// مفحوصان في `tests/security/command-center-leak.test.js`، والغيابُ مفتاحاً مفتاحاً في
// `tests/unit/command-center-redaction.test.js`.
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

// أرقامٌ مميّزة بهللاتها: أيُّها ظهر لمن لا يملكه دلّ الفشلُ عليه بعينه، ولا يتولّد واحدٌ منها
// من آخر بجمعٍ ولا قسمة. والبحث عنها حرفيٌّ في نصّ الحزمة.
const COST_LINE = 180_000_37;   // بندُ كلفةٍ مسجَّل
const COST_EXP = 30_000_41;     // مصروفٌ معتمَد
const REVENUE = 1_000_000_43;   // إيرادٌ صافٍ — يصل لمن يقرأ الإيراد، وهو ضابط الفحص

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
    status: 'IN_PROGRESS', rag: 'GREEN', progress_pct: 40, margin_pct: 34,
    contract_value_halalas: 2_043_550_00, created_at: T });
  await insert('revenue_line', { id: 'RL3', project_id: 'P1', sector_id: 'SOL', year: YEAR, month: 3,
    amount_halalas: 1_150_000_00, net_amount_halalas: REVENUE, created_at: T });
  await insert('cost_line', { id: 'CL3', project_id: 'P1', sector_id: 'SOL', type: 'رواتب', category: 'sal',
    amount_halalas: COST_LINE, month: 3, year: YEAR, created_at: T });
  await insert('expense', { id: 'E_APP', project_id: 'P1', sector_id: 'SOL', type: 'سفر', category: 'oth',
    amount_halalas: COST_EXP, net_amount_halalas: COST_EXP, incurred_month: 3, incurred_year: YEAR,
    status: 'APPROVED', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// الحزمة كما تصل الجهاز — نصّاً ومفكوكةً. الفحص على النصّ لأن الرقم قد يختبئ في قسمٍ جانبيّ.
const packOf = (html, id = 'cc-data') => {
  const open = `<script type="application/json" id="${id}">`;
  const from = html.indexOf(open);
  if (from < 0) return null;
  const raw = html.slice(from + open.length, html.indexOf('</script>', from));
  return { raw, json: JSON.parse(raw) };
};
const page = (user) => sectorPage(user, { year: String(YEAR), p: 'y' });
const costKeys = (data) => (data.lines || []).filter((l) => l.kind === 'cost').map((l) => l.id);

test('قائد القطاع: الكلفة والهامش يصلان — الأساس الذي تُقاس عليه بقية الأدوار', async () => {
  const p = packOf(await page(lead));
  assert.ok(p, 'حزمة الشاشة غائبة عن صفحة قائد القطاع');
  assert.ok(costKeys(p.json).length >= 6, 'سطور التكلفة الستة لم تصل من يملكها');
  assert.ok(p.json.projects.some((x) => x.margin_pct != null), 'الهامش لم يصل من يقرؤه');
  assert.ok(p.raw.includes(String(COST_LINE)) || p.raw.includes(String(COST_LINE + COST_EXP)),
    'كلفةُ سندٍ المسجَّلة لم تصل من يقرؤها — الفحص أدناه سيمرّ على حمولةٍ فارغة');
  assert.ok(p.raw.includes(String(REVENUE)), 'الإيراد لم يصل قائد القطاع');
});

test('مدير الإدارة: كلفةٌ وهامشٌ بمنحه هو — الحجب لا يطال من يملك', async () => {
  assert.equal(sectorViewMode(dm).mode, 'command', 'مدير الإدارة في وجه القيادة');
  const p = packOf(await page(dm));
  assert.ok(p, 'حزمة الشاشة غائبة عن صفحة مدير الإدارة');
  assert.ok(costKeys(p.json).length >= 6, 'سطور التكلفة لم تصل مدير الإدارة رغم منحه');
  assert.ok(!p.json.notes.includes('costs_hidden'), 'حُجبت الكلفة عمّن يقرؤها');
});

test('العمليات: لا رقمَ كلفةٍ ولا مفتاحَ هامشٍ في الحزمة كلها', async () => {
  assert.equal(sectorViewMode(ops).mode, 'command', 'العمليات في وجه القيادة (مشاريعُ وتقارير قطاعية)');
  const p = packOf(await page(ops));
  assert.ok(p, 'حزمة الشاشة غائبة عن صفحة العمليات');
  assert.deepEqual(costKeys(p.json), [], 'سطرُ تكلفةٍ واحدٌ وصل من لا يقرأ الكلفة');
  assert.ok(p.json.notes.includes('costs_hidden'), 'الحجب لم يُقل صراحةً في الحمولة');
  for (const key of ['margin_pct', 'recon']) {
    assert.ok(!p.raw.includes(key), `اسمُ الحقل المحجوب «${key}» حاضرٌ في الحزمة`);
  }
  for (const n of [COST_LINE, COST_EXP]) {
    assert.ok(!p.raw.includes(String(n)), `رقمُ كلفةٍ (${n}) تسرّب إلى من لا يقرأ الكلفة`);
  }
});

test('الموظف: الوجه الشخصي «قطاعي» — لا حزمةَ مالٍ فيه أصلاً', async () => {
  assert.equal(sectorViewMode(emp).mode, 'personal', 'الموظف على الوجه الشخصي');
  const html = await page(emp);
  assert.equal(packOf(html), null, 'حزمةُ مركز القطاع سُلِّمت للوجه الشخصي');
  const seen = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ');
  for (const n of [COST_LINE, COST_EXP, REVENUE]) {
    assert.ok(!html.includes(String(n)) && !seen.includes(String(n)), `رقمُ مالٍ قطاعي (${n}) على الوجه الشخصي`);
  }
});
