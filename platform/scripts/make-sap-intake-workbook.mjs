#!/usr/bin/env node
// «دفتر بيانات القطاع» — مولِّد دفتر Excel عربي كامل يعبّيه فريق القطاع مرة واحدة،
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
// ويصلح الدفتر لأي قطاع لا لـSAP وحده:
//   --sector=<اسم القطاع>        ← الاسم العربي كما هو على المنصة (الافتراضي «قطاع SAP»)
//   --departments=<أ،ب>          ← إدارات القطاع في القائمة المنسدلة (الافتراضي إدارتا قطاع SAP)
//   --reviewer=<اسم>             ← من يراجع الدفتر قبل الإرسال (الافتراضي مع قطاع SAP: د. نواف الشنبري)
//   --reviewer-verb=<فعل>        ← «ويُراجع» أو «وتُراجع» بحسب المراجِع (الافتراضي «ويُراجع»)
//   --with-costs                 ← يضيف ورقة «التكاليف» السرّية (مطفأة افتراضياً)
//   --required=basic             ← يخفّف الإلزام: لا يبقى ذهبياً إلا ما لا قيام للسجل بدونه
//   --prefill=<صفوف.json>        ← نسخة معبأة بما هو مسجَّل على المنصة اليوم
//                                  (يبنيه scripts/export-sector-intake.mjs — مفتاح لكل ورقة باسم
//                                   محوّلها: clients / opportunities / oppteam / projects / phases /
//                                   deliverables / employees / employeetargets / staffing / costlines)
//
// لماذا يُكتب ملف Excel يدوياً هنا بدل مكتبة النسخ المورَّدة؟ لأن النسخة المجتمعية من المكتبة
// لا تكتب التنسيقات ولا القوائم المنسدلة ولا تثبيت الصفوف ولا الصيغ — وهذه هي جوهر «سهل التعبئة».
// فالملف يُبنى أجزاءً (XML داخل ZIP) بترتيب العناصر الذي يفرضه المعيار، ويُفحص بإعادة قراءته
// بالمكتبة المورَّدة نفسها التي سيقرأ بها المحرك الملفَ العائد.
//
// قواعد مضمونة في التصميم (مثبتة من src/modules/io):
//   • ترويسات الأعمدة المستورَدة مطابقة حرفياً لعناوين المحوّلات (labelAr) — فتُطابَق تلقائياً.
//   • العمود الذي لا محوّل له بعدُ يحمل capturedUntil ويُلوَّن رمادياً: يُجمع الآن ويُطبَّق حين
//     يصل محوّله — يفحصه --verify ويطبع قائمته.
//   • الأعمدة المُلتقطة فقط (مدير الإدارة؟، بريد الموظفين) لا تشتبك مع أي عمود محوّل حتى بمطابقة
//     الاحتواء — يفحصها --verify برمجياً.
//   • المبالغ تُكتب **بدون ضريبة**، وخانة «مع الضريبة» صيغةٌ محسوبة =ROUND(س×1.15،2). والمكتبة
//     المورَّدة تقرأ القيم لا الصيغ (xlsx.js) — فخانة الصيغة تعود فارغة، ولذلك يحسب --split
//     المبلغ مع الضريبة في جافاسكربت من العمود الصافي.
//   • عمود «القطاع» لا يُطلب من الفريق: يُحقَن آلياً في ملفات الاستيراد عند --split.
//   • أسماء المراحل هي أسماء المنصة الحية (ليدز/مؤهلة/تقييم العميل/خسارة/معلّقة) — و«فائزة»
//     غائبة عمداً: ما رسا يُكتب في «المشاريع» وحدها، والمنصة تنشئ فرصته المكسوبة بنفسها.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as XLSX from '../vendor/xlsx/xlsx.mjs';
import { parseWorkbook, buildExport } from '../src/modules/io/xlsx.js';
import { normalizeText } from '../src/modules/io/parse.js';

// ─────────────────────────────────────────────────────────────────────────────
// §1 الإعدادات — القيم الحية المنسوخة من منصة سند (2026-08-27)
// ─────────────────────────────────────────────────────────────────────────────
// اسم القطاع وإداراته ومراجعه: قيمٌ تتبع خيارات سطر الأمر، وافتراضها قطاع SAP حرفاً بحرف
// (فبناء دفتر SAP بلا خيارات يعطي الملف نفسه بايتاً ببايت كبنائه بخيارات SAP الصريحة).
const DEFAULT_SECTOR_NAME = 'قطاع SAP';
let SECTOR_NAME = DEFAULT_SECTOR_NAME;
const DEPARTMENTS = ['ادارة مشاريع', 'تطوير اعمال']; // حرفياً كما أُنشئت على المنصة
const DEFAULT_REVIEWER = 'د. نواف الشنبري';
let REVIEWER = DEFAULT_REVIEWER;       // يُذكر في «من يعبّئ ماذا؟»
let REVIEWER_SHORT = 'د. نواف';        // صيغة النداء المختصرة — تُعرف للمراجِع الافتراضي وحده
let REVIEWER_VERB = 'ويُراجع';         // فعل المراجعة مؤنَّثاً أو مذكَّراً بحسب المراجِع (--reviewer-verb)
// مستوى الإلزام: strict (الافتراضي) يُذهِّب كل ما طلبه القطاع؛ basic يُبقي الذهبي على ما لا
// قيام للسجل بدونه وحده — فيصلح لقطاعٍ لا يملك بياناته كاملة اليوم.
let REQUIRED_LEVEL = 'strict';
export const requiredLevel = () => REQUIRED_LEVEL;
let WITH_COSTS = false;                 // ورقة «التكاليف» السرّية — مطفأة افتراضياً

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
const YES_NO = ['نعم', 'لا'];
// حالات المخرَج كما تنطقها المنصة (DELIVERABLE_STATUS_AR في src/web/i18n/glossary.js)
const DELIVERABLE_STATUS = ['مسودة', 'جارٍ العمل', 'تم التسليم', 'تم الاعتماد', 'مُعاد للتعديل'];
// حالات المرحلة (project_phase.status: NOT_STARTED / IN_PROGRESS / DONE) — بصيغة المؤنث
const PHASE_STATUS = ['لم تبدأ', 'قيد التنفيذ', 'مكتملة'];
// أدوار فريق الفرصة — لا أدوار المشروع: الفرصة يقودها واحد ويشارك فيها غيره ويراعيها قائد
const TEAM_ROLES = ['قائد', 'عضو', 'مراجع', 'راعٍ'];
// أنواع التكلفة كما في جدول cost_line (migrations/001_init.sql)
const COST_TYPES = ['رواتب', 'تعاقد باطني', 'أخرى'];
// أنواع المستهدف: مبيعات (ما يُوقَّع) وإيرادات (ما يُنجَز) وأخرى (بمسمّى يكتبه القطاع)
const TARGET_KINDS = ['مبيعات', 'إيرادات', 'أخرى'];
// نوع الارتباط ونوع الطرح — نصّهما العربي كما في ENGAGEMENT_TYPE_AR و SOLICITATION_TYPE_AR
const ENGAGEMENT_TYPES = ['عمل محدَّد', 'اتفاقية إطارية'];
const SOLICITATION_TYPES = ['استطلاع سوق (RFI)', 'طلب عرض (RFP)', 'طلب سعر (RFQ)', 'تكليف مباشر', 'منافسة عامة'];
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
// آخر صف في أوراق التعبئة. الدفتر الفارغ يقف عند 202؛ والدفتر المعبأ يمتد بعدد الصفوف
// المعبأة كي تبقى بعدها 200 صفٍّ فارغ جاهز (نفس مساحة الإضافة التي يجدها الفريق في الفارغ).
let LAST_ROW = EXAMPLE_ROW + DATA_ROWS; // 202
export const EXAMPLE_PREFIX = 'مثال: ';     // بادئة الخلية الأولى في صف المثال — بها يُسقطه --split
const VAT_RATE = 1.15;               // ضريبة القيمة المضافة — نسبة واحدة في الصيغة وفي --split
const ROW_CAP_WARN = 4500;           // تحذير قبل سقف المحرك (5000 صف للملف الواحد)

const COLORS = {
  header: 'FF244A99',   // أزرق المنصة — عمود اختياري
  required: 'FFA16207', // ذهبي — عمود إلزامي
  captured: 'FF64748B', // رمادي مزرق — يُجمع الآن ويُطبَّق على المنصة لاحقاً
  calc: 'FF0F766E',     // فيروزي — خانة محسوبة لا يُكتب فيها
  calcBg: 'FFE6F4F1',   // فيروزي فاتح لخلايا العمود المحسوب
  exampleBg: 'FFF3F4F6',
  exampleFg: 'FF79828F',
  border: 'FFD1D5DB',
  listHdrBg: 'FFE6E9F0',
  title: 'FF244A99',
  dark: 'FF0F172A',
  tabGold: 'FFC9A227',
  tabGray: 'FF94A3B8',
  tabRed: 'FFB91C1C',
};

// ─────────────────────────────────────────────────────────────────────────────
// §2 أدوات صغيرة
// ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; } return s; };
// رقمٌ من خانةٍ قرأتها المكتبة نصاً منسَّقاً («٣٫٥٠٠٫٠٠٠» أو «3,500,000») → عدد أو null
function numOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/٬/g, '').replace(/٫/g, '.').replace(/[,\s]/g, '')
    .replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const vatGross = (net) => Math.round(net * VAT_RATE * 100) / 100;

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
// الفهارس الجديدة تُلحَق في آخر الجدول ولا يُعاد ترقيم القديم أبداً.
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  DEFAULT: 0, DATA_TEXT: 1, HEADER: 2, HEADER_REQ: 3, HEADER_CAP: 4, EX_TEXT: 5,
  DATA_MONEY: 6, EX_MONEY: 7, DATA_TEXTFMT: 8, EX_TEXTFMT: 9, DATA_INT: 10, EX_INT: 11,
  TITLE: 12, BODY: 13, SUBHEAD: 14, LIST_HDR: 15,
  HEADER_CALC: 16, DATA_CALC: 17, EX_CALC: 18,
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
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="5">${[
    font({}),                                   // 0 افتراضي
    font({ b: 1, color: 'FFFFFFFF' }),          // 1 ترويسة بيضاء
    font({ sz: 10, i: 1, color: COLORS.exampleFg }), // 2 صف المثال
    font({ sz: 16, b: 1, color: COLORS.title }),// 3 عنوان التعليمات
    font({ b: 1, color: COLORS.dark }),         // 4 عناوين فرعية
  ].join('')}</fonts>
<fills count="9">${['<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    fill(COLORS.header), fill(COLORS.required), fill(COLORS.exampleBg),
    fill(COLORS.listHdrBg), fill(COLORS.captured),
    fill(COLORS.calc), fill(COLORS.calcBg),
  ].join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="${COLORS.border}"/></left><right style="thin"><color rgb="${COLORS.border}"/></right><top style="thin"><color rgb="${COLORS.border}"/></top><bottom style="thin"><color rgb="${COLORS.border}"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">${[
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
    xf({ f: 1, fl: 7, b: 1, align: center }),      // 16 HEADER_CALC — ترويسة فيروزية
    xf({ fl: 8, b: 1, n: 164, align: vmid }),      // 17 DATA_CALC — خانة محسوبة
    xf({ f: 2, fl: 8, b: 1, n: 164, align: vmid }),// 18 EX_CALC
  ].join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 الأجزاء الثابتة
