// فحص سكربت تصحيح فواتير وزارة الاقتصاد والتخطيط — على قاعدةٍ تحاكي الحيّ صفاً بصف.
//
// السكربت يمسّ مطالبةً مالية على جهة حكومية، فالمطلوب منه شيئان متساويان في الأهمية:
// أن **يصحّح** ما يقوله كشف المالك، وأن **يمتنع** عمّا لا يقوله يقيناً. هذا الملف يثبت الاثنين:
//   • المعاينة الافتراضية لا تكتب صفاً ولا سطر تدقيق — تُقارَن القاعدة قبلها وبعدها بايتاً ببايت.
//   • `--apply` يضبط الأرقام والتواريخ ويربط المشروع والعقد والمخرَج.
//   • الفاتورتان الغائبتان تُنشآن ببياناتهما الكاملة.
//   • مخرَجٌ اسمه قريب ولا يطابق ⇒ **يُرفض** ولا يُربط، ويُطبع لقرار إنسان. وكذلك الاسم المكرَّر.
//   • إعادة التشغيل لا تضيف صفاً ولا تغيّر قيمة ولا تكرّر تدقيقاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-moep-'));
process.env.SANAD_DB = join(dir, 'moep.db');
delete process.env.DATABASE_URL;                 // الفحص على المحرّك المحلي دائماً
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = resolve(ROOT, 'migrations');
const SCRIPT = resolve(ROOT, 'scripts/backfill-moep-invoices.mjs');
const db = await import('../../src/core/db/index.js');

const TS = '2026-04-24T09:00:00Z';
const STAMP = '2026-04-24';                       // تاريخ الترحيل المسجَّل خطأً بوصفه إصداراً
const CLIENT = 'c_ministry_of_economy_planning';
const PRJ = 'prj_saudi_data_platform';
const CON = 'con_moep_2026';
const SEC = 'sec_digital';

// كشف المالك كما هو — نسخة الفحص المستقلة عن نسخة السكربت (لو انحرف أحدهما ظهر الخلاف هنا).
const S = [
  ['INV/2026/000089', 'inv_NisGJ7UrJRa1', 'إعداد وثيقة محتوى المؤشرات', 657950.00, 98692.50, 756642.50],
  ['INV/2026/000090', 'inv_r153nnxOrHZt', 'توسيع نطاق المحتوى بإضافة ٤٣٨ مؤشراً اقتصادياً جديداً', 727950.00, 109192.50, 837142.50],
  ['INV/2026/000091', 'inv_YYUnbdlk7rFg', 'ربط المنصة بمصادر بيانات جديدة والتحديث المستمر لقاعدة البيانات', 797950.00, 119692.50, 917642.50],
  ['INV/2026/000092', 'inv_vjMHHkwTtvv4', 'إعداد تقرير يشمل تصميم رحلة المستفيد الرقمية', 727252.00, 109087.80, 836339.80],
  ['INV/2026/000093', 'inv_9nDB8cPVItUF', 'بناء وتنفيذ إطار تصميمي لمنصة بيانات السعودية وفق كود المنصات', 478900.00, 71835.00, 550735.00],
  ['INV/2026/000094', 'inv_svm9FNUCRTi7', 'إعداد خطة شاملة لتحسين محركات البحث', 358800.00, 53820.00, 412620.00],
  ['INV/2026/000095', 'inv_LosJmUrpbjND', 'تصميم وتنفيذ واجهة مستخدم حديثة تلبي احتياجات وتفضيلات المستخدمين', 350000.00, 52500.00, 402500.00],
  ['INV/2026/000096', 'inv_5sCEmzVVoFbD', 'تقديم البنية التحتية والاشتراكات اللازمة لتجهيز وتشغيل نماذج وتقنيات الذكاء الاصطناعي', 3315000.00, 497250.00, 3812250.00],
  ['INV/2026/000097', 'inv_-VOvl40aHngt', 'تطوير مستكشف المعرفة بالذكاء الاصطناعي', 5585500.00, 837825.00, 6423325.00],
  ['INV/2026/000098', 'inv_pQ35Ax0ZoZo2', 'إعداد خطة تسويقية لتعزيز الوصول المحلي والدولي', 527700.00, 79155.00, 606855.00],
  ['INV/2026/000104', null, 'تقييم الأثر النهائي', 210960.00, 31644.00, 242604.00],
  ['INV/2026/000105', null, 'تقديم تقارير تنفيذ الخطة التسويقية للأنشطة والحملات التسويقية', 3652000.00, 547800.00, 4199800.00],
].map(([code, liveId, deliverable, net, vat, gross]) => ({ code, liveId, deliverable, net, vat, gross }));

