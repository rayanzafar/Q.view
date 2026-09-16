#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// تحميل كشف فواتير المالية إلى المنصة — صفٌّ في الملف = فاتورة على مشروعها
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// المالية تُرسل كشفاً واحداً لقطاعٍ كامل: تاريخ · جهة · وصف · مركز تكلفة · مبلغ. لا رقم فاتورة،
// ولا تاريخ استحقاق، ولا ربط بمخرَج. وهذا السكربت يحمله كما هو: لا يخترع رقماً، ولا يخمّن
// تاريخاً، ولا يشتقّ مبلغاً، ولا يربط مخرجاً.
//
// ── القواعد التي بُني عليها ──────────────────────────────────────────────────────────────────
//  ① **المعاينة هي الافتراض**: بلا `--apply` لا يُكتب صفٌّ واحد، ويُطبع كشفٌ بما سيُحمَّل وبما
//     سيُترك وبما ستقرؤه الشاشات بعده.
//  ② **التسكين لا يُخمَّن هنا**: مركز التكلفة → المشروع يأتي جاهزاً من ملف تسكينٍ اعتمده المالك.
//     ومراكزُ التكلفة التي لم تُحسم (`UNRESOLVED`) **لا تُحمَّل** — تُطبع بمبالغها لتُحسم بقرار
//     إنسان، ثم تُحمَّل في جولةٍ لاحقة. قرار المالك، لا اجتهاد السكربت.
//  ③ **العميل من المشروع لا من الملف**: خانة «Partner» في الكشف مزاحةٌ على صفوفٍ عدّة (جهةٌ
//     مكتوبة أمام مركز تكلفة مشروعٍ لجهةٍ أخرى)، فلا تُقرأ للنسبة أبداً. عميل الفاتورة عميلُ
//     مشروعها المسجَّل على المنصة.
//  ④ **المبلغ في الملف صافٍ، والمخزَّن إجمالي**: القاعدة الواحدة في المنصة أن مبلغ الفاتورة
//     شاملٌ الضريبة (`migrations/019_vat_split.sql`). فيُحسب الإجمالي من الصافي بدالة المنصة
//     `grossOfNet`، ويُخزَّن الصافي كما جاء في الملف، والضريبةُ **الفارق** فلا هللة تضيع ولا تُخلق.
//  ⑤ **التاريخ إلزامي**: فاتورةٌ بلا `issue_date` تسقط صامتةً من جسر السنة المالية
//     (`src/modules/finance/finance.js:39`). فصفٌّ بتاريخٍ غير مقروء يوقف التشغيل كلَّه قبل أي كتابة.
//  ⑥ **الحالة «صادرة»**: الحالة الافتراضية `DRAFT` مستبعدةٌ من كل مجموع مفوتر في المنصة، فكشفٌ
//     يُحمَّل بها يُحمَّل ليبقى غير مرئي.
//  ⑦ **قابل لإعادة التشغيل**: معرّف الفاتورة مشتقٌّ اشتقاقاً ثابتاً من (التاريخ · الصافي · مركز
//     التكلفة · ترتيب الصف في الورقة). تشغيلٌ ثانٍ على الملف نفسه لا يُنشئ صفاً ولا سطر تدقيق.
//  ⑧ **كل كتابة مُدقَّقة** بـ`audit(ctx, …)` داخل معاملةٍ واحدة.
//
// ── ما لا يكتبه هذا السكربت عمداً ────────────────────────────────────────────────────────────
//   • `code` (رقم الفاتورة): الكشف لا يحمله، واختراعُ رقمٍ يُطالَب به العميل خطرٌ لا فائدة فيه.
//   • `due_date`: الكشف لا يذكره.
//   • `deliverable_id` و`invoice_line`: التحميل على مستوى المشروع عمداً — ربطُ المخرَج يحتاج
//     مطابقةً بالاسم ليست في هذا الكشف.
//   • `collection`: الملف لا يحمل بيانات سداد. فنسبةُ التحصيل وفترةُ التحصيل تبقيان كما كانتا،
//     وهذا يُقال في التقرير ولا يُملأ بالتخمين.
//
// ── ما يجب أن يُعرف قبل الاعتماد ─────────────────────────────────────────────────────────────
//   • إشعار الخصم (المبلغ السالب) يُحمَّل فاتورةً سالبة بقرار المالك: يطرح من «المفوتر» كما يجب،
//     لكنه **غير مرئي لأعمار الذمم** لأن المستحق يُقصّ عند الصفر (`finance.js:60`). فهو يصحّح
//     الإيراد المطالَب به ولا يظهر بنداً في جدول الأعمار.
//
// التشغيل:
//   معاينة:  node --experimental-sqlite scripts/load-invoice-statement.mjs --file=<الكشف.xlsx> --map=<التسكين.json> --sector=CONSULTING
//   تنفيذ:   … --apply --actor=sysadmin@evc.sa
//   وسائط:   --include-unresolved  (تحميل مراكز التكلفة غير المحسومة — تحتاج مشروعاً في ملف التسكين)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import XLSX from '../vendor/xlsx/xlsx.mjs';
import { get, insert, tx, close } from '../src/core/db/index.js';
import { audit } from '../src/core/audit/index.js';
import { nowIso, toHalalas } from '../src/core/util/ids.js';
import { grossOfNet, splitGross, netSum } from '../src/modules/finance/vat.js';
import { config } from '../src/core/config.js';

