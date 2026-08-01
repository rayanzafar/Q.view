#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// تصحيح فواتير وزارة الاقتصاد والتخطيط — مشروع «منصة البيانات السعودية»
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// عشر فواتير وصلت من الترحيل بلا رقم فاتورة، وبلا تاريخ إصدار حقيقي (المسجَّل هو يوم الترحيل)،
// وبلا ربطٍ بعقدها ولا بمشروعها ولا بمخرجاتها. وفاتورتان من كشف المالك لم تصلا أصلاً.
// هذا السكربت يعيد هذه الاثنتي عشرة فاتورة إلى ما يقوله **كشف المالك** — وهو المصدر الوحيد
// للحقيقة هنا: لا رقم يُخترع، ولا تاريخ يُخمَّن، ولا مبلغ يُشتق.
//
// ── القواعد التي بُني عليها ──────────────────────────────────────────────────────────────────
//  ① **المعاينة هي الافتراض**: بلا وسائط لا يُكتب صفٌّ واحد، ويُطبع كشفٌ سطراً سطراً بما سيتغيّر.
//     الكتابة لا تقع إلا بعلَم صريح `--apply`.
//  ② **مطابقة المخرَج بالاسم كاملاً أو لا مطابقة**: يُقارَن اسم المخرَج في كشف المالك باسم المخرَج
//     في المشروع بعد توحيدٍ إملائي (تشكيل، تطويل، همزات، ة/ه، ى/ي، ترقيم، مسافات) ثم **تطابق
//     تام**. لا تشابه جزئي، ولا بداية اسم، ولا مسافة تحرير، ولا مطابقة بالمبلغ. المبلغ يُطبع
//     للمقارنة البشرية ولا يدخل قرار الربط أبداً.
//     ما لم يُطابَق يقيناً — أو طابق أكثر من مخرَج — يُترك **بلا ربط** ويُطبع في «تحتاج قرار إنسان».
//     مطابقةٌ خاطئة تُلوّث مطالبةً مالية على جهة حكومية؛ والرفض أرخص من الخطأ.
//  ③ **الملء لا الاستبدال**: الروابط (المشروع/العقد/المخرَج/القطاع/المسؤول) تُكتب حين تكون فارغة
//     فقط. خانةٌ مشغولة بقيمة مختلفة لا تُدهَس — تُترك ويُطلب قرار إنسان.
//     ويُستثنى الرقم وتاريخ الإصدار: يُكتبان إن كانا فارغين أو يحملان أثر الترحيل، لا غير.
//  ④ **مبلغ الفاتورة لا يُمسّ**: `amount_halalas` مخزَّن شاملاً الضريبة ومطابقٌ للكشف — والسكربت
//     يتحقّق منه ويرفض تعديل أي فاتورة اختلف مبلغها عن الكشف (دليل أننا على قاعدة غير متوقعة).
//  ⑤ **خانات الضريبة تُكتشف وقت التشغيل** ولا تُفترض: إن وُجدت خانات الصافي/الضريبة/الإجمالي
//     مُلئت؛ وإن غابت طُبع تنبيه واضح ومضى العمل بلا كسر.
//  ⑥ **قابل لإعادة التشغيل**: الإنشاء مفتاحه رقم الفاتورة، والتعديل لا يكتب ما هو مكتوب أصلاً.
//     تشغيلٌ ثانٍ لا يضيف صفاً ولا يغيّر قيمة ولا يكرّر سطر تدقيق.
//  ⑦ **كل كتابة مُدقَّقة** بـ`audit(ctx, …)` داخل معاملة واحدة.
//
// التشغيل:
//   معاينة (لا تكتب شيئاً):  node --experimental-sqlite scripts/backfill-moep-invoices.mjs
//   تنفيذ:                    node --experimental-sqlite scripts/backfill-moep-invoices.mjs --apply
//   على قاعدة حيّة:          … --apply --yes-live      (مطلوب متى وُجد DATABASE_URL)
//   وسائط اختيارية:          --project=<id>  --contract=<id>  --actor=<username>
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { all, get, insert, update, tx, close } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { nowIso, toHalalas } from '../src/core/util/ids.js';
import { config } from '../src/core/config.js';

// ── الوسائط ────────────────────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);
const valOf = (name) => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() || null : null;
};
const APPLY = has('--apply');
const YES_LIVE = has('--yes-live');
const PROJECT_OVERRIDE = valOf('project');
const CONTRACT_OVERRIDE = valOf('contract');
const ACTOR_OVERRIDE = valOf('actor');

// ── ثوابت الحالة الحيّة ────────────────────────────────────────────────────────────────────────
const CLIENT_ID = 'c_ministry_of_economy_planning';
const PROJECT_NAME_AR = 'منصة البيانات السعودية';
// تاريخ الترحيل المسجَّل خطأً بوصفه تاريخ إصدار — الأثر الوحيد المسموح باستبداله.
const MIGRATION_STAMP = '2026-04-24';
const VAT_RATE = 0.15;

