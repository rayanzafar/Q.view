// ── تصحيح علامة المرآة على قطاعٍ حُمِّل من خارج المنصة ────────────────────────
// مرايا مشاريع حُمِّلت بعلامةٍ غير `project` لا تتبع مشاريعها أبداً (`syncMirrorFromProject`
// لا تعرف اتجاه الحقيقة إلا بالعلامة) — فتُقرأ في المبيعات قيمةٌ قديمة. والعلاج بالبيانات:
// تُقلب العلامة حيث تُثبت القرائنُ الولادة من المشروع، **ولا تُقلب** على فرصةٍ باعها إنسان —
// فقلبُها يجعل أول تعديلٍ للمشروع يمحو رقم البيع الذي كتبه.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mirrorfix-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, fix;
const T0 = '2026-01-05T08:00:00Z';   // الفرصة اليدوية سبقت مشروعها
const T1 = '2026-02-01T10:00:00Z';   // لحظة التحميل: المشروع ومرآته معاً
const T2 = '2026-02-10T10:00:00Z';   // مشروع الفرصة اليدوية وُلد لاحقاً
const TB = '2026-06-18T11:22:29.008Z'; // دفعةُ الفرص المحمَّلة — لحظةٌ واحدة لكل الصفوف
const TB2 = '2026-07-20T07:58:09.100Z'; // ومشاريعها حُمِّلت بعدها بشهر
const H = (sar) => Math.round(sar * 100);

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  fix = await import('../../scripts/fix-mirror-source.mjs');

  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T0 });
  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', active: 1, created_at: T0 });
  await db.insert('app_user', { id: 'u_sys', username: 'sysadmin', email: 'sysadmin@test.sa',
    name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: null, active: 1, created_at: T0 });
  for (const [id, ar, won, lost, ord] of [['LEAD', 'ترشيح', 0, 0, 1], ['WON', 'مكسوبة', 1, 0, 9], ['LOST', 'مفقودة', 0, 1, 10]]) {
    await db.insert('stage', { id, name_ar: ar, default_win_pct: won ? 100 : 10, sort_order: ord, is_won: won, is_lost: lost });
  }

  // ① مرآةٌ محمَّلة قيمتُها تخلّفت عن عقد مشروعها — الحالة التي أبلغ عنها القطاع.
  await mirrorPair({ o: 'o_imp1', p: 'p_imp1', title: 'قياس ١٤ — العلا',
    oppValue: H(1_282_343), contract: H(1_474_694.5) });
  // ② مرآةٌ محمَّلة قيمتُها مطابقة — تُصحَّح علامتها ولا يتحرك رقمها.
  await mirrorPair({ o: 'o_imp2', p: 'p_imp2', title: 'مشروع مطابق', oppValue: H(500_000), contract: H(500_000) });
  // ③ فرصةٌ باعها إنسان ثم وُلد منها مشروع — تُستبعَد وإن كان الرابط الخلفي موجوداً.
  await db.insert('opportunity', { id: 'o_manual', title_ar: 'صفقة باعها إنسان', client_id: 'CL',
    sector_id: 'CONS', stage_id: 'WON', win_pct: 100, value_halalas: H(900_000), year: 2026,
    source: 'manual', exclude_from_sales: 0, stage_changed_at: T2, created_at: T0, created_by: 'u_sys' });
  await db.insert('opportunity_stage_history', { id: 'osh_m1', opportunity_id: 'o_manual',
    from_stage_id: null, to_stage_id: 'LEAD', changed_by: 'u_sys', changed_at: T0 });
  await db.insert('opportunity_stage_history', { id: 'osh_m2', opportunity_id: 'o_manual',
    from_stage_id: 'LEAD', to_stage_id: 'WON', changed_by: 'u_sys', changed_at: T2, note: 'فوز' });
  await db.insert('project', { id: 'p_manual', name_ar: 'مشروع الصفقة', sector_id: 'CONS', client_id: 'CL',
    source_opp_id: 'o_manual', status: 'IN_PROGRESS', kind: 'external',
    contract_value_halalas: H(1_200_000), created_at: T2, created_by: 'u_sys' });

  // ④ قطاعٌ آخر: دفعةٌ حُمِّلت كلها في لحظةٍ واحدة، ومشاريعُها حُمِّلت بعدها بشهر — وهي حال
  //    قطاع الاستشارات على بيئة التجربة. أسبقيةُ الفرص هنا أسبقيةُ تحميلٍ لا أسبقيةُ بيع.
  await db.insert('sector', { id: 'CONS2', name_ar: 'قطاع محمَّل', kind: 'delivery', active: 1, created_at: T0 });
  for (let i = 1; i <= 3; i++) {
    await db.insert('opportunity', { id: `o_b${i}`, title_ar: `مشروع محمَّل ${i}`, client_id: 'CL',
      sector_id: 'CONS2', stage_id: 'WON', win_pct: 100, value_halalas: H(1_000_000), year: 2026,
      source: 'CONS_IMPORT', exclude_from_sales: 0, stage_changed_at: TB, created_at: TB, created_by: null });
    await db.insert('project', { id: `p_b${i}`, name_ar: `مشروع محمَّل ${i}`, sector_id: 'CONS2', client_id: 'CL',
      source_opp_id: `o_b${i}`, status: 'IN_PROGRESS', kind: 'external',
      contract_value_halalas: i === 1 ? H(1_100_000) : H(1_000_000), created_at: TB2, created_by: null });
  }
});

