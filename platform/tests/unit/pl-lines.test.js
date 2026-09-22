// وحدة: سطور قائمة الدخل — الكتابة والبوابات والقراءة والمطابقة، على قاعدة مصغّرة محكومة.
//
// ما تحرسه هذه الاختبارات بالذات:
//   • الصفر المُدخَل ليس فراغاً، وغيابُ الصفّ ليس صفراً — وهذه القاعدة هي كل الفرق بين
//     «أُقفل الشهر ولا صرف» و«لم يُدخَل بعد»، وعليها يُبنى «مجمل الربح».
//   • الإصدار يرتفع مع التصحيح، والأثر يُكتب مرتين — فالرقم المُصحَّح يُعرف بعد شهر.
//   • «تكلفة الإيراد» و«مجمل الربح» لا يُكتبان: محسوبان لا مُدخَلان.
//   • قائد قطاعٍ لا يكتب في قطاع غيره، ومن لا يرى التكلفة لا يكتبها ولا يقرؤها.
//   • الخطة للقطاع كلّه: قصُّ الشاشة على مشروع يُفرِّغ الكلفة محقّقةً وخطةً.
//   • المطابقة تقول «متقاربان» أو «بينهما فرق» بعتبتين من مصدرهما الواحد، ولا تقابل بندياً
//     إلا ما يُسجَّل في سند على مشروع.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-pll-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, get, all, run, close } = await import('../../src/core/db/index.js');

// دورٌ اختباري يقرأ سطور قائمة الدخل والإيراد **بلا بوابة التكلفة** — لا يوجد في المصفوفة دورٌ
// بهذه التوليفة، وبناؤه في القاعدة أصدق من تزوير قرار المحرّك.
await run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_plrev','قارئ إيرادٍ بلا تكلفة','PL Revenue Only',0,'2026-01-01T00:00:00.000Z')");
for (const r of ['pl_line', 'revenue_line']) {
  await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_plrev', r, 'read', 'sector']);
}
// ودورٌ ثانٍ يكتب سطور قائمة الدخل ويرى الكلفة **بلا الهامش** — توليفةٌ لا تمنحها المصفوفة
// لأحد، وبناؤها هنا هو ما يُثبت أن بوابة الكتابة تسأل عن البابين لا عن واحد.
await run("INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES ('t_plcost','كاتبٌ بلا هامش','PL Cost Only',0,'2026-01-01T00:00:00.000Z')");
for (const [resource, action] of [['pl_line', 'read'], ['pl_line', 'create'], ['pl_line', 'update'], ['cost', 'read']]) {
  await run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)', ['t_plcost', resource, action, 'sector']);
}
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();

const {
  savePlActuals, savePlPlan, deletePlLine, listPlLines,
  loadCostActuals, loadCostPlans, monthlyPlLines, closedThrough, reconcile, RECON_THRESHOLDS,
} = await import('../../src/modules/finance/pl-lines.js');
const { PL_RECON_MIN_HALALAS, PL_RECON_PCT } = await import('../../src/core/i18n/thresholds.js');

const T = '2026-01-10T08:00:00.000Z';
const YR = 2026;
const lead = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'S1', scope: 'sector' };
const lead2 = { id: 'u_lead2', role_id: 'sector_lead', sector_id: 'S2', scope: 'sector' };
const deptMgr = { id: 'u_dm', role_id: 'department_manager', sector_id: 'S1', scope: 'department' };
const revOnly = { id: 'u_rev', role_id: 't_plrev', sector_id: 'S1', scope: 'sector' };
const costNoMargin = { id: 'u_costnm', role_id: 't_plcost', sector_id: 'S1', scope: 'sector' };
const ctx = { user: lead, ip: '10.0.0.9' };
const ctx2 = { user: lead2, ip: '10.0.0.8' };
const ctxDm = { user: deptMgr, ip: '10.0.0.7' };