// ── كشف المالك — المصدر الوحيد للحقيقة ─────────────────────────────────────────────────────────
// المبالغ بالريال كما وردت في الكشف حرفياً؛ تُحوَّل إلى هللات عند الاستعمال.
// `liveId` هو معرّف الفاتورة القائمة على المنصة، و`null` يعني فاتورةً تُنشأ.
const STATEMENT = [
  { code: 'INV/2026/000089', issueDate: '2026-07-09', liveId: 'inv_NisGJ7UrJRa1', group: 'تكامل مصادر البيانات',
    deliverable: 'إعداد وثيقة محتوى المؤشرات', net: 657950.00, vat: 98692.50, gross: 756642.50 },
  { code: 'INV/2026/000090', issueDate: '2026-07-09', liveId: 'inv_r153nnxOrHZt', group: 'تكامل مصادر البيانات',
    deliverable: 'توسيع نطاق المحتوى بإضافة ٤٣٨ مؤشراً اقتصادياً جديداً', net: 727950.00, vat: 109192.50, gross: 837142.50 },
  { code: 'INV/2026/000091', issueDate: '2026-07-09', liveId: 'inv_YYUnbdlk7rFg', group: 'تكامل مصادر البيانات',
    deliverable: 'ربط المنصة بمصادر بيانات جديدة والتحديث المستمر لقاعدة البيانات', net: 797950.00, vat: 119692.50, gross: 917642.50 },
  { code: 'INV/2026/000092', issueDate: '2026-07-09', liveId: 'inv_vjMHHkwTtvv4', group: 'تحسين تجربة المستخدم',
    deliverable: 'إعداد تقرير يشمل تصميم رحلة المستفيد الرقمية', net: 727252.00, vat: 109087.80, gross: 836339.80 },
  { code: 'INV/2026/000093', issueDate: '2026-07-09', liveId: 'inv_9nDB8cPVItUF', group: 'تحسين تجربة المستخدم',
    deliverable: 'بناء وتنفيذ إطار تصميمي لمنصة بيانات السعودية وفق كود المنصات', net: 478900.00, vat: 71835.00, gross: 550735.00 },
  { code: 'INV/2026/000094', issueDate: '2026-07-09', liveId: 'inv_svm9FNUCRTi7', group: 'تحسين تجربة المستخدم',
    deliverable: 'إعداد خطة شاملة لتحسين محركات البحث', net: 358800.00, vat: 53820.00, gross: 412620.00 },
  { code: 'INV/2026/000095', issueDate: '2026-07-09', liveId: 'inv_LosJmUrpbjND', group: 'تحسين تجربة المستخدم',
    deliverable: 'تصميم وتنفيذ واجهة مستخدم حديثة تلبي احتياجات وتفضيلات المستخدمين', net: 350000.00, vat: 52500.00, gross: 402500.00 },
  { code: 'INV/2026/000096', issueDate: '2026-07-09', liveId: 'inv_5sCEmzVVoFbD', group: 'الذكاء الاصطناعي والتحليلات',
    deliverable: 'تقديم البنية التحتية والاشتراكات اللازمة لتجهيز وتشغيل نماذج وتقنيات الذكاء الاصطناعي', net: 3315000.00, vat: 497250.00, gross: 3812250.00 },
  { code: 'INV/2026/000097', issueDate: '2026-07-09', liveId: 'inv_-VOvl40aHngt', group: 'الذكاء الاصطناعي والتحليلات',
    deliverable: 'تطوير مستكشف المعرفة بالذكاء الاصطناعي', net: 5585500.00, vat: 837825.00, gross: 6423325.00 },
  { code: 'INV/2026/000098', issueDate: '2026-07-09', liveId: 'inv_pQ35Ax0ZoZo2', group: 'تعزيز الوصول المحلي والدولي',
    deliverable: 'إعداد خطة تسويقية لتعزيز الوصول المحلي والدولي', net: 527700.00, vat: 79155.00, gross: 606855.00 },
  // ── الفاتورتان غير الموجودتين على المنصة — تُنشآن ببياناتهما الكاملة (قرار المالك) ──
  { code: 'INV/2026/000104', issueDate: '2026-07-22', liveId: null, group: 'تحسين تجربة المستخدم',
    deliverable: 'تقييم الأثر النهائي', net: 210960.00, vat: 31644.00, gross: 242604.00 },
  { code: 'INV/2026/000105', issueDate: '2026-07-22', liveId: null, group: 'تعزيز الوصول المحلي والدولي',
    deliverable: 'تقديم تقارير تنفيذ الخطة التسويقية للأنشطة والحملات التسويقية', net: 3652000.00, vat: 547800.00, gross: 4199800.00 },
];
// إجماليات الكشف — تُتحقَّق قبل أي عمل، فلا يمشي السكربت على أرقام مضروبة في الطريق.
const STATEMENT_TOTALS = { net: 17389962.00, vat: 2608494.30, gross: 19998456.30 };

// معرّف ثابت للفاتورتين الجديدتين: إعادة التشغيل لا تُنشئ صفاً ثانياً حتى لو تعذّر البحث بالرقم.
const newInvoiceId = (code) => `inv_moep_${code.replace(/[^0-9]/g, '')}`;

// حالة الفاتورة الجديدة: الكشف يقول إنها طُلبت وصدرت لها شهادة إنجاز ⇒ صادرة.
const NEW_INVOICE_STATUS = 'ISSUED';

// ── أدوات ──────────────────────────────────────────────────────────────────────────────────────
const H = (sar) => toHalalas(sar);
const sar = (h) => (h === null || h === undefined ? '—'
  : (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const show = (v) => (v === null || v === undefined || v === '' ? '(فارغ)' : String(v));

// توحيد إملائي عربي ثم **تطابق تام**. ليس تشابهاً: كل ما يفعله هو تحييد اختلافات الكتابة
// (التشكيل، التطويل، صور الهمزة، ة/ه، ى/ي، الأرقام الهندية، الترقيم، تكرار المسافات).
const normalizeAr = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0x0f))
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

