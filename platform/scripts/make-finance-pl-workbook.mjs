#!/usr/bin/env node
// «دفتر سطور قائمة الدخل» — مولِّد دفتر Excel عربي تملؤه المالية (أو قائد القطاع) لقطاعٍ
// واحدٍ في سنةٍ واحدة، ثم يعود فيُستورَد من مركز البيانات بنوع «سطور قائمة الدخل».
//
//   node scripts/make-finance-pl-workbook.mjs --sector "قطاع الاستشارات" --year 2026 \
//        --out /مسار/الدفتر.xlsx                    ← دفتر فارغ جاهز للتعبئة
//   node scripts/make-finance-pl-workbook.mjs --sector … --year … --out … --demo
//                                                   ← نسخة معبأة بأرقام تجريبية (لفحص الاستيراد)
//   node scripts/make-finance-pl-workbook.mjs --verify /مسار/الدفتر.xlsx
//                                                   ← فحص بنيوي: الأوراق، والترويسات مطابقةً
//                                                     لعناوين المحوّل حرفاً، وكل خليةٍ معبأة
//                                                     تمرّ من محلّلات المحرك نفسها
//   node scripts/make-finance-pl-workbook.mjs --split /مسار/الدفتر-المعبأ.xlsx [--outdir مجلد]
//                                                   ← يفكّ الدفتر المعبأ إلى ملفَّي استيراد
//                                                     (ورقةٌ واحدة لكل ملف)
//
// ── لماذا ملفّان عند الاستيراد؟ ─────────────────────────────────────────────────────────
// محرك الاستيراد يقرأ **الورقة الأولى وحدها** من الملف المرفوع (`parseWorkbook` في
// `src/modules/io/xlsx.js`). فالدفتر هنا مكتوبٌ للإنسان: «تعليمات» أولاً ثم «الفعلي» ثم
// «الخطة» — ويُفكّ قبل الرفع بـ`--split` إلى ملفَّين كلٌّ منهما ورقةٌ واحدة بترويساتٍ مطابقة،
// يُرفع كلٌّ منهما مرةً واحدة. (نفس نهج `scripts/make-sap-intake-workbook.mjs`.)
//
// ── لماذا يُكتب ملف Excel يدوياً هنا؟ ──────────────────────────────────────────────────
// النسخة المجتمعية من المكتبة المورَّدة لا تكتب القوائم المنسدلة ولا التنسيقات ولا تثبيت
// الترويسة — وهي جوهر «سهل التعبئة». فالملف يُبنى أجزاءً (XML داخل ZIP)، ويُفحص بإعادة قراءته
// بالمكتبة نفسها التي سيقرأ بها المحرك الملفَ العائد.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import * as XLSX from '../vendor/xlsx/xlsx.mjs';
import { buildExport } from '../src/modules/io/xlsx.js';
import { parseCell, makeLookup } from '../src/modules/io/parse.js';
import { PL_LINES, COST_KEYS, LINE_BY_KEY } from '../src/modules/finance/income-statement.js';
import adapter from '../src/modules/io/adapters/finance-pl.js';

// ── §1 ثوابت الدفتر ──────────────────────────────────────────────────────────────────────
const SHEET_INFO = 'تعليمات';
const SHEET_ACTUAL = 'الفعلي';
const SHEET_PLAN = 'الخطة';
const SHEET_LISTS = 'قوائم';
export const SHEET_ORDER = [SHEET_INFO, SHEET_ACTUAL, SHEET_PLAN, SHEET_LISTS];

const COLUMNS = adapter.columns;                       // الترتيب والعناوين من المحوّل نفسه
export const HEADERS = COLUMNS.map((c) => c.labelAr);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** سطور ورقة «الفعلي»: الكلفة وحدها — الإيراد المحقق يقرؤه سند من مخرجات المشاريع لا من الدفتر. */
export const ACTUAL_KEYS = Object.freeze([...COST_KEYS]);
/** سطور ورقة «الخطة»: الإيراد المخطط مع الكلفة المخططة. */
export const PLAN_KEYS = Object.freeze(['rev', ...COST_KEYS]);
const KIND_ACTUAL = 'فعلي';
const KIND_PLAN = 'خطة';

