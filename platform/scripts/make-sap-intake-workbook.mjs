#!/usr/bin/env node
// «دفتر بيانات قطاع SAP» — مولِّد دفتر Excel عربي كامل يعبّيه فريق القطاع الجديد مرة واحدة،
// ثم يعود فيُستورد عبر مركز البيانات (src/modules/io) ورقةً ورقة.
//
//   node scripts/make-sap-intake-workbook.mjs                       ← يبني «دفتر-بيانات-قطاع-SAP.xlsx»
//   node scripts/make-sap-intake-workbook.mjs --out=<ملف.xlsx>      ← يبني باسم آخر
//   node scripts/make-sap-intake-workbook.mjs --demo=<ملف.xlsx>     ← نسخة معبأة بصفوف تجريبية (لفحص الاستيراد)
//   node scripts/make-sap-intake-workbook.mjs --verify=<ملف.xlsx>   ← فحص بنيوي شامل للملف المبني
//   node scripts/make-sap-intake-workbook.mjs --split=<المعبأ.xlsx> [--outdir=مجلد]
//                                                                   ← يفكّ الدفترَ المعبأ إلى ملفات استيراد
//                                                                     (ورقة واحدة لكل ملف — المحرك يقرأ الورقة الأولى فقط)
//
// لماذا يُكتب ملف Excel يدوياً هنا بدل مكتبة النسخ المورَّدة؟ لأن النسخة المجتمعية من المكتبة
// لا تكتب التنسيقات ولا القوائم المنسدلة ولا تثبيت الصفوف — وهذه هي جوهر «سهل التعبئة».
// فالملف يُبنى أجزاءً (XML داخل ZIP) بترتيب العناصر الذي يفرضه المعيار، ويُفحص بإعادة قراءته
// بالمكتبة المورَّدة نفسها التي سيقرأ بها المحرك الملفَ العائد.
//
// قواعد مضمونة في التصميم (مثبتة من src/modules/io):
//   • ترويسات الأعمدة المستورَدة مطابقة حرفياً لعناوين المحوّلات (labelAr) — فتُطابَق تلقائياً.
//   • الأعمدة المُلتقطة فقط (الإدارة، مدير الإدارة؟، المتابع من الفريق، بريد الموظفين) لا تشتبك
//     مع أي عمود محوّل حتى بمطابقة الاحتواء — يفحصها --verify برمجياً.
//   • عمود «القطاع» لا يُطلب من الفريق: يُحقَن آلياً في ملفات الاستيراد عند --split.
//   • أسماء المراحل هي أسماء المنصة الحية (ليدز/مؤهلة/تقييم العميل/خسارة/معلّقة) — و«فائزة»
//     غائبة عمداً: ما رسا يُكتب في «المشاريع» وحدها، والمنصة تنشئ فرصته المكسوبة بنفسها.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as XLSX from '../vendor/xlsx/xlsx.mjs';
import { parseWorkbook, buildExport } from '../src/modules/io/xlsx.js';
import { normalizeText } from '../src/modules/io/parse.js';

// ─────────────────────────────────────────────────────────────────────────────
// §1 الإعدادات — القيم الحية المنسوخة من منصة سند (2026-08-27)
// ─────────────────────────────────────────────────────────────────────────────
const SECTOR_NAME = 'قطاع SAP';
const DEPARTMENTS = ['ادارة مشاريع', 'تطوير اعمال']; // حرفياً كما أُنشئت على المنصة
const STAGES = ['ليدز', 'مؤهلة', 'تقييم العميل', 'خسارة', 'معلّقة']; // أسماء المراحل الحية — بلا «فائزة» عمداً
const PROJECT_STATUS = ['لم يبدأ', 'مُخطَّط', 'قيد التنفيذ', 'متوقّف مؤقتًا', 'مكتمل', 'ملغى'];
const RAG = ['أخضر', 'أصفر', 'أحمر'];
const CLIENT_TYPES = ['حكومي', 'شبه حكومي', 'خاص', 'داخلي'];
const EMPLOYMENT = ['أساسي', 'متعاون', 'استشاري', 'متعاقد', 'مؤقت', 'متدرب'];
const MARKETS = ['الطاقة', 'الصحة', 'التعليم', 'النقل واللوجستيات', 'المالية والاستثمار',
  'التقنية والاتصالات', 'الصناعة والتعدين', 'البلديات والإسكان', 'السياحة والترفيه', 'الأمن والدفاع'];
