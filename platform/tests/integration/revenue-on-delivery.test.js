// الإيراد يتبع التسليم لا الفاتورة — الخدمةُ حيّةً والترحيلةُ ٠٢٠ على بياناتٍ كما هي قبلها.
//
// قرار المالك: «لما الواحد يحطّ تمّ إنجاز المخرج، هو خلاص يتحوّل كأنه حقّق إيراداً — مو لازم
// إثبات الفواتير ولا أي شيء من المالية». وهذا الفحص يحرس أربعة أشياء لا تُرى إلا مجتمعة:
//   ① التسليم يخلق الإيراد، والرجوع عنه يمحوه — لا سطرَ إيرادٍ لعملٍ لم يعد مسلَّماً.
//   ② سطرٌ واحد لكل مخرَج مهما تكرّر الحفظ — وهو أخطر ما في الباب: رقمٌ ماليٌّ يتضخّم
//     بالاستعمال لا بالعمل يفسد بلا أن يشتكي أحد.
//   ③ الصافي والضريبة بقاعدة ٠١٩ نفسها — لا نسخة ثانية من القاعدة في هذا المسار.
//   ④ الترحيلة تُلحق ما مضى، وترفع أسطر الفواتير التي صارت تنوب عن التسليم — فلا يُحتسب العمل
//     مرتين، ولا يُترك مشروعٌ بلا مخرجات مسلَّمة بلا إيراد.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m20-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const TS = '2026-03-01T00:00:00.000Z';

// مبلغان: الأول يقبل القسمة على ١١٥ بلا باقٍ، والثاني لا يقبلها — فيُختبر مسار الباقي فعلاً.
const A_EVEN = 75664250;  // صافيه ٦٥٧٩٥٠٠٠ · ضريبته ٩٨٦٩٢٥٠
const A_ODD = 10000;      // مئة ريال — ٨٦٩٥ + ١٣٠٥

let gov, recog;
const CTX = { user: { id: 'u_pm', username: 'pm', role_id: 'admin', scope: 'company' }, ip: '127.0.0.1' };
const line = (dlvId) => db.get('SELECT * FROM revenue_line WHERE id = ?', ['rl_dlv_' + dlvId]);

before(async () => {
  // المخطط حتى ٠١٩ فقط — أي الحال الذي تجده الترحيلة على الخادم.
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort().filter((x) => x < '020')) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, TS]);
  }
  await db.insert('sector', { id: 'S', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: TS });
  await db.insert('client', { id: 'C', name_ar: 'عميل', created_at: TS });
  // مشروعان: الأول له مخرجات مسلَّمة، والثاني لا — والفرق بينهما هو ما يحرسه فحص الرفع.
  await db.insert('project', { id: 'P1', name_ar: 'مشروع بمخرجات', sector_id: 'S', client_id: 'C', status: 'IN_PROGRESS', created_at: TS });
  await db.insert('project', { id: 'P2', name_ar: 'مشروع بلا تسليم', sector_id: 'S', client_id: 'C', status: 'IN_PROGRESS', created_at: TS });

  // ما قبل الترحيلة: مخرجات بحالاتٍ مختلفة، وسطرا إيرادٍ من فواتير (بلا مخرَج خلفهما).
  const mk = (id, project, status, amount, extra = {}) => db.insert('deliverable', {
    id, project_id: project, sector_id: 'S', name_ar: 'مخرَج ' + id, amount_halalas: amount,
    status, delivered_at: status === 'DELIVERED' || status === 'ACCEPTED' ? '2026-05-20T09:00:00.000Z' : null,
    accepted_at: status === 'ACCEPTED' ? '2026-06-11T09:00:00.000Z' : null, created_at: TS, ...extra });
  await mk('D_DELIVERED', 'P1', 'DELIVERED', A_EVEN);
  await mk('D_ACCEPTED', 'P1', 'ACCEPTED', A_ODD);
  await mk('D_DRAFT', 'P1', 'DRAFT', A_EVEN);                       // لم يُسلَّم — لا إيراد له
  await mk('D_NOAMOUNT', 'P1', 'DELIVERED', 0);                     // بلا مبلغ — لا إيراد له
  await mk('D_GONE', 'P1', 'DELIVERED', A_EVEN, { deleted_at: TS }); // محذوف — لا إيراد له
  await mk('D_PERIOD', 'P1', 'DELIVERED', A_EVEN, { month: 2, year: 2026 }); // استحقاقه يسبق تسليمه

  await db.insert('revenue_line', { id: 'rl_inv_1', project_id: 'P1', sector_id: 'S',
    amount_halalas: 999900, month: 1, year: 2026, label: 'فاتورة قديمة', auto: 0, created_at: TS });
  await db.insert('revenue_line', { id: 'rl_inv_2', project_id: 'P2', sector_id: 'S',
    amount_halalas: 555500, month: 1, year: 2026, label: 'فاتورة مشروع بلا تسليم', auto: 0, created_at: TS });

  await db.exec(readFileSync(join(MIG, '020_revenue_on_delivery.sql'), 'utf8'));

  // المنح تُقرأ من القاعدة، فتُبذر ثم تُحمَّل — الفحص يمرّ بنفس طريق الطلب الحقيقي.
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  if (seedRbac) await seedRbac();
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  // بعد بذر الأدوار: صفّ المستخدم يشير إلى دورٍ يجب أن يكون موجوداً (سجل التدقيق يشير إليه).
  await db.insert('app_user', { id: 'u_pm', username: 'pm', name_ar: 'مدير مشروع', role_id: 'admin',
    scope: 'company', active: 1, created_at: TS });

  gov = await import('../../src/modules/pmo/governance.js');
  recog = await import('../../src/modules/finance/recognition.js');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── الترحيلة: ما مضى ────────────────────────────────────────────────────────────────────────