const H = (sar) => Math.round(Number(sar) * 100);
const byCode = (code) => S.find((r) => r.code === code);

// ── الحالتان اللتان يجب أن يرفضهما السكربت ──
// ① اسمٌ قريب لا مطابق: المخرَج في المشروع بلا كلمة «شاملة». مسافةُ تحريرٍ واحدة — ومع ذلك رفض.
const NEAR_MISS = { code: 'INV/2026/000094', nameInProject: 'إعداد خطة لتحسين محركات البحث' };
// ② اسمٌ مكرَّر: مخرَجان في المشروع يحملان اسم فاتورة ٠٠٠٠٩٥ ⇒ المطابقة غير يقينية ⇒ لا ربط.
const AMBIGUOUS = byCode('INV/2026/000095');

// ولمزيد من الإحكام: مخرَج «تشكيلي» يثبت أن التوحيد الإملائي يعمل — الاسم نفسه بهمزات وتشكيل
// وتطويل وأرقام هندية مختلفة، ويجب أن يُطابَق (توحيد إملائي، لا تشابه).
const ORTHO = byCode('INV/2026/000090');
const ORTHO_IN_PROJECT = 'توسيع نطاق المحتوي بإضافة ٤٣٨ مؤشرا اقتصاديا جديدا';

let TAX = { net: null, vat: null, gross: null };  // تُكتشف بعد الترحيلات، كما يفعل السكربت

const run = (args = []) => execFileSync(process.execPath, ['--experimental-sqlite', SCRIPT, ...args],
  { env: { ...process.env, SANAD_DB: process.env.SANAD_DB }, encoding: 'utf8' });

// لقطة كاملة للجدول: أي كتابة مهما صغرت تُغيّرها.
const snapshot = async () => JSON.stringify(await db.all('SELECT * FROM invoice ORDER BY id'));
const auditCount = async () => (await db.get("SELECT COUNT(*) n FROM audit_log WHERE resource = 'invoice'")).n;
const inv = (id) => db.get('SELECT * FROM invoice WHERE id = ?', [id]);
const invByCode = (code) => db.get('SELECT * FROM invoice WHERE code = ? AND deleted_at IS NULL', [code]);