// أرقام النسخة التجريبية (ريالاً) — أرقامٌ معقولة لا حقيقية، للفحص لا للعرض على أحد.
const DEMO_ACTUAL = { sal: 420000, con: 180000, ctr: 95000, lic: 12000, rent: 45000, oth: 30000 };
const DEMO_PLAN = { rev: 2000000, sal: 400000, con: 200000, ctr: 100000, lic: 15000, rent: 45000, oth: 35000 };

const COLORS = { header: 'FF1F4E79', headerAlt: 'FF2E7D6F', title: 'FF1F4E79', hint: 'FF6B7280', border: 'FFBFBFBF', band: 'FFF3F6FA' };

// ── §2 أدوات ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };

// ── §3 كاتب/قارئ ZIP على node:zlib ──────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 22;   // طابع ثابت: بناءٌ قابل لإعادة الإنتاج
const DOS_TIME = 0;
function zipWrite(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const comp = deflateRawSync(data, { level: 9 });
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
function zipRead(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ليس ملف Excel صالحاً — لا نهاية فهرس');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const parts = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('فهرس الملف تالف');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16); const compLen = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32); const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26); const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    // الجزء إما مضغوطاً (8) وإما مخزَّناً كما هو (0) — وملفُّ المكتبة المورَّدة يكتب الثاني أحياناً
    const raw = buf.subarray(dataStart, dataStart + compLen);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    if (crc32(data) !== crc) throw new Error(`تحقق سلامة الجزء ${name} فشل`);
    parts.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}

// ── §4 الأنماط ───────────────────────────────────────────────────────────────────────────
const S = { DEFAULT: 0, CELL: 1, HEADER: 2, HEADER_ALT: 3, MONEY: 4, TITLE: 5, BODY: 6, SUBHEAD: 7, BAND: 8, BAND_MONEY: 9 };
function stylesXml() {
  const font = (e) => `<font><sz val="${e.sz || 11}"/>${e.b ? '<b/>' : ''}${e.i ? '<i/>' : ''}${e.color ? `<color rgb="${e.color}"/>` : ''}<name val="Calibri"/></font>`;
  const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/></patternFill></fill>`;
  const xf = ({ f = 0, fl = 0, b = 0, n = 0, align = '' } = {}) =>
    `<xf numFmtId="${n}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0"`
    + `${n ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}`
    + `${b ? ' applyBorder="1"' : ''}${align ? ` applyAlignment="1">${align}</xf>` : '/>'}`;
  const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const vmid = '<alignment vertical="center"/>';
  const body = '<alignment vertical="top" wrapText="1"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="5">${[
    font({}), font({ b: 1, color: 'FFFFFFFF' }), font({ sz: 16, b: 1, color: COLORS.title }),
    font({ b: 1, color: COLORS.title }), font({ sz: 10, i: 1, color: COLORS.hint }),
  ].join('')}</fonts>
<fills count="5">${['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    fill(COLORS.header), fill(COLORS.headerAlt), fill(COLORS.band)].join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="${COLORS.border}"/></left><right style="thin"><color rgb="${COLORS.border}"/></right><top style="thin"><color rgb="${COLORS.border}"/></top><bottom style="thin"><color rgb="${COLORS.border}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">${[
    xf({}),                                     // 0 DEFAULT
    xf({ b: 1, align: vmid }),                  // 1 CELL
    xf({ f: 1, fl: 2, b: 1, align: center }),   // 2 HEADER
    xf({ f: 1, fl: 3, b: 1, align: center }),   // 3 HEADER_ALT
    xf({ b: 1, n: 164, align: vmid }),          // 4 MONEY
    xf({ f: 2, align: vmid }),                  // 5 TITLE
    xf({ align: body }),                        // 6 BODY
    xf({ f: 3, align: vmid }),                  // 7 SUBHEAD
    xf({ fl: 4, b: 1, align: vmid }),           // 8 BAND
    xf({ fl: 4, b: 1, n: 164, align: vmid }),   // 9 BAND_MONEY
  ].join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ── §5 الأجزاء الثابتة ───────────────────────────────────────────────────────────────────
const contentTypesXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${SHEET_ORDER.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
const workbookXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${SHEET_ORDER.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}"${name === SHEET_LISTS ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;
const workbookRelsXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${SHEET_ORDER.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${SHEET_ORDER.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// ── §6 باني الورقة ───────────────────────────────────────────────────────────────────────
function cellXml(ref, s, val) {
  if (val == null || val === '') return `<c r="${ref}" s="${s}"/>`;
  if (typeof val === 'number') return `<c r="${ref}" s="${s}"><v>${val}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${esc(val)}</t></is></c>`;
}
function worksheetXml({ dimension, freeze = false, selected = false, cols = [], rows = [], validations = [] }) {
  const colsXml = cols.length
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rowsXml = rows.map(({ r, ht, cells }) => `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`).join('');
  const dv = validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${dimension}"/>
<sheetViews><sheetView rightToLeft="1"${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${freeze
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ''}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${colsXml}<sheetData>${rowsXml}</sheetData>
${dv}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}
const validationXml = ({ sqref, listRef, title, prompt }) =>
  `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop"`
  + ` errorTitle="اختر من القائمة" error="هذه الخانة تقبل قيم القائمة المنسدلة فقط — افتح السهم واختر."`
  + ` promptTitle="${esc(title)}" prompt="${esc(prompt)}" sqref="${sqref}"><formula1>${esc(listRef)}</formula1></dataValidation>`;

// ── §7 الأوراق ───────────────────────────────────────────────────────────────────────────
const COL_OF = Object.fromEntries(COLUMNS.map((c, i) => [c.key, colLetter(i + 1)]));
const WIDTHS = [22, 9, 9, 26, 10, 18, 34];

/** صفوف ورقة بيانات: شهرٌ بعد شهر، وداخل الشهر السطور بترتيب قائمة الدخل. */
export function dataRows({ sector, year, keys, kindAr, demo = false, demoMap = {} }) {
  const out = [];
  for (const m of MONTHS) {
    for (const key of keys) {
      out.push({
        sector, year, month: m, line: LINE_BY_KEY[key].ar, kind: kindAr,
        amount: demo ? (demoMap[key] ?? 0) : '', note: '',
      });
    }
  }
  return out;
}

function dataSheetXml({ rows, headerStyle, validations }) {
  const sheetRows = [{
    r: 1, ht: 26,
    cells: HEADERS.map((h, i) => cellXml(`${colLetter(i + 1)}1`, headerStyle, h)),
  }];
  rows.forEach((row, i) => {
    const r = i + 2;
    const band = Math.floor(i / (rows.length / 12)) % 2 === 1;
    const textStyle = band ? S.BAND : S.CELL;
    const moneyStyle = band ? S.BAND_MONEY : S.MONEY;
    sheetRows.push({
      r,
      cells: COLUMNS.map((c, ci) => cellXml(`${colLetter(ci + 1)}${r}`,
        c.key === 'amount' ? moneyStyle : textStyle,
        c.key === 'amount' && row.amount === '' ? '' : row[c.key])),
    });
  });
  return worksheetXml({
    dimension: `A1:${colLetter(HEADERS.length)}${rows.length + 1}`,
    freeze: true, cols: WIDTHS, rows: sheetRows, validations,
  });
}

/** ورقة القوائم المخفية: عمودٌ لبنود قائمة الدخل وعمودٌ للنوع — مرجعا القائمتين المنسدلتين. */
function listsSheetXml() {
  const lineNames = PLAN_KEYS.map((k) => LINE_BY_KEY[k].ar);
  const kinds = [KIND_ACTUAL, KIND_PLAN];
  const rows = [];
  const n = Math.max(lineNames.length, kinds.length) + 1;
  for (let r = 1; r <= n; r++) {
    const cells = [];
    if (r === 1) { cells.push(cellXml('A1', S.SUBHEAD, 'البند'), cellXml('B1', S.SUBHEAD, 'النوع')); }
    else {
      if (lineNames[r - 2] != null) cells.push(cellXml(`A${r}`, S.DEFAULT, lineNames[r - 2]));
      if (kinds[r - 2] != null) cells.push(cellXml(`B${r}`, S.DEFAULT, kinds[r - 2]));
    }
    if (cells.length) rows.push({ r, cells });
  }
  return worksheetXml({ dimension: `A1:B${n}`, cols: [30, 12], rows });
}
const LINE_LIST_REF = () => `'${SHEET_LISTS}'!$A$2:$A$${PLAN_KEYS.length + 1}`;
const KIND_LIST_REF = () => `'${SHEET_LISTS}'!$B$2:$B$3`;

function infoSheetXml({ sector, year }) {
  const lines = [
    [S.TITLE, `دفتر سطور قائمة الدخل — ${sector} — سنة ${year}`],
    [S.BODY, ''],
    [S.SUBHEAD, 'ما المطلوب؟'],
    [S.BODY, 'ورقتان: «الفعلي» لما أقفلته المالية شهراً بشهر، و«الخطة» لما خُطِّط للسنة موزَّعاً على الأشهر. اكتب المبلغ بالريال في عمود «المبلغ (ريال)» فقط — بقية الأعمدة مكتوبة مسبقاً فلا تغيّرها ولا تغيّر عناوين الصف الأول.'],
    [S.BODY, ''],
    [S.SUBHEAD, 'ورقة «الفعلي»: بنود الكلفة الستة فقط'],
    [S.BODY, `${ACTUAL_KEYS.map((k) => LINE_BY_KEY[k].ar).join('، ')}. أما الإيراد المحقق فلا يُكتب هنا: سند يقرؤه من مخرجات المشاريع ومستخلصاتها، وكتابته مرتين تعني رقمين لا يتطابقان.`],
    [S.BODY, ''],
    [S.SUBHEAD, 'ورقة «الخطة»: الإيراد مع بنود الكلفة'],
    [S.BODY, `${PLAN_KEYS.map((k) => LINE_BY_KEY[k].ar).join('، ')}. ولو لم يكن لديكم توزيعٌ شهري للخطة فاقسم الرقم السنوي على اثني عشر — التقريب معلومٌ خيرٌ من فراغ.`],
    [S.BODY, ''],
    [S.SUBHEAD, 'الشهر الذي لم يُقفل بعد'],
    [S.BODY, 'احذف صفّه كاملاً من الورقة. الخانة الفارغة تُردّ عند الرفع برسالة «القيمة مطلوبة»، والصفر معناه «أُقفل الشهر ولا صرف على هذا البند» — وهو خبرٌ آخر تماماً.'],
    [S.BODY, ''],
    [S.SUBHEAD, 'الشهر الذي رُفع سابقاً يُعدّ مُقفلاً'],
    [S.BODY, 'الشاشة تقرأ «آخر شهرٍ مُقفل» من آخر شهرٍ وصلت أرقامه. فإن رفعت شهراً ثم صحّحته، ارفع الصف نفسه بمبلغه الجديد: يُحدَّث السطر ويرتفع إصداره ويبقى القديم في سجل التغييرات.'],
    [S.BODY, ''],
    [S.SUBHEAD, 'كيف يُرفع الدفتر؟'],
    [S.BODY, 'الرفع من «مركز البيانات» ← نوع «سطور قائمة الدخل». وكل رفعةٍ ورقةٌ واحدة: تُرفع «الفعلي» أولاً ثم «الخطة» (فريق المنصة يفكّ الدفتر إلى ملفَّين قبل الرفع، أو احفظ كل ورقة ملفاً مستقلاً من Excel).'],
    [S.BODY, ''],
    [S.SUBHEAD, 'ماذا يظهر على الشاشة؟'],
    [S.BODY, 'كل بندٍ لم تصل أرقامه يبقى «لم يُسجَّل» بالرمادي — لا صفراً. وحين تصل الأرقام تُقارن بما سجّله مديرو المشاريع من مصروفات في سند، وتظهر شارة «مطابق سند» حين يتطابق الرقمان في حدود السماح.'],
    [S.BODY, ''],
    [S.BODY, 'الأسماء في عمود «البند» هي أسماء قائمة الدخل المعتمدة حرفاً — اخترها من القائمة المنسدلة ولا تكتبها يدوياً.'],
  ];
  const rows = lines.map(([style, text], i) => ({
    r: i + 1, ht: style === S.TITLE ? 30 : (style === S.BODY && text ? 34 : 20),
    cells: [cellXml(`A${i + 1}`, style, text)],
  }));
  return worksheetXml({ dimension: `A1:A${lines.length}`, selected: true, cols: [120], rows });
}

// ── §8 البناء ────────────────────────────────────────────────────────────────────────────
export function buildWorkbookBuffer({ sector, year, demo = false }) {
  const actual = dataRows({ sector, year, keys: ACTUAL_KEYS, kindAr: KIND_ACTUAL, demo, demoMap: DEMO_ACTUAL });
  const plan = dataRows({ sector, year, keys: PLAN_KEYS, kindAr: KIND_PLAN, demo, demoMap: DEMO_PLAN });
  const dv = (rowCount) => [
    validationXml({ sqref: `${COL_OF.line}2:${COL_OF.line}${rowCount + 1}`, listRef: LINE_LIST_REF(), title: 'البند', prompt: 'اختر بند قائمة الدخل من القائمة' }),
    validationXml({ sqref: `${COL_OF.kind}2:${COL_OF.kind}${rowCount + 1}`, listRef: KIND_LIST_REF(), title: 'النوع', prompt: 'فعلي لما أُقفل، خطة لما خُطِّط' }),
  ];
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(), 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(infoSheetXml({ sector, year }), 'utf8') },
    { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(dataSheetXml({ rows: actual, headerStyle: S.HEADER, validations: dv(actual.length) }), 'utf8') },
    { name: 'xl/worksheets/sheet3.xml', data: Buffer.from(dataSheetXml({ rows: plan, headerStyle: S.HEADER_ALT, validations: dv(plan.length) }), 'utf8') },
    { name: 'xl/worksheets/sheet4.xml', data: Buffer.from(listsSheetXml(), 'utf8') },
  ];
  return zipWrite(files);
}