// ── اكتشاف خانات الجدول وقت التشغيل ────────────────────────────────────────────────────────────
// الترحيلة التي تضيف خانات الضريبة تُكتب بالتوازي مع هذا الملف، فلا نفترض أسماءها ولا وجودها:
// نسأل فهرس المحرّك نفسه، ونعمل بما نجده، ونقول بوضوح ما لم نجده.
async function columnsOf(table) {
  try {
    const rows = config.databaseUrl
      ? await all('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = CURRENT_SCHEMA() AND table_name = ?', [table])
      : await all('SELECT name FROM pragma_table_info(?)', [table]);
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

// أسماء محتملة لكل معنى، بالترتيب. أول موجود يُستعمل.
const TAX_CANDIDATES = {
  net: ['net_halalas', 'subtotal_halalas', 'net_amount_halalas', 'amount_net_halalas',
    'amount_excl_vat_halalas', 'excl_vat_halalas', 'pre_tax_halalas', 'amount_before_vat_halalas'],
  vat: ['vat_halalas', 'tax_halalas', 'vat_amount_halalas', 'tax_amount_halalas'],
  gross: ['gross_halalas', 'total_halalas', 'gross_amount_halalas', 'amount_incl_vat_halalas',
    'incl_vat_halalas', 'total_with_vat_halalas'],
};
// خانة «نسبة الضريبة» لا تُكتب أبداً: وحدتها غير قابلة للاستنتاج (0.15 أم 15 أم 1500؟)،
// وكتابتها تخميناً على مطالبة حكومية أسوأ من تركها فارغة. تُذكر لقرار إنسان إن وُجدت.
const RATE_CANDIDATES = ['vat_rate', 'vat_rate_pct', 'vat_pct', 'tax_rate', 'tax_pct', 'vat_rate_bp'];

function pickColumn(cols, candidates) {
  return candidates.find((c) => cols.has(c)) || null;
}

// ── التقرير ────────────────────────────────────────────────────────────────────────────────────
const HUMAN = [];                       // ما يحتاج قرار إنسان
const NOTES = [];                       // ملاحظات عامة
const needsHuman = (code, reason) => HUMAN.push({ code, reason });
const line = (n = 96) => console.log('─'.repeat(n));
const die = (msg) => { console.error(`\n✗ توقّف: ${msg}\n`); process.exitCode = 1; };

// ═══ ١) فحص الكشف نفسه قبل لمس القاعدة ══════════════════════════════════════════════════════
function verifyStatement() {
  const problems = [];
  for (const r of STATEMENT) {
    if (H(r.net) + H(r.vat) !== H(r.gross)) problems.push(`${r.code}: الصافي + الضريبة ≠ الإجمالي`);
    if (Math.abs(H(r.net) * VAT_RATE - H(r.vat)) > 0.5) problems.push(`${r.code}: الضريبة ليست ١٥٪ من الصافي`);
  }
  const t = STATEMENT.reduce((a, r) => ({ net: a.net + H(r.net), vat: a.vat + H(r.vat), gross: a.gross + H(r.gross) }),
    { net: 0, vat: 0, gross: 0 });
  if (t.net !== H(STATEMENT_TOTALS.net)) problems.push('مجموع الصافي لا يطابق إجمالي الكشف');
  if (t.vat !== H(STATEMENT_TOTALS.vat)) problems.push('مجموع الضريبة لا يطابق إجمالي الكشف');
  if (t.gross !== H(STATEMENT_TOTALS.gross)) problems.push('مجموع الإجمالي لا يطابق إجمالي الكشف');
  const codes = new Set(STATEMENT.map((r) => r.code));
  if (codes.size !== STATEMENT.length) problems.push('رقم فاتورة مكرر في الكشف');
  const names = STATEMENT.map((r) => normalizeAr(r.deliverable));
  if (new Set(names).size !== names.length) problems.push('اسم مخرَج مكرر في الكشف — المطابقة بالاسم غير ممكنة');
  return { problems, totals: t };
}

// ═══ ٢) تحديد المشروع ═══════════════════════════════════════════════════════════════════════
async function resolveProject() {
  if (PROJECT_OVERRIDE) {
    const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [PROJECT_OVERRIDE]);
    if (!p) return { error: `المشروع المحدَّد يدوياً غير موجود أو محذوف: ${PROJECT_OVERRIDE}` };
    if (p.client_id && p.client_id !== CLIENT_ID) {
      return { error: `المشروع المحدَّد يدوياً ليس لوزارة الاقتصاد والتخطيط (عميله: ${p.client_id})` };
    }
    return { project: p, how: 'حُدِّد يدوياً بالوسيط --project' };
  }
  const target = normalizeAr(PROJECT_NAME_AR);
  const rows = await all('SELECT * FROM project WHERE client_id = ? AND deleted_at IS NULL', [CLIENT_ID]);
  const exact = rows.filter((p) => normalizeAr(p.name_ar) === target);
  if (exact.length === 1) return { project: exact[0], how: `تطابق تام لاسم المشروع «${PROJECT_NAME_AR}» على عميل الوزارة` };
  if (exact.length > 1) {
    return { error: `أكثر من مشروع باسم «${PROJECT_NAME_AR}» على عميل الوزارة: ${exact.map((p) => p.id).join('، ')}. حدّد الصحيح بـ --project=<المعرّف>` };
  }
  const candidates = rows.map((p) => `${p.id} — ${p.name_ar}`);
  return {
    error: `لا مشروع باسم «${PROJECT_NAME_AR}» على عميل الوزارة.${candidates.length ? ` مشاريع العميل: ${candidates.join(' | ')}.` : ' لا مشاريع لهذا العميل أصلاً.'} حدّد الصحيح بـ --project=<المعرّف>`,
  };
}

// ═══ ٣) تحديد العقد — يُقرأ من المشروع ولا يُخترع ════════════════════════════════════════════
async function resolveContract(project) {
  if (CONTRACT_OVERRIDE) {
    const c = await get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [CONTRACT_OVERRIDE]);
    if (!c) return { contract: null, how: `العقد المحدَّد يدوياً غير موجود: ${CONTRACT_OVERRIDE} — لن يُربط عقد` };
    if (c.project_id && c.project_id !== project.id) {
      return { contract: null, how: `العقد المحدَّد يدوياً ليس عقد هذا المشروع — لن يُربط عقد` };
    }
    return { contract: c, how: 'حُدِّد يدوياً بالوسيط --contract' };
  }
  const rows = await all('SELECT * FROM contract WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at', [project.id]);
  if (rows.length === 1) return { contract: rows[0], how: 'عقد المشروع الوحيد' };
  if (rows.length === 0) return { contract: null, how: 'لا عقد مسجَّل على هذا المشروع — تُترك خانة العقد فارغة' };
  return { contract: null, how: `للمشروع ${rows.length} عقود (${rows.map((c) => c.code || c.id).join('، ')}) — لا يُختار أحدها تخميناً` };
}