const PROJECT_ROLES = ['قائد المشروع', 'استشاري رئيسي', 'استشاري', 'محلل أعمال', 'دعم فني', 'ضبط جودة'];
const MONTH_NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const YES_ONLY = ['نعم'];
// العملاء النشطون المسجّلون على المنصة (77) — قائمة اقتراح تمنع اختلاف الإملاء لجهة موجودة
const CLIENTS_LIVE = [
  'أرامكو السعودية', 'أمانة العاصمة المقدسة', 'أمانة المنطقة الشرقية', 'أمانة محافظة الطائف',
  'أمانة منطقة الجوف', 'أمانة منطقة الرياض', 'إثراء للضيافة', 'استدامة — مركز البحوث الزراعية',
  'اكاديمية مهد', 'الأمن العام', 'البعثة الإيرانية للحج', 'البنك السعودي للاستثمار',
  'الجامعة السعودية الإلكترونية', 'الخطوط السعودية', 'الديوان العام للمحاسبة',
  'الرئاسة العامة لشؤون الحرمين الشريفين', 'الشركة الوطنية للإسكان', 'المركز الوطني لإدارة النفايات',
  'المركز الوطني لتنمية الحياة الفطرية', 'المركز الوطني لتنمية الغطاء النباتي ومكافحة التصحر',
  'المركز الوطني للرقابة على الالتزام البيئي', 'المركز الوطني للفعاليات', 'المعهد الوطني للتطوير المهني',
  'الهيئة السعودية للمواصفات والمقاييس والجودة', 'الهيئة العامة للإحصاء',
  'الهيئة العامة للذكاء الاصطناعي والبيانات', 'الهيئة العامة للصناعات العسكرية',
  'الهيئة العامة للطيران المدني', 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي',
  'الهيئة العامة للمنافسة', 'الهيئة العامة للمنشآت الصغيرة والمتوسطة', 'الهيئة العامة للموانئ',
  'الهيئة الملكية لمحافظة العلا', 'الهيئة الملكية لمدينة مكة المكرمة والمشاعر المقدسة',
  'بنك المنشآت الصغيرة والمتوسطة', 'تكامل القابضة', 'تمكين للتقنيات', 'جمعية نسك الإنسانية',
  'حلول الاتصالات (stc)', 'ديوان المظالم', 'شركة أفيردا', 'شركة الفا الرقمية',
  'شركة تكامل لصالح وزارة الحرس الوطني', 'شركة علم', 'شركة كدانة للتنمية والتطوير',
  'شركة مطارات القابضة', 'صندوق البيئة', 'صندوق التنمية السياحي', 'صندوق تنمية الموارد البشرية',
  'قطاع الحلول — داخلي (رؤية الخبراء)', 'مؤسسة محمد بن سلمان الخيرية (مسك)',
  'مجلس تنسيق بعثات الحج الأجنبية', 'مجموعة د. سليمان الحبيب الطبية',
  'مدينة الملك عبدالله للطاقة الذرية والمتجددة', 'مركز مشاريع البنية التحتية بمنطقة الرياض',
  'معهد الأمير سلطان لأبحاث التقنيات المتقدمة', 'ميناء جدة الإسلامي', 'هلا للمدفوعات',
  'هيئة التأمين', 'هيئة الحكومة الرقمية', 'هيئة المساحة الجيولوجية السعودية',
  'هيئة تطوير منطقة المدينة المنورة', 'هيئة تطوير منطقة عسير', 'هيئة تطوير منطقة مكة المكرمة',
  'وادي مكة للتقنية', 'وزارة الاستثمار', 'وزارة الاقتصاد والتخطيط', 'وزارة الثقافة',
  'وزارة الحج والعمرة', 'وزارة الداخلية', 'وزارة الدفاع', 'وزارة السياحة',
  'وزارة الشؤون الإسلامية', 'وزارة الصحة', 'وزارة الموارد البشرية والتنمية الاجتماعية',
  'وزارة النقل والخدمات اللوجستية', 'يسر المشاعر',
];

const DATA_ROWS = 200;               // صفوف جاهزة (منسّقة وبقوائمها) بعد صف المثال
const EXAMPLE_ROW = 2;               // صف المثال الرمادي
const LAST_ROW = EXAMPLE_ROW + DATA_ROWS; // 202
const EXAMPLE_PREFIX = 'مثال: ';     // بادئة الخلية الأولى في صف المثال — بها يُسقطه --split

const COLORS = {
  header: 'FF244A99',   // أزرق المنصة — عمود اختياري
  required: 'FFA16207', // ذهبي — عمود إلزامي
  captured: 'FF64748B', // رمادي مزرق — يُجمع الآن ويُطبَّق على المنصة لاحقاً
  exampleBg: 'FFF3F4F6',
  exampleFg: 'FF79828F',
  border: 'FFD1D5DB',
  listHdrBg: 'FFE6E9F0',
  title: 'FF244A99',
  dark: 'FF0F172A',
  tabGold: 'FFC9A227',
  tabGray: 'FF94A3B8',
};

// ─────────────────────────────────────────────────────────────────────────────
// §2 أدوات صغيرة
// ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };

// ─────────────────────────────────────────────────────────────────────────────
// §3 كاتب/قارئ ZIP على node:zlib — أجزاء الملف تُضغط وتُفهرس بمواصفة ZIP القياسية
// ─────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// طابع زمني ثابت (2026-08-27) — بناء قابل لإعادة الإنتاج بايتاً ببايت
const DOS_DATE = ((2026 - 1980) << 9) | (8 << 5) | 27;
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
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
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
  if (eocd < 0) throw new Error('ليس ملف ZIP صالحاً — لا نهاية فهرس');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const parts = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('فهرس ZIP تالف');
    const crc = buf.readUInt32LE(p + 16); const compLen = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32); const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26); const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + compLen));
    if (crc32(data) !== crc) throw new Error(`تحقق CRC فشل للجزء ${name}`);
    parts.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 الأنماط — جدول styles.xml الثابت (الفهارس أدناه هي قيم s= في الخلايا)
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  DEFAULT: 0, DATA_TEXT: 1, HEADER: 2, HEADER_REQ: 3, HEADER_CAP: 4, EX_TEXT: 5,
  DATA_MONEY: 6, EX_MONEY: 7, DATA_TEXTFMT: 8, EX_TEXTFMT: 9, DATA_INT: 10, EX_INT: 11,
  TITLE: 12, BODY: 13, SUBHEAD: 14, LIST_HDR: 15,
};
function stylesXml() {
  const font = (extra) => `<font><sz val="${extra.sz || 11}"/>${extra.b ? '<b/>' : ''}${extra.i ? '<i/>' : ''}${extra.color ? `<color rgb="${extra.color}"/>` : ''}<name val="Calibri"/></font>`;
  const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/></patternFill></fill>`;
  const xf = ({ f = 0, fl = 0, b = 0, n = 0, align = '' } = {}) =>
    `<xf numFmtId="${n}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0"` +
    `${n ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${fl ? ' applyFill="1"' : ''}` +
    `${b ? ' applyBorder="1"' : ''}${align ? ` applyAlignment="1">${align}</xf>` : '/>'}`;
  const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
  const vmid = '<alignment vertical="center"/>';
  const body = '<alignment vertical="top" wrapText="1"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="5">${[
    font({}),                                   // 0 افتراضي
    font({ b: 1, color: 'FFFFFFFF' }),          // 1 ترويسة بيضاء
    font({ sz: 10, i: 1, color: COLORS.exampleFg }), // 2 صف المثال
    font({ sz: 16, b: 1, color: COLORS.title }),// 3 عنوان التعليمات
    font({ b: 1, color: COLORS.dark }),         // 4 عناوين فرعية
  ].join('')}</fonts>
<fills count="7">${['<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    fill(COLORS.header), fill(COLORS.required), fill(COLORS.exampleBg),
    fill(COLORS.listHdrBg), fill(COLORS.captured),
  ].join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="${COLORS.border}"/></left><right style="thin"><color rgb="${COLORS.border}"/></right><top style="thin"><color rgb="${COLORS.border}"/></top><bottom style="thin"><color rgb="${COLORS.border}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">${[
    xf({}),                                        // 0
    xf({ b: 1, align: vmid }),                     // 1 DATA_TEXT
    xf({ f: 1, fl: 2, b: 1, align: center }),      // 2 HEADER
    xf({ f: 1, fl: 3, b: 1, align: center }),      // 3 HEADER_REQ
    xf({ f: 1, fl: 6, b: 1, align: center }),      // 4 HEADER_CAP
    xf({ f: 2, fl: 4, b: 1, align: vmid }),        // 5 EX_TEXT
    xf({ b: 1, n: 164, align: vmid }),             // 6 DATA_MONEY
    xf({ f: 2, fl: 4, b: 1, n: 164, align: vmid }),// 7 EX_MONEY
    xf({ b: 1, n: 49, align: vmid }),              // 8 DATA_TEXTFMT (@)
    xf({ f: 2, fl: 4, b: 1, n: 49, align: vmid }), // 9 EX_TEXTFMT
    xf({ b: 1, n: 1, align: vmid }),               // 10 DATA_INT
    xf({ f: 2, fl: 4, b: 1, n: 1, align: vmid }),  // 11 EX_INT
    xf({ f: 3, align: '<alignment vertical="center"/>' }), // 12 TITLE
    xf({ align: body }),                           // 13 BODY
    xf({ f: 4, align: vmid }),                     // 14 SUBHEAD
    xf({ f: 4, fl: 5, b: 1, align: vmid }),        // 15 LIST_HDR
  ].join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 الأجزاء الثابتة
// ─────────────────────────────────────────────────────────────────────────────
const SHEET_ORDER = ['التعليمات', 'العملاء', 'الفرص', 'المشاريع', 'الموظفون', 'التسكين', 'قوائم'];
function contentTypesXml() {
  const sheets = SHEET_ORDER.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets}</Types>`;
}
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
function workbookXml() {
  const sheets = SHEET_ORDER.map((name, i) =>
    `<sheet name="${esc(name)}" sheetId="${i + 1}"${name === 'قوائم' ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets}</sheets>
<calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`;
}
function workbookRelsXml() {
  const rels = SHEET_ORDER.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}<Relationship Id="rId${SHEET_ORDER.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 باني ورقة العمل — ترتيب العناصر ثابت كما تفرضه المواصفة (وإلا «أصلح» Excel الملف)
// sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData → dataValidations → pageMargins
// ─────────────────────────────────────────────────────────────────────────────
function cellXml(ref, s, val) {
  if (val == null || val === '') return `<c r="${ref}" s="${s}"/>`;
  if (typeof val === 'number') return `<c r="${ref}" s="${s}"><v>${val}</v></c>`;
  if (typeof val === 'object' && val.f) return `<c r="${ref}" s="${s}" t="str"><f>${esc(val.f)}</f></c>`;
  const sp = /^\s|\s$/.test(val) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t${sp}>${esc(val)}</t></is></c>`;
}
function worksheetXml({ tabColor, dimension, freeze = false, selected = false, cols = [], rows = [], validations = [] }) {
  const colsXml = cols.length
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rowsXml = rows.map(({ r, ht, cells }) =>
    `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`).join('');
  const dv = validations.length
    ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${tabColor ? `<sheetPr><tabColor rgb="${tabColor}"/></sheetPr>` : ''}<dimension ref="${dimension}"/>
<sheetViews><sheetView rightToLeft="1"${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${freeze
    ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    : ''}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${colsXml}<sheetData>${rowsXml}</sheetData>
${dv}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}
function validationXml({ sqref, listRef, strict, title, prompt }) {
  const type = listRef ? ' type="list" allowBlank="1"' : ' allowBlank="1"';
  const err = listRef && strict
    ? ' showErrorMessage="1" errorStyle="stop" errorTitle="اختر من القائمة" error="هذه الخانة تقبل قيم القائمة المنسدلة فقط — افتح السهم واختر."'
    : ' showErrorMessage="0"';
  return `<dataValidation${type} showInputMessage="1"${err} promptTitle="${esc(title)}" prompt="${esc(prompt)}" sqref="${sqref}">${listRef ? `<formula1>${esc(listRef)}</formula1>` : ''}</dataValidation>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 مواصفات الأوراق
// ─────────────────────────────────────────────────────────────────────────────
// ورقة «قوائم» (مخفية): قائمة في كل عمود — والمرايا صيغٌ تنعكس فيها أسماء ما كتبه الفريق
const LISTS = [
  { key: 'clientType', header: 'التصنيف', values: CLIENT_TYPES },
  { key: 'stages', header: 'المرحلة', values: STAGES },
  { key: 'projectStatus', header: 'حالة المشروع', values: PROJECT_STATUS },
  { key: 'rag', header: 'مؤشر الصحة', values: RAG },
  { key: 'departments', header: 'الإدارة', values: DEPARTMENTS },
  { key: 'employment', header: 'نوع التوظيف', values: EMPLOYMENT },
  { key: 'yes', header: 'مدير الإدارة', values: YES_ONLY },
  { key: 'markets', header: 'القطاع السوقي', values: MARKETS },
  { key: 'roles', header: 'الدور', values: PROJECT_ROLES },
  { key: 'months', header: 'الشهر', values: MONTH_NUMS },
  { key: 'clients', header: 'العملاء', values: CLIENTS_LIVE, mirror: { sheet: 'العملاء', col: 'A' } },
  { key: 'employees', header: 'الموظفون', values: [], mirror: { sheet: 'الموظفون', col: 'A' } },
  { key: 'projects', header: 'المشاريع', values: [], mirror: { sheet: 'المشاريع', col: 'A' } },
];
function listMeta() {
  const meta = new Map();
  LISTS.forEach((l, i) => {
    const col = colLetter(i + 1);
    const mirrorCount = l.mirror ? (LAST_ROW - EXAMPLE_ROW + 1) : 0; // مرايا صفوف 2..202
    const last = 1 + l.values.length + mirrorCount;
    meta.set(l.key, { col, first: 2, last: Math.max(2, last) });
  });
  return meta;
}
const LIST_META = listMeta();
const listRef = (key) => {
  const m = LIST_META.get(key);
  return `'قوائم'!$${m.col}$${m.first}:$${m.col}$${m.last}`;
};

function buildListsSheetXml() {
  const rows = [];
  const maxLast = Math.max(...[...LIST_META.values()].map((m) => m.last));
  const hdr = { r: 1, ht: 22, cells: LISTS.map((l, i) => cellXml(`${colLetter(i + 1)}1`, S.LIST_HDR, l.header)) };
  rows.push(hdr);
  for (let r = 2; r <= maxLast; r++) {
    const cells = [];
    LISTS.forEach((l, i) => {
      const col = colLetter(i + 1);
      const vi = r - 2;
      if (vi < l.values.length) {
        cells.push(cellXml(`${col}${r}`, S.DEFAULT, l.values[vi]));
      } else if (l.mirror) {
        const srcRow = EXAMPLE_ROW + (vi - l.values.length);
        if (srcRow <= LAST_ROW) {
          const src = `'${l.mirror.sheet}'!${l.mirror.col}${srcRow}`;
          cells.push(cellXml(`${col}${r}`, S.DEFAULT,
            { f: `IF(OR(${src}="",LEFT(${src},6)="${EXAMPLE_PREFIX}"),"",${src})` }));
        }
      }
    });
    if (cells.length) rows.push({ r, cells });
  }
  return worksheetXml({
    tabColor: COLORS.tabGray,
    dimension: `A1:${colLetter(LISTS.length)}${maxLast}`,
    cols: LISTS.map(() => 26),
    rows,
  });
}

// أوراق التعبئة — الترويسات المستورَدة مطابقة حرفياً لعناوين المحوّلات (labelAr).
// captured: عمود يُجمع الآن ويُطبَّق يدوياً/بالإسناد لاحقاً — لا يستورده المحرك.
const SHEETS = [
  {
    name: 'العملاء', adapter: 'clients', injectSector: false,
    columns: [
      { header: 'اسم العميل', width: 44, kind: 'text', required: true, list: { key: 'clients', strict: false },
        title: 'اسم العميل', hint: 'اسم الجهة الرسمي. إن كانت في القائمة فاخترها كما هي — لا تكتبها بصياغة مختلفة.' },
      { header: 'الاسم الإنجليزي', width: 24, kind: 'text', title: 'الاسم الإنجليزي', hint: 'اختياري — الاسم بالإنجليزية إن وُجد.' },
      { header: 'التصنيف', width: 15, kind: 'text', list: { key: 'clientType', strict: true },
        title: 'التصنيف', hint: 'نوع الجهة: حكومي، شبه حكومي، خاص، أو داخلي.' },
      { header: 'القطاع السوقي', width: 20, kind: 'text', list: { key: 'markets', strict: false },
        title: 'القطاع السوقي', hint: 'المجال الذي تعمل فيه الجهة — اختر من القائمة أو اكتب غيره.' },
      { header: 'جهة الاتصال', width: 22, kind: 'text', title: 'جهة الاتصال', hint: 'اسم من تتواصلون معه في الجهة.' },
      { header: 'منصب جهة الاتصال', width: 20, kind: 'text', title: 'منصب جهة الاتصال', hint: 'منصبه الوظيفي.' },
      { header: 'البريد الإلكتروني', width: 28, kind: 'textfmt', title: 'البريد الإلكتروني', hint: 'بريد جهة الاتصال.' },
      { header: 'الجوال', width: 14, kind: 'textfmt', title: 'الجوال', hint: 'يبدأ بـ 05.' },
    ],
    example: ['وزارة الطاقة', 'Ministry of Energy', 'حكومي', 'الطاقة', 'م. فهد الدوسري', 'مدير تقنية المعلومات', 'fahad@example.gov.sa', '0551234567'],
    demo: [
      ['وزارة الطاقة', 'Ministry of Energy', 'حكومي', 'الطاقة', 'م. فهد الدوسري', 'مدير تقنية المعلومات', 'fahad@example.gov.sa', '0551234567'],
      ['شركة التعدين التجريبية', '', 'خاص', 'الصناعة والتعدين', 'أ. نورة العتيبي', 'مديرة المشتريات', 'noura@example.com', '0557654321'],
    ],
  },
  {
    name: 'الفرص', adapter: 'opportunities', injectSector: true,
    columns: [
      { header: 'العنوان', width: 46, kind: 'text', required: true,
        title: 'عنوان الفرصة', hint: 'اسم الفرصة — اجعله مميزاً لا يتكرر.' },
      { header: 'العميل', width: 44, kind: 'text', list: { key: 'clients', strict: false },
        title: 'العميل', hint: 'اختر الجهة من القائمة. الجهة الجديدة تُضاف أولاً في ورقة «العملاء» بنفس الاسم حرفياً.' },
      { header: 'الإدارة', width: 16, kind: 'text', captured: true, list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'الإدارة التي تتابع هذه الفرصة.' },
      { header: 'المرحلة', width: 16, kind: 'text', list: { key: 'stages', strict: true },
        title: 'المرحلة', hint: 'أين وصلت الفرصة الآن؟ الفرصة التي رسَت عليكم لا تُكتب هنا — بل في ورقة «المشاريع». الفارغ يُحسب «ليدز».' },
      { header: 'القيمة (ريال)', width: 16, kind: 'money',
        title: 'القيمة', hint: 'القيمة المتوقعة بالريال، أرقاماً فقط، مع الضريبة.' },
      { header: 'السنة', width: 10, kind: 'int',
        title: 'السنة', hint: 'سنة الترسية المتوقعة — اتركها فارغة إن كانت 2026.' },
      { header: 'الخطوة التالية', width: 36, kind: 'text',
        title: 'الخطوة التالية', hint: 'ما الإجراء القادم على هذه الفرصة؟' },
      { header: 'المتابع من الفريق', width: 22, kind: 'text', captured: true,
        title: 'المتابع من الفريق', hint: 'اسم الزميل الذي يتابع الفرصة — يُربط بحسابه على المنصة لاحقاً.' },
      { header: 'ملاحظات', width: 36, kind: 'text', title: 'ملاحظات', hint: 'أي تفاصيل تهم الفريق.' },
    ],
    example: ['تطبيق نظام SAP S/4HANA لجهة حكومية', 'وزارة الطاقة', 'تطوير اعمال', 'مؤهلة', 3500000, 2026, 'تسليم العرض الفني والمالي', 'د. نواف الشنبري', 'بانتظار محضر الاجتماع التمهيدي'],
    demo: [
      ['تطبيق نظام SAP S/4HANA لوزارة الطاقة', 'وزارة الطاقة', 'تطوير اعمال', 'مؤهلة', 3500000, 2026, 'تسليم العرض الفني والمالي', 'د. نواف الشنبري', ''],
      ['دعم وصيانة أنظمة الموارد الحكومية', 'شركة التعدين التجريبية', 'تطوير اعمال', 'ليدز', 900000, 2026, 'جدولة اجتماع تعريفي', '', ''],
    ],
  },
  {
    name: 'المشاريع', adapter: 'projects', injectSector: true,
    columns: [
      { header: 'اسم المشروع', width: 46, kind: 'text', required: true,
        title: 'اسم المشروع', hint: 'اسم المشروع كما في العقد — مميز لا يتكرر.' },
      { header: 'العميل', width: 44, kind: 'text', list: { key: 'clients', strict: false },
        title: 'العميل', hint: 'اختر الجهة من القائمة — والجديدة تُضاف أولاً في ورقة «العملاء».' },
      { header: 'الإدارة', width: 16, kind: 'text', captured: true, list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'الإدارة المنفّذة.' },
      { header: 'حالة المشروع', width: 17, kind: 'text', list: { key: 'projectStatus', strict: true },
        title: 'حالة المشروع', hint: 'وضع المشروع اليوم.' },
      { header: 'مؤشر الصحة', width: 13, kind: 'text', list: { key: 'rag', strict: true },
        title: 'مؤشر الصحة', hint: 'أخضر: على المسار. أصفر: في خطر. أحمر: حرج.' },
      { header: 'نسبة الإنجاز (%)', width: 15, kind: 'int',
        title: 'نسبة الإنجاز', hint: 'رقم من 0 إلى 100 بدون علامة %.' },
      { header: 'قيمة العقد (ريال)', width: 17, kind: 'money',
        title: 'قيمة العقد', hint: 'قيمة التعاقد بالريال، أرقاماً فقط، مع الضريبة.' },
      { header: 'الميزانية (ريال)', width: 16, kind: 'money',
        title: 'الميزانية', hint: 'اختياري — ميزانية التنفيذ الداخلية إن وُجدت.' },
      { header: 'تاريخ البداية', width: 14, kind: 'textfmt',
        title: 'تاريخ البداية', hint: 'اكتب: 2026-02-01 أو 01/02/2026.' },
      { header: 'تاريخ النهاية', width: 14, kind: 'textfmt',
        title: 'تاريخ النهاية', hint: 'تاريخ النهاية التعاقدي.' },
      { header: 'مدير المشروع', width: 22, kind: 'text',
        title: 'مدير المشروع', hint: 'اسم مدير المشروع.' },
    ],
    example: ['تشغيل ودعم نظام SAP لجهة حكومية', 'وزارة الطاقة', 'ادارة مشاريع', 'قيد التنفيذ', 'أخضر', 35, 5750000, 4200000, '2026-02-01', '2027-01-31', 'م. سارة القحطاني'],
    demo: [
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'وزارة الطاقة', 'ادارة مشاريع', 'قيد التنفيذ', 'أخضر', 35, 5750000, 4200000, '2026-02-01', '2027-01-31', 'م. سارة القحطاني'],
    ],
  },
  {
    name: 'الموظفون', adapter: 'employees', injectSector: true,
    columns: [
      { header: 'الاسم', width: 30, kind: 'text', required: true,
        title: 'الاسم', hint: 'الاسم الثلاثي بالعربية.' },
      { header: 'الاسم الإنجليزي', width: 24, kind: 'text', title: 'الاسم الإنجليزي', hint: 'اختياري.' },
      { header: 'المسمى الوظيفي', width: 24, kind: 'text', title: 'المسمى الوظيفي', hint: 'كما في العقد.' },
      { header: 'الإدارة', width: 16, kind: 'text', captured: true, list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'إدارة الموظف.' },
      { header: 'مدير الإدارة؟', width: 14, kind: 'text', captured: true, list: { key: 'yes', strict: true },
        title: 'مدير الإدارة', hint: 'علّم «نعم» أمام مدير كل إدارة فقط — واكتب بريده في عمود «البريد الإلكتروني».' },
      { header: 'نوع التوظيف', width: 14, kind: 'text', list: { key: 'employment', strict: false },
        title: 'نوع التوظيف', hint: 'اتركه فارغاً أو اختر «أساسي» لموظف الدوام الكامل.' },
      { header: 'البريد الإلكتروني', width: 28, kind: 'textfmt', captured: true,
        title: 'البريد الإلكتروني', hint: 'لمن يحتاج دخول المنصة — وإلزامي لمديري الإدارات.' },
    ],
    example: ['محمد أحمد الشهري', 'Mohammed Alshehri', 'مستشار SAP أول', 'ادارة مشاريع', '', 'أساسي', 'm.alshehri@evc.sa'],
    demo: [
      ['محمد أحمد الشهري', 'Mohammed Alshehri', 'مستشار SAP أول', 'ادارة مشاريع', '', 'أساسي', 'm.alshehri@evc.sa'],
      ['سارة خالد القحطاني', '', 'مديرة مشاريع', 'ادارة مشاريع', 'نعم', 'أساسي', 's.alqahtani@evc.sa'],
    ],
  },
  {
    name: 'التسكين', adapter: 'staffing', injectSector: false,
    columns: [
      { header: 'الموظف', width: 30, kind: 'text', required: true, list: { key: 'employees', strict: false },
        title: 'الموظف', hint: 'اختر الاسم من القائمة — كما كتبته في ورقة «الموظفون» حرفياً.' },
      { header: 'المشروع', width: 46, kind: 'text', required: true, list: { key: 'projects', strict: false },
        title: 'المشروع', hint: 'اختر المشروع من القائمة — كما في ورقة «المشاريع» حرفياً.' },
      { header: 'السنة', width: 10, kind: 'int', title: 'السنة', hint: 'اتركها فارغة إن كانت 2026.' },
      { header: 'الدور', width: 20, kind: 'text', list: { key: 'roles', strict: false },
        title: 'الدور', hint: 'دوره في هذا المشروع.' },
      { header: 'من شهر', width: 10, kind: 'int', list: { key: 'months', strict: false },
        title: 'من شهر', hint: 'رقم الشهر: 1 = يناير … 12 = ديسمبر.' },
      { header: 'إلى شهر', width: 10, kind: 'int', list: { key: 'months', strict: false },
        title: 'إلى شهر', hint: 'رقم الشهر الأخير للتكليف.' },
      { header: 'الإشغال (%)', width: 13, kind: 'int',
        title: 'الإشغال', hint: 'نسبة وقت الموظف على هذا المشروع — رقم من 0 إلى 100.' },
    ],
    example: ['محمد أحمد الشهري', 'تشغيل ودعم نظام SAP لجهة حكومية', 2026, 'قائد المشروع', 2, 12, 75],
    demo: [
      ['محمد أحمد الشهري', 'تشغيل ودعم نظام SAP لوزارة الطاقة', 2026, 'قائد المشروع', 2, 12, 75],
    ],
  },
];

const KIND_STYLES = {
  text: { data: S.DATA_TEXT, ex: S.EX_TEXT },
  money: { data: S.DATA_MONEY, ex: S.EX_MONEY },
  int: { data: S.DATA_INT, ex: S.EX_INT },
  textfmt: { data: S.DATA_TEXTFMT, ex: S.EX_TEXTFMT },
};

function buildDataSheetXml(spec, { demoRows = null } = {}) {
  const n = spec.columns.length;
  const rows = [];
  rows.push({
    r: 1, ht: 30,
    cells: spec.columns.map((c, i) => cellXml(`${colLetter(i + 1)}1`,
      c.required ? S.HEADER_REQ : (c.captured ? S.HEADER_CAP : S.HEADER), c.header)),
  });
  // صف المثال — الخلية الأولى تبدأ بـ«مثال: » وبها يتعرف عليه --split فيُسقطه
  rows.push({
    r: EXAMPLE_ROW,
    cells: spec.columns.map((c, i) => {
      const v = spec.example[i];
      const val = i === 0 && v ? EXAMPLE_PREFIX + v : v;
      return cellXml(`${colLetter(i + 1)}${EXAMPLE_ROW}`, KIND_STYLES[c.kind].ex, val === '' ? null : val);
    }),
  });
  // صفوف تجريبية (وضع --demo) ثم صفوف فارغة جاهزة حتى LAST_ROW
  const demo = demoRows || [];
  for (let r = EXAMPLE_ROW + 1; r <= LAST_ROW; r++) {
    const d = demo[r - EXAMPLE_ROW - 1];
    rows.push({
      r,
      cells: spec.columns.map((c, i) => cellXml(`${colLetter(i + 1)}${r}`, KIND_STYLES[c.kind].data,
        d ? (d[i] === '' ? null : d[i]) : null)),
    });
  }
  const validations = spec.columns.map((c, i) => {
    const L = colLetter(i + 1);
    return validationXml({
      sqref: `${L}${EXAMPLE_ROW}:${L}${LAST_ROW}`,
      listRef: c.list ? listRef(c.list.key) : null,
      strict: c.list ? c.list.strict : false,
      title: c.title, prompt: c.hint,
    });
  });
  return worksheetXml({
    tabColor: COLORS.header,
    dimension: `A1:${colLetter(n)}${LAST_ROW}`,
    freeze: true,
    cols: spec.columns.map((c) => c.width),
    rows, validations,
  });
}

// ورقة «التعليمات» — الغلاف
function buildInstructionsSheetXml() {
  const lines = [];
  const push = (a, b, sA, sB, ht) => lines.push({ a, b, sA, sB, ht });
  push(null, 'دفتر بيانات قطاع SAP — منصة سند', S.DEFAULT, S.TITLE, 30);
  push(null, null);
  push(null, 'أهلاً بكم. هذا الدفتر هو الخطوة الأولى لقطاع SAP على المنصة: تُجمَع فيه بياناتكم مرة واحدة، ثم تظهر في شاشات المنصة — الفرص والمشاريع والفريق — من غير إدخال يدوي بعد اليوم.', S.DEFAULT, S.BODY, 32);
  push(null, null);
  push(null, 'أوراق الدفتر', S.DEFAULT, S.SUBHEAD);
  push(null, '1. العملاء — كل جهة تتعاملون معها، الحالية والمستهدفة.', S.DEFAULT, S.BODY);
  push(null, '2. الفرص — كل ما هو قيد المتابعة أو معلّق أو انتهى بخسارة.', S.DEFAULT, S.BODY);
  push(null, '3. المشاريع — كل ما رسا عليكم: الجاري تنفيذه والمكتمل.', S.DEFAULT, S.BODY);
  push(null, '4. الموظفون — فريق القطاع كاملاً، مع إدارة كل موظف.', S.DEFAULT, S.BODY);
  push(null, '5. التسكين (ورقة اختيارية) — من يعمل على أي مشروع وبأي نسبة من وقته.', S.DEFAULT, S.BODY);
  push(null, null);
  push(null, 'القواعد الذهبية', S.DEFAULT, S.SUBHEAD);
  push(null, '• سطر واحد لكل سجل، وعناوين الصف الأول تبقى كما هي — لا تعديل ولا حذف ولا إعادة ترتيب.', S.DEFAULT, S.BODY);
  push(null, '• العمل الواحد يُكتب مرة واحدة فقط: ما زال عرضاً أو متابعةً ← ورقة «الفرص»، وما رسا عليكم أو جارٍ تنفيذه أو اكتمل ← ورقة «المشاريع». لا يُكتب في الورقتين معاً أبداً.', S.DEFAULT, S.BODY, 32);
  push(null, '• المبالغ كلها بالريال السعودي، أرقاماً فقط من غير كلمة «ريال»، وتُكتب مع الضريبة — أي المبلغ الذي يدفعه العميل.', S.DEFAULT, S.BODY, 32);
  push(null, '• التواريخ بصيغة 2026-01-31 أو 31/01/2026، والنسب أرقام من 0 إلى 100.', S.DEFAULT, S.BODY);
  push(null, '• في عمود «العميل» افتحوا القائمة واختاروا الاسم إن وجدتموه — ولا تكتبوا اسماً بصياغة مختلفة لجهة موجودة. الجهة الجديدة فعلاً تُضاف أولاً في ورقة «العملاء».', S.DEFAULT, S.BODY, 32);
  push(null, '• الصف الرمادي أول كل ورقة مثالٌ للتوضيح — اكتبوا بياناتكم مكانه أو احذفوه قبل إعادة الدفتر.', S.DEFAULT, S.BODY);
  push(null, null);
  push(null, 'دليل ألوان الأعمدة', S.DEFAULT, S.SUBHEAD);
  push('إلزامي', 'العمود الذهبي إلزامي — لا يُترك فارغاً.', S.HEADER_REQ, S.BODY);
  push('اختياري', 'العمود الأزرق اختياري — والقليل الصحيح خير من الكثير الناقص.', S.HEADER, S.BODY);
  push('لاحقاً', 'العمود الرمادي معلومة تُجمَع الآن وتُفعَّل على المنصة لاحقاً: الإدارة، مدير الإدارة، المتابع، البريد.', S.HEADER_CAP, S.BODY, 32);
  push(null, null);
  push(null, 'من يعبّئ ماذا؟', S.DEFAULT, S.SUBHEAD);
  push(null, 'كل إدارة تعبّئ صفوفها، وعمود «الإدارة» يحدد تبعية كل سجل: «ادارة مشاريع» أو «تطوير اعمال».', S.DEFAULT, S.BODY);
  push(null, 'في ورقة «الموظفون» علّموا «نعم» أمام مدير كل إدارة واكتبوا بريده الإلكتروني ليُفتَح له حساب على المنصة — وكذلك بريد كل زميل يحتاج الدخول.', S.DEFAULT, S.BODY, 32);
  push(null, 'ويُراجع د. نواف الدفتر كاملاً قبل الإرسال.', S.DEFAULT, S.BODY);
  push(null, null);
  push(null, 'ملاحظات أخيرة', S.DEFAULT, S.SUBHEAD);
  push(null, '• الرواتب لا تُطلب في هذا الدفتر.', S.DEFAULT, S.BODY);
  push(null, '• الإيراد الشهري المحقق يُسجَّل لاحقاً مع الإدارة المالية — لا مكان له هنا.', S.DEFAULT, S.BODY);
  push(null, '• لا تنتظروا الكمال: أرسلوا ما اكتمل، وما ينقص يُستكمل لاحقاً أو من المنصة مباشرة.', S.DEFAULT, S.BODY);
  push(null, '• لأي سؤال: د. نواف الشنبري، أو فريق منصة سند.', S.DEFAULT, S.BODY);
  const rows = lines.map((l, i) => ({
    r: i + 1, ht: l.ht || (l.b || l.a ? 22 : 10),
    cells: [
      l.a != null ? cellXml(`A${i + 1}`, l.sA, l.a) : cellXml(`A${i + 1}`, S.DEFAULT, null),
      l.b != null ? cellXml(`B${i + 1}`, l.sB ?? S.BODY, l.b) : cellXml(`B${i + 1}`, S.DEFAULT, null),
    ],
  }));
  return worksheetXml({
    tabColor: COLORS.tabGold,
    dimension: `A1:B${lines.length}`,
    selected: true,
    cols: [10, 110],
    rows,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 تجميع الدفتر
// ─────────────────────────────────────────────────────────────────────────────
function buildWorkbook({ demo = false } = {}) {
  const sheetXmls = [
    buildInstructionsSheetXml(),
    ...SHEETS.map((s) => buildDataSheetXml(s, { demoRows: demo ? s.demo : null })),
    buildListsSheetXml(),
  ];
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml(), 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(xml, 'utf8') })),
  ];
  return zipWrite(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// §9 تفكيك الدفتر المعبأ إلى ملفات استيراد — ورقة واحدة في كل ملف (المحرك يقرأ الأولى فقط)
// ─────────────────────────────────────────────────────────────────────────────
function splitWorkbook(filePath, outdir) {
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true });
  mkdirSync(outdir, { recursive: true });
  const attribution = [['الورقة', 'الاسم', 'الإدارة', 'مدير الإدارة؟', 'البريد الإلكتروني', 'المتابع من الفريق']];
  const written = [];
  for (const spec of SHEETS) {
    const ws = wb.Sheets[wb.SheetNames.find((n) => n.trim() === spec.name)];
    if (!ws) { console.log(`⚠ الورقة «${spec.name}» غير موجودة في الملف — تُتجاوز`); continue; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    if (!aoa.length) continue;
    const headers = aoa[0].map((h) => String(h ?? '').trim());
    let dropped = 0;
    const body = aoa.slice(1)
      .map((r) => headers.map((_, i) => String(r[i] ?? '').trim()))
      .filter((r) => {
        if (!r.some((c) => c !== '')) return false;
        if (r[0].startsWith(EXAMPLE_PREFIX.trim())) { dropped++; return false; }
        return true;
      });
    // حقن عمود «القطاع» — لا يُطلب من الفريق، ويُلزم المحرك به عند الإنشاء
    const outHeaders = spec.injectSector ? [...headers, 'القطاع'] : headers;
    const outBody = spec.injectSector ? body.map((r) => [...r, SECTOR_NAME]) : body;
    const columns = outHeaders.map((h, i) => ({ key: `c${i}`, labelAr: h }));
    const rows = outBody.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
    const { buffer } = buildExport({ columns, rows, format: 'xlsx', sheetName: spec.name });
    const outFile = join(outdir, `استيراد-${spec.name}.xlsx`);
    writeFileSync(outFile, buffer);
    written.push(outFile);
    console.log(`✔ ${basename(outFile)} — الصفوف: ${outBody.length} (أُسقطت صفوف المثال: ${dropped})`);
    // ملف الإسناد: اسم السجل → الإدارة (+ بيانات المديرين والمتابعين)
    const hIdx = (name) => headers.indexOf(name);
    const dep = hIdx('الإدارة'); const mgr = hIdx('مدير الإدارة؟');
    const mail = hIdx('البريد الإلكتروني'); const owner = hIdx('المتابع من الفريق');
    if (dep >= 0 || owner >= 0) {
      for (const r of body) {
        attribution.push([spec.name, r[0],
          dep >= 0 ? r[dep] : '', mgr >= 0 ? r[mgr] : '',
          (mail >= 0 && spec.name === 'الموظفون') ? r[mail] : '', owner >= 0 ? r[owner] : '']);
      }
    }
  }
  const csv = '﻿' + attribution.map((row) => row.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const attrFile = join(outdir, 'إسناد-الإدارات.csv');
  writeFileSync(attrFile, csv, 'utf8');
  console.log(`✔ ${basename(attrFile)} — مرجع الإسناد وفتح الحسابات`);
  console.log('\nترتيب الاستيراد في المنصة: العملاء ← الفرص ← المشاريع ← الموظفون ← التسكين');
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 الفحص البنيوي — لا يمر الملف إلا إذا صحّت بنيته وترويساته ومطابقته للمحوّلات
// ─────────────────────────────────────────────────────────────────────────────
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
function adapterLabels(adapterName) {
  const src = readFileSync(join(scriptDir, `../src/modules/io/adapters/${adapterName}.js`), 'utf8');
  const labels = [...src.matchAll(/labelAr:\s*'([^']+)'/g)].map((m) => m[1]);
  const aliases = [...src.matchAll(/aliases:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  return { labels, all: [...labels, ...aliases] };
}
function verifyWorkbook(filePath) {
  const buf = readFileSync(filePath);
  const fails = []; let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

  // 1) سلامة ZIP والأجزاء
  const parts = zipRead(buf);
  const expected = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', ...SHEET_ORDER.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`)];
  ok(expected.every((p) => parts.has(p)) && parts.size === expected.length,
    `أجزاء الملف: المتوقع ${expected.length} والموجود ${parts.size}`);

  // 2) فحوص XML لكل ورقة بيانات
  SHEETS.forEach((spec, si) => {
    const xml = parts.get(`xl/worksheets/sheet${si + 2}.xml`).toString('utf8');
    ok(xml.includes('rightToLeft="1"'), `${spec.name}: الاتجاه ليس من اليمين إلى اليسار`);
    ok(xml.includes('state="frozen"'), `${spec.name}: الصف الأول غير مثبَّت`);
    ok(xml.includes(`<dataValidations count="${spec.columns.length}">`),
      `${spec.name}: عدد قواعد الإدخال ≠ ${spec.columns.length}`);
    const refs = [...xml.matchAll(/<formula1>([^<]+)<\/formula1>/g)].map((m) => m[1]);
    ok(refs.every((r) => /^&apos;قوائم&apos;!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+$/.test(r) || /^'قوائم'!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+$/.test(r)),
      `${spec.name}: مرجع قائمة منسدلة خارج ورقة قوائم`);
    const sqrefs = [...xml.matchAll(/sqref="([A-Z]+)\d+:[A-Z]+\d+"/g)].map((m) => m[1]);
    ok(new Set(sqrefs).size === sqrefs.length, `${spec.name}: نطاقا تحقق متداخلان`);
  });

  // 3) إعادة قراءة كاملة بالمكتبة المورَّدة (نفس قارئ المحرك)
  const wb = XLSX.read(buf, { type: 'buffer' });
  ok(JSON.stringify(wb.SheetNames) === JSON.stringify(SHEET_ORDER),
    `أسماء الأوراق: ${wb.SheetNames.join('، ')}`);
  for (const spec of SHEETS) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[spec.name], { header: 1, raw: false, defval: '' });
    const headers = (aoa[0] || []).map((h) => String(h).trim());
    ok(JSON.stringify(headers) === JSON.stringify(spec.columns.map((c) => c.header)),
      `${spec.name}: الترويسات لا تطابق المواصفة`);
    ok(String((aoa[1] || [])[0] || '').startsWith(EXAMPLE_PREFIX.trim()),
      `${spec.name}: صف المثال لا يبدأ بـ«مثال: »`);
  }

  // 4) محاكاة التفكيك: ترويسات ملف الاستيراد المفكك تصل المحرك سليمة عبر قارئه الفعلي
  for (const spec of SHEETS) {
    const importable = spec.columns.filter((c) => !c.captured).map((c) => c.header);
    const outHeaders = spec.injectSector
      ? [...spec.columns.map((c) => c.header), 'القطاع'] : spec.columns.map((c) => c.header);
    const columns = outHeaders.map((h, i) => ({ key: `c${i}`, labelAr: h }));
    const { buffer } = buildExport({ columns, rows: [], format: 'xlsx', sheetName: spec.name });
    const parsed = parseWorkbook(buffer, 'x.xlsx');
    ok(importable.every((h) => parsed.headers.includes(h)),
      `${spec.name}: ترويسة مستوردة ضاعت في التفكيك`);
    if (spec.injectSector) ok(parsed.headers.includes('القطاع'), `${spec.name}: عمود القطاع لم يُحقن`);
  }

  // 5) مطابقة المحوّلات: المستورَد موجود حرفياً، والمُلتقط لا يشتبك حتى بالاحتواء
  const contains = (a, b) => a.includes(b) || b.includes(a);
  for (const spec of SHEETS) {
    const { labels, all } = adapterLabels(spec.adapter);
    for (const c of spec.columns) {
      if (!c.captured) {
        ok(labels.includes(c.header), `${spec.name}/«${c.header}»: ليست labelAr في محوّل ${spec.adapter}`);
      } else {
        const nc = normalizeText(c.header);
        const clash = all.find((l) => contains(normalizeText(l), nc));
        ok(!clash, `${spec.name}/«${c.header}»: تشتبك مع «${clash}» في محوّل ${spec.adapter}`);
      }
    }
    if (spec.injectSector) ok(labels.includes('القطاع'), `${spec.adapter}: لا عمود «القطاع» لحقنه`);
  }

  // 6) قيم القوائم الصارمة تُطابق قوائم المحوّلات المقروءة من مصدرها
  const clientsSrc = adapterLabels('clients');
  ok(clientsSrc.labels.length > 0, 'محوّل العملاء غير مقروء');

  if (fails.length) {
    console.error(`✗ فشل الفحص (${fails.length} من ${checks}):`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`✔ الفحص سليم — فحوص ناجحة: ${checks} (${SHEET_ORDER.length} أوراق، ${parts.size} جزءاً)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 التشغيل
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  if (args.verify) { verifyWorkbook(String(args.verify)); return; }
  if (args.split) {
    splitWorkbook(String(args.split), String(args.outdir || 'استيراد-قطاع-SAP'));
    return;
  }
  const demo = !!args.demo;
  const out = String(args.demo || args.out || 'دفتر-بيانات-قطاع-SAP.xlsx');
  const buf = buildWorkbook({ demo });
  writeFileSync(out, buf);
  console.log(`✔ بُني ${out} (${(buf.length / 1024).toFixed(0)} ك.ب)${demo ? ' — بصفوف تجريبية' : ''}`);
  console.log(`  الأوراق: ${SHEET_ORDER.join('، ')} — الصفوف الجاهزة في كل ورقة: ${DATA_ROWS}`);
}
main();