// ── §9 الفحص ─────────────────────────────────────────────────────────────────────────────
const aoaOf = (wb, name) => {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
};

/**
 * فحصٌ بنيويّ للملف المبني: الأوراق وترتيبها، والترويسات مطابقةً لعناوين المحوّل حرفاً،
 * والقوائم المنسدلة موجودة، وكل خليةٍ معبأة تمرّ من محلّلات المحرك نفسها.
 * @returns {{ok:boolean, errors:string[], notes:string[], sheets:object}}
 */
export function verifyWorkbook(buffer) {
  const errors = [];
  const notes = [];
  const wb = XLSX.read(buffer, { type: 'buffer' });
  for (const name of SHEET_ORDER) if (!wb.SheetNames.includes(name)) errors.push(`ورقة «${name}» مفقودة`);
  if (wb.SheetNames[0] !== SHEET_INFO) errors.push(`الورقة الأولى يجب أن تكون «${SHEET_INFO}»`);

  // القوائم المنسدلة موجودة في ورقتَي البيانات
  const parts = zipRead(buffer);
  for (const [i, name] of [[2, SHEET_ACTUAL], [3, SHEET_PLAN]]) {
    const xml = parts.get(`xl/worksheets/sheet${i}.xml`)?.toString('utf8') || '';
    const count = (xml.match(/<dataValidation /g) || []).length;
    if (count < 2) errors.push(`ورقة «${name}»: القائمتان المنسدلتان (البند، النوع) غير مكتملتين`);
  }

  const sectorNames = new Set();
  const sheets = {};
  for (const [name, keys, kindAr] of [[SHEET_ACTUAL, ACTUAL_KEYS, KIND_ACTUAL], [SHEET_PLAN, PLAN_KEYS, KIND_PLAN]]) {
    const aoa = aoaOf(wb, name);
    if (!aoa) continue;
    const head = (aoa[0] || []).map((h) => String(h).trim());
    if (head.length !== HEADERS.length || head.some((h, i) => h !== HEADERS[i])) {
      errors.push(`ورقة «${name}»: الترويسات لا تطابق عناوين الاستيراد — المتوقع: ${HEADERS.join(' | ')}`);
    }
    const body = aoa.slice(1);
    const expected = keys.length * 12;
    if (body.length !== expected) errors.push(`ورقة «${name}»: عدد الصفوف ${body.length} والمتوقع ${expected} (${keys.length} بنود × 12 شهراً)`);
    const allowed = new Set(keys.map((k) => LINE_BY_KEY[k].ar));
    let filled = 0;
    body.forEach((r, i) => {
      const rowNo = i + 2;
      const cell = (key) => String(r[COLUMNS.findIndex((c) => c.key === key)] ?? '').trim();
      if (!allowed.has(cell('line'))) errors.push(`ورقة «${name}» الصف ${rowNo}: البند «${cell('line')}» ليس من بنود هذه الورقة`);
      if (cell('kind') !== kindAr) errors.push(`ورقة «${name}» الصف ${rowNo}: النوع يجب أن يكون «${kindAr}»`);
      sectorNames.add(cell('sector'));
      if (cell('amount') !== '') filled++;
    });
    sheets[name] = { rows: body.length, filled };
    notes.push(`ورقة «${name}»: ${body.length} صفاً، معبأ منها ${filled}`);
  }

  // كل خليةٍ معبأة تمرّ من محلّلات المحرك — بنفس عقد أعمدة المحوّل
  const lookups = { sector: makeLookup([...sectorNames].filter(Boolean).map((n, i) => ({ id: `S${i}`, name_ar: n })), { label: 'القطاعات' }) };
  for (const name of [SHEET_ACTUAL, SHEET_PLAN]) {
    const aoa = aoaOf(wb, name);
    if (!aoa) continue;
    aoa.slice(1).forEach((r, i) => {
      COLUMNS.forEach((col, ci) => {
        const raw = String(r[ci] ?? '').trim();
        if (raw === '' && col.key === 'amount') return;   // شهرٌ لم يُقفل بعد — يُحذف صفّه قبل الرفع
        try { parseCell(col, raw, lookups); }
        catch (e) { errors.push(`ورقة «${name}» الصف ${i + 2}: ${col.labelAr} — ${e.message}`); }
      });
    });
  }
  return { ok: errors.length === 0, errors, notes, sheets };
}

