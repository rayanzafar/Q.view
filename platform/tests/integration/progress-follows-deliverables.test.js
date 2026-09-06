// العيب الذي رآه المالك بعينه على البيانات الحيّة، بأرقامه الحقيقية.
//
// اعتمد اثني عشر مخرَجاً من اثني عشر — مجموع أوزانها ١٠٠٪ — وبقيت الشاشة تقول «٥٨٪». والبطاقة
// تناقض نفسها في سطرين متجاورين: «الإنجاز التنفيذي ٥٨٪» فوق «١٢ من ١٢ مخرَجاً معتمَداً».
//
// السبب أن `progress_pct` المستورد من المنصة القديمة كان **يفوز دائماً** على المشتقّ من
// المخرجات. ونيّة القاعدة سليمة — قرار إنسان لا يُلغى باشتقاق — لكن الرقم هنا لم يكتبه إنسان
// في سند، ولا سبيل إلى تصحيحه من الواجهة (لا حقل لنسبة الإنجاز في صفحة المشروع). فالرقم
// المستورد يبقى أبداً، والعمل الحقيقي لا يحرّكه شيء: المنصة تُعاقِب من يستعملها.
//
// والحدّ الثاني الذي يثبّته الملف: **اللوحة وصفحة المشروع تقولان الرقم نفسه**. كانت اللوحة
// تشتقّ نسبتها باستعلامٍ خاص بها (المسلَّم **أو** المعتمَد، موزوناً بالمبلغ) وصفحةُ المشروع من
// `projectProgress` (المعتمَد وحده، بالأوزان المكتوبة إن كُتبت) — رقمان لمشروعٍ واحد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prog-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
  { env: process.env, stdio: 'ignore' });

let db, progress;
const T = new Date().toISOString();
// أوزان المشروع الحيّ نفسه، بالترتيب — مجموعها مئة بالضبط
const W = [4, 4, 4, 2, 2, 5, 19, 32, 3, 3, 21, 1];