before(async () => {
  // ① المخطط كاملاً بالسكربت نفسه الذي يُشغَّل على الخادم (تشمل أي ترحيلة ضريبة تُضاف لاحقاً).
  execFileSync(process.execPath, ['--experimental-sqlite', resolve(ROOT, 'scripts/migrate.js')],
    { env: process.env, stdio: 'ignore' });

  // ② الأساس: قطاع، عميل الوزارة، مستخدم إدارة (فاعل التدقيق)، المشروع، وعقده الوحيد.
  await db.insert('role', { id: 'admin', name_ar: 'مدير النظام', name_en: 'Admin', is_system: 1, created_at: TS });
  await db.insert('sector', { id: SEC, name_ar: 'التحول الرقمي', active: 1, created_at: TS });
  await db.insert('client', { id: CLIENT, name_ar: 'وزارة الاقتصاد والتخطيط', type: 'حكومي', active: 1, created_at: TS });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin',
    sector_id: SEC, scope: 'company', active: 1, created_at: TS });
  await db.insert('project', { id: PRJ, name_ar: 'منصة البيانات السعودية', client_id: CLIENT, sector_id: SEC,
    owner_user_id: 'u_admin', status: 'IN_PROGRESS', created_at: TS });
  // مشروع آخر لنفس العميل باسم مشابه — يثبت أن تحديد المشروع بالتطابق التام لا بالاحتواء.
  await db.insert('project', { id: 'prj_other', name_ar: 'دعم منصة البيانات السعودية — مرحلة لاحقة',
    client_id: CLIENT, sector_id: SEC, status: 'IN_PROGRESS', created_at: TS });
  await db.insert('contract', { id: CON, code: 'C-MOEP-2026', client_id: CLIENT, project_id: PRJ,
    sector_id: SEC, value_halalas: H(19998456.30), status: 'ACTIVE', created_at: TS });
  // مخرَج على المشروع الآخر يحمل اسم أحد مخرجاتنا — يجب ألا يُلتقط (البحث داخل المشروع وحده).
  await db.insert('deliverable', { id: 'del_other', project_id: 'prj_other', name_ar: 'تقييم الأثر النهائي',
    amount_halalas: H(210960), status: 'PENDING', sector_id: SEC, created_at: TS });

  // ③ مخرجات المشروع — بأسماء الكشف، مع الحالتين المرفوضتين والحالة التشكيلية.
  let i = 0;
  for (const r of S) {
    let name = r.deliverable;
    if (r.code === NEAR_MISS.code) name = NEAR_MISS.nameInProject;
    if (r.code === ORTHO.code) name = ORTHO_IN_PROJECT;
    await db.insert('deliverable', { id: `del_${++i}`, project_id: PRJ, name_ar: name,
      amount_halalas: H(r.net), status: 'ACCEPTED', delivered_at: TS, accepted_at: TS,
      sector_id: SEC, created_at: TS });
  }
  // النسخة المكرّرة التي تصنع الالتباس على ٠٠٠٠٩٥.
  await db.insert('deliverable', { id: 'del_dup', project_id: PRJ, name_ar: AMBIGUOUS.deliverable,
    amount_halalas: H(AMBIGUOUS.net), status: 'ACCEPTED', sector_id: SEC, created_at: TS });

  // ④ الفواتير العشر كما وصلت من الترحيل: بلا رقم، بلا استحقاق، بلا روابط، وتاريخها يوم الترحيل.
  for (const r of S.filter((x) => x.liveId)) {
    await db.insert('invoice', { id: r.liveId, code: null, contract_id: null, project_id: null,
      client_id: CLIENT, deliverable_id: null, sector_id: null, amount_halalas: H(r.gross),
      issue_date: STAMP, due_date: null, status: 'ISSUED', kind: 'standard', created_at: TS });
  }

  // ⑤ خانات الضريبة كما هي في هذه القاعدة — الفحص يتكيّف كما يتكيّف السكربت.
  const cols = new Set((await db.all('SELECT name FROM pragma_table_info(?)', ['invoice'])).map((c) => c.name));
  const pick = (cands) => cands.find((c) => cols.has(c)) || null;
  TAX = {
    net: pick(['net_halalas', 'subtotal_halalas', 'net_amount_halalas', 'amount_net_halalas',
      'amount_excl_vat_halalas', 'excl_vat_halalas', 'pre_tax_halalas', 'amount_before_vat_halalas']),
    vat: pick(['vat_halalas', 'tax_halalas', 'vat_amount_halalas', 'tax_amount_halalas']),
    gross: pick(['gross_halalas', 'total_halalas', 'gross_amount_halalas', 'amount_incl_vat_halalas',
      'incl_vat_halalas', 'total_with_vat_halalas']),
  };
});

after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ═══ ١) المعاينة: كشفٌ كامل وصفر كتابة ══════════════════════════════════════════════════════
let previewOut = '';
test('المعاينة الافتراضية لا تكتب صفاً واحداً ولا سطر تدقيق', async () => {
  const before = await snapshot();
  const beforeAudit = await auditCount();
  const beforeCount = (await db.get('SELECT COUNT(*) n FROM invoice')).n;

  previewOut = run();                                   // بلا وسائط ⇒ معاينة

  assert.equal(await snapshot(), before, 'المعاينة غيّرت صفاً في جدول الفواتير');
  assert.equal(await auditCount(), beforeAudit, 'المعاينة كتبت سطر تدقيق');
  assert.equal((await db.get('SELECT COUNT(*) n FROM invoice')).n, beforeCount, 'المعاينة أنشأت فاتورة');
  assert.match(previewOut, /معاينة فقط/);
  assert.match(previewOut, /لم يُكتب شيء/);
});

