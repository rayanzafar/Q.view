// ترحيلة ٠١٩ على بياناتٍ كما هي قبلها — فصلُ الضريبة عن المبلغ في كل صنف صف.
//
// النموذج هو `migration-017.test.js`: تُبنى قاعدةٌ بمخطط ما قبل الترحيلة، تُملأ بصفوفٍ من كل
// صنف، ثم يُشغَّل `scripts/migrate.js` **الحقيقي** كما يُشغَّل على الخادم (لا تنفيذٌ يدوي للملف)،
// ويُتحقَّق من كل صف. وهو الفحص الوحيد الذي يمنع ترحيلةً تمشي بلا خطأ وتُفسد معنى البيانات.
//
// والمبالغ المختارة مقصودة: ثلاثةٌ منها من المواصفة وكلها **تقبل القسمة على ١١٥ بلا باقٍ**،
// وواحدٌ زيد عمداً **لا يقبلها** — لأن فحصاً يقتصر على القابلة للقسمة لا يمرّ بمسار الباقي
// إطلاقاً، فيمرّ أخضرَ ولو كان التقريب مكسوراً. والصفر والفراغ حاضران كذلك.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-m19-'));
process.env.SANAD_DB = join(dir, 'm.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const db = await import('../../src/core/db/index.js');
const TS = '2026-03-01T00:00:00Z';

// المبالغ بالهللات. الثلاثة الأولى من المواصفة (تقبل القسمة)، والرابع مضافٌ ولا يقبلها.
const A_756642_50 = 75664250;   // صافيه ٦٥٧٩٥٠٠٠ · ضريبته ٩٨٦٩٢٥٠
const A_6423325 = 642332500;    // صافيه ٥٥٨٥٥٠٠٠٠ · ضريبته ٨٣٧٨٢٥٠٠
const A_412620 = 41262000;      // صافيه ٣٥٨٨٠٠٠٠ · ضريبته ٥٣٨٢٠٠٠
const A_ODD = 10000;            // مئة ريال — لا يقبل القسمة: ٨٦٩٥ + ١٣٠٥

before(async () => {
  // ١) المخطط حتى ٠١٨ فقط — أي الحال الذي تجده الترحيلة على الخادم.
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < '019');
  for (const f of files) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
    await db.run('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)', [f, TS]);
  }
  await db.insert('sector', { id: 'VS', name_ar: 'قطاع', kind: 'delivery', active: 1, created_at: TS });
  await db.insert('client', { id: 'VC', name_ar: 'عميل', created_at: TS });
  await db.insert('project', { id: 'VP', name_ar: 'مشروع الضريبة', sector_id: 'VS', client_id: 'VC', status: 'IN_PROGRESS', created_at: TS });
  await db.insert('supplier', { id: 'VSUP', name_ar: 'مورّد', created_at: TS });

  // ٢) صفٌّ من كل صنف داخل النطاق، بالمبالغ الأربعة موزَّعة، ومعها الحالات الحدّية.
  await db.insert('contract', { id: 'VCON', code: 'C-1', client_id: 'VC', project_id: 'VP', sector_id: 'VS',
    value_halalas: A_6423325, start_date: '2026-01-01', status: 'ACTIVE', created_at: TS });
  await db.insert('contract', { id: 'VCON_ODD', code: 'C-2', client_id: 'VC', sector_id: 'VS',
    value_halalas: A_ODD, start_date: '2026-01-01', status: 'ACTIVE', created_at: TS });
  await db.insert('contract_payment', { id: 'VPAY', contract_id: 'VCON', label: 'دفعة',
    amount_halalas: A_412620, status: 'SCHEDULED', created_at: TS });

  await db.insert('invoice', { id: 'VINV', code: 'INV-1', contract_id: 'VCON', project_id: 'VP', client_id: 'VC',
    sector_id: 'VS', amount_halalas: A_756642_50, issue_date: '2026-02-01', status: 'ISSUED', created_at: TS });
  await db.insert('invoice', { id: 'VINV_ODD', code: 'INV-2', project_id: 'VP', client_id: 'VC', sector_id: 'VS',
    amount_halalas: A_ODD, issue_date: '2026-02-02', status: 'ISSUED', created_at: TS });
  // فاتورة بصفر، وأخرى محذوفة ناعماً: كلتاهما صفٌّ قائم ويجب أن تُملأ كبقيتها.
  await db.insert('invoice', { id: 'VINV_ZERO', code: 'INV-3', project_id: 'VP', sector_id: 'VS',
    amount_halalas: 0, issue_date: '2026-02-03', status: 'DRAFT', created_at: TS });
  await db.insert('invoice', { id: 'VINV_DEL', code: 'INV-4', project_id: 'VP', sector_id: 'VS',
    amount_halalas: A_ODD, issue_date: '2026-02-04', status: 'ISSUED', created_at: TS, deleted_at: TS });

  await db.insert('collection', { id: 'VCOL', invoice_id: 'VINV', amount_halalas: A_412620,
    collected_at: '2026-03-01', method: 'تحويل', created_at: TS });
  await db.insert('collection', { id: 'VCOL_ODD', invoice_id: 'VINV_ODD', amount_halalas: A_ODD,
    collected_at: '2026-03-02', method: 'تحويل', created_at: TS });

  await db.insert('revenue_line', { id: 'VREV', project_id: 'VP', sector_id: 'VS',
    amount_halalas: A_6423325, month: 2, year: 2026, auto: 0, created_at: TS });
  await db.insert('revenue_line', { id: 'VREV_ODD', project_id: 'VP', sector_id: 'VS',
    amount_halalas: A_ODD, month: 3, year: 2026, auto: 0, created_at: TS });

  await db.insert('purchase_order', { id: 'VPO', code: 'PO-1', supplier_id: 'VSUP', project_id: 'VP',
    sector_id: 'VS', amount_halalas: A_412620, status: 'ISSUED', created_at: TS });

  // ٣) وصفوفٌ خارج النطاق: يجب ألا تُمَسّ — تعبئتها كانت ستخترع ضريبةً لم تُدفع.
  await db.insert('expense', { id: 'VEXP', project_id: 'VP', sector_id: 'VS', type: 'مستردّ موظف',
    amount_halalas: A_ODD, incurred_month: 2, incurred_year: 2026, status: 'PAID', created_at: TS });
  await db.insert('cost_line', { id: 'VCOST', project_id: 'VP', sector_id: 'VS', type: 'رواتب',
    amount_halalas: A_412620, month: 2, year: 2026, created_at: TS });

  // ٤) الترحيلة تُشغَّل كما تُشغَّل على الخادم — بالسكربت نفسه لا بتنفيذ يدوي.
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
    { env: process.env, stdio: 'ignore' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const row = (t, id) => db.get(`SELECT * FROM ${t} WHERE id = ?`, [id]);

test('الترحيلة طُبِّقت وسُجِّلت مرة واحدة', async () => {
  const applied = await db.all("SELECT version FROM schema_migration WHERE version LIKE '019%'");
  assert.equal(applied.length, 1);
});

test('لا علامة استفهام لاتينية في ملف الترحيلة — ولا حتى داخل تعليق', async () => {
  // الملف كله يمرّ على مُحوِّل العلامات إلى ترقيم دولارات على Postgres، فأي علامة تُفسد النص.
  const sql = readFileSync(join(MIG, '019_vat_split.sql'), 'utf8');
  assert.equal(sql.includes('?'), false, 'علامة استفهام واحدة تكفي لإفساد الملف على المحرّك الآخر');
});

test('الفاتورة: صافٍ وضريبة على المبلغ القابل للقسمة وعلى غير القابل معاً', async () => {
  const a = await row('invoice', 'VINV');
  assert.equal(a.amount_halalas, A_756642_50, 'المبلغ الأصلي لم يُمَسّ — بقي إجمالياً كما كان');
  assert.equal(a.net_amount_halalas, 65795000);
  assert.equal(a.vat_halalas, 9869250);

  const odd = await row('invoice', 'VINV_ODD');
  assert.equal(odd.amount_halalas, A_ODD, 'ولا هنا');
  assert.equal(odd.net_amount_halalas, 8695, 'الكسر يُقتطع من الصافي');
  assert.equal(odd.vat_halalas, 1305, 'والباقي يذهب إلى الضريبة كاملاً');
});

test('الجمع مغلق في كل صفٍّ من كل جدول: صافٍ + ضريبة = إجمالي', async () => {
  const checks = [
    ['invoice', 'amount_halalas', 'net_amount_halalas'],
    ['contract', 'value_halalas', 'net_value_halalas'],
    ['contract_payment', 'amount_halalas', 'net_amount_halalas'],
    ['revenue_line', 'amount_halalas', 'net_amount_halalas'],
    ['collection', 'amount_halalas', 'net_amount_halalas'],
    ['purchase_order', 'amount_halalas', 'net_amount_halalas'],
  ];
  for (const [t, gross, net] of checks) {
    const bad = await db.all(`SELECT id FROM ${t} WHERE ${net} + vat_halalas != COALESCE(${gross},0)`);
    assert.equal(bad.length, 0, `${t}: هللة ضائعة في ${bad.map((r) => r.id).join('، ')}`);
    const unfilled = await db.all(`SELECT id FROM ${t} WHERE ${net} IS NULL OR vat_halalas IS NULL`);
    assert.equal(unfilled.length, 0, `${t}: صفٌّ قائم بلا تعبئة رجعية`);
  }
});

test('كل صنف صفٍّ في النطاق مُلئ — بما فيه الصفر والمحذوف ناعماً', async () => {
  assert.equal((await row('contract', 'VCON')).net_value_halalas, 558550000);
  assert.equal((await row('contract', 'VCON')).vat_halalas, 83782500);
  assert.equal((await row('contract', 'VCON_ODD')).net_value_halalas, 8695);
  assert.equal((await row('contract_payment', 'VPAY')).net_amount_halalas, 35880000);
  assert.equal((await row('revenue_line', 'VREV')).net_amount_halalas, 558550000);
  assert.equal((await row('revenue_line', 'VREV_ODD')).net_amount_halalas, 8695);
  assert.equal((await row('collection', 'VCOL')).net_amount_halalas, 35880000);
  assert.equal((await row('collection', 'VCOL_ODD')).net_amount_halalas, 8695);
  assert.equal((await row('purchase_order', 'VPO')).net_amount_halalas, 35880000);
  // الصفر: صافيه صفر وضريبته صفر — وهذا قياسٌ صحيح لا غياب، فالصف موجود ومبلغه صفر فعلاً.
  const zero = await row('invoice', 'VINV_ZERO');
  assert.equal(zero.net_amount_halalas, 0);
  assert.equal(zero.vat_halalas, 0);
  // المحذوف ناعماً صفٌّ قائم في الجدول: تركُه بلا تعبئة يجعله يعود يوماً بصافٍ فارغ.
  const del = await row('invoice', 'VINV_DEL');
  assert.equal(del.net_amount_halalas, 8695);
  assert.equal(del.vat_halalas, 1305);
});

test('المصروف: عمودان أُضيفا ولم يُملآ — الفراغ يعني غير مُسجَّل لا صفراً', async () => {
  const e = await row('expense', 'VEXP');
  assert.equal(e.amount_halalas, A_ODD, 'المبلغ كما هو');
  assert.equal(e.net_amount_halalas, null, 'تعبئته بخمسة عشر بالمئة كانت ستخترع ضريبةً مستردّة على مستردّ موظف');
  assert.equal(e.vat_halalas, null, 'والصفر هنا كان سيعني إعفاءً لم يقرّره أحد');
});

test('بند الكلفة: لم يُمَسّ أصلاً — لا عمود ولا تعبئة', async () => {
  const c = await row('cost_line', 'VCOST');
  assert.equal(c.amount_halalas, A_412620);
  assert.equal('net_amount_halalas' in c, false, 'بند الكلفة اعترافٌ بكلفةٍ صافية بطبيعته، وأول أنواعه رواتب ولا ضريبة على راتب');
});

test('مجاميع الجداول تُطابق: مجموع الصوافي + مجموع الضرائب = مجموع الإجماليات', async () => {
  // المطابقة على المجموع لا على الصف: هنا يظهر التراكم لو كان التقريب مكسوراً.
  const t = await db.get(`SELECT COALESCE(SUM(amount_halalas),0) g, COALESCE(SUM(net_amount_halalas),0) n,
     COALESCE(SUM(vat_halalas),0) v FROM invoice`);
  assert.equal(t.n + t.v, t.g);
  assert.equal(t.g, A_756642_50 + A_ODD + 0 + A_ODD);
  assert.equal(t.n, 65795000 + 8695 + 0 + 8695);
});