// ─────────────────────────────────────────────────────────────────────────────
export let SHEET_ORDER = [];
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
  // خانة صيغة: تُكتب بلا قيمة مخزَّنة (fullCalcOnLoad يحسبها عند الفتح). الصيغة النصّية تحمل
  // t="str"؛ والرقمية تُترك بلا نوع كي يكتب Excel نوعها العددي بنفسه بعد الحساب.
  if (typeof val === 'object' && val.f) {
    return `<c r="${ref}" s="${s}"${val.numeric ? '' : ' t="str"'}><f>${esc(val.f)}</f></c>`;
  }
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
  { key: 'deliverableStatus', header: 'حالة المخرج', values: DELIVERABLE_STATUS },
  { key: 'phaseStatus', header: 'حالة المرحلة', values: PHASE_STATUS },
  { key: 'yesNo', header: 'نعم أو لا', values: YES_NO },
  { key: 'teamRoles', header: 'دور عضو الفرصة', values: TEAM_ROLES },
  { key: 'costTypes', header: 'نوع التكلفة', values: COST_TYPES },
  { key: 'targetKind', header: 'نوع المستهدف', values: TARGET_KINDS },
  { key: 'engagement', header: 'نوع الارتباط', values: ENGAGEMENT_TYPES },
  { key: 'solicitation', header: 'طريقة الطرح', values: SOLICITATION_TYPES },
  { key: 'opportunities', header: 'الفرص', values: [], mirror: { sheet: 'الفرص', col: 'A' } },
  { key: 'phases', header: 'مراحل المشاريع', values: [], mirror: { sheet: 'مراحل المشروع', col: 'B' } },
];
function listMeta() {
  const meta = new Map();
  LISTS.forEach((l, i) => {
    const col = colLetter(i + 1);
    const mirrorCount = l.mirror ? (LAST_ROW - EXAMPLE_ROW + 1) : 0; // مرايا صفوف 2..LAST_ROW
    const last = 1 + l.values.length + mirrorCount;
    meta.set(l.key, { col, first: 2, last: Math.max(2, last) });
  });
  return meta;
}
// الفهرس يُعاد حسابه قبل كل بناء: طول الأوراق (LAST_ROW) وقيم القوائم قد يتغيّران مع الملء المسبق.
let LIST_META = listMeta();
const listRef = (key) => {
  const m = LIST_META.get(key);
  return `'قوائم'!$${m.col}$${m.first}:$${m.col}$${m.last}`;
};
// خانة «بيان الملء المسبق» على ورقة «قوائم» المخفية: عدد الصفوف المعبأة لكل ورقة، يكتبها البناء
// ويقرأها --verify فيتأكد أن ما وصل الفريقَ يطابق ما خرج من المنصة عدداً.
const MANIFEST_HEADER = 'بيان الملء المسبق';
// خانات «بيان الدفتر» المجاورة (مخفيةٌ معها): يحمل الدفترُ هويةَ قطاعه — الاسم والإدارات
// والمراجِع — فيقرؤها ‏--split و--verify من الملف نفسه ولا يخطئان القطاع إن نُسي العلم.
const IDENTITY_HEADER = 'بيان الدفتر';
const IDENTITY_KEYS = { sector: 'القطاع', departments: 'الإدارات', reviewer: 'المراجِع' };
const IDENTITY_COL = () => colLetter(LISTS.length + 1);
const MANIFEST_COL = () => colLetter(LISTS.length + 2);
let PREFILL_MANIFEST = null;         // 'العملاء=2؛ الفرص=14' — أو null في الدفتر الفارغ
const identityLines = () => [
  `${IDENTITY_KEYS.sector}=${SECTOR_NAME}`,
  `${IDENTITY_KEYS.departments}=${DEPARTMENTS.join('، ')}`,
  `${IDENTITY_KEYS.reviewer}=${REVIEWER}`,
];
// القراءة المقابلة: عمودٌ واحد، سطرٌ لكل حقيقة بصيغة «المفتاح=القيمة»
function readIdentity(wb) {
  const ws = wb.Sheets['قوائم'];
  if (!ws) return {};
  const col = IDENTITY_COL();
  if (String(ws[`${col}1`]?.v ?? '').trim() !== IDENTITY_HEADER) return {};
  const out = {};
  for (let r = 2; r <= 1 + Object.keys(IDENTITY_KEYS).length; r++) {
    const line = String(ws[`${col}${r}`]?.v ?? '').trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const val = line.slice(eq + 1).trim();
    if (val) out[line.slice(0, eq).trim()] = val;
  }
  return out;
}
// الهوية تُؤخذ من الملف، والعلم في سطر الأمر يعلو عليها — ويُطبع في كل مرة أيُّ مصدرٍ حكم.
function applyIdentityFromWorkbook(wb, args = {}) {
  const id = readIdentity(wb);
  const flagged = (name) => !!(args[name] && args[name] !== true);
  const srcOf = (name, key) => (flagged(name) ? 'العلم' : (id[key] ? 'الملف' : 'الافتراضي'));
  const sectorSrc = srcOf('sector', IDENTITY_KEYS.sector);
  if (sectorSrc === 'الملف') SECTOR_NAME = id[IDENTITY_KEYS.sector];
  const deptSrc = srcOf('departments', IDENTITY_KEYS.departments);
  if (deptSrc === 'الملف') {
    const deps = id[IDENTITY_KEYS.departments].split(/[,،]/).map((d) => d.trim()).filter(Boolean);
    if (deps.length) DEPARTMENTS.splice(0, DEPARTMENTS.length, ...deps);
  }
  const reviewerSrc = srcOf('reviewer', IDENTITY_KEYS.reviewer);
  if (reviewerSrc === 'الملف') {
    REVIEWER = id[IDENTITY_KEYS.reviewer];
    REVIEWER_SHORT = REVIEWER === DEFAULT_REVIEWER ? 'د. نواف' : REVIEWER;
  }
  console.log(`  هوية الدفتر: القطاع «${SECTOR_NAME}» (من ${sectorSrc}) · الإدارات «${DEPARTMENTS.join('، ')}» (من ${deptSrc})`
    + ` · المراجِع «${REVIEWER}» (من ${reviewerSrc})`);
  return { sectorSrc, deptSrc, reviewerSrc };
}

function buildListsSheetXml() {
  const rows = [];
  const maxLast = Math.max(...[...LIST_META.values()].map((m) => m.last));
  const hdr = { r: 1, ht: 22, cells: LISTS.map((l, i) => cellXml(`${colLetter(i + 1)}1`, S.LIST_HDR, l.header)) };
  const identity = identityLines();
  hdr.cells.push(cellXml(`${IDENTITY_COL()}1`, S.LIST_HDR, IDENTITY_HEADER));
  if (PREFILL_MANIFEST) hdr.cells.push(cellXml(`${MANIFEST_COL()}1`, S.LIST_HDR, MANIFEST_HEADER));
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
    if (r - 2 < identity.length) cells.push(cellXml(`${IDENTITY_COL()}${r}`, S.DEFAULT, identity[r - 2]));
    if (PREFILL_MANIFEST && r === 2) cells.push(cellXml(`${MANIFEST_COL()}2`, S.DEFAULT, PREFILL_MANIFEST));
    if (cells.length) rows.push({ r, cells });
  }
  const lastCol = colLetter(LISTS.length + 1 + (PREFILL_MANIFEST ? 1 : 0));
  return worksheetXml({
    tabColor: COLORS.tabGray,
    dimension: `A1:${lastCol}${maxLast}`,
    cols: PREFILL_MANIFEST ? [...LISTS.map(() => 26), 60, 60] : [...LISTS.map(() => 26), 60],
    rows,
  });
}

