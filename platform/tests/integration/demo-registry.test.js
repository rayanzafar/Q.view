// سجلّ البيانات التجريبية — البذر يُسجَّل، والمحو لا يبلغ ما لم يُسجَّل.
//
// المطلب بلسان المالك: «لازم تحفظ كل السيناريوهات اللي سيبتها عشان البيانات الافتراضية لما
// اقلك امسحها تمسحها». والخطر الذي يحرسه هذا الملف ليس «هل يمحو» بل **«هل يمحو غير ما بُذر»**:
// أي محوٍ يعتمد على تخمين (اسمٌ ينتهي بـ«تجريبي»، تاريخُ إنشاءٍ بعد لحظة كذا) يُسقط يوماً صفاً
// حقيقياً — والصف الحقيقي المحذوف لا يُستعاد من رسالة اعتذار.
//
// ما يُثبَت هنا:
//   ١) البذر يُسجّل كل صفٍّ أدرجه (لا صفَّ تجريبياً بلا قيد).
//   ٢) الكشف يسبق المحو ويقول العدد بالعربية قبل أن يُنفَّذ شيء.
//   ٣) المحو يُزيل **كل** المسجَّل … و**لا شيء** غيره: صفوفٌ حقيقية بأسماء متشابهة عمداً
//      تبقى بعد المحو. هذا هو الفحص الذي يجب أن يسقط لو استُبدل السجل بمطابقة أسماء.
//   ٤) المحو مرتين لا يُخطئ: الثانية لا-عملية لا انهيار.
//   ٥) إعادة البذر بعد المحو تعمل — فالدورة كاملة لا اتجاه واحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-demoreg-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const quiet = async (fn) => {
  const log = console.log; console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};
const db = await import('../../src/core/db/index.js');
const { get, all, insert, close } = db;
const seedMod = await import('../../scripts/seed.js');
const { seedFixture } = await import('../../scripts/lib/seed-fixture.mjs');
await quiet(async () => { await seedMod.seed(); await seedFixture(); await seedMod.seedDemoOrg(); });
const { listBatches, previewPurge, purgeBatch, recordDemo } = await import('../../src/core/demo/registry.js');
const { seedScenarios, BATCH } = await import('../../scripts/seed-scenarios.mjs');