// ═══ ٤) بناء الخطة ══════════════════════════════════════════════════════════════════════════
function planChange(row, col, current, desired, mode = 'fill') {
  if (desired === null || desired === undefined) return;
  const cur = current === undefined ? null : current;
  if (cur !== null && String(cur) === String(desired)) return;      // مكتوب أصلاً بالقيمة الصحيحة
  if (cur === null || cur === '') { row.changes.push({ col, from: null, to: desired }); return; }
  if (mode === 'replace-stamp' && row.replaceableStamps.includes(String(cur))) {
    row.changes.push({ col, from: cur, to: desired }); return;
  }
  row.blocked.push(`«${col}» مشغولة بقيمة مختلفة (${cur}) والمطلوب (${desired}) — تُركت كما هي`);
}

async function buildPlan({ project, contract, deliverables, taxCols }) {
  // فهرس المخرجات بالاسم الموحَّد. الاسم المكرَّر داخل المشروع يجعل المطابقة غير يقينية ⇒ يُرفض.
  const byName = new Map();
  for (const d of deliverables) {
    const k = normalizeAr(d.name_ar);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(d);
  }
  // مخرجات مربوطة بفواتير أخرى — لا يُسحب مخرَج من فاتورة إلى فاتورة.
  const linkedElsewhere = new Map();
  for (const r of await all('SELECT id, code, deliverable_id FROM invoice WHERE deliverable_id IS NOT NULL AND deleted_at IS NULL')) {
    linkedElsewhere.set(r.deliverable_id, r);
  }

  const rows = [];
  const claimed = new Map();     // معرّف المخرَج → رقم الفاتورة التي طالبت به في هذه الخطة

  for (const s of STATEMENT) {
    const row = {
      code: s.code, statement: s, changes: [], blocked: [], warnings: [],
      replaceableStamps: [MIGRATION_STAMP],
      action: null, invoice: null, deliverable: null, matchNote: '',
    };
    rows.push(row);

    // ── الفاتورة القائمة أو المزمع إنشاؤها ──
    if (s.liveId) {
      const inv = await get('SELECT * FROM invoice WHERE id = ?', [s.liveId]);
      if (!inv) {
        row.action = 'skip';
        row.blocked.push(`الفاتورة ${s.liveId} غير موجودة في هذه القاعدة`);
        needsHuman(s.code, `الفاتورة ${s.liveId} غير موجودة — هل هذه هي القاعدة الصحيحة؟`);
        continue;
      }
      if (inv.deleted_at) {
        row.action = 'skip';
        row.blocked.push('الفاتورة محذوفة — لا تُعدَّل');
        needsHuman(s.code, 'الفاتورة محذوفة في القاعدة؛ استرجاعها قرار إنسان');
        continue;
      }
      // حارس الهوية: مبلغ مختلف عن الكشف يعني أننا لسنا أمام الصف الذي وُصف لنا.
      if (Number(inv.amount_halalas) !== H(s.gross)) {
        row.action = 'skip';
        row.blocked.push(`المبلغ في القاعدة ${sar(inv.amount_halalas)} ولا يطابق الكشف ${sar(H(s.gross))}`);
        needsHuman(s.code, `مبلغ الفاتورة في القاعدة (${sar(inv.amount_halalas)}) يخالف كشف المالك (${sar(H(s.gross))}) — لم تُمسّ`);
        continue;
      }
      if (inv.client_id && inv.client_id !== CLIENT_ID) {
        row.action = 'skip';
        row.blocked.push(`الفاتورة منسوبة إلى عميل آخر (${inv.client_id})`);
        needsHuman(s.code, `الفاتورة منسوبة إلى عميل غير وزارة الاقتصاد والتخطيط — لم تُمسّ`);
        continue;
      }
      row.invoice = inv;
      row.action = 'update';
    } else {
      // الإنشاء مفتاحه رقم الفاتورة: تشغيلٌ ثانٍ يجد الصف ولا يُنشئ ثانياً.
      const existing = await get('SELECT * FROM invoice WHERE (code = ? OR id = ?) AND deleted_at IS NULL',
        [s.code, newInvoiceId(s.code)]);
      if (existing) {
        row.invoice = existing;
        row.action = 'update';
        row.warnings.push('موجودة أصلاً برقمها — لا إنشاء، تُستكمل خاناتها الناقصة فقط');
        if (Number(existing.amount_halalas) !== H(s.gross)) {
          row.blocked.push(`مبلغ الفاتورة الموجودة ${sar(existing.amount_halalas)} ≠ الكشف ${sar(H(s.gross))}`);
          needsHuman(s.code, `فاتورة بالرقم نفسه موجودة بمبلغ مختلف — لم تُمسّ`);
          row.action = 'skip';
          continue;
        }
      } else {
        row.action = 'create';
      }
    }

    // ── مطابقة المخرَج: تطابق تام أو لا ربط ──
    const key = normalizeAr(s.deliverable);
    const hits = byName.get(key) || [];
    if (hits.length === 1) {
      const d = hits[0];
      const already = linkedElsewhere.get(d.id);
      const claimedBy = claimed.get(d.id);
      if (already && already.id !== row.invoice?.id) {
        row.matchNote = 'مطابق بالاسم لكنه مربوط بفاتورة أخرى — لا يُسحب';
        needsHuman(s.code, `المخرَج «${d.name_ar}» مربوط بالفعل بفاتورة أخرى (${already.code || already.id}) — تُرك بلا ربط`);
      } else if (claimedBy) {
        row.matchNote = `تنازعت عليه فاتورتان في هذه الخطة (${claimedBy})`;
        needsHuman(s.code, `المخرَج «${d.name_ar}» طالبت به الفاتورة ${claimedBy} أيضاً — تُرك بلا ربط`);
      } else {
        row.deliverable = d;
        row.matchNote = 'تطابق تام بالاسم';
        claimed.set(d.id, s.code);
        // المبلغ لا يقرّر الربط، لكنه يُقال إن اختلف: خلافه علامة تستحق نظر إنسان.
        if (Number(d.amount_halalas || 0) !== H(s.net) && Number(d.amount_halalas || 0) !== H(s.gross)) {
          row.warnings.push(`مبلغ المخرَج المسجَّل ${sar(d.amount_halalas)} لا يساوي صافي الكشف ${sar(H(s.net))} ولا إجماليه ${sar(H(s.gross))}`);
          needsHuman(s.code, `رُبط المخرَج بالاسم، لكن مبلغه المسجَّل (${sar(d.amount_halalas)}) يخالف الكشف — يستحق مراجعة`);
        }
      }
    } else if (hits.length === 0) {
      row.matchNote = 'لا مخرَج باسمه في المشروع';
      needsHuman(s.code, `لم يُطابَق مخرَج باسم «${s.deliverable}» — تُركت الفاتورة بلا ربط بمخرَج`);
    } else {
      row.matchNote = `${hits.length} مخرجات بالاسم نفسه`;
      needsHuman(s.code, `أكثر من مخرَج بالاسم نفسه «${s.deliverable}» (${hits.map((d) => d.id).join('، ')}) — تُركت بلا ربط`);
    }

    // ── الخانات المطلوبة ──
    const inv = row.invoice;
    if (row.action === 'create') {
      row.newRow = {
        id: newInvoiceId(s.code),
        code: s.code,
        contract_id: contract?.id || null,
        project_id: project.id,
        client_id: CLIENT_ID,
        deliverable_id: row.deliverable?.id || null,
        sector_id: project.sector_id || null,
        amount_halalas: H(s.gross),
        issue_date: s.issueDate,
        due_date: null,                      // لا يذكره الكشف ⇒ لا يُخترع
        status: NEW_INVOICE_STATUS,
        kind: 'standard',
        owner_user_id: project.owner_user_id || null,
        created_at: nowIso(),
      };
      if (taxCols.net) row.newRow[taxCols.net] = H(s.net);
      if (taxCols.vat) row.newRow[taxCols.vat] = H(s.vat);
      if (taxCols.gross) row.newRow[taxCols.gross] = H(s.gross);
    } else if (row.action === 'update') {
      // الرقم: يُكتب إن كان فارغاً. رقمٌ آخر مكتوب لا يُدهَس — يُطلب قرار إنسان.
      planChange(row, 'code', inv.code, s.code);
      // التاريخ: يُكتب إن كان فارغاً أو يحمل أثر يوم الترحيل وحده. تاريخٌ ثالث لا يُدهَس.
      planChange(row, 'issue_date', inv.issue_date, s.issueDate, 'replace-stamp');
      planChange(row, 'project_id', inv.project_id, project.id);
      if (contract) planChange(row, 'contract_id', inv.contract_id, contract.id);
      if (row.deliverable) planChange(row, 'deliverable_id', inv.deliverable_id, row.deliverable.id);
      planChange(row, 'client_id', inv.client_id, CLIENT_ID);
      if (project.sector_id) planChange(row, 'sector_id', inv.sector_id, project.sector_id);
      if (project.owner_user_id) planChange(row, 'owner_user_id', inv.owner_user_id, project.owner_user_id);
      if (taxCols.net) planChange(row, taxCols.net, inv[taxCols.net], H(s.net));
      if (taxCols.vat) planChange(row, taxCols.vat, inv[taxCols.vat], H(s.vat));
      if (taxCols.gross) planChange(row, taxCols.gross, inv[taxCols.gross], H(s.gross));
      for (const b of row.blocked) needsHuman(s.code, b);
    }
  }
  return rows;
}