// ── مواصفة العمود ────────────────────────────────────────────────────────────
//   header        الترويسة العربية — إن كانت labelAr في محوّلها استوردها المحرك حرفياً
//   req           'always' إلزامي دائماً · 'strict' إلزامي في المستوى الصارم · false اختياري
//   captured      يُجمع الآن ولا محوّل له أصلاً (يُطبَّق بيدٍ: فتح حساب، إسناد إدارة)
//   capturedUntil اسم المحوّل الذي سيلتقطه حين يصل — رماديٌّ حتى ذلك الحين
//   calc          { from: 'ترويسة المصدر', op: 'vat_gross' | 'months' } خانة محسوبة لا يُكتب فيها
//   skipOnSplit   لا يخرج في ملف الاستيراد (العمود الصافي: المحرك يأخذ «مع الضريبة»)
//   splitHeader   الترويسة التي تُكتب في ملف الاستيراد بدل header — للعمود الذي يقرؤه الفريق
//                 باسمٍ («القيمة مع الضريبة») ويعرفه المحوّل باسمٍ آخر («القيمة (ريال)»)، فيصل
//                 المحرك اليومَ بلا انتظار محوّل جديد. و--verify يشترط أن تكون labelAr في محوّله.
//   list          { key, strict } القائمة المنسدلة ومدى صرامتها
export const ALL_SHEETS = [
  {
    name: 'العملاء', adapter: 'clients', injectSector: false,
    desc: 'كل جهة تتعاملون معها، الحالية والمستهدفة',
    columns: [
      { header: 'اسم العميل', width: 44, kind: 'text', req: 'always', list: { key: 'clients', strict: false },
        title: 'اسم العميل', hint: 'اسم الجهة الرسمي. إن كانت في القائمة فاخترها كما هي — لا تكتبها بصياغة مختلفة.' },
      { header: 'الاسم الإنجليزي', width: 24, kind: 'text', title: 'الاسم الإنجليزي', hint: 'اختياري — الاسم بالإنجليزية إن وُجد.' },
      { header: 'التصنيف', width: 15, kind: 'text', req: 'strict', list: { key: 'clientType', strict: true },
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
    desc: 'كل ما هو قيد المتابعة أو معلّق أو انتهى بخسارة',
    columns: [
      { header: 'العنوان', width: 46, kind: 'text', req: 'always',
        title: 'عنوان الفرصة', hint: 'اسم الفرصة — اجعله مميزاً لا يتكرر.' },
      { header: 'العميل', width: 40, kind: 'text', req: 'strict', list: { key: 'clients', strict: false },
        title: 'العميل', hint: 'اختر الجهة من القائمة. الجهة الجديدة تُضاف أولاً في ورقة «العملاء» بنفس الاسم حرفياً.' },
      { header: 'الإدارة', width: 16, kind: 'text', req: 'strict', capturedUntil: 'opportunities', list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'الإدارة التي تتابع هذه الفرصة — اختر من القائمة.' },
      { header: 'المرحلة', width: 16, kind: 'text', req: 'strict', list: { key: 'stages', strict: true },
        title: 'المرحلة', hint: 'أين وصلت الفرصة الآن؟ الفرصة التي رسَت عليكم لا تُكتب هنا — بل في ورقة «المشاريع». الفارغ يُحسب «ليدز».' },
      { header: 'نسبة الفوز %', width: 13, kind: 'int', req: 'strict', capturedUntil: 'opportunities',
        title: 'نسبة الفوز', hint: 'تقديركم لاحتمال الفوز — رقم من 0 إلى 100 بلا علامة %.' },
      { header: 'القيمة بدون ضريبة', width: 18, kind: 'money', req: 'strict', capturedUntil: 'opportunities', skipOnSplit: true,
        title: 'القيمة بدون ضريبة', hint: 'القيمة المتوقعة بالريال قبل الضريبة، أرقاماً فقط. وخانة «مع الضريبة» تُحسب وحدها.' },
      { header: 'القيمة مع الضريبة', width: 18, kind: 'money', splitHeader: 'القيمة (ريال)',
        calc: { from: 'القيمة بدون ضريبة', op: 'vat_gross' },
        title: 'القيمة مع الضريبة', hint: 'يُحسب تلقائياً — لا تكتب فيه. القيمة بدون ضريبة × 1.15.' },
      { header: 'السنة', width: 10, kind: 'int', req: 'strict',
        title: 'السنة', hint: 'سنة الترسية المتوقعة — اتركها فارغة إن كانت 2026.' },
      { header: 'تاريخ الإغلاق المتوقع', width: 18, kind: 'textfmt', captured: true,
        title: 'تاريخ الإغلاق المتوقع', hint: 'متى تتوقعون البتّ في الفرصة؟ اكتب: 2026-06-30.' },
      { header: 'نوع الارتباط', width: 16, kind: 'text', capturedUntil: 'opportunities', list: { key: 'engagement', strict: true },
        title: 'نوع الارتباط', hint: 'عمل محدَّد النطاق والقيمة، أو اتفاقية إطارية قيمتها سقف يُسحَب منه لاحقاً.' },
      { header: 'طريقة الطرح', width: 18, kind: 'text', capturedUntil: 'opportunities', list: { key: 'solicitation', strict: true },
        title: 'طريقة الطرح', hint: 'كيف وصلت الفرصة: استطلاع سوق، طلب عرض، طلب سعر، تكليف مباشر، أو منافسة عامة.' },
      { header: 'مدير الفرصة', width: 22, kind: 'text', req: 'strict', capturedUntil: 'opportunities', list: { key: 'employees', strict: false },
        title: 'مدير الفرصة', hint: 'من يقود هذه الفرصة — اختر الاسم كما كتبتموه في ورقة «الموظفون».' },
      { header: 'الخطوة التالية', width: 32, kind: 'text',
        title: 'الخطوة التالية', hint: 'ما الإجراء القادم على هذه الفرصة؟' },
      { header: 'ملاحظات', width: 30, kind: 'text', title: 'ملاحظات', hint: 'أي تفاصيل تهم الفريق.' },
    ],
    example: ['تطبيق نظام SAP S/4HANA لجهة حكومية', 'وزارة الطاقة', 'تطوير اعمال', 'مؤهلة', 40, 3000000,
      null, 2026, '2026-06-30', 'عمل محدَّد', 'طلب عرض (RFP)', 'محمد أحمد الشهري',
      'تسليم العرض الفني والمالي', 'بانتظار محضر الاجتماع التمهيدي'],
    demo: [
      ['تطبيق نظام SAP S/4HANA لوزارة الطاقة', 'وزارة الطاقة', 'تطوير اعمال', 'مؤهلة', 40, 3000000,
        null, 2026, '2026-06-30', 'عمل محدَّد', 'طلب عرض (RFP)', 'محمد أحمد الشهري', 'تسليم العرض الفني والمالي', ''],
      ['دعم وصيانة أنظمة الموارد الحكومية', 'شركة التعدين التجريبية', 'تطوير اعمال', 'ليدز', 20, 1043478.26,
        null, 2026, '2026-09-30', 'اتفاقية إطارية', 'استطلاع سوق (RFI)', 'سارة خالد القحطاني', 'جدولة اجتماع تعريفي', ''],
    ],
  },
  {
    name: 'فريق الفرصة', adapter: 'oppteam', injectSector: false,
    desc: 'من يعمل على كل فرصة ودوره فيها',
    columns: [
      { header: 'الفرصة', width: 46, kind: 'text', req: 'always', capturedUntil: 'oppteam', list: { key: 'opportunities', strict: false },
        title: 'الفرصة', hint: 'اختر عنوان الفرصة من القائمة — كما كتبتموه في ورقة «الفرص» حرفياً.' },
      { header: 'الموظف', width: 30, kind: 'text', req: 'always', capturedUntil: 'oppteam', list: { key: 'employees', strict: false },
        title: 'الموظف', hint: 'اختر الاسم من القائمة — كما في ورقة «الموظفون».' },
      { header: 'الدور', width: 16, kind: 'text', req: 'strict', capturedUntil: 'oppteam', list: { key: 'teamRoles', strict: true },
        title: 'الدور', hint: 'قائد الفرصة واحد، والبقية أعضاء أو مراجعون أو راعٍ.' },
      { header: 'نسبة التخصيص %', width: 15, kind: 'int', capturedUntil: 'oppteam',
        title: 'نسبة التخصيص', hint: 'كم من وقته يعطي هذه الفرصة — رقم من 0 إلى 100.' },
    ],
    example: ['تطبيق نظام SAP S/4HANA لجهة حكومية', 'محمد أحمد الشهري', 'قائد', 60],
    demo: [
      ['تطبيق نظام SAP S/4HANA لوزارة الطاقة', 'محمد أحمد الشهري', 'قائد', 60],
      ['تطبيق نظام SAP S/4HANA لوزارة الطاقة', 'سارة خالد القحطاني', 'عضو', 25],
    ],
  },
  {
    name: 'المشاريع', adapter: 'projects', injectSector: true,
    desc: 'كل ما رسا عليكم: الجاري تنفيذه والمكتمل',
    columns: [
      { header: 'اسم المشروع', width: 46, kind: 'text', req: 'always',
        title: 'اسم المشروع', hint: 'اسم المشروع كما في العقد — مميز لا يتكرر.' },
      { header: 'العميل', width: 40, kind: 'text', req: 'strict', list: { key: 'clients', strict: false },
        title: 'العميل', hint: 'اختر الجهة من القائمة — والجديدة تُضاف أولاً في ورقة «العملاء».' },
      { header: 'الإدارة', width: 16, kind: 'text', req: 'strict', capturedUntil: 'projects', list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'الإدارة المنفّذة.' },
      { header: 'مدير المشروع', width: 22, kind: 'text', req: 'strict', list: { key: 'employees', strict: false },
        title: 'مدير المشروع', hint: 'اختر الاسم من القائمة — كما في ورقة «الموظفون».' },
      { header: 'حالة المشروع', width: 17, kind: 'text', req: 'strict', list: { key: 'projectStatus', strict: true },
        title: 'حالة المشروع', hint: 'وضع المشروع اليوم.' },
      { header: 'مؤشر الصحة', width: 13, kind: 'text', list: { key: 'rag', strict: true },
        title: 'مؤشر الصحة', hint: 'أخضر: على المسار. أصفر: في خطر. أحمر: حرج.' },
      { header: 'نسبة الإنجاز (%)', width: 15, kind: 'int',
        title: 'نسبة الإنجاز', hint: 'رقم من 0 إلى 100 بدون علامة %.' },
      { header: 'تاريخ توقيع العقد', width: 17, kind: 'textfmt', req: 'strict', capturedUntil: 'projects',
        title: 'تاريخ توقيع العقد', hint: 'عليه تُحسب المبيعات — لا يُترك فارغاً. اكتب: 2026-01-20.' },
      { header: 'قيمة العقد بدون ضريبة', width: 20, kind: 'money', req: 'strict', capturedUntil: 'projects', skipOnSplit: true,
        title: 'قيمة العقد بدون ضريبة', hint: 'قيمة التعاقد قبل الضريبة، أرقاماً فقط. وخانة «مع الضريبة» تُحسب وحدها.' },
      { header: 'قيمة العقد مع الضريبة', width: 20, kind: 'money', splitHeader: 'قيمة العقد (ريال)',
        calc: { from: 'قيمة العقد بدون ضريبة', op: 'vat_gross' },
        title: 'قيمة العقد مع الضريبة', hint: 'يُحسب تلقائياً — لا تكتب فيه.' },
      { header: 'قيمة أمر الشراء', width: 17, kind: 'money', capturedUntil: 'projects',
        title: 'قيمة أمر الشراء', hint: 'اختياري — قيمة أمر الشراء إن صدر بقيمة تخالف العقد.' },
      { header: 'تاريخ البداية', width: 14, kind: 'textfmt', req: 'strict',
        title: 'تاريخ البداية', hint: 'اكتب: 2026-02-01 أو 01/02/2026.' },
      { header: 'تاريخ النهاية', width: 14, kind: 'textfmt', req: 'strict',
        title: 'تاريخ النهاية', hint: 'تاريخ النهاية التعاقدي.' },
      { header: 'مدة المشروع (شهر)', width: 16, kind: 'int', capturedUntil: 'projects',
        calc: { from: 'تاريخ البداية', to: 'تاريخ النهاية', op: 'months' },
        title: 'مدة المشروع', hint: 'يُحسب تلقائياً من تاريخي البداية والنهاية — لا تكتب فيه.' },
      { header: 'الميزانية (ريال)', width: 16, kind: 'money',
        title: 'الميزانية', hint: 'اختياري — ميزانية التنفيذ الداخلية إن وُجدت.' },
    ],
    example: ['تشغيل ودعم نظام SAP لجهة حكومية', 'وزارة الطاقة', 'ادارة مشاريع', 'سارة خالد القحطاني',
      'قيد التنفيذ', 'أخضر', 35, '2026-01-20', 5000000, null, 5000000, '2026-02-01', '2027-01-31', null, 4200000],
    demo: [
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'وزارة الطاقة', 'ادارة مشاريع', 'سارة خالد القحطاني',
        'قيد التنفيذ', 'أخضر', 35, '2026-01-20', 5000000, null, 5000000, '2026-02-01', '2027-01-31', null, 4200000],
    ],
  },
  {
    name: 'مراحل المشروع', adapter: 'phases', injectSector: false,
    desc: 'مراحل تنفيذ كل مشروع بتواريخها',
    columns: [
      { header: 'المشروع', width: 46, kind: 'text', req: 'always', capturedUntil: 'phases', list: { key: 'projects', strict: false },
        title: 'المشروع', hint: 'اختر المشروع من القائمة — كما في ورقة «المشاريع» حرفياً.' },
      { header: 'اسم المرحلة', width: 30, kind: 'text', req: 'always', capturedUntil: 'phases',
        title: 'اسم المرحلة', hint: 'اسم المرحلة كما في خطة المشروع.' },
      { header: 'الترتيب', width: 10, kind: 'int', req: 'strict', capturedUntil: 'phases',
        title: 'الترتيب', hint: 'رقم تسلسل المرحلة داخل المشروع: 1، 2، 3…' },
      { header: 'البداية', width: 14, kind: 'textfmt', capturedUntil: 'phases',
        title: 'بداية المرحلة', hint: 'اكتب: 2026-02-01.' },
      { header: 'النهاية', width: 14, kind: 'textfmt', capturedUntil: 'phases',
        title: 'نهاية المرحلة', hint: 'اكتب: 2026-04-30.' },
      { header: 'الحالة', width: 15, kind: 'text', capturedUntil: 'phases', list: { key: 'phaseStatus', strict: true },
        title: 'حالة المرحلة', hint: 'لم تبدأ، قيد التنفيذ، أو مكتملة.' },
    ],
    example: ['تشغيل ودعم نظام SAP لجهة حكومية', 'التحليل والتشخيص', 1, '2026-02-01', '2026-04-30', 'مكتملة'],
    demo: [
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'التحليل والتشخيص', 1, '2026-02-01', '2026-04-30', 'مكتملة'],
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'البناء والتهيئة', 2, '2026-05-01', '2026-10-31', 'قيد التنفيذ'],
    ],
  },
  {
    name: 'المخرجات والبنود', adapter: 'deliverables', injectSector: false,
    desc: 'بنود العقد ومخرجاته، وما فُوتِر منها وما حُصِّل',
    columns: [
      { header: 'المشروع', width: 40, kind: 'text', req: 'always', capturedUntil: 'deliverables', list: { key: 'projects', strict: false },
        title: 'المشروع', hint: 'اختر المشروع من القائمة — كما في ورقة «المشاريع» حرفياً.' },
      { header: 'اسم المخرج أو البند', width: 36, kind: 'text', req: 'always', capturedUntil: 'deliverables',
        title: 'اسم المخرج أو البند', hint: 'اسم البند كما في جدول الكميات أو خطة المخرجات.' },
      { header: 'المرحلة', width: 24, kind: 'text', capturedUntil: 'deliverables', list: { key: 'phases', strict: false },
        title: 'المرحلة', hint: 'اختياري — المرحلة التي ينتمي إليها البند، كما كتبتموها في ورقة «مراحل المشروع».' },
      { header: 'المبلغ بدون ضريبة', width: 18, kind: 'money', req: 'always', capturedUntil: 'deliverables', skipOnSplit: true,
        title: 'المبلغ بدون ضريبة', hint: 'قيمة البند قبل الضريبة، أرقاماً فقط. وخانة «مع الضريبة» تُحسب وحدها.' },
      { header: 'المبلغ مع الضريبة', width: 18, kind: 'money', capturedUntil: 'deliverables',
        calc: { from: 'المبلغ بدون ضريبة', op: 'vat_gross' },
        title: 'المبلغ مع الضريبة', hint: 'يُحسب تلقائياً — لا تكتب فيه.' },
      { header: 'شهر الاستحقاق', width: 14, kind: 'int', req: 'always', capturedUntil: 'deliverables', list: { key: 'months', strict: false },
        title: 'شهر الاستحقاق', hint: 'الإيراد يُحسب بهذا الشهر — لا شهر الفاتورة ولا شهر التحصيل. رقم الشهر: 1 = يناير.' },
      { header: 'سنة الاستحقاق', width: 13, kind: 'int', req: 'always', capturedUntil: 'deliverables',
        title: 'سنة الاستحقاق', hint: 'سنة الشهر أعلاه.' },
      { header: 'تاريخ الاستحقاق', width: 15, kind: 'textfmt', capturedUntil: 'deliverables',
        title: 'تاريخ الاستحقاق', hint: 'اختياري — اليوم المحدَّد في الخطة. اكتب: 2026-04-30.' },
      { header: 'حالة المخرج', width: 15, kind: 'text', req: 'strict', capturedUntil: 'deliverables', list: { key: 'deliverableStatus', strict: true },
        title: 'حالة المخرج', hint: 'أين وصل البند: مسودة، جارٍ العمل، تم التسليم، تم الاعتماد، أو مُعاد للتعديل.' },
      { header: 'تاريخ التسليم', width: 14, kind: 'textfmt', capturedUntil: 'deliverables',
        title: 'تاريخ التسليم', hint: 'متى سُلِّم للعميل فعلاً.' },
      { header: 'تاريخ الاعتماد', width: 14, kind: 'textfmt', capturedUntil: 'deliverables',
        title: 'تاريخ الاعتماد', hint: 'متى اعتمده العميل.' },
      { header: 'مفوتر؟', width: 11, kind: 'text', req: 'strict', capturedUntil: 'deliverables', list: { key: 'yesNo', strict: true },
        title: 'مفوتر', hint: 'هل صدرت فاتورة بهذا البند؟ نعم أو لا.' },
      { header: 'رقم الفاتورة', width: 16, kind: 'textfmt', capturedUntil: 'deliverables',
        title: 'رقم الفاتورة', hint: 'رقم الفاتورة كما صدرت.' },
      { header: 'تاريخ الفاتورة', width: 14, kind: 'textfmt', req: 'strict', capturedUntil: 'deliverables',
        title: 'تاريخ الفاتورة', hint: 'مطلوب متى كان «مفوتر؟» = نعم.' },
      { header: 'محصَّل؟', width: 11, kind: 'text', req: 'strict', capturedUntil: 'deliverables', list: { key: 'yesNo', strict: true },
        title: 'محصَّل', hint: 'هل وصل المبلغ؟ نعم أو لا.' },
      { header: 'تاريخ التحصيل', width: 14, kind: 'textfmt', req: 'strict', capturedUntil: 'deliverables',
        title: 'تاريخ التحصيل', hint: 'مطلوب متى كان «محصَّل؟» = نعم.' },
      { header: 'المسؤول', width: 22, kind: 'text', capturedUntil: 'deliverables', list: { key: 'employees', strict: false },
        title: 'المسؤول', hint: 'اختياري — من يتولى هذا البند من الفريق.' },
      { header: 'ملاحظة', width: 28, kind: 'text', capturedUntil: 'deliverables',
        title: 'ملاحظة', hint: 'أي تفصيل يخص البند.' },
    ],
    example: ['تشغيل ودعم نظام SAP لجهة حكومية', 'تقرير الوضع الراهن', 'التحليل والتشخيص', 250000, null,
      4, 2026, '2026-04-30', 'تم الاعتماد', '2026-04-25', '2026-04-30', 'نعم', 'INV-2026-014', '2026-05-03',
      'نعم', '2026-06-10', 'محمد أحمد الشهري', ''],
    demo: [
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'تقرير الوضع الراهن', 'التحليل والتشخيص', 250000, null,
        4, 2026, '2026-04-30', 'تم الاعتماد', '2026-04-25', '2026-04-30', 'نعم', 'INV-2026-014', '2026-05-03',
        'نعم', '2026-06-10', 'محمد أحمد الشهري', ''],
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'تهيئة البيئة الأساسية', 'البناء والتهيئة', 600000, null,
        8, 2026, '2026-08-31', 'جارٍ العمل', '', '', 'لا', '', '', 'لا', '', 'سارة خالد القحطاني', ''],
    ],
  },
  {
    name: 'الموظفون', adapter: 'employees', injectSector: true,
    desc: 'فريق القطاع كاملاً، مع إدارة كل موظف',
    columns: [
      { header: 'الاسم', width: 30, kind: 'text', req: 'always',
        title: 'الاسم', hint: 'الاسم الثلاثي بالعربية.' },
      { header: 'الاسم الإنجليزي', width: 24, kind: 'text', title: 'الاسم الإنجليزي', hint: 'اختياري.' },
      { header: 'المسمى الوظيفي', width: 24, kind: 'text', req: 'strict', title: 'المسمى الوظيفي', hint: 'كما في العقد.' },
      { header: 'الإدارة', width: 16, kind: 'text', req: 'strict', capturedUntil: 'employees', list: { key: 'departments', strict: true },
        title: 'الإدارة', hint: 'إدارة الموظف.' },
      { header: 'مدير الإدارة؟', width: 14, kind: 'text', captured: true, list: { key: 'yes', strict: true },
        title: 'مدير الإدارة', hint: 'علّم «نعم» أمام مدير كل إدارة فقط — واكتب بريده في عمود «البريد الإلكتروني».' },
      { header: 'نوع التوظيف', width: 14, kind: 'text', req: 'strict', list: { key: 'employment', strict: false },
        title: 'نوع التوظيف', hint: 'اختر «أساسي» لموظف الدوام الكامل.' },
      { header: 'تاريخ التعيين', width: 15, kind: 'textfmt', req: 'strict', capturedUntil: 'employees',
        title: 'تاريخ التعيين', hint: 'تاريخ مباشرة العمل. اكتب: 2025-03-01.' },
      { header: 'الطاقة %', width: 12, kind: 'int', capturedUntil: 'employees',
        title: 'الطاقة', hint: 'اختياري — نسبة توفّره للعمل على المشاريع، والافتراضي 100.' },
      { header: 'البريد الإلكتروني', width: 28, kind: 'textfmt', captured: true,
        title: 'البريد الإلكتروني', hint: 'لمن يحتاج دخول المنصة — وإلزامي لمديري الإدارات.' },
    ],
    example: ['محمد أحمد الشهري', 'Mohammed Alshehri', 'مستشار SAP أول', 'ادارة مشاريع', '', 'أساسي', '2025-03-01', 100, 'm.alshehri@evc.sa'],
    demo: [
      ['محمد أحمد الشهري', 'Mohammed Alshehri', 'مستشار SAP أول', 'ادارة مشاريع', '', 'أساسي', '2025-03-01', 100, 'm.alshehri@evc.sa'],
      ['سارة خالد القحطاني', '', 'مديرة مشاريع', 'ادارة مشاريع', 'نعم', 'أساسي', '2024-09-15', 100, 's.alqahtani@evc.sa'],
    ],
  },
  {
    name: 'مستهدفات الموظفين', adapter: 'employeetargets', injectSector: false,
    desc: 'مستهدف كل موظف لهذه السنة',
    columns: [
      { header: 'الموظف', width: 30, kind: 'text', req: 'always', capturedUntil: 'employeetargets', list: { key: 'employees', strict: false },
        title: 'الموظف', hint: 'اختر الاسم من القائمة — كما في ورقة «الموظفون».' },
      { header: 'نوع المستهدف', width: 16, kind: 'text', req: 'always', capturedUntil: 'employeetargets', list: { key: 'targetKind', strict: true },
        title: 'نوع المستهدف', hint: 'مبيعات: ما يُوقَّع من عقود. إيرادات: ما يُنجَز من مخرجات. أخرى: مستهدف آخر تكتبون بيانه.' },
      { header: 'السنة', width: 10, kind: 'int', req: 'always', capturedUntil: 'employeetargets',
        title: 'السنة', hint: 'سنة المستهدف — مثلاً 2026.' },
      { header: 'المستهدف السنوي بدون ضريبة', width: 24, kind: 'money', req: 'always', capturedUntil: 'employeetargets',
        title: 'المستهدف السنوي', hint: 'المبلغ بالريال قبل الضريبة، أرقاماً فقط.' },
      { header: 'بيان المستهدف', width: 30, kind: 'text', capturedUntil: 'employeetargets',
        title: 'بيان المستهدف', hint: 'اكتبه متى كان النوع «أخرى» — كلمتان تشرحان ما المستهدف.' },
    ],
    example: ['محمد أحمد الشهري', 'مبيعات', 2026, 3000000, ''],
    demo: [
      ['محمد أحمد الشهري', 'مبيعات', 2026, 3000000, ''],
      ['سارة خالد القحطاني', 'إيرادات', 2026, 4500000, ''],
    ],
  },
  {
    name: 'التسكين', adapter: 'staffing', injectSector: false,
    desc: 'من يعمل على أي مشروع وبأي نسبة من وقته',
    columns: [
      { header: 'الموظف', width: 30, kind: 'text', req: 'always', list: { key: 'employees', strict: false },
        title: 'الموظف', hint: 'اختر الاسم من القائمة — كما كتبته في ورقة «الموظفون» حرفياً.' },
      { header: 'المشروع', width: 46, kind: 'text', req: 'always', list: { key: 'projects', strict: false },
        title: 'المشروع', hint: 'اختر المشروع من القائمة — كما في ورقة «المشاريع» حرفياً.' },
      { header: 'السنة', width: 10, kind: 'int', req: 'strict', title: 'السنة', hint: 'اتركها فارغة إن كانت 2026.' },
      { header: 'الدور', width: 20, kind: 'text', list: { key: 'roles', strict: false },
        title: 'الدور', hint: 'دوره في هذا المشروع.' },
      { header: 'من شهر', width: 10, kind: 'int', req: 'strict', list: { key: 'months', strict: false },
        title: 'من شهر', hint: 'رقم الشهر: 1 = يناير … 12 = ديسمبر.' },
      { header: 'إلى شهر', width: 10, kind: 'int', req: 'strict', list: { key: 'months', strict: false },
        title: 'إلى شهر', hint: 'رقم الشهر الأخير للتكليف.' },
      { header: 'الإشغال (%)', width: 13, kind: 'int', req: 'strict',
        title: 'الإشغال', hint: 'نسبة وقت الموظف على هذا المشروع — رقم من 0 إلى 100.' },
    ],
    example: ['محمد أحمد الشهري', 'تشغيل ودعم نظام SAP لجهة حكومية', 2026, 'قائد المشروع', 2, 12, 75],
    demo: [
      ['محمد أحمد الشهري', 'تشغيل ودعم نظام SAP لوزارة الطاقة', 2026, 'قائد المشروع', 2, 12, 75],
    ],
  },
  {
    name: 'التكاليف', adapter: 'costlines', injectSector: true, optional: true,
    tabColor: COLORS.tabRed,
    note: 'سرّية: لقائد القطاع وحده.',
    desc: 'تكاليف تنفيذ المشاريع — ورقة سرّية',
    columns: [
      { header: 'المشروع', width: 46, kind: 'text', req: 'always', capturedUntil: 'costlines', list: { key: 'projects', strict: false },
        title: 'المشروع', hint: 'اختر المشروع من القائمة — كما في ورقة «المشاريع» حرفياً.' },
      { header: 'نوع التكلفة', width: 16, kind: 'text', req: 'always', capturedUntil: 'costlines', list: { key: 'costTypes', strict: true },
        title: 'نوع التكلفة', hint: 'رواتب، تعاقد باطني، أو أخرى.' },
      { header: 'المبلغ (ريال)', width: 16, kind: 'money', req: 'always', capturedUntil: 'costlines',
        title: 'المبلغ', hint: 'التكلفة صافية بطبيعتها — لا ضريبة عليها.' },
      { header: 'الشهر', width: 10, kind: 'int', req: 'always', capturedUntil: 'costlines', list: { key: 'months', strict: false },
        title: 'الشهر', hint: 'رقم الشهر: 1 = يناير … 12 = ديسمبر.' },
      { header: 'السنة', width: 10, kind: 'int', req: 'always', capturedUntil: 'costlines',
        title: 'السنة', hint: 'سنة التكلفة.' },
      { header: 'المصدر', width: 24, kind: 'text', capturedUntil: 'costlines',
        title: 'المصدر', hint: 'اختياري — من أين جاء الرقم: كشف الرواتب، عقد المورّد…' },
    ],
    example: ['تشغيل ودعم نظام SAP لجهة حكومية', 'رواتب', 180000, 3, 2026, 'كشف الرواتب'],
    demo: [
      ['تشغيل ودعم نظام SAP لوزارة الطاقة', 'رواتب', 180000, 3, 2026, 'كشف الرواتب'],
    ],
  },
];