// صفوفٌ **حقيقية** تُزرع عمداً بأسماء تشبه التجريبي — الفخّ الذي يقع فيه أي محوٍ بمطابقة اسم.
const REAL = {
  client: 'ct_real_trap',
  task: 'tk_real_trap',
  opportunity: 'op_real_trap',
};
before(async () => {
  const now = new Date().toISOString();
  await insert('client', { id: REAL.client, name_ar: 'جهة تجريبية للاختبار (حقيقية)', active: 1, created_at: now });
  await insert('task', { id: REAL.task, title: 'مراجعة وثيقة المتطلبات مع الجهة', status: 'TODO', priority: 'P2', created_at: now });
  await insert('opportunity', { id: REAL.opportunity, title_ar: 'تطوير منصة تجربة الزائر', client_id: REAL.client, value_halalas: 0, created_at: now });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('البذر يسجّل كل صفٍّ أدرجه — لا صفَّ تجريبياً بلا قيد', async () => {
  const res = await quiet(() => seedScenarios({ quiet: true }));
  assert.ok(res.added > 30, `عدد الصفوف المبذورة ${res.added}`);
  const registered = await get('SELECT COUNT(*) n FROM demo_record WHERE batch = ?', [BATCH]);
  assert.equal(Number(registered.n), res.added, 'كل صفٍّ أُدرج له قيد في السجل');
});

test('الكشف يقول ما سيُمحى بالعربية قبل أن يُمحى شيء', async () => {
  const pv = await previewPurge(BATCH);
  assert.ok(pv.total > 30);
  assert.ok(pv.items.length >= 5, 'عدة جداول');
  // التسميات عربية لا أسماء جداول — الكشف يُقرأ بعين مالك لا مهندس
  for (const it of pv.items) assert.match(it.label, /[؀-ۿ]/, `«${it.table}» بلا تسمية عربية`);
  // ولم يُمحَ شيء بمجرّد الكشف
  const alive = await get('SELECT COUNT(*) n FROM demo_record WHERE batch = ? AND purged_at IS NULL', [BATCH]);
  assert.equal(Number(alive.n), pv.total);
});

test('الدفعات تُعرض بمقاديرها', async () => {
  const batches = await listBatches();
  const mine = batches.find((b) => b.batch === BATCH);
  assert.ok(mine, 'الدفعة ظاهرة في الكشف');
  assert.ok(mine.alive > 30);
  assert.ok(mine.tables.some((t) => t.table === 'task'), 'المهام ضمنها');
});

test('المحو يُزيل كل المسجَّل — ولا يمسّ صفاً حقيقياً بالاسم نفسه', async () => {
  const before = {
    tasks: Number((await get('SELECT COUNT(*) n FROM task'))?.n) || 0,
    opps: Number((await get('SELECT COUNT(*) n FROM opportunity'))?.n) || 0,
  };
  const res = await purgeBatch(BATCH);
  assert.equal(res.failed.length, 0, `تعذّر محو: ${JSON.stringify(res.failed.slice(0, 3))}`);
  assert.ok(res.purged > 30);

  // (أ) لا يبقى صفٌّ مسجَّل حيّاً
  const leftover = await all('SELECT table_name, row_id FROM demo_record WHERE batch = ? AND purged_at IS NULL', [BATCH]);
  assert.equal(leftover.length, 0, 'كل القيود مُحيت');
  // (ب) وفعلاً غادرت الجداول لا السجل وحده
  for (const r of await all('SELECT table_name, row_id FROM demo_record WHERE batch = ? LIMIT 20', [BATCH])) {
    const row = await get(`SELECT id FROM ${r.table_name} WHERE id = ?`, [r.row_id]);
    assert.equal(row, undefined, `${r.table_name}/${r.row_id} ما زال موجوداً`);
  }
  // (ج) **الفخّ**: الصفوف الحقيقية بأسماء متطابقة عمداً باقية كما هي
  for (const [table, rowId] of Object.entries(REAL)) {
    const row = await get(`SELECT id FROM ${table} WHERE id = ?`, [rowId]);
    assert.ok(row, `المحو أزال صفاً حقيقياً من ${table} — هذه هي الكارثة التي يمنعها السجل`);
  }
  assert.ok(before.tasks > 0 && before.opps > 0, 'كان في الجداول صفوف قبل المحو');
});

test('المحو مرتين لا يُخطئ — الثانية لا-عملية', async () => {
  const again = await purgeBatch(BATCH);
  assert.equal(again.purged, 0);
  assert.equal(again.failed.length, 0);
});

test('إعادة البذر بعد المحو تعمل — الدورة كاملة لا اتجاه واحد', async () => {
  const res = await quiet(() => seedScenarios({ quiet: true }));
  assert.ok(res.added > 30, 'بُذرت من جديد');
  const alive = await get('SELECT COUNT(*) n FROM demo_record WHERE batch = ? AND purged_at IS NULL', [BATCH]);
  assert.equal(Number(alive.n), res.added);
});

test('البذر لا يتكرّر فوق نفسه — تشغيلٌ ثانٍ بلا محو يُتخطّى', async () => {
  const res = await quiet(() => seedScenarios({ quiet: true }));
  assert.equal(res.added, 0);
  assert.equal(res.skipped, true);
});

test('تساوي أختام التسجيل لا يترك الآباء؛ والارتباط الحقيقي يمنع المحو', async () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const batch = 'same-timestamp-regression';
  await insert('client', { id: 'tie_client', name_ar: 'جهة', created_at: stamp });
  await insert('project', { id: 'tie_project', name_ar: 'مشروع', client_id: 'tie_client', created_at: stamp });
  await insert('contract', { id: 'tie_contract', project_id: 'tie_project', created_at: stamp });
  await insert('invoice', { id: 'tie_invoice', contract_id: 'tie_contract', project_id: 'tie_project', created_at: stamp });
  // Reverse dependency order, deliberately identical timestamps and adverse ids.
  for (const [key, table] of [['z', 'client'], ['y', 'project'], ['x', 'contract'], ['a', 'invoice']]) {
    await insert('demo_record', { id: 'tie_' + key, batch, table_name: table, row_id: 'tie_' + table, created_at: stamp });
  }
  const result = await purgeBatch(batch);
  assert.equal(result.purged, 4);
  assert.deepEqual(result.failed, []);
  assert.equal((await previewPurge(batch)).total, 0);

  await insert('client', { id: 'protected_demo', name_ar: 'تجريبي', created_at: stamp });
  await insert('opportunity', { id: 'real_dependency', client_id: 'protected_demo', title_ar: 'فرصة حقيقية', created_at: stamp });
  await recordDemo('protected-batch', 'client', 'protected_demo');
  const protectedResult = await purgeBatch('protected-batch');
  assert.equal(protectedResult.purged, 0);
  assert.equal(protectedResult.failed.length, 1);
  assert.ok(await get('SELECT id FROM opportunity WHERE id = ?', ['real_dependency']));
  assert.ok(await get('SELECT id FROM client WHERE id = ?', ['protected_demo']));
  assert.equal((await previewPurge('protected-batch')).total, 1);
});