// ═══ ٥) الطباعة ═════════════════════════════════════════════════════════════════════════════
function printPlan(rows, { project, contract, contractHow, projectHow, taxCols, rateCol }) {
  line();
  console.log('كشف التغيير — فواتير وزارة الاقتصاد والتخطيط · مشروع «منصة البيانات السعودية»');
  line();
  console.log(`المشروع: ${project.id} — ${project.name_ar}   (${projectHow})`);
  console.log(`العقد:   ${contract ? `${contract.id} — ${contract.code || 'بلا رقم'}` : 'لا يُربط'}   (${contractHow})`);
  console.log(`خانات الضريبة: ${taxCols.net || taxCols.vat || taxCols.gross
    ? `الصافي=${taxCols.net || '—'} · الضريبة=${taxCols.vat || '—'} · الإجمالي=${taxCols.gross || '—'}`
    : 'غير موجودة في هذه القاعدة'}`);
  if (rateCol) console.log(`خانة نسبة الضريبة الموجودة «${rateCol}» لن تُكتب — وحدتها غير معلومة (قرار إنسان).`);
  line();

  for (const r of rows) {
    const s = r.statement;
    const head = r.action === 'create' ? '＋ إنشاء' : r.action === 'skip' ? '⊘ متروكة' : '✎ تعديل';
    console.log(`\n${head}  ${s.code}   ${s.issueDate}   إجمالي ${sar(H(s.gross))} = صافي ${sar(H(s.net))} + ضريبة ${sar(H(s.vat))}`);
    console.log(`   المجموعة: ${s.group}`);
    console.log(`   المخرَج في الكشف: ${s.deliverable}`);
    console.log(`   المطابقة: ${r.matchNote}${r.deliverable ? ` → ${r.deliverable.id} «${r.deliverable.name_ar}»` : ' → بلا ربط'}`);
    if (r.action === 'create') {
      for (const [k, v] of Object.entries(r.newRow)) {
        console.log(`     • ${k}: ${show(k.endsWith('halalas') ? sar(v) : v)}`);
      }
    } else if (r.action === 'update') {
      if (!r.changes.length) console.log('     (لا تغيير — الصف مضبوط أصلاً)');
      for (const c of r.changes) {
        const f = c.col.endsWith('halalas') ? sar(c.from) : show(c.from);
        const t = c.col.endsWith('halalas') ? sar(c.to) : show(c.to);
        console.log(`     • ${c.col}: ${f}  ⟵  ${t}`);
      }
    }
    for (const b of r.blocked) console.log(`     ⚑ ${b}`);
    for (const w of r.warnings) console.log(`     ⚠ ${w}`);
  }
}