// الأوراق الفاعلة في البناء الحالي — «التكاليف» لا تدخل إلا مع --with-costs.
export let SHEETS = ALL_SHEETS.filter((s) => !s.optional);
export function setWithCosts(on) {
  WITH_COSTS = !!on;
  SHEETS = ALL_SHEETS.filter((s) => !s.optional || WITH_COSTS);
  SHEET_ORDER = ['التعليمات', ...SHEETS.map((s) => s.name), 'قوائم'];
  return SHEETS;
}
setWithCosts(false);

// ── قواعد المواصفة التي يقرأها المولِّد والمصدِّر معاً ────────────────────────
export const isRequired = (c) => c.req === 'always' || (c.req === 'strict' && REQUIRED_LEVEL === 'strict');
export const isCalc = (c) => !!c.calc;
export const isGrey = (c) => !!c.captured || !!c.capturedUntil;
// أعمدة ملف الاستيراد: يسقط العمود الصافي (المحرك يأخذ «مع الضريبة») وتسقط مدة المشروع
// (رقمٌ مشتق للقراءة لا يُخزَّن).
export const splitColumns = (spec) =>
  spec.columns.filter((c) => !c.skipOnSplit && !(c.calc && c.calc.op === 'months'));

// أنواع الأعمدة التي تُقرأ بقيمتها المخزَّنة لا بنصها المعروض (§التفكيك)
const NUMERIC_KINDS = new Set(['money', 'int']);
const KIND_STYLES = {
  text: { data: S.DATA_TEXT, ex: S.EX_TEXT },
  money: { data: S.DATA_MONEY, ex: S.EX_MONEY },
  int: { data: S.DATA_INT, ex: S.EX_INT },
  textfmt: { data: S.DATA_TEXTFMT, ex: S.EX_TEXTFMT },
};
const headerStyle = (c) => (isCalc(c) ? S.HEADER_CALC
  : (isRequired(c) ? S.HEADER_REQ : (isGrey(c) ? S.HEADER_CAP : S.HEADER)));

