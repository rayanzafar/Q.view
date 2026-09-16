// ── قراءة دفتر التعبئة ومطابقته على المنصة: ما يفهمه القارئ البشري يفهمه القارئ الآلي ────────
// هذه اختباراتُ الطرف الخالص وحده: لا قاعدة بيانات ولا خدمة ولا شبكة. الدفاتر تُبنى هنا —
// دفترٌ حقيقي من مولّد الدفاتر ثم تُستبدل أوراقُ بياناته بصفوفٍ مصنوعة — كي يبقى كلُّ ما يخصّ
// الشكل (الأعمدة المخفية، ورقة «قوائم»، هوية الدفتر) حقيقياً بلا تزييف.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from '../../vendor/xlsx/xlsx.mjs';
import { ALL_SHEETS, isHelper, isCalc, sheetKey } from '../../scripts/make-sap-intake-workbook.mjs';
import {
  readWorkbook, normArabic, tokenSet, jaccard, matchOne, parseDateCell, netToStoredHalalas,
  suspectExampleResidue, diffOf, projectStatusKey, ragKey, deliverableStatusKey, allocationTypeKey,
  ROLE_LABELS, PROJECT_STATUS_LABELS, RAG_LABELS, numberOf, specOf,
} from '../../scripts/lib/workbook-read.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REAL_FILE = '/home/zunix/Q.view/دفتر-بيانات-قطاع-الاستشاراتfilled.xlsx';
const specByName = (name) => ALL_SHEETS.find((s) => s.name === name);

// ─────────────────────────────────────────────────────────────────────────────
// §1 تطبيع العربية
// ─────────────────────────────────────────────────────────────────────────────

test('normArabic: ما لا يفرّقه القارئ لا تفرّقه المطابقة', () => {
  assert.equal(normArabic('مشروع  بناء'), normArabic('مشروع بناء'), 'الفراغ المزدوج فرّق اسمين');
  assert.equal(normArabic('مشروع بناء '), normArabic('مشروع بناء'), 'الفراغ الطرفي فرّق اسمين');
  assert.equal(
    normArabic('مشروع تطویر الحلول الابتكاریة لمنصة بیانات السعودیة'),
    normArabic('مشروع تطوير الحلول الابتكارية لمنصة بيانات السعودية'),
    'الياء الفارسية (ی) فرّقت اسماً عن نفسه',
  );
  assert.equal(normArabic('مکتب البنية'), normArabic('مكتب البنية'), 'الكاف الفارسية (ک) لم تُوحَّد');
  assert.equal(normArabic('إدارة آل مؤسّسة'), 'اداره ال موسسه');
  assert.equal(normArabic('الهيئة الملكية ٢٠٢٦'), 'الهييه الملكيه 2026');
  assert.equal(normArabic('لعام ۲۰۲۶'), 'لعام 2026', 'الأرقام الفارسية لم تُردّ');
  assert.equal(normArabic('  Data   Science '), 'data science');
  assert.notEqual(normArabic('استراتيحية'), normArabic('استراتيجية'), 'خطأ إملائي حقيقي لا يُبتلع');
});