test('المعاينة تعرض كل فاتورة من الكشف مع ما سيتغيّر', () => {
  for (const r of S) assert.ok(previewOut.includes(r.code), `الرقم ${r.code} غائب عن كشف المعاينة`);
  assert.match(previewOut, /＋ إنشاء\s+INV\/2026\/000104/);
  assert.match(previewOut, /＋ إنشاء\s+INV\/2026\/000105/);
  assert.match(previewOut, /✎ تعديل\s+INV\/2026\/000089/);
  assert.ok(previewOut.includes(PRJ), 'المشروع المحدَّد غير مذكور');
  assert.ok(previewOut.includes(CON), 'العقد المقروء من المشروع غير مذكور');
  // إجمالي الكشف يُطبع كما هو بالهللة
  assert.ok(previewOut.includes('19,998,456.30'), 'إجمالي الكشف غير مطبوع');
});

test('المعاينة ترفض ما لا يُطابَق يقيناً وتسمّيه لقرار إنسان', () => {
  const human = previewOut.split('تحتاج قرار إنسان').pop();
  assert.ok(human.includes(NEAR_MISS.code), 'المخرَج قريب الاسم لم يُطرح لقرار إنسان');
  assert.ok(human.includes(AMBIGUOUS.code), 'الاسم المكرَّر لم يُطرح لقرار إنسان');
  assert.match(previewOut, /لا مخرَج باسمه في المشروع/);
  assert.match(previewOut, /2 مخرجات بالاسم نفسه/);
  // عشرة من اثنتي عشرة تُربط، والمرفوضتان لا
  assert.match(previewOut, /مربوطة بمخرَج 10 من 12/);
});

// ═══ ٢) التنفيذ ═════════════════════════════════════════════════════════════════════════════
let applyOut = '';
test('التنفيذ يضبط الأرقام والتواريخ والروابط على الفواتير العشر', async () => {
  applyOut = run(['--apply']);
  for (const r of S.filter((x) => x.liveId)) {
    const row = await inv(r.liveId);
    assert.equal(row.code, r.code, `${r.code}: الرقم لم يُضبط`);
    assert.equal(row.issue_date, '2026-07-09', `${r.code}: التاريخ لم يُضبط`);
    assert.equal(row.project_id, PRJ, `${r.code}: المشروع لم يُربط`);
    assert.equal(row.contract_id, CON, `${r.code}: العقد لم يُربط`);
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.sector_id, SEC, `${r.code}: القطاع لم يُملأ`);
    assert.equal(Number(row.amount_halalas), H(r.gross), `${r.code}: المبلغ تغيّر — يجب ألا يُمسّ`);
    assert.equal(row.due_date, null, 'تاريخ استحقاق مخترَع — الكشف لا يذكره');
  }
});

test('كل مخرَج طابق باسمه رُبط بفاتورته، ولا مخرَج مربوط بفاتورتين', async () => {
  const linked = await db.all('SELECT i.code, d.name_ar FROM invoice i JOIN deliverable d ON d.id = i.deliverable_id WHERE i.project_id = ?', [PRJ]);
  assert.equal(linked.length, 10, 'عدد الفواتير المربوطة بمخرَج غير متوقع');
  for (const l of linked) {
    const st = byCode(l.code);
    // التطابق بعد التوحيد الإملائي: الاسم في المشروع قد يختلف رسماً لا لفظاً (حالة ORTHO).
    const norm = (s) => String(s).normalize('NFKC').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf))
      .replace(/[ً-ٰـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    assert.equal(norm(l.name_ar), norm(st.deliverable), `${l.code}: رُبط بمخرَج اسمه مختلف`);
  }
  const dups = await db.all(`SELECT deliverable_id FROM invoice WHERE deliverable_id IS NOT NULL AND deleted_at IS NULL
     GROUP BY deliverable_id HAVING COUNT(*) > 1`);
  assert.equal(dups.length, 0, 'مخرَج مربوط بأكثر من فاتورة');
});