// صيغة الخانة المحسوبة لصفٍّ بعينه — تُترك فارغة ما دام مصدرها فارغاً كي لا يقرأ الفريق أصفاراً
function calcFormula(spec, col, row) {
  const at = (header) => {
    const i = spec.columns.findIndex((c) => c.header === header);
    if (i < 0) throw new Error(`ورقة «${spec.name}»: عمود محسوب يشير إلى «${header}» وليس في الورقة`);
    return `${colLetter(i + 1)}${row}`;
  };
  if (col.calc.op === 'vat_gross') {
    const src = at(col.calc.from);
    return { f: `IF(${src}="","",ROUND(${src}*${VAT_RATE},2))`, numeric: true };
  }
  if (col.calc.op === 'months') {
    const a = at(col.calc.from); const b = at(col.calc.to);
    return { f: `IF(OR(${a}="",${b}=""),"",DATEDIF(${a},${b},"m")+1)`, numeric: true };
  }
  throw new Error(`عملية حساب غير معروفة: ${col.calc.op}`);
}

function buildDataSheetXml(spec, { dataRows = null } = {}) {
  const n = spec.columns.length;
  const rows = [];
  rows.push({
    r: 1, ht: 30,
    cells: spec.columns.map((c, i) => cellXml(`${colLetter(i + 1)}1`, headerStyle(c), c.header)),
  });
  // صف المثال — الخلية الأولى تبدأ بـ«مثال: » وبها يتعرف عليه --split فيُسقطه
  rows.push({
    r: EXAMPLE_ROW,
    cells: spec.columns.map((c, i) => {
      if (isCalc(c)) return cellXml(`${colLetter(i + 1)}${EXAMPLE_ROW}`, S.EX_CALC, calcFormula(spec, c, EXAMPLE_ROW));
      const v = spec.example[i];
      const val = i === 0 && v ? EXAMPLE_PREFIX + v : v;
      return cellXml(`${colLetter(i + 1)}${EXAMPLE_ROW}`, KIND_STYLES[c.kind].ex, (val === '' || val == null) ? null : val);
    }),
  });
  // الصفوف المعبأة (تجريبية مع --demo أو حقيقية مع --prefill) ثم صفوف فارغة جاهزة حتى LAST_ROW
  const demo = dataRows || [];
  for (let r = EXAMPLE_ROW + 1; r <= LAST_ROW; r++) {
    const d = demo[r - EXAMPLE_ROW - 1];
    rows.push({
      r,
      cells: spec.columns.map((c, i) => {
        if (isCalc(c)) return cellXml(`${colLetter(i + 1)}${r}`, S.DATA_CALC, calcFormula(spec, c, r));
        return cellXml(`${colLetter(i + 1)}${r}`, KIND_STYLES[c.kind].data,
          d ? (d[i] === '' ? null : d[i]) : null);
      }),
    });
  }
  const validations = spec.columns.map((c, i) => {
    const L = colLetter(i + 1);
    const prompt = [spec.note, c.hint].filter(Boolean).join(' ');
    return validationXml({
      sqref: `${L}${EXAMPLE_ROW}:${L}${LAST_ROW}`,
      listRef: c.list ? listRef(c.list.key) : null,
      strict: c.list ? c.list.strict : false,
      title: c.title, prompt,
    });
  });
  return worksheetXml({
    tabColor: spec.tabColor || COLORS.header,
    dimension: `A1:${colLetter(n)}${LAST_ROW}`,
    freeze: true,
    cols: spec.columns.map((c) => c.width),
    rows, validations,
  });
}