const auditCount = async (resourceId) => (await get(
  "SELECT COUNT(*) n FROM audit_log WHERE resource = 'pl_line' AND resource_id = ?", [resourceId])).n;

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع أ', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'S2', name_ar: 'قطاع ب', active: 1, sort_order: 2, created_at: T });
  await insert('project', { id: 'P1', name_ar: 'مشروع أ', sector_id: 'S1', status: 'IN_PROGRESS', created_at: T });
  // الصفّ يحمل كاتبه (`created_by`/`updated_by` إلى `app_user`) — فالحسابات موجودةٌ فعلاً،
  // ولا يُمرَّر معرّفٌ لا يقابله أحد في الدفاتر.
  for (const u of [lead, lead2]) {
    await insert('app_user', { id: u.id, username: u.id, name_ar: 'حساب اختباري',
      role_id: u.role_id, sector_id: u.sector_id, scope: u.scope, active: 1, created_at: T });
  }

  // ── ما أقفلته المالية على قطاع أ ──
  // رواتب: يناير 1,000,000 هللة، وفبراير **صفرٌ مُدخَل** (أُقفل ولا صرف).
  // مستشارون: يناير 500,000. تراخيص: مارس 2,000,000. وإيرادٌ معتمَد من المالية في يناير.
  await savePlActuals(ctx, { sectorId: 'S1', year: YR, rows: [
    { month: 1, line_key: 'sal', amount_halalas: 1_000_000 },
    { month: 2, line_key: 'sal', amount_halalas: 0, note: 'أُقفل الشهر بلا صرف' },
    { month: 1, line_key: 'con', amount_halalas: 500_000 },
    { month: 3, line_key: 'lic', amount_halalas: 2_000_000 },
    { month: 1, line_key: 'rev', amount_halalas: 9_000_000 },
  ] });
  // خطةٌ للرواتب: 100,000 لكل شهر ⇒ سنةٌ 1,200,000.
  await savePlPlan(ctx, { sectorId: 'S1', year: YR,
    rows: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, line_key: 'sal', amount_halalas: 100_000 })) });

  // ── ما سجّله أهل المشاريع في سند نفسه ──
  await insert('expense', { id: 'E1', sector_id: 'S1', project_id: 'P1', type: 'أتعاب مستشار',
    category: 'con', amount_halalas: 575_000, net_amount_halalas: 500_000,
    incurred_year: YR, incurred_month: 1, status: 'APPROVED', created_at: T });
  await insert('expense', { id: 'E2', sector_id: 'S1', project_id: 'P1', type: 'أتعاب مستشار',
    category: 'con', amount_halalas: 400_000, incurred_year: YR, incurred_month: 1,
    status: 'DRAFT', created_at: T });                 // لم يُعتمد ⇒ ليس كلفةً بعد
  await insert('expense', { id: 'E3', sector_id: 'S1', project_id: 'P1', type: 'تعاقد باطني',
    category: 'ctr', amount_halalas: 300_000, incurred_year: YR, incurred_month: 2,
    status: 'PAID', created_at: T });
  await insert('expense', { id: 'E4', sector_id: 'S1', project_id: 'P1', type: 'ترخيص منصة',
    category: 'lic', amount_halalas: 1_000_000, incurred_year: YR, incurred_month: 3,
    status: 'APPROVED', created_at: T });
  await insert('expense', { id: 'E5', sector_id: 'S1', project_id: 'P1', type: 'متنوعة',
    category: 'oth', amount_halalas: 50_000, incurred_year: YR, incurred_month: null,
    status: 'APPROVED', created_at: T });               // بلا شهر ⇒ خارج المقارنة، ويُقال صراحةً
  await insert('cost_line', { id: 'CL1', sector_id: 'S1', project_id: 'P1', type: 'رواتب',
    category: 'sal', amount_halalas: 1_000_000, year: YR, month: 1, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── الكتابة ─────────────────────────────────────────────────────────────────────────────

test('الإدخال ثم التصحيح: إصدارٌ يرتفع وأثرٌ يُكتب مرتين', async () => {
  const created = await savePlActuals(ctx, { sectorId: 'S1', year: YR,
    rows: [{ month: 6, line_key: 'rent', amount_halalas: 700_000 }] });
  assert.equal(created.saved.length, 1);
  const first = created.saved[0];
  assert.equal(first.action, 'create');
  assert.equal(first.before, null);
  assert.equal(Number(first.after.revision), 1);
  assert.equal(Number(first.after.amount_halalas), 700_000);
  assert.equal(first.after.created_by, 'u_lead');
  assert.equal(await auditCount(first.resourceId), 1);

  const fixed = await savePlActuals(ctx, { sectorId: 'S1', year: YR,
    rows: [{ month: 6, line_key: 'rent', amount_halalas: 750_000, note: 'تصحيح الإيجار' }] });
  const second = fixed.saved[0];
  assert.equal(second.action, 'update');
  assert.equal(second.resourceId, first.resourceId, 'المفتاح متفرّد: تُحدَّث الصفّ نفسه ولا يُضاف ثانٍ بجانبه');
  assert.equal(Number(second.after.revision), 2);
  assert.equal(Number(second.after.amount_halalas), 750_000);
  assert.equal(Number(second.before.amount_halalas), 700_000);
  assert.equal(second.after.updated_by, 'u_lead');
  assert.equal(await auditCount(first.resourceId), 2);

  const rows = await all("SELECT id FROM pl_line_amount WHERE sector_id='S1' AND year=? AND month=6 AND line_key='rent' AND kind='actual'", [YR]);
  assert.equal(rows.length, 1);

  // والحذف الفعلي (تراجع الرفعة) يسحب الصفّ ويكتب أثره ثالثاً.
  const removed = await deletePlLine(ctx, first.resourceId);
  assert.equal(removed.action, 'delete');
  assert.ok(!(await get("SELECT id FROM pl_line_amount WHERE id = ?", [first.resourceId])));
  assert.equal(await auditCount(first.resourceId), 3);
});

test('المحسوب لا يُدخَل، والشهر والمبلغ والنوع تُردّ برسالة عربية', async () => {
  const bad = async (rows, re) => assert.rejects(
    () => savePlActuals(ctx, { sectorId: 'S1', year: YR, rows }), (e) => { assert.match(e.message, re); return e.status === 400; });
  await bad([{ month: 1, line_key: 'cor', amount_halalas: 10 }], /تكلفة الإيراد/);
  await bad([{ month: 1, line_key: 'gp', amount_halalas: 10 }], /مجمل الربح/);
  await bad([{ month: 1, line_key: 'xx', amount_halalas: 10 }], /بنود قائمة الدخل/);
  await bad([{ month: 13, line_key: 'sal', amount_halalas: 10 }], /الشهر/);
  await bad([{ month: 0, line_key: 'sal', amount_halalas: 10 }], /الشهر/);
  await bad([{ month: 1, line_key: 'sal', amount_halalas: -1 }], /سالب/);
  await bad([{ month: 1, line_key: 'sal', amount_halalas: 12.5 }], /صحيحاً بالهللة/);
  await bad([], /سطور للحفظ/);
  // تكرار (شهر، بند) في الدفعة نفسها: يُردّ قبل الكتابة لا يُكتب فوق نفسه صامتاً.
  await bad([{ month: 7, line_key: 'oth', amount_halalas: 10 }, { month: 7, line_key: 'oth', amount_halalas: 20 }], /تكرّر/);
  assert.ok(!(await get("SELECT id FROM pl_line_amount WHERE sector_id='S1' AND month=7 AND line_key='oth'")));
});

test('البوابتان: قطاعٌ غير قطاعه، ودورٌ بلا منح، وقارئٌ بلا بوابة تكلفة', async () => {
  const rows = [{ month: 4, line_key: 'oth', amount_halalas: 1000 }];
  await assert.rejects(() => savePlActuals(ctx2, { sectorId: 'S1', year: YR, rows }), (e) => e.status === 403);
  await assert.rejects(() => savePlActuals(ctxDm, { sectorId: 'S1', year: YR, rows }), (e) => e.status === 403);
  await assert.rejects(() => savePlActuals({ user: revOnly }, { sectorId: 'S1', year: YR, rows }), (e) => e.status === 403);
  await assert.rejects(() => savePlActuals({ user: null }, { sectorId: 'S1', year: YR, rows }), (e) => e.status === 403);
  assert.ok(!(await get("SELECT id FROM pl_line_amount WHERE sector_id='S1' AND month=4 AND line_key='oth'")));
  // وقائد قطاع ب يكتب في قطاعه هو بلا اعتراض — فالرفض أعلاه عن القطاع لا عن الدور.
  const ok = await savePlActuals(ctx2, { sectorId: 'S2', year: YR, rows });
  assert.equal(ok.saved[0].action, 'create');
});

// بوابةُ الكتابة تسأل عن البابين معاً كما تسأل عنهما القراءة: من يرى الكلفة ولا يرى الهامش
// يكتب رقماً يغيّر مجمل الربح ولا يرى ما غيّره — فلا يُفتح له باب الكتابة نصفَ فتحة.
test('بوابة الكتابة: كلفةٌ بلا هامش لا تكتب سطراً ولا تحذفه', async () => {
  const c = { user: costNoMargin, ip: '10.0.0.6' };
  const rows = [{ month: 6, line_key: 'oth', amount_halalas: 9000 }];
  await assert.rejects(() => savePlActuals(c, { sectorId: 'S1', year: YR, rows }), (e) => e.status === 403);
  await assert.rejects(() => savePlPlan(c, { sectorId: 'S1', year: YR, rows }),
    (e) => e.status === 403 && /أرقام التكلفة خارج صلاحيتك/.test(e.message));
  assert.ok(!(await get("SELECT id FROM pl_line_amount WHERE sector_id='S1' AND month=6 AND line_key='oth'")),
    'لا صفّ كُتب رغم منح الإضافة على القطاع');
  const victim = await get("SELECT id FROM pl_line_amount WHERE sector_id='S1' AND line_key='sal' AND month=1");
  await assert.rejects(() => deletePlLine(c, victim.id), (e) => e.status === 403);
  assert.ok(await get('SELECT id FROM pl_line_amount WHERE id = ?', [victim.id]), 'الصفّ باقٍ');
});

test('القراءة المحكومة: سطور الكلفة تُحذف عمّن لا يملك بوابتها', async () => {
  const full = await listPlLines(lead, 'S1', YR, { kind: 'actual' });
  assert.ok(full.some((r) => r.line_key === 'sal'));
  assert.ok(full.some((r) => r.line_key === 'rev'));
  assert.equal(full[0].ar, 'الإيراد');                   // الاسم العربي معه، لا المفتاح وحده

  const limited = await listPlLines(revOnly, 'S1', YR, {});
  assert.ok(limited.length > 0);
  assert.ok(limited.every((r) => r.line_key === 'rev'), 'من لا يرى التكلفة لا تصله سطورها أصلاً');

  await assert.rejects(() => listPlLines(lead2, 'S1', YR, {}), (e) => e.status === 403);
  await assert.rejects(() => listPlLines(null, 'S1', YR, {}), (e) => e.status === 403);
});

// ── المحمِّلان ──────────────────────────────────────────────────────────────────────────

test('صفرٌ مُدخَل صفر، وغيابُ الصفّ فراغ', async () => {
  const feb = await loadCostActuals('S1', YR, [2], {});
  assert.equal(feb.sal.period, 0, 'صفٌّ موجود بصفر يعود صفراً — لا فراغاً');
  assert.equal(feb.con.period, null, 'لا صفّ لمستشاري فبراير ⇒ فراغ لا صفر');
  assert.equal(feb.rent.period, null);
  assert.deepEqual(Object.keys(feb).sort(), ['con', 'ctr', 'lic', 'oth', 'rent', 'sal']);
});

test('الفترة شيء و«حتى تاريخه» شيء', async () => {
  const jan = await loadCostActuals('S1', YR, [1, 2], {});
  assert.equal(jan.sal.period, 1_000_000);
  assert.equal(jan.sal.ytd, 1_000_000);
  assert.equal(jan.lic.period, null, 'التراخيص في مارس، خارج الفترة');
  assert.equal(jan.lic.ytd, null, '«حتى تاريخه» تقف عند آخر شهرٍ في الفترة (فبراير)');

  const mar = await loadCostActuals('S1', YR, [3], {});
  assert.equal(mar.sal.period, null, 'لا رواتب مُدخلة لمارس');
  assert.equal(mar.sal.ytd, 1_000_000, 'ويناير وفبراير داخلان في «حتى تاريخه»');
  assert.equal(mar.lic.period, 2_000_000);
  assert.equal(mar.lic.ytd, 2_000_000);
});

test('المقصوص على مشروعٍ أو عميلٍ أو إدارة: الكلفة فارغة محقّقةً وخطةً', async () => {
  for (const scope of [{ project: 'P1' }, { client: 'C1' }, { dept: 'D1' }]) {
    const a = await loadCostActuals('S1', YR, [1], scope);
    const p = await loadCostPlans('S1', YR, [1], scope);
    assert.ok(Object.values(a).every((v) => v.period === null && v.ytd === null));
    assert.ok(Object.values(p).every((v) => v.fy === null && v.period === null));
  }
});

test('الخطة: سنةً كاملةً وفترةً، وفراغٌ لبندٍ بلا خطة', async () => {
  const p = await loadCostPlans('S1', YR, [1, 2, 3], {});
  assert.equal(p.sal.fy, 1_200_000);
  assert.equal(p.sal.period, 300_000);
  assert.equal(p.con.fy, null);
  assert.equal(p.con.period, null);
  const full = await loadCostPlans('S1', YR, [], {});
  assert.equal(full.sal.period, 1_200_000, 'فترةٌ بلا أشهر = السنة كاملة');
});

test('الصورة الشهرية: اثنا عشر شقّاً لكل بند، والشهر بلا صفٍّ فارغ', async () => {
  const m = await monthlyPlLines('S1', YR);
  assert.deepEqual(Object.keys(m).sort(), ['con', 'ctr', 'lic', 'oth', 'rent', 'rev', 'sal']);
  assert.equal(m.sal.actual.length, 12);
  assert.equal(m.sal.plan.length, 12);
  assert.equal(m.sal.actual[0], 1_000_000);
  assert.equal(m.sal.actual[1], 0);
  assert.equal(m.sal.actual[2], null);
  assert.deepEqual(m.sal.plan, Array(12).fill(100_000));
  assert.equal(m.rev.actual[0], 9_000_000);
  assert.deepEqual(m.rev.plan, Array(12).fill(null));
});

// ── شهر الإقفال ─────────────────────────────────────────────────────────────────────────

test('آخر شهرٍ مغلق: مشتقٌّ من الرفعة، ثم تجاوزٌ صريح يعلوه', async () => {
  const derived = await closedThrough('S1', YR);
  assert.deepEqual(derived, { month: 3, source: 'derived' }, 'آخر شهرٍ فيه كلفةٌ مُدخلة');
  assert.deepEqual(await closedThrough('S2', 2030), { month: null, source: null });

  await insert('budget', { id: 'B1', sector_id: 'S1', fiscal_year: YR,
    target_revenue_halalas: 1_200_000, target_sales_halalas: 0, created_at: T });
  assert.deepEqual(await closedThrough('S1', YR), { month: 3, source: 'derived' },
    'مستهدفٌ بلا تجاوز يعني «اقرأ المشتقّ» لا «لا شهر مغلق»');

  await run('UPDATE budget SET closed_through_month = ? WHERE id = ?', [2, 'B1']);
  assert.deepEqual(await closedThrough('S1', YR), { month: 2, source: 'override' });
  await run('UPDATE budget SET closed_through_month = NULL WHERE id = ?', ['B1']);
});

// ── المطابقة ────────────────────────────────────────────────────────────────────────────

test('المطابقة شهراً بشهر: العتبتان معاً، وأوسعهما تحكم', async () => {
  const r = await reconcile('S1', YR);
  assert.equal(r.months.length, 12, 'اثنا عشر شهراً دائماً — شكل السنة لا يتغيّر بما أُدخل منها');

  const m1 = r.months[0];
  assert.equal(m1.fin_cor, 1_500_000);          // رواتب 1,000,000 + مستشارون 500,000
  assert.equal(m1.sanad_cor, 1_500_000);        // بند كلفة 1,000,000 + مصروف صافٍ 500,000 (والمسودة خارجة)
  assert.equal(m1.diff, 0);
  assert.equal(m1.pct, 0);
  assert.equal(m1.match, true);

  const m2 = r.months[1];
  assert.equal(m2.fin_cor, 0, 'صفرٌ مُدخَل للرواتب — لا فراغ');
  assert.equal(m2.sanad_cor, 300_000);
  assert.equal(m2.diff, -300_000);
  assert.equal(m2.pct, null, 'لا نسبة على مقامٍ صفر');
  assert.equal(m2.match, true, 'الفرق دون حدّ الخمسة آلاف ريال ⇒ متقاربان');

  const m3 = r.months[2];
  assert.equal(m3.fin_cor, 2_000_000);
  assert.equal(m3.sanad_cor, 1_000_000);
  assert.equal(m3.diff, 1_000_000);
  assert.equal(m3.pct, 50);
  assert.equal(m3.match, false, 'مليونُ هللة فوق أوسع العتبتين');

  const m4 = r.months[3];
  assert.deepEqual([m4.fin_cor, m4.sanad_cor, m4.diff, m4.match], [null, 0, null, null],
    'شهرٌ لم تُدخله المالية لا يُحكم عليه');

  // حافة العتبة: فرقٌ يساوي الحدّ الأدنى بالضبط مطابق، وواحدٌ فوقه ليس كذلك.
  const big = PL_RECON_MIN_HALALAS * 1000;      // نصف بالمئة منه = 5,000,000 هللة > الحد الأدنى
  assert.equal(RECON_THRESHOLDS.min_halalas, PL_RECON_MIN_HALALAS);
  assert.equal(RECON_THRESHOLDS.pct, PL_RECON_PCT);
  const { plReconMatch } = await import('../../src/core/i18n/thresholds.js');
  assert.equal(plReconMatch(100_000, PL_RECON_MIN_HALALAS), true);
  assert.equal(plReconMatch(100_000, PL_RECON_MIN_HALALAS + 1), false);
  assert.equal(plReconMatch(big, (big * PL_RECON_PCT) / 100), true);
  assert.equal(plReconMatch(big, (big * PL_RECON_PCT) / 100 + 1), false);
  assert.equal(plReconMatch(null, 5), null);
});

test('المطابقة مجاميعَ وبنوداً: ما لا يُقابَل يُقال سببه', async () => {
  const r = await reconcile('S1', YR);
  assert.equal(r.totals.fin_cor, 3_500_000);
  assert.equal(r.totals.sanad_cor, 2_800_000);
  assert.equal(r.totals.diff, 700_000);
  assert.equal(r.totals.pct, 20);
  assert.equal(r.totals.match, false);
  assert.equal(r.totals.sanad_unmonthed_halalas, 50_000, 'صرفٌ بلا شهر يُقال صراحةً ولا يختفي');
  assert.equal(r.totals.months_entered, 3);

  const byKey = Object.fromEntries(r.by_line.map((l) => [l.key, l]));
  assert.deepEqual(r.by_line.map((l) => l.key), ['sal', 'con', 'ctr', 'lic', 'rent', 'oth']);
  for (const k of ['con', 'ctr', 'lic']) assert.equal(byKey[k].comparable, true, k);
  for (const k of ['sal', 'rent', 'oth']) assert.equal(byKey[k].comparable, false, k);
  assert.equal(byKey.sal.reason, 'الرواتب من المالية فقط');
  assert.equal(byKey.rent.reason, 'مصروف قطاع لا يُسجَّل على مشروع');
  assert.equal(byKey.oth.reason, 'مصروف قطاع لا يُسجَّل على مشروع');
  assert.equal(byKey.con.reason, null);

  assert.deepEqual([byKey.con.fin, byKey.con.sanad], [500_000, 500_000]);
  assert.deepEqual([byKey.ctr.fin, byKey.ctr.sanad], [null, 300_000], 'بندٌ في سند بلا مقابلٍ من المالية');
  assert.deepEqual([byKey.lic.fin, byKey.lic.sanad], [2_000_000, 1_000_000]);
  assert.deepEqual([byKey.sal.fin, byKey.sal.sanad], [1_000_000, 1_000_000]);
  assert.deepEqual([byKey.rent.fin, byKey.rent.sanad], [null, null]);
  assert.equal(byKey.oth.sanad, null, 'مصروفُ «أخرى» بلا شهر لا يُنسب إلى بند');
  assert.equal(byKey.sal.ar, 'رواتب التشغيل');
});