async function mirrorPair({ o, p, title, oppValue, contract }) {
  await db.insert('opportunity', { id: o, title_ar: title, client_id: 'CL', sector_id: 'CONS',
    stage_id: 'WON', win_pct: 100, value_halalas: oppValue, year: 2026, source: 'CONS_IMPORT',
    exclude_from_sales: 0, stage_changed_at: T1, created_at: T1, created_by: 'u_sys' });
  await db.insert('opportunity_stage_history', { id: `osh_${o}`, opportunity_id: o,
    from_stage_id: null, to_stage_id: 'WON', changed_by: 'u_sys', changed_at: T1 });
  await db.insert('project', { id: p, name_ar: title, sector_id: 'CONS', client_id: 'CL',
    source_opp_id: o, status: 'IN_PROGRESS', kind: 'external',
    contract_value_halalas: contract, created_at: T1, created_by: 'u_sys' });
}

after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const src = async (id) => (await db.get('SELECT source FROM opportunity WHERE id = ?', [id])).source;
const val = async (id) => (await db.get('SELECT value_halalas FROM opportunity WHERE id = ?', [id])).value_halalas;

// ── المعاينة ────────────────────────────────────────────────────────────────
test('المعاينة تكشف المرايا بالرابط الخلفي وتستبعد ما باعه إنسان — ولا تكتب صفّاً واحداً', async () => {
  const before = await fix.counters('CONS');
  const auditsBefore = (await db.get('SELECT COUNT(*) n FROM audit_log')).n;

  const plan = await fix.planFix({ sectorId: 'CONS', year: 2026 });
  assert.equal(plan.fix.length, 2, 'المرآتان المحمَّلتان وحدهما');
  assert.deepEqual(plan.fix.map((r) => r.o_id).sort(), ['o_imp1', 'o_imp2']);
  assert.equal(plan.excluded.length, 1);
  assert.equal(plan.excluded[0].o_id, 'o_manual');
  assert.ok(plan.excluded[0].ev.blockers.length, 'ويُذكر المانع صراحةً لا صمتاً');

  assert.equal(plan.salesBefore, H(1_282_343) + H(500_000) + H(900_000));
  assert.equal(plan.expectedAfter, H(1_474_694.5) + H(500_000) + H(900_000));

  // التنفيذ لا يقع بلا `--apply`.
  const done = await fix.applyFix(plan, { apply: false, actor: null });
  assert.equal(done.flipped, 0);
  assert.deepEqual(await fix.counters('CONS'), before, 'العدّادات كما هي قبل المعاينة وبعدها');
  assert.equal((await db.get('SELECT COUNT(*) n FROM audit_log')).n, auditsBefore);
  assert.equal(await src('o_imp1'), 'CONS_IMPORT');
  assert.equal(await val('o_imp1'), H(1_282_343));
});