// ورقة «التعليمات» — الغلاف
function buildInstructionsSheetXml({ prefilled = false } = {}) {
  const lines = [];
  const push = (a, b, sA, sB, ht) => lines.push({ a, b, sA, sB, ht });
  const para = (t) => push(null, t, S.DEFAULT, S.BODY, t.length > 220 ? 46 : (t.length > 110 ? 32 : 22));
  const head = (t) => { push(null, null); push(null, t, S.DEFAULT, S.SUBHEAD); };

  push(null, `دفتر بيانات ${SECTOR_NAME} — منصة سند`, S.DEFAULT, S.TITLE, 30);
  push(null, null);
  para(`أهلاً بكم. هذا الدفتر هو الخطوة الأولى ل${SECTOR_NAME} على المنصة: تُجمَع فيه بياناتكم مرة واحدة، ثم تظهر في شاشات المنصة — الفرص والمشاريع والمخرجات والفريق — من غير إدخال يدوي بعد اليوم.`);
  // الدفتر المعبأ يصل الفريقَ وفيه ما هو مسجَّل اليوم — فيُقال ذلك صراحةً، وإلا ظنّه الفريق فارغاً
  // فأعاد كتابة ما هو مكتوب، أو ظنّ المكتوب نهائياً فلم يصحّحه.
  if (prefilled) {
    para('وقد عبّأنا لكم فيه ما هو مسجَّل على المنصة اليوم: راجعوا كل سطر، صحّحوا ما يحتاج تصحيحاً، أكملوا الخانات الفارغة، وأضيفوا في الصفوف التالية ما لم يُسجَّل بعد. والسطر الذي تتركونه كما هو نفهم منه أنه صحيح كما هو.');
  }

  head('ماذا في هذا الدفتر؟');
  SHEETS.forEach((sp, i) => {
    const req = sp.columns.filter((c) => isRequired(c)).map((c) => `«${c.header}»`);
    para(`${i + 1}. ${sp.name} — ${sp.desc}. الإلزامي فيها: ${req.length ? req.join('، ') : 'لا شيء'}.`);
  });

  head('القواعد الذهبية');
  para('• سطر واحد لكل سجل، وعناوين الصف الأول تبقى كما هي — لا تعديل ولا حذف ولا إعادة ترتيب.');
  para('• العمل الواحد يُكتب مرة واحدة فقط: ما زال عرضاً أو متابعةً ← ورقة «الفرص»، وما رسا عليكم أو جارٍ تنفيذه أو اكتمل ← ورقة «المشاريع». لا يُكتب في الورقتين معاً أبداً.');
  para('• التواريخ بصيغة 2026-01-31 أو 31/01/2026، والنسب أرقام من 0 إلى 100 بلا علامة %.');
  para('• لا تُترك خانة ذهبية فارغة. وإن جهلتم قيمتها فاكتبوا في «ملاحظات» أنها غير معروفة بدل تركها بلا أثر.');

  head('قاعدة المبالغ');
  para('• كل المبالغ بالريال السعودي، أرقاماً فقط من غير كلمة «ريال».');
  para('• تُكتب بدون ضريبة، وخانة «مع الضريبة» تُحسب وحدها — الفيروزي لا يُكتب فيه.');
  para('• التكاليف صافية بطبيعتها فلا ضريبة عليها.');

  head('قاعدتا التاريخ');
  para('• المبيعات تُحسب بتاريخ توقيع العقد.');
  para('• الإيراد يُحسب بشهر المخرج — لا شهر الفاتورة ولا شهر التحصيل.');
  para('• لذلك لا يُتركان فارغين: «تاريخ توقيع العقد» في ورقة «المشاريع»، و«شهر الاستحقاق» في ورقة «المخرجات والبنود».');

  head('القوائم المنسدلة');
  para('• في كل خانة لها سهم افتحوا القائمة واختاروا — الكتابة اليدوية تصنع اسمين لشيء واحد.');
  para('• في عمود «العميل» اختاروا الاسم إن وجدتموه، ولا تكتبوا اسماً بصياغة مختلفة لجهة موجودة. الجهة الجديدة فعلاً تُضاف أولاً في ورقة «العملاء».');
  para('• أسماء الموظفين والمشاريع والفرص والمراحل تظهر في القوائم بعد كتابتها في أوراقها — اكتبوها أولاً ثم اختاروها في بقية الأوراق.');

  head('صف المثال');
  para('• الصف الرمادي أول كل ورقة مثالٌ للتوضيح — اكتبوا بياناتكم مكانه أو احذفوه قبل إعادة الدفتر.');

  head('دليل ألوان الأعمدة');
  push('إلزامي', 'العمود الذهبي إلزامي — لا يُترك فارغاً.', S.HEADER_REQ, S.BODY);
  push('اختياري', 'العمود الأزرق اختياري — والقليل الصحيح خير من الكثير الناقص.', S.HEADER, S.BODY);
  push('محسوب', 'العمود الفيروزي محسوب تلقائياً لا يُكتب فيه — يملأ نفسه من الخانة التي بجانبه.', S.HEADER_CALC, S.BODY);
  push('لاحقاً', 'العمود الرمادي معلومة تُجمَع الآن وتظهر على المنصة في التحديث القادم: الإدارة، مدير الإدارة، البريد، تاريخ الإغلاق المتوقع، ومخرجات المشاريع.', S.HEADER_CAP, S.BODY, 32);

  head('من يعبّئ ماذا؟');
  para(`كل إدارة تعبّئ صفوفها، وعمود «الإدارة» يحدد تبعية كل سجل: ${DEPARTMENTS.map((d) => `«${d}»`).join(' أو ')}.`);
  para('ورقة «المخرجات والبنود» يعبّئها مدير كل مشروع — فهو من يعرف بنود عقده وتواريخ تسليمها وفوترتها.');
  if (WITH_COSTS) para('وورقة «التكاليف» يعبّئها قائد القطاع وحده، وهي سرّية لا تُتداول خارج هذا الدفتر.');
  para('في ورقة «الموظفون» علّموا «نعم» أمام مدير كل إدارة واكتبوا بريده الإلكتروني ليُفتَح له حساب على المنصة — وكذلك بريد كل زميل يحتاج الدخول.');
  para(`${REVIEWER_VERB} ${REVIEWER_SHORT} الدفتر كاملاً قبل الإرسال.`);

  head('ملاحظات أخيرة');
  para('• الرواتب لا تُطلب في هذا الدفتر.');
  para('• لا تنتظروا الكمال: أرسلوا ما اكتمل، وما ينقص يُستكمل لاحقاً أو من المنصة مباشرة.');
  para(`• لأي سؤال: ${REVIEWER}، أو فريق منصة سند.`);

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
// مفتاح الورقة في ملف الملء المسبق: اسم المحوّل (clients/opportunities/oppteam/projects/phases/
// deliverables/employees/employeetargets/staffing/costlines) — ويُقبل اسم الورقة العربي أيضاً.
export const sheetKey = (spec) => spec.adapter;
function rowsForSheet(prefill, spec) {
  if (!prefill) return null;
  const rows = prefill[sheetKey(spec)] ?? prefill[spec.name];
  if (rows == null) return [];
  if (!Array.isArray(rows)) throw new Error(`ورقة «${spec.name}»: الصفوف يجب أن تكون قائمة صفوف`);
  return rows.map((r, i) => {
    if (!Array.isArray(r)) throw new Error(`ورقة «${spec.name}» الصف ${i + 1}: الصف يجب أن يكون قائمة خانات بترتيب الأعمدة`);
    if (r.length > spec.columns.length) throw new Error(`ورقة «${spec.name}» الصف ${i + 1}: خانات أكثر من أعمدة الورقة (${spec.columns.length})`);
    return spec.columns.map((c, ci) => {
      // الخانة المحسوبة تبقى صيغةً مهما جاء في الملء المسبق: المصدِّر يكتب الصافي وحده.
      if (isCalc(c)) return '';
      const v = r[ci];
      if (v == null || v === '') return '';
      if (typeof v === 'number') return Number.isFinite(v) ? v : '';
      return String(v);
    });
  });
}
// القوائم المنسدلة الصارمة تُوسَّع بقيم الملء المسبق: قيمةٌ حقيقية على المنصة خارج القائمة كانت
// ستُرفض في وجه من يحرّر الخانة (أسماء المراحل والإدارات تختلف بين قطاع وقطاع).
function widenStrictLists(prefill) {
  if (!prefill) return;
  for (const spec of SHEETS) {
    const rows = rowsForSheet(prefill, spec);
    if (!rows.length) continue;
    spec.columns.forEach((c, ci) => {
      if (!c.list || !c.list.strict) return;
      const list = LISTS.find((l) => l.key === c.list.key);
      if (!list) return;
      for (const r of rows) {
        const v = r[ci];
        if (v === '' || v == null) continue;
        if (!list.values.some((x) => String(x) === String(v))) list.values.push(v);
      }
    });
  }
}
function buildWorkbook({ demo = false, prefill = null } = {}) {
  widenStrictLists(prefill);
  const filled = new Map(SHEETS.map((sp) => [sp, prefill ? rowsForSheet(prefill, sp) : (demo ? sp.demo : null)]));
  if (prefill) {
    const maxRows = Math.max(0, ...[...filled.values()].map((r) => (r ? r.length : 0)));
    LAST_ROW = EXAMPLE_ROW + DATA_ROWS + maxRows;
    PREFILL_MANIFEST = SHEETS.map((sp) => `${sp.name}=${filled.get(sp).length}`).join('؛ ');
  } else {
    LAST_ROW = EXAMPLE_ROW + DATA_ROWS;
    PREFILL_MANIFEST = null;
  }
  LIST_META = listMeta();
  const sheetXmls = [
    buildInstructionsSheetXml({ prefilled: !!prefill }),
    ...SHEETS.map((s) => buildDataSheetXml(s, { dataRows: filled.get(s) })),
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
// ترتيب الاستيراد على المنصة: المرجع قبل المُشير إليه دائماً.
const IMPORT_ORDER = ['العملاء', 'الموظفون', 'الفرص', 'فريق الفرصة', 'المشاريع', 'مراحل المشروع',
  'المخرجات والبنود', 'التسكين', 'مستهدفات الموظفين', 'التكاليف'];

/**
 * يقرأ الدفتر المعبأ ويحوّل كل ورقةٍ إلى جدول ملف الاستيراد — بلا كتابة على القرص،
 * كي يستعمله --split و--verify معاً على المنطق نفسه.
 */
function splitSheets(filePath) {
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true });
  // الأوراق الموجودة في الملف هي التي تُفكَّك — فدفترٌ بُني بلا «التكاليف» لا تُطلب منه.
  const present = ALL_SHEETS.filter((sp) => wb.SheetNames.some((n) => n.trim() === sp.name));
  const out = [];
  for (const spec of present) {
    const ws = wb.Sheets[wb.SheetNames.find((n) => n.trim() === spec.name)];
    // قراءتان: النص المعروض (تُبقي التواريخ نصاً كما يكتبها الفريق) والقيمة المخزَّنة.
    // خانات المال والعدد تُؤخذ من القيمة المخزَّنة لأن النص المعروض مقرَّب بصيغة العرض،
    // فـ1043478.26 كان يُقرأ 1,043,478 فينحرف المبلغ مع الضريبة عن الحقيقة.
    const opts = { header: 1, defval: '', blankrows: true };
    const aoaText = XLSX.utils.sheet_to_json(ws, { ...opts, raw: false });
    const aoaRaw = XLSX.utils.sheet_to_json(ws, { ...opts, raw: true });
    const aoa = aoaText.map((row, ri) => {
      if (ri === 0) return row;
      const rawRow = aoaRaw[ri] || [];
      return row.map((cell, ci) => {
        const col = spec.columns[ci];
        if (!col || !NUMERIC_KINDS.has(col.kind)) return cell;
        const v = rawRow[ci];
        // String(number) بلا فواصل ولا تقريب — أدقّ ما يمكن تمريره لبقية الأنبوب
        return typeof v === 'number' && Number.isFinite(v) ? String(v) : cell;
      });
    }).filter((r, ri) => ri === 0 || r.some((c) => String(c ?? '').trim() !== ''));
    if (!aoa.length) { out.push({ spec, headers: [], rows: [], dropped: 0, source: [] }); continue; }
    const fileHeaders = aoa[0].map((h) => String(h ?? '').trim());
    let dropped = 0;
    const body = aoa.slice(1)
      .map((r) => fileHeaders.map((_, i) => String(r[i] ?? '').trim()))
      .filter((r) => {
        if (!r.some((c) => c !== '')) return false;
        if (r[0].startsWith(EXAMPLE_PREFIX.trim())) { dropped++; return false; }
        return true;
      });
    const idxOf = (header) => spec.columns.findIndex((c) => c.header === header);
    const kept = new Set(splitColumns(spec));
    const keep = spec.columns.map((c, i) => ({ c, i })).filter(({ c }) => kept.has(c));
    // ترويسة ملف الاستيراد: splitHeader إن وُجد (اسم المحوّل) وإلا ترويسة الورقة كما يقرؤها الفريق
    const headers = keep.map(({ c }) => c.splitHeader || c.header);
    const rows = body.map((r) => keep.map(({ c, i }) => {
      if (c.calc && c.calc.op === 'vat_gross') {
        // الصيغة تصل هنا فارغةً (المكتبة تقرأ القيم لا الصيغ) — فيُحسب المبلغ مع الضريبة
        // في جافاسكربت من العمود الصافي؛ وإن كُتب رقمٌ فوق الصيغة فهو الأصدق فيُؤخذ كما هو.
        const typed = numOf(r[i]);
        if (typed != null) return typed;
        const net = numOf(r[idxOf(c.calc.from)]);
        return net == null ? '' : vatGross(net);
      }
      return r[i];
    }));
    if (spec.injectSector) { headers.push('القطاع'); rows.forEach((r) => r.push(SECTOR_NAME)); }
    out.push({ spec, headers, rows, dropped, source: body, fileHeaders });
  }
  return out;
}

function splitWorkbook(filePath, outdir) {
  const sheets = splitSheets(filePath);
  mkdirSync(outdir, { recursive: true });
  // ملف الإسناد: الحقائق التي لا محوّل لها أصلاً — تُطبَّق بيدٍ بعد الاستيراد
  const attribution = [['الورقة', 'الاسم', 'مدير الإدارة؟', 'البريد الإلكتروني', 'تاريخ الإغلاق المتوقع']];
  const written = [];
  for (const { spec, headers, rows, dropped, source, fileHeaders } of sheets) {
    if (!headers.length) { console.log(`⚠ الورقة «${spec.name}» فارغة تماماً — تُتجاوز`); continue; }
    const columns = headers.map((h, i) => ({ key: `c${i}`, labelAr: h }));
    const objRows = rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])));
    const { buffer } = buildExport({ columns, rows: objRows, format: 'xlsx', sheetName: spec.name });
    const outFile = join(outdir, `استيراد-${spec.name}.xlsx`);
    writeFileSync(outFile, buffer);
    written.push(outFile);
    const grey = spec.columns.filter((c) => c.capturedUntil && !c.skipOnSplit).length;
    console.log(`✔ ${basename(outFile)} — الصفوف: ${rows.length} (أُسقطت صفوف المثال: ${dropped})`
      + `${grey ? ` — أعمدة رمادية تنتظر محوّلها: ${grey}` : ''}`);
    if (rows.length > ROW_CAP_WARN) {
      console.log(`  ⚠ «${spec.name}» فيها ${rows.length} صفاً — سقف الرفعة الواحدة 5000 صف. قسّمها على ملفين قبل الرفع.`);
    }
    const hIdx = (name) => (fileHeaders || []).indexOf(name);
    const mgr = hIdx('مدير الإدارة؟'); const mail = hIdx('البريد الإلكتروني');
    const close = hIdx('تاريخ الإغلاق المتوقع');
    if (mgr >= 0 || close >= 0 || (mail >= 0 && spec.name === 'الموظفون')) {
      for (const r of source) {
        const cells = [mgr >= 0 ? r[mgr] : '', (mail >= 0 && spec.name === 'الموظفون') ? r[mail] : '',
          close >= 0 ? r[close] : ''];
        if (cells.some((v) => v !== '')) attribution.push([spec.name, r[0], ...cells]);
      }
    }
  }
  const csv = '﻿' + attribution.map((row) => row.map((v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
  const attrFile = join(outdir, 'إسناد-الإدارات.csv');
  writeFileSync(attrFile, csv, 'utf8');
  console.log(`✔ ${basename(attrFile)} — مدير الإدارة والبريد وتاريخ الإغلاق المتوقع (${attribution.length - 1} سطراً)`);
  const order = IMPORT_ORDER.filter((n) => sheets.some((s) => s.spec.name === n));
  console.log(`\nترتيب الاستيراد في المنصة: ${order.join(' ← ')}`);
  console.log('ويُرفع كل ملف وحده — المحرك يقرأ الورقة الأولى من الملف فقط.');
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 الفحص البنيوي — لا يمر الملف إلا إذا صحّت بنيته وترويساته ومطابقته للمحوّلات
// ─────────────────────────────────────────────────────────────────────────────
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
function adapterLabels(adapterName) {
  const path = join(scriptDir, `../src/modules/io/adapters/${adapterName}.js`);
  if (!existsSync(path)) return null;      // محوّل لم يُكتب بعد — أعمدته كلها رمادية
  const src = readFileSync(path, 'utf8');
  const labels = [...src.matchAll(/labelAr:\s*'([^']+)'/g)].map((m) => m[1]);
  const aliases = [...src.matchAll(/aliases:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  return { labels, all: [...labels, ...aliases] };
}
function verifyWorkbook(filePath, args = {}) {
  const buf = readFileSync(filePath);
  const fails = []; const warns = []; let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };

  // 0) وضع الدفتر يُقرأ من الملف نفسه: أفيه ورقة «التكاليف» أم لا
  const probe = XLSX.read(buf, { type: 'buffer' });
  setWithCosts(probe.SheetNames.includes('التكاليف'));
  // وهويّته — القطاع وإداراته ومراجعه — تُقرأ من «بيان الدفتر» المخفي، والعلم يعلو عليها
  applyIdentityFromWorkbook(probe, args);
  // وطول الأوراق (الدفتر المعبأ أطول من الفارغ) يُقرأ من مدى ورقة العملاء
  const dimRef = String(probe.Sheets[SHEETS[0].name]?.['!ref'] || '');
  const dimRow = Number((dimRef.split(':')[1] || '').replace(/[A-Z]/g, ''));
  if (Number.isFinite(dimRow) && dimRow > EXAMPLE_ROW) LAST_ROW = dimRow;
  LIST_META = listMeta();
  // «التكاليف» لا تُبنى إلا بطلبٍ صريح — يُثبَت على المواصفة لا على الملف
  ok(!ALL_SHEETS.filter((s) => !s.optional).some((s) => s.name === 'التكاليف'),
    'ورقة «التكاليف» ليست اختيارية في المواصفة — تظهر في كل دفتر');

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
    // الخانات المحسوبة صيغٌ فعلاً، في صف المثال وفي أول صف بيانات وفي آخر صف
    spec.columns.forEach((c, ci) => {
      if (!isCalc(c)) return;
      const L = colLetter(ci + 1);
      for (const r of [EXAMPLE_ROW, EXAMPLE_ROW + 1, LAST_ROW]) {
        const cell = new RegExp(`<c r="${L}${r}"[^>]*>(<f>[^<]*</f>)`).exec(xml);
        ok(!!cell, `${spec.name}/«${c.header}»: الخانة ${L}${r} ليست صيغة محسوبة`);
      }
      const styled = new RegExp(`<c r="${L}1" s="${S.HEADER_CALC}"`).test(xml);
      ok(styled, `${spec.name}/«${c.header}»: ترويسة العمود المحسوب ليست فيروزية`);
    });
  });

  // 2ب) مرايا «قوائم» تغطي آخر صفٍّ في أوراقها — وإلا اختفى آخر ما كتبه الفريق من القوائم
  const listsXml = parts.get(`xl/worksheets/sheet${SHEET_ORDER.length}.xml`).toString('utf8');
  for (const l of LISTS) {
    if (!l.mirror) continue;
    ok(listsXml.includes(`${esc(`'${l.mirror.sheet}'!${l.mirror.col}${LAST_ROW}`)}`)
      || listsXml.includes(`'${l.mirror.sheet}'!${l.mirror.col}${LAST_ROW}`),
    `قوائم/«${l.header}»: المرآة لا تصل الصف ${LAST_ROW}`);
  }

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

  // 3ب) الملء المسبق: عدد صفوف كل ورقة = ما أعلنه «بيان الملء المسبق» على ورقة «قوائم» المخفية
  const listsWs = wb.Sheets['قوائم'];
  const manifestCell = listsWs ? listsWs[`${MANIFEST_COL()}2`] : null;
  const manifest = manifestCell ? String(manifestCell.v ?? '') : '';
  if (manifest) {
    const declared = new Map(manifest.split('؛').map((p) => {
      const [k, v] = p.split('=');
      return [String(k || '').trim(), Number(v)];
    }));
    for (const spec of SHEETS) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[spec.name], { header: 1, raw: false, defval: '', blankrows: false });
      const actual = aoa.slice(1).filter((r) => {
        const cells = spec.columns.map((_, i) => String(r[i] ?? '').trim());
        if (!cells.some((c) => c !== '')) return false;
        return !cells[0].startsWith(EXAMPLE_PREFIX.trim());
      }).length;
      const want = declared.get(spec.name);
      ok(Number.isFinite(want) && want === actual,
        `${spec.name}: الصفوف المعبأة ${actual} والمعلن ${want ?? '—'}`);
    }
  }

  // 4) التفكيك الفعلي: الترويسات تصل المحرك سليمة، والمبلغ مع الضريبة يُحسب صحيحاً
  // 4أ) الحساب نفسه على صافٍ بكسور — الهللات لا تضيع في التقريب
  ok(vatGross(1043478.26) === 1200000, `الحساب: 1043478.26 × ${VAT_RATE} = ${vatGross(1043478.26)} والمتوقع 1200000`);
  ok(vatGross(1234567.89) === 1419753.07, `الحساب: 1234567.89 × ${VAT_RATE} = ${vatGross(1234567.89)} والمتوقع 1419753.07`);
  const split = splitSheets(filePath);
  ok(split.length === SHEETS.length, `التفكيك أنتج ${split.length} ورقة والمتوقع ${SHEETS.length}`);
  for (const { spec, headers, rows, source } of split) {
    const columns = headers.map((h, i) => ({ key: `c${i}`, labelAr: h }));
    const { buffer } = buildExport({ columns, rows: [], format: 'xlsx', sheetName: spec.name });
    const parsed = parseWorkbook(buffer, 'x.xlsx');
    ok(JSON.stringify(parsed.headers) === JSON.stringify(headers),
      `${spec.name}: ترويسة ضاعت في التفكيك`);
    if (spec.injectSector) ok(parsed.headers.includes('القطاع'), `${spec.name}: عمود القطاع لم يُحقن`);
    for (const c of spec.columns) {
      if (c.skipOnSplit) ok(!headers.includes(c.header), `${spec.name}/«${c.header}»: العمود الصافي لم يُسقَط من ملف الاستيراد`);
      if (c.calc && c.calc.op === 'months') ok(!headers.includes(c.header), `${spec.name}/«${c.header}»: عمود المدة لم يُسقَط`);
    }
    // الحساب: كل خانة «مع الضريبة» في الملف المفكوك = تقريب(الصافي × 1.15) من الورقة الأصلية
    spec.columns.forEach((c) => {
      if (!c.calc || c.calc.op !== 'vat_gross') return;
      const outIdx = headers.indexOf(c.splitHeader || c.header);
      const netIdx = spec.columns.findIndex((x) => x.header === c.calc.from);
      rows.forEach((r, ri) => {
        const net = numOf(source[ri][netIdx]);
        const got = r[outIdx];
        const want = net == null ? '' : vatGross(net);
        ok(String(got) === String(want),
          `${spec.name} صف ${ri + 1}/«${c.header}»: ${got} والمتوقع ${want}`);
      });
    });
    if (rows.length > ROW_CAP_WARN) warns.push(`${spec.name}: ${rows.length} صفاً — قارب سقف الرفعة (5000)`);
  }

  // 5) مطابقة المحوّلات: المستورَد موجود حرفياً، والمُلتقط لا يشتبك حتى بالاحتواء
  const contains = (a, b) => a.includes(b) || b.includes(a);
  const grey = [];
  for (const spec of SHEETS) {
    const src = adapterLabels(spec.adapter);
    if (!src) {
      ok(spec.columns.every((c) => c.capturedUntil || c.captured),
        `${spec.name}: لا محوّل «${spec.adapter}» بعد، فكل أعمدتها يجب أن تكون رمادية`);
      spec.columns.forEach((c) => grey.push(`${spec.name}/${c.header}`));
      continue;
    }
    const { labels, all } = src;
    for (const c of spec.columns) {
      if (c.capturedUntil) {
        grey.push(`${spec.name}/${c.header}`);
        ok(c.capturedUntil === spec.adapter,
          `${spec.name}/«${c.header}»: capturedUntil «${c.capturedUntil}» لا يطابق محوّل الورقة «${spec.adapter}»`);
      } else if (!c.captured) {
        // العمود المستورَد اليوم: إمّا ترويسته نفسها labelAr في محوّله، وإمّا يحمل splitHeader
        // يُكتب مكانها في ملف الاستيراد — وذاك أيضاً يجب أن يكون labelAr حرفياً لا اسماً مقارباً.
        const want = c.splitHeader || c.header;
        ok(labels.includes(want), c.splitHeader
          ? `${spec.name}/«${c.header}»: splitHeader «${c.splitHeader}» ليست labelAr في محوّل ${spec.adapter}`
          : `${spec.name}/«${c.header}»: ليست labelAr في محوّل ${spec.adapter} ولا تحمل capturedUntil`);
      } else {
        grey.push(`${spec.name}/${c.header}`);
        const nc = normalizeText(c.header);
        const clash = all.find((l) => contains(normalizeText(l), nc));
        ok(!clash, `${spec.name}/«${c.header}»: تشتبك مع «${clash}» في محوّل ${spec.adapter}`);
      }
    }
    if (spec.injectSector) ok(labels.includes('القطاع'), `${spec.adapter}: لا عمود «القطاع» لحقنه`);
  }

  // 6) قيم القوائم الصارمة تُطابق قوائم المحوّلات المقروءة من مصدرها
  const clientsSrc = adapterLabels('clients');
  ok(clientsSrc && clientsSrc.labels.length > 0, 'محوّل العملاء غير مقروء');

  const sizeMb = buf.length / (1024 * 1024);
  if (sizeMb > 5) warns.push(`حجم الملف ${sizeMb.toFixed(1)} م.ب — أكبر من 5 م.ب، وقد يثقل على البريد`);

  if (fails.length) {
    console.error(`✗ فشل الفحص (${fails.length} من ${checks}):`);
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`✔ الفحص سليم — فحوص ناجحة: ${checks} (${SHEET_ORDER.length} أوراق، ${parts.size} جزءاً)${manifest ? ` — ملء مسبق: ${manifest}` : ''}`);
  console.log(`  الحجم: ${(buf.length / 1024).toFixed(0)} ك.ب (${sizeMb.toFixed(2)} م.ب) — آخر صف: ${LAST_ROW}`);
  console.log(`  أعمدة تنتظر محوّلها (رمادية): ${grey.length}`);
  if (grey.length) console.log('   ' + grey.join('، '));
  for (const w of warns) console.log(`  ⚠ ${w}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 التشغيل
// ─────────────────────────────────────────────────────────────────────────────
// صفوف المثال تسمّي SAP صراحةً (اسم منتج، مسمّى وظيفي، إدارة من إدارات قطاع SAP) — وهي في
// دفتر قطاعٍ آخر نصٌّ غريب، وخانةُ «الإدارة» فيها تخالف قائمة إدارات ذلك القطاع فيرفضها إكسل.
// فتُستبدل الخانات التي تسمّي SAP وحدها بأمثلةٍ محايدة (جهة حكومية، عمل حوكمة/تنظيم، استشاري)،
// وتبقى نصوص قطاع SAP حرفاً بحرف حين لا يُمرَّر --sector فيخرج دفتره بايتاً ببايت كما كان.
const deptLike = (re) => DEPARTMENTS.find((d) => re.test(d)) || DEPARTMENTS[0] || '';
// مفردات «الدور» في دفتر قطاعٍ آخر هي مفردات المنصة نفسها (ROLE_AR في modules/team/resources.js):
// ما يُكتب هنا يعود من الاستيراد إلى مفتاحه المخزَّن فيدور دورةً كاملة بلا تغيّر قيمة.
const PLATFORM_ROLES = ['عضو فريق', 'قائد الفريق', 'مدير المشروع', 'مراجع', 'معتمِد', 'مالك'];
function retargetExamplesToSector() {
  const pmoDept = deptLike(/مشاريع/);
  const bdDept = deptLike(/تطوير/);
  const oppTitle = 'بناء إطار حوكمة وسياسات لجهة حكومية';
  const projectExample = 'إعادة تصميم الهيكل التنظيمي لجهة حكومية';
  const sheet = (name) => ALL_SHEETS.find((sp) => sp.name === name);
  const set = (name, header, val) => {
    const sp = sheet(name);
    const i = sp.columns.findIndex((c) => c.header === header);
    if (i >= 0) sp.example[i] = val;
  };
  set('الفرص', 'العنوان', oppTitle);
  set('الفرص', 'الإدارة', bdDept);
  set('المشاريع', 'اسم المشروع', projectExample);
  set('المشاريع', 'الإدارة', pmoDept);
  set('الموظفون', 'المسمى الوظيفي', 'استشاري أول');
  set('الموظفون', 'الإدارة', pmoDept);
  set('التسكين', 'المشروع', projectExample);
  set('التسكين', 'الدور', PLATFORM_ROLES[1]);
  set('فريق الفرصة', 'الفرصة', oppTitle);
  set('مراحل المشروع', 'المشروع', projectExample);
  set('المخرجات والبنود', 'المشروع', projectExample);
  set('التكاليف', 'المشروع', projectExample);
  PROJECT_ROLES.splice(0, PROJECT_ROLES.length, ...PLATFORM_ROLES);
}

function applySectorArgs(args) {
  if (args.sector && args.sector !== true) SECTOR_NAME = String(args.sector).trim();
  if (args.departments && args.departments !== true) {
    const deps = String(args.departments).split(/[,،]/).map((d) => d.trim()).filter(Boolean);
    if (deps.length) DEPARTMENTS.splice(0, DEPARTMENTS.length, ...deps);
  }
  if (args['reviewer-verb'] && args['reviewer-verb'] !== true) REVIEWER_VERB = String(args['reviewer-verb']).trim();
  // تمرير المراجِع الافتراضي صراحةً يجب أن يعطي الملف نفسه بايتاً ببايت كتركه — فاختصار اسمه
  // معروفٌ سلفاً، ولا يُشتق من نصّ الخيار.
  if (args.reviewer && args.reviewer !== true) {
    REVIEWER = String(args.reviewer).trim();
    REVIEWER_SHORT = REVIEWER === DEFAULT_REVIEWER ? 'د. نواف' : REVIEWER;
  }
  else if (SECTOR_NAME !== DEFAULT_SECTOR_NAME) { REVIEWER = 'قائد القطاع'; REVIEWER_SHORT = 'قائد القطاع'; }
  if (args.required && args.required !== true) {
    const lvl = String(args.required).trim();
    if (!['strict', 'basic'].includes(lvl)) throw new Error('‏--required يقبل strict أو basic فقط');
    REQUIRED_LEVEL = lvl;
  }
  setWithCosts(!!args['with-costs']);
  if (SECTOR_NAME !== DEFAULT_SECTOR_NAME) retargetExamplesToSector();
}
const fileSlug = () => SECTOR_NAME.replace(/\s+/g, '-');

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  if (args.verify) { verifyWorkbook(String(args.verify), args); return; }
  applySectorArgs(args);
  if (args.split) {
    const file = String(args.split);
    // الدفتر يحمل قطاعه: تُقرأ هويته من الملف قبل التفكيك، فلا يُحقن قطاعٌ غريب في عمود «القطاع»
    applyIdentityFromWorkbook(XLSX.read(readFileSync(file), { type: 'buffer' }), args);
    splitWorkbook(file, String(args.outdir || `استيراد-${fileSlug()}`));
    return;
  }
  const demo = !!args.demo;
  let prefill = null;
  if (args.prefill && args.prefill !== true) {
    prefill = JSON.parse(readFileSync(String(args.prefill), 'utf8'));
    const known = new Set(ALL_SHEETS.flatMap((sp) => [sheetKey(sp), sp.name]));
    const strays = Object.keys(prefill).filter((k) => !known.has(k));
    if (strays.length) throw new Error(`مفاتيح لا تقابل أوراق الدفتر: ${strays.join('، ')}`);
    const skipped = Object.keys(prefill).filter((k) => known.has(k) && !SHEETS.some((sp) => sheetKey(sp) === k || sp.name === k));
    if (skipped.length) console.log(`⚠ صفوف لأوراق غير مطلوبة في هذا البناء تُتجاوز: ${skipped.join('، ')}`);
  }
  const out = String(args.demo || args.out
    || (prefill ? `دفتر-بيانات-${fileSlug()}-المعبأ.xlsx` : `دفتر-بيانات-${fileSlug()}.xlsx`));
  const buf = buildWorkbook({ demo, prefill });
  writeFileSync(out, buf);
  const filledNote = prefill ? ` — معبأ ببيانات المنصة (${PREFILL_MANIFEST})` : (demo ? ' — بصفوف تجريبية' : '');
  console.log(`✔ بُني ${out} (${(buf.length / 1024).toFixed(0)} ك.ب)${filledNote}`);
  console.log(`  الأوراق: ${SHEET_ORDER.join('، ')} — الصفوف الفارغة الجاهزة في كل ورقة: ${DATA_ROWS}`);
  console.log(`  مستوى الإلزام: ${REQUIRED_LEVEL === 'strict' ? 'صارم' : 'أساسي'}`
    + `${WITH_COSTS ? ' — مع ورقة «التكاليف» السرّية' : ''}`);
}
// يُستورَد من scripts/export-sector-intake.mjs لقراءة مواصفة الأوراق — فلا يُشغَّل البناء إلا
// عند استدعاء الملف مباشرةً من سطر الأمر.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