function printHuman() {
  line();
  if (!HUMAN.length) {
    console.log('تحتاج قرار إنسان: لا شيء — كل سطر طابق يقيناً.');
  } else {
    console.log(`تحتاج قرار إنسان (${HUMAN.length}):`);
    for (const h of HUMAN) console.log(`  · ${h.code}: ${h.reason}`);
  }
  if (NOTES.length) {
    console.log('\nملاحظات:');
    for (const n of NOTES) console.log(`  · ${n}`);
  }
  line();
}

// ═══ ٦) التنفيذ ═════════════════════════════════════════════════════════════════════════════
async function applyPlan(rows, ctx, project) {
  let created = 0, updated = 0, untouched = 0;
  await tx(async () => {
    for (const r of rows) {
      if (r.action === 'create') {
        await insert('invoice', r.newRow);
        await audit(ctx, {
          action: 'create', resource: 'invoice', resourceId: r.newRow.id,
          sectorId: r.newRow.sector_id || project.sector_id || null,
          detail: { source: 'كشف المالك — فواتير وزارة الاقتصاد والتخطيط', code: r.code,
            deliverable_id: r.newRow.deliverable_id, amount_halalas: r.newRow.amount_halalas },
        });
        created++;
      } else if (r.action === 'update' && r.changes.length) {
        const patch = Object.fromEntries(r.changes.map((c) => [c.col, c.to]));
        await update('invoice', r.invoice.id, patch);
        await audit(ctx, {
          action: 'update', resource: 'invoice', resourceId: r.invoice.id,
          sectorId: patch.sector_id || r.invoice.sector_id || project.sector_id || null,
          detail: { source: 'كشف المالك — فواتير وزارة الاقتصاد والتخطيط', code: r.code,
            changes: r.changes.map((c) => ({ column: c.col, from: c.from, to: c.to })) },
        });
        updated++;
      } else {
        untouched++;
      }
    }
  });
  return { created, updated, untouched };
}