before(async () => {
  db = await import('../../src/core/db/index.js');
  progress = await import('../../src/modules/pmo/progress.js');
  await db.insert('sector', { id: 'S', name_ar: 'قطاع', active: 1, created_at: T });
  // النسبة المستوردة ٥٨٪ — كما هي على البيانات الحيّة
  await db.insert('project', { id: 'p', name_ar: 'مشروع مستورد', sector_id: 'S', status: 'IN_PROGRESS',
    progress_pct: 58, contract_value_halalas: 2000000000, created_at: T });
  for (let i = 0; i < W.length; i++) {
    await db.insert('deliverable', { id: 'd' + i, project_id: 'p', name_ar: 'مخرَج ' + i,
      weight: W[i], amount_halalas: 100000 * W[i], status: 'ACCEPTED', month: 3, year: 2026, created_at: T });
  }
  await db.insert('project', { id: 'p_bare', name_ar: 'مشروع بلا مخرجات', sector_id: 'S',
    status: 'IN_PROGRESS', progress_pct: 40, created_at: T });
  await db.insert('project', { id: 'p_done', name_ar: 'مشروع مكتمل', sector_id: 'S',
    status: 'COMPLETED', progress_pct: 12, created_at: T });
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('اعتماد كل المخرجات يرفع الإنجاز إلى مئة — ولو حمل المشروع نسبةً مستوردة تخالفه', async () => {
  const r = await progress.projectProgress('p', { today: '2026-08-01' });
  assert.equal(r.delivery.total, 12);
  assert.equal(r.delivery.accepted, 12);
  assert.equal(r.delivery.acceptedPct, 100, 'الأوزان لا تجمع مئة — الفحص نفسه مبنيٌّ خطأً');
  assert.equal(r.executivePct, 100, 'الإنجاز بقي على الرقم المستورد رغم اعتماد كل المخرجات');
  assert.equal(r.executiveSource, 'deliverables', 'مصدر الرقم ما زال «المسجَّل» لا المخرجات');
  assert.equal(r.storedPct, 58, 'الرقم المستورد يُعاد بجانب المشتقّ لا يُخفى');
});

test('ونصفُ العمل يُقرأ نصفه — الرجوع بحالة مخرَجٍ ينزل بالنسبة فوراً', async () => {
  await db.run("UPDATE deliverable SET status='IN_PROGRESS' WHERE id='d7'");   // وزنه ٣٢٪
  const r = await progress.projectProgress('p', { today: '2026-08-01' });
  assert.equal(r.executivePct, 68, 'الرجوع بحالة مخرَج لا ينعكس على الإنجاز');
  await db.run("UPDATE deliverable SET status='ACCEPTED' WHERE id='d7'");
});

// القاعدة القديمة لم تُلغَ — صار لها موضعها الصحيح: حيث لا مخرجات يُقاس بها.
test('ومشروعٌ بلا مخرجات يبقى على تقدير مديره المسجَّل', async () => {
  const r = await progress.projectProgress('p_bare', { today: '2026-08-01' });
  assert.equal(r.executivePct, 40, 'ضاع تقدير المدير على مشروعٍ لا مخرجات فيه');
  assert.equal(r.executiveSource, 'stored');
  assert.equal(r.delivery.acceptedPct, null, 'بلا مخرجات: فراغٌ لا صفر');
});

test('والمكتمل مئةٌ مهما قيل — حالته أصرحُ من أي حساب', async () => {
  const r = await progress.projectProgress('p_done', { today: '2026-08-01' });
  assert.equal(r.executivePct, 100);
  assert.equal(r.executiveSource, 'status');
  assert.equal(r.evidence.warnings[0].code, 'COMPLETED_WITHOUT_OUTPUTS');
  assert.equal(r.evidence.storedPct, 12);
  assert.equal((await db.get('SELECT progress_pct FROM project WHERE id = ?', ['p_done'])).progress_pct, 12);
});

// ── الحدّ الذي يمنع عودة العيب من الباب الآخر ──
test('اللوحة وصفحة المشروع تقولان الرقم نفسه — لا حسابان لمشروعٍ واحد', async () => {
  const ids = ['p', 'p_bare', 'p_done'];
  const port = await progress.portfolioProgress(ids, { today: '2026-08-01' });
  for (const pid of ids) {
    const one = await progress.projectProgress(pid, { today: '2026-08-01' });
    assert.deepEqual(port.get(pid).delivery.acceptedPct, one.delivery.acceptedPct,
      `«${pid}»: اللوحة تشتقّ نسبةً تخالف صفحة المشروع`);
    assert.deepEqual(port.get(pid).delivery.deliveredPct, one.delivery.deliveredPct, `«${pid}»: المُسلَّم يختلف`);
  }
});

// وفرقُ «سُلِّم» عن «اعتُمد» يبقى محفوظاً: الاعتماد وحده يرفع الإنجاز، والتسليم يُعرض بجانبه.
test('والتسليم بلا اعتماد لا يرفع الإنجاز — الفرق الذي يسبق كل خلافٍ على مستخلص', async () => {
  await db.insert('project', { id: 'p_dlv', name_ar: 'مشروع مُسلَّم غير معتمَد', sector_id: 'S',
    status: 'IN_PROGRESS', progress_pct: 0, created_at: T });
  await db.insert('deliverable', { id: 'x1', project_id: 'p_dlv', name_ar: 'مخرَج مُسلَّم',
    amount_halalas: 100000, status: 'DELIVERED', created_at: T });
  const r = await progress.projectProgress('p_dlv', { today: '2026-08-01' });
  assert.equal(r.executivePct, 0, 'التسليم وحده رفع الإنجاز — والاعتماد إقرارٌ من صاحب الحق');
  assert.equal(r.delivery.deliveredPct, 100, 'والمُسلَّم يُعرض بجانبه');
  assert.equal(r.delivery.awaitingAcceptance, 100, 'وما ينتظر اعتماد العميل يُقال بعدده');
});