// ── الوسائط ────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv = process.argv.slice(2)) {
  const valOf = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3).trim() || null : null;
  };
  return {
    file: valOf('file'),
    map: valOf('map'),
    sector: valOf('sector') || 'CONSULTING',
    actor: valOf('actor'),
    year: valOf('year') ? Number(valOf('year')) : null,
    apply: argv.includes('--apply'),
    includeUnresolved: argv.includes('--include-unresolved'),
    yesLive: argv.includes('--yes-live'),
  };
}

// ── أدوات ──────────────────────────────────────────────────────────────────────────────────────
const H = (sarValue) => toHalalas(sarValue);
export const sar = (h) => (h === null || h === undefined ? '—'
  : (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const padR = (s, n) => { const t = String(s ?? ''); return t.length >= n ? t : ' '.repeat(n - t.length) + t; };

// توحيد نصّ مركز التكلفة قبل المطابقة — فراغاتٌ وصيغُ محارف لا غير. لا تشابه ولا اجتهاد.
export const normCenter = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

// تاريخ إكسل التسلسلي → YYYY-MM-DD. المرجع 1899-12-30 (نظام 1900 بخطأ السنة الكبيسة المعروف).
// ويُقبل أيضاً نصٌّ مكتوب YYYY-MM-DD كما هو، لأن ورقةً محفوظةً بصيغةٍ نصية تأتي هكذا.
export function excelDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1 || v > 400000) return null;                       // خارج أي مدى معقول لتاريخ
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// معرّفٌ ثابت للفاتورة: يُشتقّ من هوية الصف في الكشف نفسه، فإعادة التشغيل على الملف نفسه
// تُنتج المعرّفات نفسها فلا يُنشأ صفٌّ ثانٍ. وترتيبُ الصف داخل الورقة جزءٌ من الهوية لأن الكشف
// يحمل صفوفاً متطابقة تماماً (دفعاتٌ شهرية بالمبلغ نفسه على المركز نفسه).
export function invoiceIdFor({ issueDate, netHalalas, center, rowIndex }) {
  const key = `${issueDate}|${netHalalas}|${normCenter(center)}|${rowIndex}`;
  return `inv_cs_${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`;
}

// ═══ ١) قراءة الكشف ═════════════════════════════════════════════════════════════════════════
// الورقة الأولى، الصف الأول عناوين. صفُّ المجموع الكلي (مبلغٌ بلا تاريخ ولا وصف ولا مركز) يُستبعد
// ويُستعمل للمطابقة: لو خالف مجموعَ الصفوف توقّف العمل — علامةُ ملفٍ قُرئ على غير وجهه.
export function readStatement(path) {
  const wb = XLSX.read(readFileSync(path));
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false });
  if (!aoa.length) throw new Error(`الورقة «${sheetName}» فارغة — لا صفوف تُقرأ`);

  const head = (aoa[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  const col = (want) => head.findIndex((h) => h === want);
  const ix = { date: col('date'), partner: col('partner'), desc: col('description'), center: col('cost center'), amount: col('amount') };
  for (const [k, v] of Object.entries(ix)) {
    if (v < 0) throw new Error(`الكشف لا يحمل العنوان المطلوب «${k}» في الصف الأول — الأعمدة المتوقعة: Date | Partner | Description | Cost Center | Amount`);
  }

  const rows = [];
  let grandTotal = null;
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r] || [];
    const cell = (i) => (raw[i] === undefined ? null : raw[i]);
    const amountRaw = cell(ix.amount);
    const hasAmount = amountRaw !== null && amountRaw !== '' && Number.isFinite(Number(amountRaw));
    const rest = [cell(ix.date), cell(ix.partner), cell(ix.desc), cell(ix.center)]
      .map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!hasAmount && !rest.length) continue;                    // صفٌّ فارغ
    if (hasAmount && !rest.length) {                             // صفُّ المجموع الكلي
      grandTotal = H(Number(amountRaw));
      continue;
    }
    rows.push({
      sheetRow: r + 1,                                           // رقم الصف كما يراه من يفتح الملف
      rowIndex: r,                                               // ترتيبه بين صفوف البيانات — جزءٌ من المعرّف الثابت
      dateRaw: cell(ix.date),
      issueDate: excelDate(cell(ix.date)),
      partner: String(cell(ix.partner) ?? '').trim() || null,    // لا يُستعمل للنسبة — يُطبع للمقارنة البشرية
      description: String(cell(ix.desc) ?? '').trim() || null,
      center: normCenter(cell(ix.center)),
      netHalalas: hasAmount ? H(Number(amountRaw)) : null,
      hasAmount,
    });
  }
  return { sheetName, rows, grandTotal };
}