// ═══ ٧) المطابقة بعد التنفيذ ═════════════════════════════════════════════════════════════════
async function reconcile({ project, contract, taxCols }) {
  line();
  console.log('جدول المطابقة — القاعدة مقابل كشف المالك');
  line();
  const pad = (s, n) => {
    const t = String(s);
    return t.length >= n ? t : t + ' '.repeat(n - t.length);
  };
  console.log([pad('الرقم', 17), pad('التاريخ', 12), pad('الإجمالي', 16), pad('مشروع', 7), pad('عقد', 6), pad('مخرَج', 7), 'الحالة'].join(' '));
  let okCount = 0, sumGross = 0, sumNet = 0, sumVat = 0;
  const problems = [];
  for (const s of STATEMENT) {
    const invId = s.liveId || newInvoiceId(s.code);
    const inv = await get('SELECT * FROM invoice WHERE (id = ? OR code = ?) AND deleted_at IS NULL', [invId, s.code]);
    if (!inv) {
      console.log([pad(s.code, 17), pad('—', 12), pad('—', 16), pad('—', 7), pad('—', 6), pad('—', 7), 'غير موجودة'].join(' '));
      problems.push(`${s.code}: غير موجودة في القاعدة`);
      continue;
    }
    sumGross += Number(inv.amount_halalas || 0);
    if (taxCols.net) sumNet += Number(inv[taxCols.net] || 0);
    if (taxCols.vat) sumVat += Number(inv[taxCols.vat] || 0);
    const codeOk = inv.code === s.code;
    const dateOk = inv.issue_date === s.issueDate;
    const amtOk = Number(inv.amount_halalas) === H(s.gross);
    const prjOk = inv.project_id === project.id;
    const conOk = contract ? inv.contract_id === contract.id : true;
    const delOk = !!inv.deliverable_id;
    if (!codeOk) problems.push(`${s.code}: الرقم في القاعدة «${show(inv.code)}»`);
    if (!dateOk) problems.push(`${s.code}: التاريخ في القاعدة «${show(inv.issue_date)}»`);
    if (!amtOk) problems.push(`${s.code}: المبلغ في القاعدة ${sar(inv.amount_halalas)} ≠ الكشف ${sar(H(s.gross))}`);
    if (!prjOk) problems.push(`${s.code}: غير مربوطة بالمشروع`);
    if (contract && !conOk) problems.push(`${s.code}: غير مربوطة بالعقد`);
    if (codeOk && dateOk && amtOk && prjOk && conOk && delOk) okCount++;
    console.log([pad(inv.code || '—', 17), pad(inv.issue_date || '—', 12), pad(sar(inv.amount_halalas), 16),
      pad(prjOk ? 'نعم' : 'لا', 7), pad(contract ? (conOk ? 'نعم' : 'لا') : '—', 6),
      pad(delOk ? 'نعم' : 'لا', 7),
      codeOk && dateOk && amtOk ? (delOk ? 'مكتملة' : 'بلا مخرَج') : 'ناقصة'].join(' '));
  }
  line();
  console.log(`مجموع الإجمالي في القاعدة: ${sar(sumGross)}   ·   كشف المالك: ${sar(H(STATEMENT_TOTALS.gross))}   ·   ${sumGross === H(STATEMENT_TOTALS.gross) ? 'مطابق' : 'غير مطابق'}`);
  if (taxCols.net) console.log(`مجموع الصافي:            ${sar(sumNet)}   ·   كشف المالك: ${sar(H(STATEMENT_TOTALS.net))}   ·   ${sumNet === H(STATEMENT_TOTALS.net) ? 'مطابق' : 'غير مطابق'}`);
  if (taxCols.vat) console.log(`مجموع الضريبة:           ${sar(sumVat)}   ·   كشف المالك: ${sar(H(STATEMENT_TOTALS.vat))}   ·   ${sumVat === H(STATEMENT_TOTALS.vat) ? 'مطابق' : 'غير مطابق'}`);
  console.log(`فواتير مكتملة الربط: ${okCount} من ${STATEMENT.length}`);

  // فحص التعلّق: كل معرّف مكتوب يجب أن يُوصل إلى صفّ حيّ.
  const orphanDel = await get(`SELECT COUNT(*) n FROM invoice i WHERE i.deleted_at IS NULL AND i.deliverable_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM deliverable d WHERE d.id = i.deliverable_id AND d.deleted_at IS NULL)`);
  const orphanPrj = await get(`SELECT COUNT(*) n FROM invoice i WHERE i.deleted_at IS NULL AND i.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM project p WHERE p.id = i.project_id AND p.deleted_at IS NULL)`);
  const orphanCon = await get(`SELECT COUNT(*) n FROM invoice i WHERE i.deleted_at IS NULL AND i.contract_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.id = i.contract_id AND c.deleted_at IS NULL)`);
  const dupDel = await all(`SELECT deliverable_id, COUNT(*) n FROM invoice WHERE deleted_at IS NULL AND deliverable_id IS NOT NULL
     GROUP BY deliverable_id HAVING COUNT(*) > 1`);
  console.log(`روابط معلّقة — مخرَج: ${orphanDel.n} · مشروع: ${orphanPrj.n} · عقد: ${orphanCon.n}`);
  console.log(`مخرجات مربوطة بأكثر من فاتورة: ${dupDel.length}`);
  if (problems.length) {
    console.log('\nفروقات باقية:');
    for (const p of problems) console.log(`  · ${p}`);
  }
  line();
  return { okCount, problems };
}