/** يفكّ الدفتر المعبأ إلى ملفَّي استيراد — ورقةٌ واحدة لكل ملف، لأن المحرك يقرأ الأولى وحدها. */
export function splitWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out = [];
  for (const name of [SHEET_ACTUAL, SHEET_PLAN]) {
    const aoa = aoaOf(wb, name);
    if (!aoa) continue;
    const rows = aoa.slice(1)
      .map((r) => Object.fromEntries(COLUMNS.map((c, i) => [c.key, String(r[i] ?? '').trim()])))
      .filter((r) => r.amount !== '');
    if (!rows.length) continue;
    out.push({ name, rows, ...buildExport({ columns: COLUMNS, rows, format: 'xlsx', sheetName: name }) });
  }
  return out;
}

// ── §10 سطر الأوامر ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

const writeOut = (path, buf) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, buf); };

async function main(argv) {
  const args = parseArgs(argv);

  if (args.verify && args.verify !== true) {
    const res = verifyWorkbook(readFileSync(args.verify));
    res.notes.forEach((n) => console.log(`  • ${n}`));
    if (!res.ok) { res.errors.slice(0, 20).forEach((e) => console.error(`  ✗ ${e}`)); console.error(`فشل الفحص: ${res.errors.length} ملاحظة`); process.exitCode = 1; return; }
    console.log(`✓ الدفتر سليم: ${args.verify}`);
    return;
  }

  if (args.split && args.split !== true) {
    const parts = splitWorkbook(readFileSync(args.split));
    const dir = args.outdir && args.outdir !== true ? args.outdir : dirname(args.split);
    const base = basename(args.split).replace(/\.xlsx$/i, '');
    if (!parts.length) { console.error('لا صفوف معبأة في الدفتر — لا شيء يُرفع'); process.exitCode = 1; return; }
    for (const p of parts) {
      const path = join(dir, `${base}-${p.name}.xlsx`);
      writeOut(path, p.buffer);
      console.log(`✓ ${path} (${p.rows.length} صفاً)`);
    }
    return;
  }

  const sector = args.sector && args.sector !== true ? String(args.sector) : null;
  const year = Number(args.year) || new Date().getUTCFullYear();
  if (!sector) { console.error('حدّد القطاع: --sector "اسم القطاع كما هو في المنصة"'); process.exitCode = 1; return; }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { console.error('حدّد السنة برقمٍ مثل 2026'); process.exitCode = 1; return; }
  const out = args.out && args.out !== true ? String(args.out) : `دفتر-قائمة-الدخل-${sector}-${year}.xlsx`;
  const demo = args.demo === true || args.demo === '1';
  const buf = buildWorkbookBuffer({ sector, year, demo });
  writeOut(out, buf);
  const res = verifyWorkbook(buf);
  console.log(`✓ ${out} — ${sector} / ${year}${demo ? ' (نسخة تجريبية معبأة)' : ''}`);
  res.notes.forEach((n) => console.log(`  • ${n}`));
  console.log(`  • الأشهر: ${MONTH_AR[0]}…${MONTH_AR[11]} — الرفع ورقةً ورقة (المحرك يقرأ الورقة الأولى من كل ملف)`);
  if (!res.ok) { res.errors.slice(0, 20).forEach((e) => console.error(`  ✗ ${e}`)); process.exitCode = 1; }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('make-finance-pl-workbook.mjs');
if (invokedDirectly) await main(process.argv.slice(2));