// ═══ ٢) قراءة ملف التسكين المعتمد ═══════════════════════════════════════════════════════════
export function readMapping(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : (parsed.entries || []);
  if (!Array.isArray(entries) || !entries.length) throw new Error(`ملف التسكين «${path}» لا يحمل قائمة مراكز تكلفة`);
  const byCenter = new Map();
  for (const e of entries) {
    const key = normCenter(e.cost_center);
    if (!key) throw new Error('ملف التسكين يحوي مدخلاً بلا اسم مركز تكلفة');
    if (byCenter.has(key)) throw new Error(`مركز التكلفة «${key}» مذكور مرتين في ملف التسكين — التسكين يجب أن يكون واحداً`);
    byCenter.set(key, {
      center: key,
      projectId: e.project_id || null,
      projectName: e.project_name || null,
      clientId: e.client_id || null,
      clientName: e.client_name || null,
      verdict: String(e.verdict || '').toUpperCase(),
    });
  }
  return byCenter;
}

// ═══ ٣) الخطة ═══════════════════════════════════════════════════════════════════════════════
// تُبنى الخطة كاملةً قبل أي قراءةٍ من القاعدة، ثم تُواجه القاعدة. وأي سببٍ للتوقف يُجمَّع كله
// ويُرمى مرّةً واحدة: من يشغّل الكشف يريد قائمة ما يجب إصلاحه، لا خطأً واحداً في كل تشغيلة.
export function buildPlan({ statement, mapping, sectorId, includeUnresolved = false }) {
  const fatal = [];

  // ① التاريخ إلزامي — قبل أي شيء آخر.
  const undated = statement.rows.filter((r) => !r.issueDate);
  if (undated.length) {
    fatal.push(`${undated.length} صفاً بلا تاريخ مقروء — والتاريخ إلزامي لأن فاتورةً بلا تاريخ تسقط صامتةً من حساب السنة المالية. الصفوف: ${undated.map((r) => `#${r.sheetRow} («${r.dateRaw ?? 'فارغ'}»)`).join('، ')}`);
  }
  // ② المبلغ إلزامي كذلك.
  const unpriced = statement.rows.filter((r) => !r.hasAmount);
  if (unpriced.length) fatal.push(`${unpriced.length} صفاً بلا مبلغ مقروء — الصفوف: ${unpriced.map((r) => `#${r.sheetRow}`).join('، ')}`);

  // ③ مطابقة المجموع الكلي المكتوب في الملف بمجموع صفوفه.
  const sumAll = statement.rows.reduce((a, r) => a + (r.netHalalas || 0), 0);
  if (statement.grandTotal !== null && Math.abs(sumAll - statement.grandTotal) > 1) {
    fatal.push(`مجموع صفوف الكشف (${sar(sumAll)}) لا يطابق المجموع الكلي المكتوب فيه (${sar(statement.grandTotal)}) — الملف قُرئ على غير وجهه`);
  }

  // ④ كل مركز تكلفة في الملف له مدخلٌ في التسكين المعتمد.
  const centers = [...new Set(statement.rows.map((r) => r.center))];
  const unmapped = centers.filter((c) => !mapping.has(c));
  if (unmapped.length) fatal.push(`${unmapped.length} مركز تكلفة في الكشف بلا تسكين معتمد: ${unmapped.map((c) => `«${c}»`).join('، ')}`);

  if (fatal.length) throw new Error(fatal.join('\n  · '));

  // ⑤ التوزيع: ما يُحمَّل وما يُترك.
  const groups = new Map();
  for (const center of centers) {
    const m = mapping.get(center);
    const rows = statement.rows.filter((r) => r.center === center);
    const decided = m.verdict === 'CONFIDENT' || m.verdict === 'LIKELY';
    const take = decided || (includeUnresolved && !!m.projectId);
    const g = {
      center, map: m, rows, decided, take,
      netHalalas: rows.reduce((a, r) => a + r.netHalalas, 0),
      grossHalalas: rows.reduce((a, r) => a + grossOfNet(r.netHalalas), 0),
      reason: take ? null
        : (m.projectId ? `التسكين «${m.verdict}» غير محسوم — لا يُحمَّل إلا بعلَم --include-unresolved` : `التسكين «${m.verdict || 'بلا حكم'}» بلا مشروع — لا مشروع تُنسب إليه الفواتير`),
    };
    groups.set(center, g);
  }

  if (includeUnresolved) {
    const blocked = [...groups.values()].filter((g) => !g.decided && !g.map.projectId);
    if (blocked.length) {
      throw new Error(`طُلب تحميل غير المحسوم، لكن ${blocked.length} مركز تكلفة منه بلا مشروع في ملف التسكين: ${blocked.map((g) => `«${g.center}»`).join('، ')}`);
    }
  }

  const load = [];
  const roundingRows = [];
  for (const g of groups.values()) {
    if (!g.take) continue;
    for (const r of g.rows) {
      const netHalalas = r.netHalalas;
      const grossHalalas = grossOfNet(netHalalas);
      // تحقّقٌ بدالة المنصة نفسها: ردُّ الإجمالي إلى صافيه يجب أن يعود إلى صافي الملف. والفارق
      // المسموح هللةٌ واحدة لا غير، وهو ما يقع على المبالغ التي لا تقبل القسمة (والسالبة منها
      // خاصةً، لأن الاقتطاع في `netOfGross` نحو الصفر والتقريب في `grossOfNet` نحو الأقرب).
      const back = splitGross(grossHalalas).net_halalas;
      if (Math.abs(back - netHalalas) > 1) {
        throw new Error(`صفٌّ #${r.sheetRow}: الإجمالي المحسوب ${sar(grossHalalas)} لا يعود إلى صافي الملف ${sar(netHalalas)} — قاعدة الضريبة لا تنطبق على هذا المبلغ`);
      }
      if (back !== netHalalas) roundingRows.push(r.sheetRow);
      load.push({
        group: g,
        row: r,
        id: invoiceIdFor({ issueDate: r.issueDate, netHalalas, center: g.center, rowIndex: r.rowIndex }),
        issueDate: r.issueDate,
        netHalalas,
        grossHalalas,
        vatHalalas: grossHalalas - netHalalas,                   // الفارق دائماً — لا حسابٌ ثانٍ للضريبة
        projectId: g.map.projectId,
        sectorId,
      });
    }
  }
  const skipped = [...groups.values()].filter((g) => !g.take);
  // ملاحظةٌ واحدة لا سطرٌ لكل صف: الفارق نفسه ويُقال مرّةً بعدده وأرقام صفوفه.
  const roundingNotes = roundingRows.length ? [
    `${roundingRows.length} صفاً مبلغُه لا يقبل القسمة على ١٫١٥ بلا كسر، فإجماليه يعود إلى صافٍ أقلّ بهللةٍ واحدة (الصفوف: ${roundingRows.join('، ')}). المخزَّن صافيه كما في الملف حرفياً، فمجاميع «المفوتر» تطابق الكشف ولا تتراكم الهللات.`,
  ] : [];
  return { groups: [...groups.values()], load, skipped, sumAll, roundingNotes };
}

// ═══ ٤) مواجهة القاعدة ══════════════════════════════════════════════════════════════════════
// المشروع والقطاع يجب أن يوجدا فعلاً؛ والعميل يُقرأ من المشروع لا من الملف. وأي خللٍ هنا يوقف
// التشغيل قبل الكتابة — فاتورةٌ على مشروعٍ غير موجود تكسر كل شاشةٍ تعرضها.
export async function resolveAgainstDb(plan, sectorId) {
  const problems = [];
  const notes = [];

  const sector = await get('SELECT id, name_ar FROM sector WHERE id = ?', [sectorId]);
  if (!sector) problems.push(`القطاع «${sectorId}» غير موجود في القاعدة`);

  const wantIds = [...new Set(plan.load.map((l) => l.projectId))];
  const projects = new Map();
  for (const pid of wantIds) {
    const p = await get('SELECT id, name_ar, client_id, sector_id, owner_user_id FROM project WHERE id = ? AND deleted_at IS NULL', [pid]);
    if (!p) { problems.push(`المشروع «${pid}» في ملف التسكين غير موجود في القاعدة`); continue; }
    projects.set(pid, p);
    if (sector && p.sector_id && p.sector_id !== sectorId) {
      problems.push(`المشروع «${pid}» يتبع قطاع «${p.sector_id}» لا «${sectorId}» — التسكين يخالف القاعدة`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n  · '));

  for (const l of plan.load) {
    const p = projects.get(l.projectId);
    l.project = p;
    // العميل من المشروع — لا من خانة Partner في الملف، فهي مزاحة.
    l.clientId = p.client_id || l.group.map.clientId || null;
    if (!p.client_id && l.group.map.clientId) {
      notes.push(`المشروع «${p.id}» بلا عميل مسجَّل — استُعمل عميل ملف التسكين «${l.group.map.clientId}»`);
    }
    if (p.client_id && l.group.map.clientId && p.client_id !== l.group.map.clientId) {
      notes.push(`المشروع «${p.id}» عميله في القاعدة «${p.client_id}» ويخالف ما في ملف التسكين «${l.group.map.clientId}» — المعتمد عميل القاعدة`);
    }
    l.ownerUserId = p.owner_user_id || null;
  }

  // ما هو مكتوبٌ أصلاً — إعادةُ التشغيل لا تُنشئ شيئاً.
  for (const l of plan.load) {
    const existing = await get('SELECT id, deleted_at FROM invoice WHERE id = ?', [l.id]);
    l.exists = !!existing;
  }
  plan.sector = sector;
  plan.notes = [...new Set([...(plan.roundingNotes || []), ...notes])];
  return plan;
}

// الخطة كاملةً من الملف إلى القاعدة — المدخل الواحد الذي تستعمله الواجهة والاختبار معاً.
export async function planLoad({ file, map, sector = 'CONSULTING', includeUnresolved = false }) {
  if (!file) throw new Error('لم يُذكر ملف الكشف — استعمل --file=<المسار>');
  if (!map) throw new Error('لم يُذكر ملف التسكين المعتمد — استعمل --map=<المسار>');
  const statement = readStatement(file);
  const mapping = readMapping(map);
  const plan = buildPlan({ statement, mapping, sectorId: sector, includeUnresolved });
  plan.statement = statement;
  return resolveAgainstDb(plan, sector);
}

// ═══ ٥) التنفيذ ═════════════════════════════════════════════════════════════════════════════
export async function applyPlan(plan, ctx, { apply = false } = {}) {
  const pending = plan.load.filter((l) => !l.exists);
  if (!apply) return { created: 0, already: plan.load.length - pending.length, planned: pending.length };

  let created = 0;
  await tx(async () => {
    for (const l of pending) {
      const row = {
        id: l.id,
        code: null,                                  // الكشف بلا رقم فاتورة — لا يُخترع
        contract_id: null,
        project_id: l.projectId,
        client_id: l.clientId,
        deliverable_id: null,                        // تحميلٌ على مستوى المشروع عمداً
        sector_id: l.sectorId,
        amount_halalas: l.grossHalalas,              // المخزَّن إجمالي بقاعدة المنصة
        net_amount_halalas: l.netHalalas,            // كما جاء في الملف حرفياً
        vat_halalas: l.vatHalalas,                   // الفارق
        issue_date: l.issueDate,
        due_date: null,                              // الكشف لا يذكره ⇒ لا يُخترع
        status: 'ISSUED',
        kind: 'standard',
        owner_user_id: l.ownerUserId || null,
        created_at: nowIso(),
        created_by: ctx?.user?.id || null,
      };
      await insert('invoice', row);
      await audit(ctx, {
        action: 'create', resource: 'invoice', resourceId: row.id, sectorId: row.sector_id,
        detail: {
          source: 'كشف فواتير المالية — تحميل على مستوى المشروع',
          cost_center: l.group.center,
          statement_row: l.row.sheetRow,
          description: l.row.description,
          issue_date: row.issue_date,
          amount_halalas: row.amount_halalas,
          net_amount_halalas: row.net_amount_halalas,
          vat_halalas: row.vat_halalas,
        },
      });
      created++;
    }
  });
  return { created, already: plan.load.length - pending.length, planned: pending.length };
}

// ═══ ٦) صدى الشاشات ═════════════════════════════════════════════════════════════════════════
// ما ستقرؤه لوحة القطاع بعد التحميل — يُحسب من القاعدة نفسها لا من الملف، ويُضاف إليه ما سيُكتب.
export async function dashboardEcho(plan, { sectorId, year }) {
  const cur = await get(`SELECT COALESCE(SUM(i.amount_halalas),0) gross,
       ${netSum('i.amount_halalas', 'i.net_amount_halalas')} net, COUNT(*) n
     FROM invoice i LEFT JOIN project p ON p.id = i.project_id
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','CANCELLED')
       AND COALESCE(i.sector_id, p.sector_id) = ?
       AND CAST(substr(COALESCE(i.issue_date, i.created_at),1,4) AS INTEGER) = ?`, [sectorId, year]);
  const rev = await get(`SELECT ${netSum('amount_halalas', 'net_amount_halalas')} net
     FROM revenue_line WHERE sector_id = ? AND year = ?`, [sectorId, year]);
  const addingRows = plan.load.filter((l) => !l.exists && String(l.issueDate).slice(0, 4) === String(year));
  const addNet = addingRows.reduce((a, l) => a + l.netHalalas, 0);
  const addGross = addingRows.reduce((a, l) => a + l.grossHalalas, 0);
  return {
    year,
    revenueNet: rev?.net || 0,
    // ما في القاعدة الآن، بلا إسقاط. بعد التنفيذ يكون هذا هو الرقم النهائي الصادق: الإسقاط
    // أدناه يبني على `plan.load` وأعلامُ «مكتوبٌ أصلاً» فيه قديمةٌ بعد الكتابة، فيُحسب المكتوب
    // مرّتين. فمن يقرأ بعد التنفيذ يقرأ `currentNet`، ومن يعاين قبله يقرأ `afterNet`.
    currentNet: cur?.net || 0, currentGross: cur?.gross || 0, currentCount: cur?.n || 0,
    currentGap: (rev?.net || 0) - (cur?.net || 0),
    beforeNet: cur?.net || 0, beforeGross: cur?.gross || 0, beforeCount: cur?.n || 0,
    afterNet: (cur?.net || 0) + addNet, afterGross: (cur?.gross || 0) + addGross,
    afterCount: (cur?.n || 0) + addingRows.length,
    gapBefore: (rev?.net || 0) - (cur?.net || 0),
    gapAfter: (rev?.net || 0) - ((cur?.net || 0) + addNet),
  };
}

// ═══ ٧) الطباعة ═════════════════════════════════════════════════════════════════════════════
export function renderPreview(plan, { apply = false, sectorId, echo = null, done = null } = {}) {
  const out = [];
  const say = (s = '') => out.push(s);
  const rule = () => say('─'.repeat(100));

  rule();
  say(apply ? 'تحميل كشف فواتير المالية — تنفيذ' : 'تحميل كشف فواتير المالية — معاينة (لا يُكتب صفٌّ واحد)');
  rule();
  say(`الورقة: ${plan.statement.sheetName} · صفوف البيانات: ${plan.statement.rows.length} · المجموع الكلي في الملف: ${sar(plan.statement.grandTotal)} (صافٍ)`);
  say(`القطاع: ${sectorId}${plan.sector?.name_ar ? ` — ${plan.sector.name_ar}` : ''}`);
  say('');

  say('مراكز التكلفة التي ستُحمَّل — مركزاً مركزاً باسمه كاملاً:');
  for (const g of plan.groups.filter((x) => x.take)) {
    say('');
    say(`  • «${g.center}»`);
    say(`      ↳ ${g.map.projectId} — ${g.map.projectName || '—'} · العميل: ${g.map.clientName || '—'} · الحكم: ${g.map.verdict}`);
    say(`      ↳ ${padR(g.rows.length, 2)} صفاً · صافٍ ${padR(sar(g.netHalalas), 16)} · إجمالي ${padR(sar(g.grossHalalas), 16)}`);
  }

  say('');
  if (!plan.skipped.length) {
    say('لا مركز تكلفة متروك — كل الكشف مُسكَّن ومحسوم.');
  } else {
    const sn = plan.skipped.reduce((a, g) => a + g.netHalalas, 0);
    const sr = plan.skipped.reduce((a, g) => a + g.rows.length, 0);
    say(`مراكز تكلفة **لن تُحمَّل** (${plan.skipped.length} مركزاً · ${sr} صفاً · ${sar(sn)} صافٍ) — تنتظر قرار إنسان:`);
    for (const g of plan.skipped) {
      say(`  ⊘ «${g.center}» — ${g.reason}`);
      for (const r of g.rows) {
        say(`      #${r.sheetRow}  ${r.issueDate}  ${padR(sar(r.netHalalas), 16)}  ${r.description || '—'}`);
      }
    }
  }

  say('');
  const netAll = plan.load.reduce((a, l) => a + l.netHalalas, 0);
  const grossAll = plan.load.reduce((a, l) => a + l.grossHalalas, 0);
  const vatAll = plan.load.reduce((a, l) => a + l.vatHalalas, 0);
  const negatives = plan.load.filter((l) => l.netHalalas < 0);
  rule();
  say(`الخلاصة: ${plan.load.length} فاتورة ستُحمَّل · صافٍ ${sar(netAll)} · ضريبة ${sar(vatAll)} · إجمالي ${sar(grossAll)}`);
  say(`         ${plan.skipped.reduce((a, g) => a + g.rows.length, 0)} صفاً متروكاً · صافٍ ${sar(plan.skipped.reduce((a, g) => a + g.netHalalas, 0))}`);
  say(`         المجموع الكلي للكشف: ${sar(plan.sumAll)} صافٍ (مطابقٌ لما كُتب في الملف)`);
  if (negatives.length) {
    say(`         منها ${negatives.length} إشعار خصم (مبلغ سالب): ${negatives.map((l) => sar(l.netHalalas)).join('، ')}`);
  }
  const already = plan.load.filter((l) => l.exists).length;
  say(`         مكتوبٌ أصلاً في القاعدة: ${already} من ${plan.load.length} (إعادة التشغيل لا تكرّر)`);

  if (echo) {
    say('');
    say(`ما ستقرؤه الشاشات لسنة ${echo.year} (صافٍ):`);
    say(`  «المفوتر»:            ${sar(echo.beforeNet)}  ←  ${sar(echo.afterNet)}   (عدد الفواتير ${echo.beforeCount} ← ${echo.afterCount})`);
    say(`  الإيراد المتحقق:       ${sar(echo.revenueNet)}`);
    const lbl = (v) => (v < 0 ? 'المفوتر قبل الإنجاز' : 'منجَز لم يُفوتر');
    say(`  «${lbl(echo.gapBefore)}»:    ${sar(Math.abs(echo.gapBefore))}  ←  «${lbl(echo.gapAfter)}» ${sar(Math.abs(echo.gapAfter))}`);
  }

  say('');
  say('ملاحظات تُقال ولا تُملأ بالتخمين:');
  say('  · لا رقم فاتورة في الكشف، فخانة الرقم تبقى فارغة — والمعرّف الداخلي ثابتٌ مشتقٌّ من الصف.');
  say('  · لا تاريخ استحقاق في الكشف، فخانة الاستحقاق تبقى فارغة — وأعمار الذمم تُحتسب من تاريخ الإصدار.');
  say('  · لا بيانات سداد في الكشف: لا يُنشأ تحصيلٌ واحد، فنسبة التحصيل وفترة التحصيل تبقيان كما كانتا.');
  say('  · التحميل على مستوى المشروع لا المخرَج: لا تُنشأ بنود فاتورة ولا يُختم مخرَج بأنه مفوتر.');
  if (negatives.length) {
    say('  · إشعار الخصم يُحمَّل فاتورةً سالبة: يطرح من «المفوتر» كما يجب، لكنه **غير مرئي في أعمار');
    say('    الذمم** لأن المستحق يُقصّ عند الصفر (finance.js:60). فهو يصحّح المطالبة ولا يظهر بنداً.');
  }
  for (const n of plan.notes || []) say(`  · ${n}`);

  if (done) {
    say('');
    rule();
    say(`نُفِّذ: أُنشئت ${done.created} فاتورة · كانت مكتوبةً أصلاً ${done.already}`);
  }
  rule();
  return out.join('\n');
}

// ═══ main ═══════════════════════════════════════════════════════════════════════════════════
async function main() {
  const args = parseArgs();
  const target = config.databaseUrl ? 'قاعدة خارجية (DATABASE_URL)' : `ملف محلي: ${config.dbFile}`;
  console.log(`\nالوجهة: ${target}`);
  console.log(`الوضع:  ${args.apply ? '⚠ تنفيذ (--apply) — ستُكتب بيانات' : 'معاينة فقط — لن يُكتب صفٌّ واحد'}`);

  if (args.apply && config.databaseUrl && !args.yesLive) {
    throw new Error('التنفيذ على قاعدة خارجية يحتاج --yes-live بعد أخذ نسخة احتياطية بـ scripts/pg-backup.sh');
  }

  const plan = await planLoad({ file: args.file, map: args.map, sector: args.sector, includeUnresolved: args.includeUnresolved });
  const year = args.year || Number(String(plan.load[0]?.issueDate || nowIso()).slice(0, 4));

  const before = await get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL');
  const echo = await dashboardEcho(plan, { sectorId: args.sector, year });

  if (!args.apply) {
    console.log(renderPreview(plan, { apply: false, sectorId: args.sector, echo }));
    console.log(`عدد الفواتير في القاعدة: ${before.n} — لم يُكتب شيء. للتنفيذ أضف --apply.`);
    return;
  }

  // الفاعل في سجل التدقيق — يُقرأ من القاعدة، ولا يُخترع مستخدم.
  let actor = null;
  if (args.actor) {
    actor = await get('SELECT id, username, role_id FROM app_user WHERE (username = ? OR email = ?) AND deleted_at IS NULL', [args.actor, args.actor]);
    if (!actor) throw new Error(`لا حساب باسم «${args.actor}» في القاعدة — لا يُخترع فاعلٌ لسجل التدقيق`);
  }
  if (!actor) actor = await get("SELECT id, username, role_id FROM app_user WHERE role_id = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1");
  if (!actor) throw new Error('لا مستخدم إدارة في هذه القاعدة — لا يُنفَّذ تحميلٌ بلا فاعلٍ مُدقَّق');
  const ctx = { user: actor, ip: null };

  const done = await applyPlan(plan, ctx, { apply: true });
  const after = await get('SELECT COUNT(*) n FROM invoice WHERE deleted_at IS NULL');
  const echoAfter = await dashboardEcho(plan, { sectorId: args.sector, year });
  console.log(renderPreview(plan, { apply: true, sectorId: args.sector, echo, done }));
  console.log(`عدد الفواتير: ${before.n} ← ${after.n}`);
  console.log(`الفاعل في سجل التدقيق: ${actor.username || actor.id}`);
  console.log(`«المفوتر» ${year} بعد التنفيذ (صافٍ): ${sar(echoAfter.currentNet)} · عدد الفواتير ${echoAfter.currentCount}`);
  console.log(`«منجَز لم يُفوتر» ${year} بعد التنفيذ (صافٍ): ${sar(echoAfter.currentGap)}`);
  console.log('التراجع: معرّفات الفواتير المُنشأة ثابتة ومسجَّلة في سجل التدقيق سطراً سطراً.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => close())
    .catch(async (e) => {
      console.error(`\n✗ تعذّر إتمام التحميل:\n  · ${e.message}`);
      try { await close(); } catch { /* تجاهل */ }
      process.exitCode = 1;
    });
}