test('الترحيلة تعترف بالمسلَّم والمعتمد وحدهما', async () => {
  assert.ok(await line('D_DELIVERED'), 'مخرَج مسلَّم بلا إيراد — والقاعدة صارت للمستقبل وحده');
  assert.ok(await line('D_ACCEPTED'), 'مخرَج معتمد بلا إيراد');
  for (const d of ['D_DRAFT', 'D_NOAMOUNT', 'D_GONE']) {
    assert.equal(await line(d), undefined, `اعتُرف بإيراد «${d}» وهو ليس عملاً مسلَّماً بمبلغ`);
  }
});

test('الصافي والضريبة بقاعدة ٠١٩ نفسها — ومسار الباقي مغطّى', async () => {
  const even = await line('D_DELIVERED');
  assert.equal(even.amount_halalas, A_EVEN, 'المخزَّن يبقى إجمالياً كالعقد والفاتورة');
  assert.equal(even.net_amount_halalas, 65795000);
  assert.equal(even.vat_halalas, 9869250);

  const odd = await line('D_ACCEPTED');
  assert.equal(odd.net_amount_halalas, 8695, 'الاقتطاع لا التقريب — ⌊١٠٠٠٠×١٠٠÷١١٥⌋');
  assert.equal(odd.vat_halalas, 1305);
  assert.equal(odd.net_amount_halalas + odd.vat_halalas, A_ODD, '«صافٍ + ضريبة = إجمالي» انكسر');
});

test('الشهر: استحقاق المخرَج إن حُدِّد، وإلا شهر الحدث نفسه', async () => {
  const byEvent = await line('D_DELIVERED');
  assert.deepEqual([byEvent.year, byEvent.month], [2026, 5], 'شهر التسليم هو شهر الاعتراف');
  const accepted = await line('D_ACCEPTED');
  assert.deepEqual([accepted.year, accepted.month], [2026, 6], 'القبول يسبق التسليم في الترتيب');
  const byPeriod = await line('D_PERIOD');
  assert.deepEqual([byPeriod.year, byPeriod.month], [2026, 2], 'استحقاقٌ حدّده مدير المشروع فتُجووِز');
});

test('أسطر الفواتير تُرفع من مشروعٍ صار يُحتسب بالتسليم وحده — ويبقى غيره', async () => {
  assert.equal(await db.get('SELECT * FROM revenue_line WHERE id = ?', ['rl_inv_1']), undefined,
    'بقي سطر الفاتورة مع أسطر التسليم — فالعمل محتسَبٌ مرتين وإيراد الشركة منتفخ');
  assert.ok(await db.get('SELECT * FROM revenue_line WHERE id = ?', ['rl_inv_2']),
    'رُفع إيراد مشروعٍ بلا مخرجات مسلَّمة — فأُسقط إلى صفرٍ بلا بديل');
  const kept = await db.get('SELECT * FROM audit_log WHERE resource_id = ?', ['rl_inv_1']);
  assert.ok(kept, 'رُفع الرقم بلا أثرٍ في سجل التدقيق');
  assert.doesNotThrow(() => JSON.parse(kept.detail_json), 'تفصيل التدقيق ليس JSON صالحاً فيسقط عند العرض');
});