// ═══ main ═══════════════════════════════════════════════════════════════════════════════════
async function main() {
  const target = config.databaseUrl ? 'قاعدة خارجية (DATABASE_URL)' : `ملف محلي: ${config.dbFile}`;
  console.log(`\nالوجهة: ${target}`);
  console.log(`الوضع:  ${APPLY ? '⚠ تنفيذ (--apply) — ستُكتب بيانات' : 'معاينة فقط — لن يُكتب صفٌّ واحد'}\n`);

  // حارس القاعدة الحيّة: التنفيذ على قاعدة خارجية يحتاج إعلاناً صريحاً ثانياً.
  if (APPLY && config.databaseUrl && !YES_LIVE) {
    return die('التنفيذ على قاعدة خارجية يحتاج --yes-live بعد أخذ نسخة احتياطية بـ scripts/pg-backup.sh');
  }

  const { problems: stProblems } = verifyStatement();
  if (stProblems.length) return die(`كشف المالك المضمَّن غير متسق: ${stProblems.join(' · ')}`);
  console.log(`كشف المالك: ${STATEMENT.length} فواتير · صافٍ ${sar(H(STATEMENT_TOTALS.net))} · ضريبة ${sar(H(STATEMENT_TOTALS.vat))} · إجمالي ${sar(H(STATEMENT_TOTALS.gross))} (تحقّق داخلي: سليم)`);

  const pr = await resolveProject();
  if (pr.error) return die(pr.error);
  const project = pr.project;
  const cr = await resolveContract(project);
  const contract = cr.contract;
  if (!contract) NOTES.push(`العقد: ${cr.how}. الفواتير ستبقى بلا عقد حتى يُحسم ذلك.`);

  const cols = await columnsOf('invoice');
  if (!cols.size) return die('تعذّرت قراءة خانات جدول الفواتير — تحقّق من القاعدة والترحيلات');
  const taxCols = {
    net: pickColumn(cols, TAX_CANDIDATES.net),
    vat: pickColumn(cols, TAX_CANDIDATES.vat),
    gross: pickColumn(cols, TAX_CANDIDATES.gross),
  };
  const rateCol = pickColumn(cols, RATE_CANDIDATES);
  if (!taxCols.net && !taxCols.vat && !taxCols.gross) {
    console.log('\n⚠ تنبيه: لا توجد خانات ضريبة في جدول الفواتير في هذه القاعدة.');
    console.log('  الصافي والضريبة لن يُخزَّنا الآن — يُخزَّن الإجمالي في «مبلغ الفاتورة» كما هو اليوم.');
    console.log('  شغّل السكربت مرة أخرى بعد تطبيق الترحيلة التي تضيفها، فسيستكمل الخانات وحدها.\n');
    NOTES.push('خانات الضريبة غائبة — أعد التشغيل بعد إضافتها لاستكمال الصافي والضريبة.');
  }
  if (rateCol) NOTES.push(`خانة «${rateCol}» موجودة ولم تُكتب: وحدتها غير معلومة (٠٫١٥ أم ١٥؟). قرار إنسان.`);
  NOTES.push('تاريخ الاستحقاق لا يذكره الكشف، فلم يُكتب لأي فاتورة.');
  NOTES.push('مبلغ الفاتورة يبقى شاملاً الضريبة كما هو مخزَّن اليوم — لم يُحوَّل إلى صافٍ.');

  const deliverables = await all('SELECT * FROM deliverable WHERE project_id = ? AND deleted_at IS NULL', [project.id]);
  const rows = await buildPlan({ project, contract, deliverables, taxCols });
  printPlan(rows, { project, contract, contractHow: cr.how, projectHow: pr.how, taxCols, rateCol });

  // مخرجات المشروع التي لا يقابلها سطر في الكشف — تُقال ولا تُمسّ.
  const used = new Set(rows.map((r) => r.deliverable?.id).filter(Boolean));
  const leftovers = deliverables.filter((d) => !used.has(d.id));
  if (leftovers.length) {
    NOTES.push(`مخرجات في المشروع بلا سطر في الكشف (${leftovers.length}): ${leftovers.map((d) => d.name_ar).join(' | ')}`);
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    update: rows.filter((r) => r.action === 'update' && r.changes.length).length,
    same: rows.filter((r) => r.action === 'update' && !r.changes.length).length,
    skip: rows.filter((r) => r.action === 'skip').length,
    linked: rows.filter((r) => r.deliverable).length,
  };
  line();
  console.log(`الخلاصة: إنشاء ${counts.create} · تعديل ${counts.update} · مضبوطة أصلاً ${counts.same} · متروكة ${counts.skip} · مربوطة بمخرَج ${counts.linked} من ${STATEMENT.length}`);
  printHuman();

  const before = await get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL');
  if (!APPLY) {
    console.log(`عدد الفواتير في القاعدة: ${before.n} — لم يُكتب شيء. للتنفيذ أضف --apply.`);
    return;
  }

  // الفاعل في سجل التدقيق
  let actor = null;
  if (ACTOR_OVERRIDE) actor = await get('SELECT id, username, role_id FROM app_user WHERE username = ? AND deleted_at IS NULL', [ACTOR_OVERRIDE]);
  if (!actor) actor = await get("SELECT id, username, role_id FROM app_user WHERE role_id = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1");
  if (!actor) {
    actor = { id: null, username: 'تصحيح فواتير الوزارة', role_id: null };
    console.log('⚠ لا مستخدم إدارة في هذه القاعدة — تُسجَّل سطور التدقيق باسم العملية بلا مستخدم.');
  }
  const ctx = { user: actor, ip: null };

  const res = await applyPlan(rows, ctx, project);
  const after = await get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL');
  console.log(`\nنُفِّذ: أُنشئت ${res.created} · عُدِّلت ${res.updated} · لم تُمسّ ${res.untouched}`);
  console.log(`عدد الفواتير: ${before.n} ← ${after.n}`);
  console.log(`الفاعل في سجل التدقيق: ${actor.username || '—'}`);

  const rec = await reconcile({ project, contract, taxCols });
  printHuman();
  if (rec.problems.length) {
    console.log('انتهى التنفيذ مع فروقات باقية — راجع القائمة أعلاه قبل اعتماد الأرقام.');
  } else {
    console.log('انتهى التنفيذ ومطابقة الأرقام سليمة.');
  }
  console.log('\nالتراجع: كل تغيير مسجَّل في سجل التدقيق بقيمته السابقة (from/to)؛ والفاتورتان المُنشأتان');
  console.log('معرّفاهما ثابتان: ' + STATEMENT.filter((s) => !s.liveId).map((s) => newInvoiceId(s.code)).join('، ') + '.');
}

main()
  .then(() => close())
  .catch(async (e) => {
    console.error(`\n✗ فشل التشغيل: ${e.message}`);
    try { await close(); } catch { /* تجاهل */ }
    process.exitCode = 1;
  });