// ── التنفيذ ─────────────────────────────────────────────────────────────────
test('التنفيذ يقلب العلامة ثم تتبع المرآةُ مشروعها — والقيمة تُنقل بالخدمة لا باليد', async () => {
  const actor = await db.get('SELECT * FROM app_user WHERE id = ?', ['u_sys']);
  const plan = await fix.planFix({ sectorId: 'CONS', year: 2026 });
  const done = await fix.applyFix(plan, { apply: true, actor });
  assert.equal(done.flipped, 2);
  assert.equal(done.resynced, 1, 'المرآة المطابقة لا تُكتب مرتين بلا سبب');

  assert.equal(await src('o_imp1'), 'project');
  assert.equal(await src('o_imp2'), 'project');
  assert.equal(await val('o_imp1'), H(1_474_694.5), 'قيمة المشروع وصلت مرآتَها أخيراً');
  assert.equal(await val('o_imp2'), H(500_000));

  assert.equal(await fix.sectorWonTotal('CONS', 2026), plan.expectedAfter);
});

test('والفرصة التي باعها إنسان لم تُمسّ — لا علامتها ولا قيمتها', async () => {
  assert.equal(await src('o_manual'), 'manual');
  assert.equal(await val('o_manual'), H(900_000), 'رقم البيع باقٍ رغم أن عقد مشروعه 1.2 مليون');
});

test('لكل صفٍّ صُحِّح سطرُ تدقيق يقول من أين وإلى أين', async () => {
  for (const o of ['o_imp1', 'o_imp2']) {
    const rows = await db.all(
      `SELECT detail_json FROM audit_log WHERE resource = 'opportunity' AND resource_id = ? AND action = 'update'`, [o]);
    const flip = rows.map((r) => JSON.parse(r.detail_json)).find((d) => d.fix === 'mirror_source');
    assert.ok(flip, `سطر التدقيق موجود لـ ${o}`);
    assert.equal(flip.from, 'CONS_IMPORT');
    assert.equal(flip.to, 'project');
    assert.ok(flip.evidence.length, 'ومعه القرائن التي بُني عليها القرار');
  }
});

test('وإعادة التشغيل لا تجد ما تُصحِّح — العملية تُعاد بلا أثرٍ مضاعف', async () => {
  const plan = await fix.planFix({ sectorId: 'CONS', year: 2026 });
  assert.equal(plan.fix.length, 0);
  assert.equal(plan.excluded.length, 1, 'تبقى المستبعَدة معروضةً لقرار إنسان، ولا تُصحَّح');
  assert.equal(plan.salesBefore, plan.expectedAfter);
});

// ── الدفعة المحمَّلة: تُعرض ولا تُنفَّذ إلا بإذنٍ صريح ─────────────────────────
test('دفعةٌ سبقت مشاريعها بشهر لا تُقلب علامتها بالافتراض — تُعرض وحدها لقرار المالك', async () => {
  const plan = await fix.planFix({ sectorId: 'CONS2', year: 2026 });
  assert.equal(plan.fix.length, 0, 'لا شيء يُصحَّح بلا إذن');
  assert.equal(plan.pending.length, 3);
  assert.equal(plan.excluded.length, 0);
  assert.equal(plan.expectedAfter, plan.salesBefore, 'والمجموع لا يتحرك في المعاينة العادية');
  assert.equal(plan.pendingDelta, H(100_000), 'ويُذكر ما سيتحرك لو أُذن');
  assert.ok(plan.pending[0].ev.bulkLoad);
  assert.equal(plan.pending[0].ev.cohort, 3, 'قرينةُ الدفعة: ثلاث فرص في اللحظة نفسها');
  assert.equal(await src('o_b1'), 'CONS_IMPORT', 'ولم تُكتب');
});

test('وبالإذن الصريح تُقلب الدفعة وتتبع مشاريعها', async () => {
  const actor = await db.get('SELECT * FROM app_user WHERE id = ?', ['u_sys']);
  const plan = await fix.planFix({ sectorId: 'CONS2', year: 2026, trustBulkLoad: true });
  assert.equal(plan.fix.length, 3);
  assert.equal(plan.pending.length, 0);
  const done = await fix.applyFix(plan, { apply: true, actor });
  assert.equal(done.flipped, 3);
  assert.equal(await src('o_b1'), 'project');
  assert.equal(await val('o_b1'), H(1_100_000));
  assert.equal(await val('o_b2'), H(1_000_000));
  assert.equal(await fix.sectorWonTotal('CONS2', 2026), plan.expectedAfter);
});