// ── الخدمة: من اليوم فصاعداً ────────────────────────────────────────────────────────────────
test('تغيير الحالة إلى «سُلِّم» يخلق الإيراد، والرجوع عنها يمحوه', async () => {
  const d = await gov.createItem(CTX, 'P1', 'deliverable', { name_ar: 'مخرَج جديد', amount_sar: 1150, status: 'DRAFT' });
  assert.equal(await line(d.id), undefined, 'مسودةٌ ولها إيراد');

  await gov.updateItem(CTX, 'deliverable', d.id, { status: 'DELIVERED' });
  const created = await line(d.id);
  assert.ok(created, 'سُلِّم ولا إيراد — وهو عين ما طلبه المالك');
  assert.equal(created.amount_halalas, 115000);
  assert.equal(created.net_amount_halalas, 100000, 'ألف ريال صافياً من ١١٥٠ شاملة');
  assert.equal(created.auto, 1);
  assert.equal(created.rule_id, 'deliverable_delivered');

  await gov.updateItem(CTX, 'deliverable', d.id, { status: 'DRAFT' });
  assert.equal(await line(d.id), undefined, 'رجع إلى مسودة وبقي إيراده — إيرادُ عملٍ لم يعد مسلَّماً');
});

test('سطرٌ واحد لكل مخرَج مهما تكرّر الحفظ — ولا يتضخّم الرقم بالاستعمال', async () => {
  const d = await gov.createItem(CTX, 'P1', 'deliverable', { name_ar: 'مخرَج متكرّر', amount_sar: 1150, status: 'DELIVERED' });
  for (const amount of [2300, 3450, 4600]) {
    await gov.updateItem(CTX, 'deliverable', d.id, { amount_sar: amount });
  }
  const rows = await db.all('SELECT * FROM revenue_line WHERE deliverable_id = ?', [d.id]);
  assert.equal(rows.length, 1, `صار للمخرَج ${rows.length} أسطر إيراد — الرقم يتضخّم بالحفظ لا بالعمل`);
  assert.equal(rows[0].amount_halalas, 460000, 'آخر مبلغ هو المعتمد');
  assert.equal(rows[0].net_amount_halalas, 400000);
});

test('حذف المخرَج يمحو إيراده', async () => {
  const d = await gov.createItem(CTX, 'P1', 'deliverable', { name_ar: 'مخرَج سيُحذف', amount_sar: 1150, status: 'DELIVERED' });
  assert.ok(await line(d.id));
  await gov.deleteItem(CTX, 'deliverable', d.id);
  assert.equal(await line(d.id), undefined, 'حُذف المخرَج وبقي إيراده');
});

test('الاعتراف لا يمرّ بالمالية ولا بفاتورة — والفوترة تبقى مختومة على مدير المشروع', async () => {
  const d = await gov.createItem(CTX, 'P1', 'deliverable', { name_ar: 'بلا فاتورة', amount_sar: 1150, status: 'DELIVERED' });
  const r = await line(d.id);
  assert.ok(r, 'اشتُرطت فاتورة للاعتراف');
  const dlv = await db.get('SELECT * FROM deliverable WHERE id = ?', [d.id]);
  assert.equal(dlv.invoiced_at, null, 'الاعتراف كتب ختم الفوترة — وهو ليس فوترة');
  await assert.rejects(() => gov.updateItem(CTX, 'deliverable', d.id, { invoiced_at: '2026-07-09' }),
    /المستخلص/, 'انفتح ختم الفوترة لمدير المشروع — والقرار رفع شرط الفاتورة عن الإيراد لا فتحها له');
});

test('الاشتقاق واحدٌ في الخدمة والترحيلة — لا مفتاحان لعلاقةٍ واحدة', () => {
  assert.equal(recog.revenueLineIdFor('dlv_x'), 'rl_dlv_dlv_x');
  assert.deepEqual(recog.RECOGNIZING_STATUSES, ['DELIVERED', 'ACCEPTED']);
});