test('المرفوضان بقيا بلا ربط — ولم يُربط مخرَج مشروعٍ آخر', async () => {
  assert.equal((await inv(byCode(NEAR_MISS.code).liveId)).deliverable_id, null, 'رُبط مخرَج باسم قريب لا مطابق');
  assert.equal((await inv(AMBIGUOUS.liveId)).deliverable_id, null, 'رُبط مخرَج ملتبس');
  const stolen = await db.get('SELECT COUNT(*) n FROM invoice WHERE deliverable_id = ?', ['del_other']);
  assert.equal(stolen.n, 0, 'التُقط مخرَج من مشروع آخر');
});

test('الفاتورتان الغائبتان أُنشئتا ببياناتهما الكاملة', async () => {
  for (const code of ['INV/2026/000104', 'INV/2026/000105']) {
    const st = byCode(code);
    const row = await invByCode(code);
    assert.ok(row, `${code}: لم تُنشأ`);
    assert.equal(row.issue_date, '2026-07-22');
    assert.equal(Number(row.amount_halalas), H(st.gross));
    assert.equal(row.project_id, PRJ);
    assert.equal(row.contract_id, CON);
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.sector_id, SEC);
    assert.equal(row.status, 'ISSUED');
    assert.equal(row.due_date, null);
    const d = await db.get('SELECT name_ar FROM deliverable WHERE id = ?', [row.deliverable_id]);
    assert.equal(d?.name_ar, st.deliverable, `${code}: المخرَج غير مربوط باسمه`);
  }
  assert.equal((await db.get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL')).n, 12);
});

test('الأرقام تطابق كشف المالك إلى الهللة', async () => {
  const t = await db.get('SELECT COALESCE(SUM(amount_halalas),0) v FROM invoice WHERE project_id = ? AND deleted_at IS NULL', [PRJ]);
  assert.equal(Number(t.v), H(19998456.30), 'مجموع الإجمالي لا يطابق الكشف');
  assert.match(applyOut, /جدول المطابقة/);
  assert.ok(applyOut.includes('19,998,456.30'));
  assert.match(applyOut, /روابط معلّقة — مخرَج: 0 · مشروع: 0 · عقد: 0/);
  assert.match(applyOut, /فواتير مكتملة الربط: 10 من 12/);
});

test('خانات الضريبة: تُملأ إن وُجدت، ويُنبَّه بوضوح إن غابت', async () => {
  if (!TAX.net && !TAX.vat && !TAX.gross) {
    assert.match(applyOut, /لا توجد خانات ضريبة في جدول الفواتير/);
    return;
  }
  for (const r of S) {
    const row = r.liveId ? await inv(r.liveId) : await invByCode(r.code);
    if (TAX.net) assert.equal(Number(row[TAX.net]), H(r.net), `${r.code}: الصافي`);
    if (TAX.vat) assert.equal(Number(row[TAX.vat]), H(r.vat), `${r.code}: الضريبة`);
    if (TAX.gross) assert.equal(Number(row[TAX.gross]), H(r.gross), `${r.code}: الإجمالي`);
  }
  if (TAX.net) {
    const s = await db.get(`SELECT COALESCE(SUM(${TAX.net}),0) v FROM invoice WHERE project_id = ? AND deleted_at IS NULL`, [PRJ]);
    assert.equal(Number(s.v), H(17389962.00), 'مجموع الصافي لا يطابق الكشف');
  }
  if (TAX.vat) {
    const s = await db.get(`SELECT COALESCE(SUM(${TAX.vat}),0) v FROM invoice WHERE project_id = ? AND deleted_at IS NULL`, [PRJ]);
    assert.equal(Number(s.v), H(2608494.30), 'مجموع الضريبة لا يطابق الكشف');
  }
});

test('كل كتابة تركت سطر تدقيق يحمل القيمة السابقة واللاحقة', async () => {
  const rows = await db.all("SELECT * FROM audit_log WHERE resource = 'invoice' ORDER BY at");
  assert.equal(rows.filter((r) => r.action === 'create').length, 2, 'سطرا إنشاء غير موجودين');
  assert.equal(rows.filter((r) => r.action === 'update').length, 10, 'سطور تعديل ناقصة');
  for (const r of rows) {
    assert.equal(r.username, 'admin', 'الفاعل غير مسجَّل');
    assert.ok(r.detail_json, 'سطر تدقيق بلا تفصيل');
    assert.match(r.detail_json, /كشف المالك/);
  }
  const one = rows.find((r) => r.resource_id === byCode('INV/2026/000089').liveId);
  const detail = JSON.parse(one.detail_json);
  const codeChange = detail.changes.find((c) => c.column === 'code');
  assert.equal(codeChange.from, null);
  assert.equal(codeChange.to, 'INV/2026/000089');
  const dateChange = detail.changes.find((c) => c.column === 'issue_date');
  assert.equal(dateChange.from, STAMP, 'القيمة السابقة للتاريخ غير مسجَّلة — لا تراجع بلا سجل');
  assert.equal(dateChange.to, '2026-07-09');
});

// ═══ ٣) إعادة التشغيل ═══════════════════════════════════════════════════════════════════════
test('إعادة التشغيل بـ --apply لا تكرّر صفاً ولا تغيّر قيمة ولا تكتب تدقيقاً', async () => {
  const before = await snapshot();
  const beforeAudit = await auditCount();

  const again = run(['--apply']);

  assert.equal(await snapshot(), before, 'إعادة التشغيل غيّرت بيانات');
  assert.equal(await auditCount(), beforeAudit, 'إعادة التشغيل كتبت سطور تدقيق مكرّرة');
  assert.equal((await db.get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL')).n, 12, 'أُنشئت فاتورة مكرّرة');
  assert.match(again, /أُنشئت 0 · عُدِّلت 0/);
  assert.match(again, /موجودة أصلاً برقمها — لا إنشاء/);
});

test('المعاينة بعد التنفيذ تقول إنه لا تغيير باقٍ', async () => {
  const out = run();
  assert.match(out, /الخلاصة: إنشاء 0 · تعديل 0 · مضبوطة أصلاً 12/);
  assert.match(out, /\(لا تغيير — الصف مضبوط أصلاً\)/);
});

// ═══ ٤) حرّاس الأمان ════════════════════════════════════════════════════════════════════════
test('فاتورة اختلف مبلغها عن الكشف لا تُمسّ ولو بحرف', async () => {
  const victim = byCode('INV/2026/000097');
  await db.run('UPDATE invoice SET code = NULL, issue_date = ?, amount_halalas = ? WHERE id = ?',
    [STAMP, H(1.00), victim.liveId]);
  const out = run(['--apply']);
  const row = await inv(victim.liveId);
  assert.equal(row.code, null, 'عُدِّلت فاتورة مبلغها يخالف الكشف');
  assert.equal(row.issue_date, STAMP);
  assert.ok(out.includes(victim.code) && out.includes('يخالف كشف المالك'), 'لم يُنبَّه على اختلاف المبلغ');
  // استرجاع الحال كي لا تتأثر بقية الملف
  await db.run('UPDATE invoice SET code = ?, issue_date = ?, amount_halalas = ? WHERE id = ?',
    [victim.code, '2026-07-09', H(victim.gross), victim.liveId]);
});

test('تاريخ إصدار غير تاريخ الترحيل لا يُدهَس — يُطلب قرار إنسان', async () => {
  const victim = byCode('INV/2026/000096');
  await db.run('UPDATE invoice SET issue_date = ? WHERE id = ?', ['2026-01-15', victim.liveId]);
  const out = run(['--apply']);
  assert.equal((await inv(victim.liveId)).issue_date, '2026-01-15', 'دُهس تاريخ إصدار مكتوب بقيمة ثالثة');
  assert.match(out, /«issue_date» مشغولة بقيمة مختلفة/);
  await db.run('UPDATE invoice SET issue_date = ? WHERE id = ?', ['2026-07-09', victim.liveId]);
});