test('tokenSet وjaccard: قياسُ القرب بالكلمات لا بالحروف', () => {
  assert.deepEqual([...tokenSet('مشروع بناء (الاستراتيجية)')], ['مشروع', 'بناء', 'الاستراتيجيه']);
  assert.equal(jaccard('أ ب ج', 'أ ب ج'), 1);
  assert.equal(jaccard('أ ب ج د', 'أ ب ج ه'), 0.6, 'ثلاثٌ مشتركة من خمسٍ مجموعة = 0.6');
  assert.equal(jaccard('أ ب', 'ج د'), 0);
  assert.equal(jaccard('', 'أ ب'), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 مطابقة الأسماء
// ─────────────────────────────────────────────────────────────────────────────

test('matchOne: الحرف الساقط من أول الاسم لا يضيّع المشروع', () => {
  const live = [
    { id: 'p1', name_ar: 'تشغيل وتجديد رخص مكتب البنية المؤسسية' },
    { id: 'p2', name_ar: 'مشروع بناء الاستراتيجية للتحول الرقمي' },
  ];
  const m = matchOne('شغيل وتجديد رخص مكتب البنية المؤسسية', live);
  assert.equal(m.hit?.id, 'p1');
  assert.equal(m.rule, 'contains');
  assert.equal(m.score, 0.9);
  assert.equal(m.ambiguous, false);
});

test('matchOne: التطابق الحرفي بعد التطبيع يقين، وسلّمُه فوق الاحتواء', () => {
  const live = [{ id: 'p1', name_ar: 'مشروع تطوير الحلول الابتكارية' }];
  const m = matchOne('مشروع تطویر الحلول الابتكاریة ', live);
  assert.equal(m.hit?.id, 'p1');
  assert.equal(m.rule, 'exact');
  assert.equal(m.score, 1);
});

test('matchOne: مرشحان يحتويان الاسم → التباسٌ يُرفع، لا ترجيحٌ صامت', () => {
  const live = [
    { id: 'p1', name_ar: 'مشروع الامتثال لمتطلبات هيئة الحكومة الرقمية لعام 2025' },
    { id: 'p2', name_ar: 'مشروع الامتثال لمتطلبات هيئة الحكومة الرقمية لعام 2026' },
  ];
  const m = matchOne('مشروع الامتثال لمتطلبات هيئة الحكومة الرقمية', live);
  assert.equal(m.hit, null, 'اختار واحداً من متشابهَين');
  assert.equal(m.ambiguous, true);
  assert.ok(m.runnerUp, 'لم يُسمَّ المرشح الثاني');
});

test('matchOne: تشابهٌ دون العتبة لا يُعدّ مطابقة', () => {
  const live = [{ id: 'p1', name_ar: 'ألف باء جيم دال' }];
  const m = matchOne('ألف باء جيم هاء', live);
  assert.equal(m.score, 0.6);
  assert.equal(m.hit, null, '0.6 دون عتبة 0.7 ومع ذلك طابق');
  assert.equal(m.rule, null);
  assert.equal(m.ambiguous, false);
});

test('matchOne: قائمةٌ فارغة أو اسمٌ فارغ → لا مطابقة ولا انفجار', () => {
  assert.equal(matchOne('', [{ name_ar: 'شيء' }]).hit, null);
  assert.equal(matchOne('شيء', []).hit, null);
  assert.equal(matchOne('شيء', null).hit, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 التواريخ والمال
// ─────────────────────────────────────────────────────────────────────────────

test('parseDateCell: الغامض يُعلَن غامضاً ولا يُخمَّن', () => {
  const amb = parseDateCell('2/12/2026');
  assert.equal(amb.date, null, 'خمّن تاريخاً يحتمل قراءتين');
  assert.deepEqual(amb.ambiguous, { dmy: '2026-12-02', mdy: '2026-02-12' });
  assert.match(amb.reason, /قراءتين/);

  const clear = parseDateCell('31/12/2026');
  assert.equal(clear.date, '2026-12-31', 'اليوم 31 لا يكون شهراً — فلا لبس');
  assert.equal(clear.ambiguous, null);

  assert.equal(parseDateCell('2026-01-20').date, '2026-01-20');
  assert.equal(parseDateCell('10/12/2026').ambiguous?.dmy, '2026-12-10');
  assert.equal(parseDateCell('20/1/2026').date, '2026-01-20');
  assert.equal(parseDateCell(46042).date, '2026-01-20', 'رقم إكسل التسلسلي لم يُحوَّل');
  assert.equal(parseDateCell('').date, null);
  assert.match(parseDateCell('قريباً').reason, /صيغة تاريخ غير معروفة/);
  assert.match(parseDateCell('31/02/2026').reason, /التقويم/);
});

test('netToStoredHalalas: الصافي بالريال → الإجمالي بالهللات', () => {
  assert.equal(netToStoredHalalas(1282343.04), 147469450);
  assert.equal(netToStoredHalalas('1,282,343.04'), 147469450, 'الفواصل منعت القراءة');
  assert.equal(netToStoredHalalas(5000000), 575000000);
  assert.equal(netToStoredHalalas(0), 0);
  assert.equal(netToStoredHalalas('لا شيء'), 0);
  assert.equal(numberOf('١٬٢٨٢٬٣٤٣٫٠٤'), 1282343.04, 'الأرقام الهندية لم تُقرأ');
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 خرائط الكلمات → القيم المخزَّنة (ومرآتُها لا تفترق عن أصلها)
// ─────────────────────────────────────────────────────────────────────────────

test('الكلمة العربية تُردّ إلى قيمتها المخزَّنة', () => {
  assert.equal(projectStatusKey('قيد التنفيذ'), 'IN_PROGRESS');
  assert.equal(projectStatusKey('متوقف'), 'ON_HOLD');
  assert.equal(projectStatusKey('مُخطَّط'), 'PLANNED');
  assert.equal(projectStatusKey('كلمةٌ ليست حالة'), null);
  assert.equal(ragKey('أخضر'), 'GREEN');
  assert.equal(ragKey('كهرماني'), 'AMBER');
  assert.equal(deliverableStatusKey('تم الاعتماد'), 'ACCEPTED');
  assert.equal(deliverableStatusKey('جارٍ العمل'), 'IN_PROGRESS');
  assert.equal(allocationTypeKey('مدير المشروع'), 'pm');
  assert.equal(allocationTypeKey('قائد الفريق'), 'lead');
  assert.equal(allocationTypeKey('عضو فريق'), 'member');
  assert.equal(allocationTypeKey('مالك'), 'owner');
  assert.equal(allocationTypeKey('قائد المشروع'), 'lead', 'لفظ قائمة الدفتر لم يُردّ إلى دور المنصة');
});

test('المرايا لا تفترق عن أصلها في المنصة', () => {
  // الملفان يستوردان طبقة القاعدة فلا يُستوردان هنا — فيُقرأ نصُّهما ويُقارَن.
  const resources = readFileSync(join(ROOT, 'src/modules/team/resources.js'), 'utf8');
  for (const [k, label] of Object.entries(ROLE_LABELS)) {
    assert.ok(resources.includes(`${k}: '${label}'`), `دور «${label}» (${k}) افترق عن ROLE_AR في المنصة`);
  }
  assert.equal(Object.keys(ROLE_LABELS).length, 6, 'عدد أدوار المنصة تغيّر — راجع المرآة');

  const adapter = readFileSync(join(ROOT, 'src/modules/io/adapters/projects.js'), 'utf8');
  for (const [k, labels] of Object.entries(PROJECT_STATUS_LABELS)) {
    assert.ok(adapter.includes(`v: '${k}'`), `حالة «${k}» لم تعد في محوّل المشاريع`);
    for (const l of labels) assert.ok(adapter.includes(`'${l}'`), `لفظ «${l}» افترق عن محوّل المشاريع`);
  }
  for (const [k, labels] of Object.entries(RAG_LABELS)) {
    assert.ok(adapter.includes(`v: '${k}'`), `مؤشر «${k}» لم يعد في محوّل المشاريع`);
    for (const l of labels) assert.ok(adapter.includes(`'${l}'`), `لفظ «${l}» افترق عن محوّل المشاريع`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 بقايا صف المثال
// ─────────────────────────────────────────────────────────────────────────────

test('suspectExampleResidue: قيمُ المثال المتروكة في السطر الأول تُكشف — وما جاوَره لا', () => {
  const spec = specByName('المشاريع');
  const ex = (h) => spec.example[spec.columns.findIndex((c) => c.header === h)];
  assert.equal(ex('مدير المشروع'), 'سارة خالد القحطاني');

  assert.equal(suspectExampleResidue(spec, 0, 'مدير المشروع', 'سارة خالد القحطاني'), true);
  assert.equal(suspectExampleResidue(spec, 0, 'قيمة العقد بدون ضريبة', 5000000), true);
  assert.equal(suspectExampleResidue(spec, 0, 'قيمة العقد بدون ضريبة', '5,000,000.00'), true, 'المنسَّق لم يُقارن رقماً');
  assert.equal(suspectExampleResidue(spec, 0, 'تاريخ توقيع العقد', '2026-01-20'), true);

  assert.equal(suspectExampleResidue(spec, 0, 'العميل', 'تكامل القابضة'), false, 'عميلٌ حقيقي وُصم بالمثال');
  assert.equal(suspectExampleResidue(spec, 0, 'اسم المشروع', 'مشروع بناء الاستراتيجية'), false);
  assert.equal(suspectExampleResidue(spec, 1, 'مدير المشروع', 'سارة خالد القحطاني'), false, 'السطر الثاني ليس صفَّ المثال');
  assert.equal(suspectExampleResidue(spec, 0, 'مدير المشروع', null), false);
  assert.equal(suspectExampleResidue(spec, 0, 'عمودٌ لا وجود له', 'شيء'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 الفروق عن المخزَّن
// ─────────────────────────────────────────────────────────────────────────────

test('diffOf: يُكتب ما يضيفه الدفتر وحده — لا الاسم ولا الغامض ولا هللةُ التقريب', () => {
  const row = {
    rowNo: 5,
    residue: ['مدير المشروع'],
    cells: {
      'اسم المشروع': 'إملاءٌ مختلف للاسم',
      'حالة المشروع': 'مكتمل',
      'مؤشر الصحة': 'أحمر',
      'نسبة الإنجاز (%)': 80,
      'قيمة العقد بدون ضريبة': 1282343.04,
      'تاريخ البداية': '2/12/2026',
      'تاريخ النهاية': '31/12/2026',
      'مدير المشروع': 'سارة خالد القحطاني',
    },
  };
  const map = {
    name_ar: { header: 'اسم المشروع' },
    status: { header: 'حالة المشروع', kind: 'enum', map: projectStatusKey },
    rag: { header: 'مؤشر الصحة', kind: 'enum', map: ragKey },
    progress_pct: { header: 'نسبة الإنجاز (%)', kind: 'int' },
    contract_value_halalas: { header: 'قيمة العقد بدون ضريبة', kind: 'money' },
    start_date: { header: 'تاريخ البداية', kind: 'date' },
    end_date: { header: 'تاريخ النهاية', kind: 'date' },
    pm_name: { header: 'مدير المشروع' },
  };
  const live = {
    name_ar: 'الاسم كما أثبتته المنصة',
    status: 'IN_PROGRESS',
    rag: 'RED',
    progress_pct: 80,
    contract_value_halalas: 147469449,   // هللةٌ واحدة فرقاً — دون السماح
    start_date: null,
    end_date: null,
    pm_name: null,
  };
  const patch = diffOf(live, row, map);
  assert.deepEqual(patch, { status: 'COMPLETED', end_date: '2026-12-31' });
  assert.ok(!('name_ar' in patch), 'الاسم لا يُكتب أبداً');
  assert.ok(!('start_date' in patch), 'تاريخٌ غامض كُتب بدل أن يُرفع');
  assert.ok(!('pm_name' in patch), 'بقيّةُ المثال كُتبت');
  assert.ok(!('contract_value_halalas' in patch), 'هللةُ تقريبٍ اعتُبرت تغييراً');
  assert.ok(!('rag' in patch) && !('progress_pct' in patch), 'ما لم يتغيّر كُتب');

  const empty = diffOf(live, { cells: {}, residue: [] }, map);
  assert.deepEqual(empty, {}, 'صفٌّ فارغ أنتج رقعة');
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 قراءة دفترٍ مبنيٍّ للاختبار
// ─────────────────────────────────────────────────────────────────────────────

const HELPER_OF = (spec) => spec.columns.find(isHelper)?.header || null;
const DATA_HEADERS = (spec) => spec.columns.filter((c) => !isHelper(c)).map((c) => c.header);

/** يبني دفتراً حقيقياً بالمولّد ثم يستبدل أوراق بياناته بصفوفٍ مصنوعة. */
function buildFixture(dir, replacements) {
  const base = join(dir, 'أصل.xlsx');
  execFileSync(process.execPath, [
    join(ROOT, 'scripts/make-sap-intake-workbook.mjs'),
    '--sector=قطاع الاختبار', '--departments=أ،ب', `--out=${base}`,
  ], { cwd: ROOT, stdio: 'pipe' });

  const wb = XLSX.read(readFileSync(base), { type: 'buffer' });
  for (const [name, aoa] of Object.entries(replacements)) {
    wb.Sheets[name] = XLSX.utils.aoa_to_sheet(aoa);
  }
  const out = join(dir, 'دفتر-الاختبار.xlsx');
  writeFileSync(out, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  return out;
}

test('readWorkbook: الهوية والسحب والصفوف المُسقَطة والعمود الدخيل', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wbk-'));
  const projSpec = specByName('المشاريع');
  const dlvSpec = specByName('المخرجات');
  const projHeaders = DATA_HEADERS(projSpec);
  const cell = (spec, headers, values) => headers.map((h) => (h in values ? values[h] : null));

  // ── المشاريع: السطر الأول بقاياه من المثال، والثاني بتاريخين أحدهما غامض ──
  const projects = [
    projHeaders,
    cell(projSpec, projHeaders, {
      'اسم المشروع': 'مشروع بناء الاستراتيجية للتحول الرقمي',
      العميل: 'تكامل القابضة',
      الإدارة: 'أ',
      'مدير المشروع': 'سارة خالد القحطاني',      // بقية مثال
      'حالة المشروع': 'قيد التنفيذ',              // بقية مثال
      'مؤشر الصحة': 'أخضر',                      // بقية مثال
      'تاريخ توقيع العقد': '2026-01-20',          // بقية مثال
      'قيمة العقد بدون ضريبة': 5000000,           // بقية مثال
    }),
    cell(projSpec, projHeaders, {
      'اسم المشروع': 'مشروع الامتثال لمتطلبات هيئة الحكومة الرقمية',
      العميل: 'الهيئة الملكية لمحافظة العلا',
      الإدارة: 'ب',
      'قيمة العقد بدون ضريبة': 1282343.04,
      'تاريخ البداية': '2/12/2026',
      'تاريخ النهاية': '31/12/2026',
    }),
  ];

  // ── المخرجات: عمودٌ دخيل «y» قبل العمود المساعد، وثلاثة صفوفٍ يُسحب إليها الأصل ──
  const dlvHeaders = DATA_HEADERS(dlvSpec);
  const helper = HELPER_OF(dlvSpec);
  const fileHeaders = [...dlvHeaders, 'y', helper];
  const dlvRow = (values, { helperVal = null, stray = null } = {}) =>
    [...dlvHeaders.map((h) => (h in values ? values[h] : null)), stray, helperVal];
  const PARENT = 'مشروع بناء الاستراتيجية للتحول الرقمي';
  const deliverables = [
    fileHeaders,
    dlvRow({
      المشروع: PARENT, المعلم: 'مرحلة أولى', المخرج: 'مخرج أ', 'المبلغ بدون ضريبة': 100000,
      'شهر الاستحقاق': 3, 'سنة الاستحقاق': 2025, 'حالة المخرج': 'مسودة', المسؤول: 'وئام علي الزهراني',
    }, { helperVal: PARENT, stray: 'قيمة دخيلة' }),
    dlvRow({ المعلم: 'مرحلة أولى', المخرج: 'مخرج ب', 'المبلغ بدون ضريبة': 200000 }, { helperVal: PARENT }),
    dlvRow({ المخرج: 'مخرج ج', 'المبلغ بدون ضريبة': 300000 }, { helperVal: PARENT }),
    dlvRow({}, { helperVal: PARENT }),                                  // مساعدٌ وحده → يُسقَط ويقطع السحب
    dlvRow({ المخرج: 'مخرج يتيم', 'المبلغ بدون ضريبة': 400000 }, { helperVal: PARENT }),
    dlvRow({ المشروع: 'مشروع آخر', المخرج: 'مخرج د', 'المبلغ بدون ضريبة': 500000 }, { helperVal: 'مشروع آخر' }),
  ];

  const file = buildFixture(dir, { المشاريع: projects, المخرجات: deliverables });
  const wbk = readWorkbook(file);

  // الهوية
  assert.equal(wbk.identity.sectorName, 'قطاع الاختبار');
  assert.deepEqual(wbk.identity.departments, ['أ', 'ب']);
  assert.ok(wbk.identity.reviewer, 'المراجِع لم يُقرأ');
  assert.match(wbk.sha256, /^[0-9a-f]{64}$/);

  // المشاريع: صفّان، وبقايا المثال مكشوفة ومُفرَّغة
  const p = wbk.sheets.projects;
  assert.equal(p.rows.length, 2);
  const r1 = p.rows[0];
  assert.equal(r1.rowNo, 2);
  assert.deepEqual(
    r1.residue.sort(),
    ['مدير المشروع', 'حالة المشروع', 'مؤشر الصحة', 'تاريخ توقيع العقد', 'قيمة العقد بدون ضريبة'].sort(),
  );
  assert.equal(r1.cells['مدير المشروع'], null, 'بقيّة المثال بقيت قيمةً');
  assert.equal(r1.cells['العميل'], 'تكامل القابضة', 'عميلٌ حقيقي فُرِّغ مع البقايا');
  assert.equal(r1.cells['اسم المشروع'], 'مشروع بناء الاستراتيجية للتحول الرقمي');

  const r2 = p.rows[1];
  assert.equal(r2.residue.length, 0, 'السطر الثاني لا تُفحص بقاياه');
  assert.equal(netToStoredHalalas(r2.cells['قيمة العقد بدون ضريبة']), 147469450);
  assert.equal(parseDateCell(r2.cells['تاريخ البداية']).ambiguous?.dmy, '2026-12-02');
  assert.equal(parseDateCell(r2.cells['تاريخ النهاية']).date, '2026-12-31');
  assert.ok(!('قيمة العقد مع الضريبة' in r2.cells), 'عمودٌ محسوب قُرئ');

  // المخرجات: خمسة صفوف (المساعدُ وحدَه أُسقط)، والسحب انقطع عنده
  const d = wbk.sheets.deliverables;
  assert.equal(d.rows.length, 5, 'الصفّ الذي لا محتوى له إلا في العمود المساعد لم يُسقَط');
  assert.deepEqual(d.rows.map((r) => r.rowNo), [2, 3, 4, 6, 7]);
  assert.deepEqual(d.rows.map((r) => r.parent), [PARENT, PARENT, PARENT, null, 'مشروع آخر']);
  assert.deepEqual(d.rows.map((r) => r.cells['المخرج']), ['مخرج أ', 'مخرج ب', 'مخرج ج', 'مخرج يتيم', 'مخرج د']);
  assert.deepEqual(d.rows.map((r) => r.cells['المبلغ بدون ضريبة']), [100000, 200000, 300000, 400000, 500000]);

  // العمود الدخيل «y» لم يزحزح شيئاً ولم يدخل الصفوف
  assert.ok(!d.headers.includes('y'), 'العمود الدخيل صار عموداً من أعمدة الورقة');
  assert.ok(d.fileHeaders.includes('y'), 'العمود الدخيل لم يُرَ في ترويسة الملف');
  assert.equal(d.rows[0].cells['المسؤول'], 'وئام علي الزهراني', 'العمود الدخيل زحزح القيم');
  assert.equal(d.rows[0].cells['المعلم'], 'مرحلة أولى');
  assert.ok(!Object.values(d.rows[0].cells).includes('قيمة دخيلة'), 'قيمة العمود الدخيل تسرّبت');
  assert.ok(!(helper in d.rows[0].cells), 'العمود المساعد المخفي قُرئ بياناً');

  // «بلا أصل» قضيةٌ مرفوعة لا صفٌّ مُلقى
  const orphan = wbk.issues.filter((i) => i.sheet === 'المخرجات' && i.rowNo === 6);
  assert.equal(orphan.length, 1);
  assert.match(orphan[0].reason, /بلا أصل/);

  // أوراقٌ لم تُملأ تبقى فارغة — وصفُّ المثال لا يصير بياناً
  assert.equal(wbk.sheets.clients.rows.length, 0, 'صفّ المثال دخل البيانات');
  assert.equal(wbk.sheets.staffing.rows.length, 0);
  assert.equal(specOf('projects').name, 'المشاريع');
});

test('readWorkbook: ورقة «التكاليف» السرّية لا تُقرأ إلا بطلب', () => {
  assert.ok(ALL_SHEETS.some((s) => s.optional && s.name === 'التكاليف'));
  assert.equal(sheetKey(specByName('التكاليف')), 'costlines');
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 الملف الحقيقي الذي عبّأه قطاع الاستشارات
// ─────────────────────────────────────────────────────────────────────────────

test('الدفتر المعبّأ الحقيقي يُقرأ بعدده المعروف وبقاياه مكشوفة', { skip: !existsSync(REAL_FILE) && 'الملف المعبّأ غير موجود هنا' }, () => {
  const wbk = readWorkbook(REAL_FILE);
  assert.equal(wbk.identity.sectorName, 'قطاع الاستشارات');
  assert.equal(wbk.identity.departments.length, 4);
  assert.equal(wbk.identity.reviewer, 'مشاعل الخمشي');

  const n = (k) => wbk.sheets[k].rows.length;
  const counts = Object.fromEntries(Object.entries(wbk.sheets).map(([k, s]) => [s.name, s.rows.length]));
  console.log('  عدد صفوف كل ورقة:', JSON.stringify(counts, null, 0));

  assert.equal(n('projects'), 11, 'عدد المشاريع تغيّر');
  assert.equal(n('deliverables'), 140, 'عدد المخرجات تغيّر');
  assert.equal(n('employees'), 28, 'عدد الموظفين تغيّر');
  assert.ok(n('staffing') >= 38, `التسكين ${n('staffing')} — دون المتوقَّع`);
  assert.equal(n('clients'), 0, 'ورقة العملاء ليست فارغة');

  for (const key of ['projects', 'deliverables', 'employees']) {
    const row2 = wbk.sheets[key].rows.find((r) => r.rowNo === 2);
    assert.ok(row2, `${key}: لا سطر ثانٍ`);
    assert.ok(row2.residue.length > 0, `${key}: بقايا صف المثال لم تُكشف في السطر الثاني`);
    console.log(`  بقايا المثال — ${wbk.sheets[key].name} (سطر 2): ${row2.residue.join(' · ')}`);
    for (const h of row2.residue) assert.equal(row2.cells[h], null, `${key}/${h}: بقيّةٌ لم تُفرَّغ`);
  }

  // كل صفوف المخرجات وصلها أصلُها بالسحب — وإلا لضاع ربطُها بمشروعها
  const noParent = wbk.sheets.deliverables.rows.filter((r) => !r.parent);
  assert.equal(noParent.length, 0, `مخرجاتٌ بلا مشروع: ${noParent.map((r) => r.rowNo).join('، ')}`);
});
