#!/usr/bin/env node
// كشفُ الفروق بين **ملف المالك** لمشاريع قطاع الاستشارات وبين ما تعرضه المنصة — قراءةٌ فقط.
// لا يكتب هذا السكربت صفاً واحداً في أي حال. الكتابة مكانها scripts/apply-consulting.mjs.
//
//   node --experimental-sqlite scripts/reconcile-consulting.mjs --file=<الملف.xlsm>
//   node --experimental-sqlite scripts/reconcile-consulting.mjs --file=<الملف> --api=https://… --cookie=<ملف الجلسة>
//   … --out=<ملف التقرير>            ← يكتب التقرير نصاً بدل طباعته
//
// ── المفتاح القاطع للمطابقة ──────────────────────────────────────────────────
// «رقم المشروع» في الملف ↔ كود المشروع `CONS-<الرقم>` في المنصة. مفتاحٌ واحد صريح لا استنتاج
// فيه. وإن اختلف اسم المشروع تحت المفتاح نفسه يُسجَّل الفرق ولا يُبدَّل المفتاح.
//
// ── أساس المقارنة المالية ────────────────────────────────────────────────────
// ورقة «فواتير 2026» في الملف **بدون ضريبة**. ونظيرها المسجَّل في المنصة اليوم هو سطر الإيراد
// (وهو بدون ضريبة كذلك) لا سجل الفاتورة — فالمقارنة كلها تجري على أساس **بدون ضريبة**، ويُذكر
// ذلك في كل سطر فرق. أرقام سجل الفواتير شاملةٌ للضريبة ولا تُخلط بهذه الورقة إطلاقاً.
//
// ── ما لا يفعله هذا السكربت ──────────────────────────────────────────────────
//   • لا يخمّن بتشابه الأسماء. الاسم يُطابَق حرفياً بعد توحيد الهمزات والمسافات فقط. وما لم
//     يُطابَق يقيناً يُطبع في «تحتاج قرار إنسان» ولا يُقترح له إصلاح.
//   • لا يفرض حالةً على المنصة لا تقابلها حالة في الملف («غير معتمد» مثالها) — يذكرها ويقف.
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from '../vendor/xlsx/xlsx.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// أدوات صغيرة
// ─────────────────────────────────────────────────────────────────────────────

/** توحيد نصٍّ عربي للمقارنة: همزات وألف مقصورة وتاء مربوطة ومسافات وأرقام هندية. لا حذف كلمات. */
export function norm(s) {
  if (s == null) return '';
  return String(s)
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[ً-ْـ]/g, '')      // تشكيل وتطويل
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** رقمٌ من خلية قد تحمل فواصل آلاف أو مسافات. غير الرقم ⇒ null (وليس صفراً). */
export function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,\s ]/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  return Number.isFinite(n) ? n : null;
}

/** ريالات → هللات صحيحة (تقريب واحد في النهاية، بلا كسور عائمة مخزَّنة). */
export const hal = (sar) => (sar == null ? null : Math.round(Number(sar) * 100));

/** تاريخ الخلية → YYYY-MM-DD، أو null. */
export function dateOf(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** ريال للعرض: ثلاثة فواصل ومنزلتان — للقراءة البشرية لا للحساب. */
export const sar = (v) => (v == null ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// حالة المشروع في الملف ↔ حالة المنصة. «غير معتمد» عمداً بلا نظير: قرارُ ما يقابلها بيد المالك.
export const STATUS_MAP = { 'مكتمل': 'COMPLETED', 'قيد التشغيل': 'IN_PROGRESS' };
export const STATUS_AR = { COMPLETED: 'مكتمل', IN_PROGRESS: 'قيد التشغيل', ON_HOLD: 'متوقف',
  PLANNED: 'مخطط', NOT_STARTED: 'لم يبدأ', CANCELLED: 'ملغى' };
export const UNAPPROVED = 'غير معتمد';
// حالات البند بالعربية — لا تظهر رموز إنجليزية في تقرير يقرأه المالك.
export const ITEM_AR = { DRAFT: 'مسودة', PENDING: 'بانتظار', IN_PROGRESS: 'جارٍ العمل',
  DELIVERED: 'تم التسليم', ACCEPTED: 'تم الاعتماد', INVOICED: 'مفوتر', PAID: 'محصَّل',
  REJECTED: 'مُعاد للتعديل' };
export const itemAr = (s) => ITEM_AR[s] || s || 'غير محدد';

export const CONSULTING = 'CONSULTING';
export const REF_YEAR = 2026;                 // سنة الملف: الفواتير والتكاليف والتسكين كلها ٢٠٢٦
export const codeOf = (n) => `CONS-${n}`;

// ─────────────────────────────────────────────────────────────────────────────
// قراءة ملف المالك
// ─────────────────────────────────────────────────────────────────────────────

const SHEETS = {
  projects: 'المشاريع قيد التشغيل',
  team: 'فريق العمل',
  invoices: 'فواتير 2026',
  costs: 'التكاليف',
  items: 'DB_البنود',
};

function aoa(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`الورقة «${name}» غير موجودة في الملف`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
}

/** يجد صف العناوين (أول صف يحمل «رقم المشروع») ويعيد ما بعده. */
function rowsAfterHeader(rows, headerCell = 'رقم المشروع') {
  const i = rows.findIndex((r) => r.some((c) => norm(c) === norm(headerCell)));
  if (i < 0) throw new Error(`تعذّر العثور على صف العناوين (${headerCell})`);
  return { header: rows[i].map((c) => norm(c)), body: rows.slice(i + 1) };
}
// موضع عمودٍ بعنوانه. المطابقة التامة أولاً، ثم البادئة الوحيدة (عناوين الملف تُذيَّل أحياناً
// بـ«بدون ضريبة» وما شابه). والغموض أو الغياب **خطأٌ يوقف الكشف** — عمودٌ لم يُعثر عليه كان
// يعيد قيماً فارغة صامتة فتُقرأ كأنها «لا فرق»، وهو أسوأ من التوقف بكثير.
function colIx(header, label, { required = true } = {}) {
  const want = norm(label);
  let hits = header.map((h, i) => [h, i]).filter(([h]) => h === want);
  if (!hits.length) hits = header.map((h, i) => [h, i]).filter(([h]) => h && h.startsWith(want));
  if (!hits.length) hits = header.map((h, i) => [h, i]).filter(([h]) => h && h.includes(want));
  if (hits.length === 1) return hits[0][1];
  if (!hits.length) {
    if (required) throw new Error(`تعذّر العثور على العمود «${label}» في الملف`);
    return -1;
  }
  throw new Error(`العمود «${label}» ملتبس — يطابقه أكثر من عنوان في الملف`);
}

export function readWorkbook(path) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });

  // ① المشاريع
  const P = rowsAfterHeader(aoa(wb, SHEETS.projects));
  const c = (l) => colIx(P.header, l);
  const iName = c('اسم المشروع'), iStatus = c('حالة المشروع'), iClient = c('اسم العميل'),
    iPm = c('مدير المشروع'), iValue = c('قيمة المشروع'), iBudget = c('ميزانية 2026 المعتمدة'),
    iCost = c('تكاليف 2026 الفعلية'), iRev = c('إيرادات 2026 الفعلية'), iBill = c('نسبة الفوترة من المشروع'),
    iPo = c('PO قيمة'), iPoS = c('بداية الPO'), iPoE = c('نهاية ال PO'),
    iStart = c('تاريخ بداية المشروع'), iEnd = c('تاريخ نهاية المشروع');
  const projects = P.body.filter((r) => num(r[0]) != null).map((r) => ({
    n: num(r[0]),
    name_ar: String(r[iName] ?? '').trim(),
    status_ar: String(r[iStatus] ?? '').trim(),
    client_ar: String(r[iClient] ?? '').trim(),
    // مدير المشروع «0» في الملف = غير مذكور. لا يُكتب ولا يُخترع له اسم.
    pm_name: (String(r[iPm] ?? '').trim() === '0' || r[iPm] == null) ? null : String(r[iPm]).trim(),
    pm_missing: String(r[iPm] ?? '').trim() === '0',
    value_sar: num(r[iValue]),
    budget_sar: num(r[iBudget]),
    cost_sar: num(r[iCost]),
    revenue_sar: num(r[iRev]),
    billed_pct: num(r[iBill]),
    po_sar: num(r[iPo]), po_start: dateOf(r[iPoS]), po_end: dateOf(r[iPoE]),
    start_date: dateOf(r[iStart]), end_date: dateOf(r[iEnd]),
  }));

  // ② فريق العمل — التسكين المرجعي
  const T = rowsAfterHeader(aoa(wb, SHEETS.team));
  const team = T.body.filter((r) => num(r[0]) != null).map((r, ix) => ({
    row: ix + 1,
    n: num(r[0]),
    person: String(r[colIx(T.header, 'الاسم')] ?? '').trim(),
    job_title: String(r[colIx(T.header, 'المسمى الوظيفي')] ?? '').trim() || null,
    // النسبة في الملف كسر (0.25) — تُعرض وتُخزَّن مئويةً في المنصة.
    pct: (() => { const v = num(r[colIx(T.header, 'نسبة التحمل على المشروع')]); return v == null ? null : Math.round(v * 100); })(),
  }));

  // ③ فواتير ٢٠٢٦ — **بدون ضريبة**
  const I = rowsAfterHeader(aoa(wb, SHEETS.invoices));
  const invoices = I.body.filter((r) => num(r[0]) != null).map((r, ix) => ({
    row: ix + 1,
    n: num(r[0]),
    label: String(r[colIx(I.header, 'المشروع')] ?? '').trim(),
    date: dateOf(r[colIx(I.header, 'تاريخ الفاتورة')]),
    net_sar: num(r[colIx(I.header, 'قيمة الفاتورة بدون ضريبة')]),
  }));

  // ④ التكاليف
  const K = rowsAfterHeader(aoa(wb, SHEETS.costs));
  const costs = K.body.filter((r) => num(r[0]) != null).map((r) => ({
    n: num(r[0]),
    month_label: String(r[colIx(K.header, 'الشهر')] ?? '').trim(),
    type: String(r[colIx(K.header, 'نوع التكلفة')] ?? '').trim(),
    amount_sar: num(r[colIx(K.header, 'القيمة')]),
  }));

  // ⑤ بنود جدول الكميات
  const B = rowsAfterHeader(aoa(wb, SHEETS.items));
  const items = B.body.filter((r) => num(r[0]) != null).map((r) => ({
    n: num(r[0]),
    name_ar: String(r[colIx(B.header, 'اسم البند حسب جدول الكميات')] ?? '').trim(),
    amount_sar: num(r[colIx(B.header, 'قيمة البند حسب جدول الكميات')]),
    state: String(r[colIx(B.header, 'حالة البند')] ?? '').trim(),
    billing: String(r[colIx(B.header, 'حالة الفوترة')] ?? '').trim(),
  }));

  return { projects, team, invoices, costs, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// قراءة المنصة — مصدران بالشكل نفسه: قاعدة البيانات مباشرةً (قراءة) أو الواجهة الحيّة.
// ─────────────────────────────────────────────────────────────────────────────

export async function readPlatformDb() {
  const { all } = await import('../src/core/db/index.js');
  const projects = await all(
    `SELECT p.id, p.code, p.name_ar, p.status, p.client_id, p.pm_name, p.sector_id,
            p.contract_value_halalas, p.budget_halalas, p.actual_spend_halalas, p.revenue_halalas,
            p.po_value_halalas, p.start_date, p.end_date, c.name_ar AS client_name
       FROM project p LEFT JOIN client c ON c.id = p.client_id AND c.deleted_at IS NULL
      WHERE p.deleted_at IS NULL AND p.sector_id = ?`, [CONSULTING]);
  const employees = await all(
    'SELECT id, name_ar, job_title, sector_id, user_id, active FROM employee WHERE deleted_at IS NULL');
  const allocations = await all(
    `SELECT a.id, a.employee_id, a.person_name_ar, a.project_id, a.year, a.monthly_json, p.code AS project_code
       FROM allocation a LEFT JOIN project p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL`);
  const revenues = await all(
    `SELECT r.id, r.project_id, r.year, r.month, r.amount_halalas, r.label, p.code AS project_code
       FROM revenue_line r LEFT JOIN project p ON p.id = r.project_id
      WHERE p.sector_id = ? AND p.deleted_at IS NULL`, [CONSULTING]);
  const invoices = await all(
    `SELECT i.id, i.project_id, i.amount_halalas, i.issue_date, i.status, p.code AS project_code
       FROM invoice i LEFT JOIN project p ON p.id = i.project_id
      WHERE i.deleted_at IS NULL AND p.sector_id = ?`, [CONSULTING]);
  const deliverables = await all(
    `SELECT d.id, d.project_id, d.name_ar, d.amount_halalas, d.status, p.code AS project_code
       FROM deliverable d JOIN project p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = ?`, [CONSULTING]);
  const costLines = await all(
    `SELECT k.project_id, k.year, k.month, k.type, k.amount_halalas, p.code AS project_code
       FROM cost_line k JOIN project p ON p.id = k.project_id
      WHERE p.deleted_at IS NULL AND p.sector_id = ?`, [CONSULTING]);
  const accounts = await all(
    'SELECT id, username, name_ar, employee_id FROM app_user WHERE deleted_at IS NULL');
  return shape({ projects, employees, allocations, revenues, invoices, deliverables, costLines, accounts });
}

/** يوحّد شكل الحمولة القادمة من أي مصدر إلى ما يفهمه المطابِق. */
function shape(raw) {
  return {
    projects: raw.projects.map((p) => ({
      id: p.id, code: p.code, name_ar: p.name_ar, status: p.status, client_id: p.client_id,
      client_name: p.client_name ?? null, pm_name: p.pm_name ?? null,
      contract_halalas: p.contract_value_halalas ?? 0, budget_halalas: p.budget_halalas ?? 0,
      spend_halalas: p.actual_spend_halalas ?? 0, revenue_halalas: p.revenue_halalas ?? 0,
      po_halalas: p.po_value_halalas ?? 0, start_date: p.start_date, end_date: p.end_date,
    })),
    employees: raw.employees,
    allocations: raw.allocations.map((a) => ({
      ...a,
      pct: pctOf(a),
    })),
    revenues: raw.revenues,
    invoices: raw.invoices,
    deliverables: raw.deliverables,
    costLines: raw.costLines,
    accounts: raw.accounts || [],
  };
}

/** نسبة التسكين المئوية: أعلى قيمة شهرية في الخطة (النسبة المعلنة على المشروع). */
export function pctOf(a) {
  let mj = {};
  try { mj = typeof a.monthly_json === 'string' ? JSON.parse(a.monthly_json || '{}') : (a.monthly_json || {}); } catch { mj = {}; }
  const vals = Object.values(mj).map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  return Math.round(Math.max(...vals) * 100);
}

/** قراءة المنصة الحيّة عبر مسارات القراءة وحدها (لا كتابة). */
export async function readPlatformApi({ base, cookie }) {
  const get = async (path) => {
    const r = await fetch(base + path, { headers: { cookie } });
    if (!r.ok) throw new Error(`تعذّرت القراءة من ${path} (${r.status})`);
    return await r.json();
  };
  const getSheet = async (type) => {
    const r = await fetch(`${base}/api/io/export/${type}`, { headers: { cookie } });
    if (!r.ok) throw new Error(`تعذّر تصدير ${type} (${r.status})`);
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
    return { header: rows[0].map((h) => norm(h)), body: rows.slice(1) };
  };

  const allProjects = await get('/api/projects?limit=1000');
  const projects = allProjects.filter((p) => p.sector_id === CONSULTING);

  // العملاء: التصدير يحمل الاسم والمعرّف معاً فيُربط اسم العميل بمشروعه بلا تخمين.
  const cl = await getSheet('clients');
  const cName = colIx(cl.header, 'اسم العميل'), cId = colIx(cl.header, 'معرف السجل');
  const clientById = new Map(cl.body.map((r) => [r[cId], String(r[cName] ?? '').trim()]));
  for (const p of projects) p.client_name = clientById.get(p.client_id) ?? null;

  // الموظفون: التصدير لا يحمل معرّفاً — الاسم هو المفتاح (وهو فريد على مستوى الشركة بقاعدة الخدمة).
  const em = await getSheet('employees');
  const eName = colIx(em.header, 'الاسم'), eTitle = colIx(em.header, 'المسمى الوظيفي'), eSector = colIx(em.header, 'القطاع');
  const employees = em.body.map((r) => ({ id: null, name_ar: String(r[eName] ?? '').trim(),
    job_title: r[eTitle] ?? null, sector_name: r[eSector] ?? null, sector_id: null, user_id: null, active: 1 }));

  const st = await getSheet('staffing');
  const sEmp = colIx(st.header, 'الموظف'), sPrj = colIx(st.header, 'المشروع'), sYear = colIx(st.header, 'السنة');
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const mIx = MONTHS.map((m) => colIx(st.header, m));
  const allocations = st.body.map((r) => {
    const mj = {}; mIx.forEach((ix, i) => { const v = num(r[ix]); if (v) mj[i + 1] = v / 100; });
    return { id: null, employee_id: null, person_name_ar: String(r[sEmp] ?? '').trim(),
      project_id: null, project_code: String(r[sPrj] ?? '').trim(), year: num(r[sYear]),
      monthly_json: JSON.stringify(mj) };
  });

  const rv = await getSheet('revenues');
  const rPrj = colIx(rv.header, 'المشروع'), rYear = colIx(rv.header, 'السنة'), rMonth = colIx(rv.header, 'الشهر'),
    rAmt = colIx(rv.header, 'المبلغ (ريال)'), rLabel = colIx(rv.header, 'البيان'), rId = colIx(rv.header, 'معرف السطر');
  const codes = new Set(projects.map((p) => p.code));
  const revenues = rv.body
    .filter((r) => codes.has(String(r[rPrj] ?? '').trim()))
    .map((r) => ({ id: r[rId], project_id: null, project_code: String(r[rPrj]).trim(), year: num(r[rYear]),
      month: num(r[rMonth]), amount_halalas: hal(num(r[rAmt])), label: r[rLabel] }));

  // البنود ومؤشر الفواتير: من صفحة المشروع نفسها، مشروعاً مشروعاً.
  const deliverables = []; const invoices = [];
  for (const p of projects) {
    for (const d of await get(`/api/projects/${p.id}/deliverables`)) {
      deliverables.push({ id: d.id, project_id: p.id, project_code: p.code, name_ar: d.name_ar,
        amount_halalas: d.amount_halalas ?? 0, status: d.status });
    }
    const money = await get(`/api/projects/${p.id}/money`);
    const inv = money?.bridge?.invoiced_halalas;
    if (inv != null) invoices.push({ id: null, project_id: p.id, project_code: p.code, amount_halalas: inv, issue_date: null, status: null });
  }

  return shape({ projects, employees, allocations, revenues, invoices, deliverables, costLines: [], accounts: [] });
}

// ─────────────────────────────────────────────────────────────────────────────
// المطابقة
// ─────────────────────────────────────────────────────────────────────────────

const TOL = 2;                      // سماحية هللتين: كسور الملف العائمة لا تعني فرقاً حقيقياً
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= TOL;

export function reconcile(file, plat) {
  const byCode = new Map(plat.projects.map((p) => [p.code, p]));
  const empByName = new Map();
  for (const e of plat.employees) {
    const k = norm(e.name_ar);
    empByName.set(k, (empByName.get(k) || []).concat(e));
  }
  const humans = [];                                   // «تحتاج قرار إنسان»
  const need = (title, why) => humans.push({ title, why });

  // ① المشاريع
  const rows = file.projects.map((f) => {
    const code = codeOf(f.n);
    const p = byCode.get(code);
    if (!p) return { n: f.n, code, name: f.name_ar, missing: true, diffs: [], fixes: [] };
    const diffs = []; const fixes = [];
    const push = (label, mine, theirs, fix) => {
      diffs.push({ label, platform: mine, file: theirs });
      if (fix) fixes.push(fix);
    };
    if (norm(p.name_ar) !== norm(f.name_ar)) push('اسم المشروع', p.name_ar, f.name_ar, { name_ar: f.name_ar });

    // الحالة: «غير معتمد» بلا نظير في المنصة — تُذكر ولا تُفرض.
    if (f.status_ar === UNAPPROVED) {
      diffs.push({ label: 'حالة المشروع', platform: STATUS_AR[p.status] || p.status, file: UNAPPROVED, undecidable: true });
      need(`${code} — ${f.name_ar}`,
        `حالته في الملف «${UNAPPROVED}» ولا تقابلها حالة في المنصة (المسجَّل: ${STATUS_AR[p.status] || p.status}). القرار للمالك: أتُترك كما هي أم تُنقل إلى «متوقف»؟`);
    } else {
      const want = STATUS_MAP[f.status_ar];
      if (want && want !== p.status) push('حالة المشروع', STATUS_AR[p.status] || p.status, f.status_ar, { status: want });
    }

    // العميل: يُذكر الفرق ولا يُقترح تعديل — سجل العميل مشترك بين مشاريع، وتسمية الملف تحمل
    // لصيقة المشروع أحياناً («… - قياس13»)، فإعادة تسميته تُفسد مشاريع أخرى تشترك فيه.
    if (norm(p.client_name) !== norm(f.client_ar)) {
      diffs.push({ label: 'اسم العميل', platform: p.client_name, file: f.client_ar, undecidable: true });
      need(`${code} — العميل`,
        `اسم العميل في المنصة «${p.client_name || 'غير مربوط'}» وفي الملف «${f.client_ar}». سجل العميل مشترك بين مشاريع عدّة، فتغييره قرار مالك لا إصلاح آلي.`);
    }

    if (f.pm_missing) {
      diffs.push({ label: 'مدير المشروع', platform: p.pm_name, file: 'غير مذكور في الملف (0)', undecidable: true });
      need(`${code} — مدير المشروع`, 'خانة مدير المشروع في الملف تحمل «0» — لا اسم يُكتب. يلزم اسم من المالك.');
    } else if (f.pm_name && norm(p.pm_name) !== norm(f.pm_name)) {
      push('مدير المشروع', p.pm_name, f.pm_name, { pm_name: f.pm_name });
    }

    if (f.start_date && p.start_date !== f.start_date) push('تاريخ البداية', p.start_date, f.start_date, { start_date: f.start_date });
    if (f.end_date && p.end_date !== f.end_date) push('تاريخ النهاية', p.end_date, f.end_date, { end_date: f.end_date });

    if (f.value_sar != null && !near(p.contract_halalas, hal(f.value_sar))) {
      push('قيمة المشروع', p.contract_halalas / 100, f.value_sar, { contract_value_sar: f.value_sar });
    }
    if (f.budget_sar != null && !near(p.budget_halalas, hal(f.budget_sar))) {
      push('ميزانية ٢٠٢٦', p.budget_halalas / 100, f.budget_sar, { budget_sar: f.budget_sar });
    }
    // التكاليف والإيراد حقلان **مشتقّان** في المنصة (يُحسبان من سطور التكلفة والإيراد) — يُكشف
    // الفرق ولا يُكتب فوقه، وإلا انفصل الرقم عن أصله وصار كذبةً متّسقة الشكل.
    if (f.cost_sar != null && !near(p.spend_halalas, hal(f.cost_sar))) {
      diffs.push({ label: 'تكاليف ٢٠٢٦ الفعلية', platform: p.spend_halalas / 100, file: f.cost_sar, derived: true });
    }
    if (f.revenue_sar != null && !near(p.revenue_halalas, hal(f.revenue_sar))) {
      diffs.push({ label: 'إيرادات ٢٠٢٦ الفعلية (بدون ضريبة)', platform: p.revenue_halalas / 100, file: f.revenue_sar, derived: true });
    }
    if (f.po_sar != null && !near(p.po_halalas, hal(f.po_sar))) {
      push('قيمة أمر الشراء', p.po_halalas / 100, f.po_sar, null);
    }
    return { n: f.n, code, id: p.id, name: f.name_ar, missing: false, diffs, fixes, billed_pct: f.billed_pct };
  });

  // ② التسكين
  const allocByKey = new Map();
  for (const a of plat.allocations) {
    if (a.year != null && Number(a.year) !== REF_YEAR) continue;
    allocByKey.set(`${norm(a.person_name_ar)}|${a.project_code}`, a);
  }
  const staffing = file.team.map((t) => {
    const code = codeOf(t.n);
    const matches = empByName.get(norm(t.person)) || [];
    const out = { row: t.row, n: t.n, code, person: t.person, job_title: t.job_title, pct: t.pct };
    if (matches.length === 0) { out.state = 'موظف غير موجود'; return out; }
    if (matches.length > 1) {
      out.state = 'اسم مكرر';
      need(`تسكين — ${t.person}`, `الاسم يطابق ${matches.length} سجلات موظفين في المنصة. لا يُسكَّن أحد بالتخمين.`);
      return out;
    }
    out.employee_id = matches[0].id;
    const a = allocByKey.get(`${norm(t.person)}|${code}`);
    if (!a) { out.state = 'تسكين ناقص'; return out; }
    out.alloc_id = a.id; out.platform_pct = a.pct;
    out.state = (a.pct === t.pct) ? 'مطابق' : 'نسبة مختلفة';
    return out;
  });
  // تسكينٌ في المنصة على مشروع استشارات لا يقابله صفٌّ في الملف
  const fileKeys = new Set(file.team.map((t) => `${norm(t.person)}|${codeOf(t.n)}`));
  const extraStaffing = plat.allocations
    .filter((a) => (a.year == null || Number(a.year) === REF_YEAR)
      && /^CONS-\d+$/.test(a.project_code || '')
      && !fileKeys.has(`${norm(a.person_name_ar)}|${a.project_code}`))
    .map((a) => ({ person: a.person_name_ar, code: a.project_code, pct: a.pct }));
  for (const x of extraStaffing) {
    need(`تسكين زائد — ${x.person} على ${x.code}`,
      'مسكَّن في المنصة ولا صفَّ له في ورقة فريق العمل. رفعه قرار مالك لا إصلاح آلي.');
  }

  // ③ الفواتير — المقارنة **بدون ضريبة** على سطور الإيراد
  const pool = plat.revenues
    .filter((r) => Number(r.year) === REF_YEAR)
    .map((r) => ({ ...r, used: false }));
  const invoiceRows = file.invoices.map((v) => {
    const code = codeOf(v.n);
    const month = v.date ? Number(v.date.slice(5, 7)) : null;
    const want = hal(v.net_sar);
    // مطابقة قاطعة: نفس المشروع ونفس المبلغ ونفس الشهر. الشهر لأن الملف يحمل يوماً والمنصة شهراً.
    const hit = pool.find((r) => !r.used && r.project_code === code && near(r.amount_halalas, want)
      && (month == null || Number(r.month) === month));
    if (hit) { hit.used = true; return { ...v, code, state: 'مطابق', basis: 'بدون ضريبة' }; }
    return { ...v, code, month, state: 'غير موجود في المنصة', basis: 'بدون ضريبة' };
  });
  const extraInvoices = pool.filter((r) => !r.used)
    .map((r) => ({ code: r.project_code, month: r.month, net_sar: (r.amount_halalas ?? 0) / 100, label: r.label }));
  for (const x of extraInvoices) {
    need(`إيراد زائد — ${x.code} شهر ${x.month}`,
      `مبلغ ${sar(x.net_sar)} ريال (بدون ضريبة) مسجَّل في المنصة ولا يقابله سطر في ورقة الفواتير.`);
  }

  // ④ البنود
  const platItems = new Map();
  for (const d of plat.deliverables) {
    const k = d.project_code;
    platItems.set(k, (platItems.get(k) || []).concat({ ...d, used: false }));
  }
  const itemsByProject = new Map();
  for (const it of file.items) {
    const k = codeOf(it.n);
    itemsByProject.set(k, (itemsByProject.get(k) || []).concat(it));
  }
  const itemRows = [];
  for (const [code, list] of itemsByProject) {
    const have = platItems.get(code) || [];
    let matched = 0; const missing = []; const billingDiff = [];
    for (const it of list) {
      const hit = have.find((d) => !d.used && norm(d.name_ar) === norm(it.name_ar) && near(d.amount_halalas, hal(it.amount_sar)));
      if (!hit) { missing.push(it); continue; }
      hit.used = true; matched++;
      const filedBilled = it.billing === 'مفوتر';
      const platDelivered = hit.status === 'DELIVERED' || hit.status === 'INVOICED' || hit.status === 'PAID';
      if (filedBilled && !platDelivered) billingDiff.push({ name: it.name_ar, platform: itemAr(hit.status), file: it.billing });
    }
    const extra = have.filter((d) => !d.used);
    itemRows.push({ code, fileCount: list.length, platCount: have.length, matched, missing, extra, billingDiff,
      fileTotal: list.reduce((s, x) => s + (hal(x.amount_sar) || 0), 0),
      platTotal: have.reduce((s, x) => s + (x.amount_halalas || 0), 0) });
    for (const b of billingDiff) {
      need(`بند — ${code}`, `«${b.name}» مفوتر في الملف وحالته في المنصة «${b.platform}». تغيير حالة بند مفوتر قرار مالي بيد المالك.`);
    }
  }

  // ⑤ التكاليف
  const platCost = new Map();
  for (const k of plat.costLines) {
    if (k.year != null && Number(k.year) !== REF_YEAR) continue;
    platCost.set(k.project_code, (platCost.get(k.project_code) || 0) + (k.amount_halalas || 0));
  }
  const fileCost = new Map();
  for (const k of file.costs) {
    const c = codeOf(k.n);
    fileCost.set(c, (fileCost.get(c) || 0) + (hal(k.amount_sar) || 0));
  }
  // حين لا تُقرأ سطور التكلفة (القراءة الحيّة لا تعرضها) يبقى مقياسٌ ثانٍ صالح: «التكاليف
  // الفعلية» المسجَّلة على المشروع نفسه. يُذكر المصدر صراحةً كي لا يُقرأ رقمٌ على غير أصله.
  const spendByCode = new Map(plat.projects.map((p) => [p.code, p.spend_halalas]));
  const costRows = [...new Set([...fileCost.keys(), ...platCost.keys()])].sort().map((code) => {
    const fromLines = platCost.has(code) ? platCost.get(code) : null;
    return { code, file_halalas: fileCost.get(code) ?? 0,
      platform_halalas: fromLines ?? spendByCode.get(code) ?? null,
      basis: fromLines != null ? 'سطور التكلفة' : (spendByCode.has(code) ? 'التكاليف الفعلية على المشروع' : null) };
  });

  return { rows, staffing, extraStaffing, invoiceRows, extraInvoices, itemRows, costRows, humans,
    counts: {
      projects: file.projects.length,
      absent: rows.filter((r) => r.missing).length,
      clean: rows.filter((r) => !r.missing && r.diffs.length === 0).length,
      staffingRows: file.team.length,
      staffingOk: staffing.filter((s) => s.state === 'مطابق').length,
      staffingMissingEmployee: staffing.filter((s) => s.state === 'موظف غير موجود').length,
      staffingMissingAlloc: staffing.filter((s) => s.state === 'تسكين ناقص').length,
      staffingPctDiff: staffing.filter((s) => s.state === 'نسبة مختلفة').length,
      invoices: file.invoices.length,
      invoicesOk: invoiceRows.filter((v) => v.state === 'مطابق').length,
    } };
}

// ─────────────────────────────────────────────────────────────────────────────
// التقرير — يُقرأ بعينٍ بشرية، مصنَّفاً بالفرق لا بالعدد وحده
// ─────────────────────────────────────────────────────────────────────────────

const line = (ch = '─', n = 78) => ch.repeat(n);

export function renderReport(res, meta = {}) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('مطابقة مشاريع قطاع الاستشارات بملف المالك — كشفٌ لا كتابة');
  p(line('═'));
  if (meta.file) p(`الملف المرجعي: ${meta.file}`);
  if (meta.source) p(`مصدر قراءة المنصة: ${meta.source}`);
  p('أساس مقارنة المال: **بدون ضريبة** في الطرفين (ورقة الفواتير ↔ سطور الإيراد المسجَّلة).');
  p();

  const c = res.counts;
  p('الخلاصة بالأرقام');
  p(line());
  p(`مشاريع الملف: ${c.projects} · مطابقة تماماً: ${c.clean} · مختلفة: ${c.projects - c.clean - c.absent} · غائبة عن المنصة: ${c.absent}`);
  p(`صفوف فريق العمل: ${c.staffingRows} · مطابقة: ${c.staffingOk} · بلا سجل موظف: ${c.staffingMissingEmployee} · تسكين ناقص: ${c.staffingMissingAlloc} · نسبة مختلفة: ${c.staffingPctDiff}`);
  p(`فواتير الملف: ${c.invoices} · لها نظير في المنصة: ${c.invoicesOk} · بلا نظير: ${c.invoices - c.invoicesOk}`);
  p(`تحتاج قرار إنسان: ${res.humans.length} حالة`);
  p();

  p('١ · المشاريع الثلاثة والعشرون');
  p(line());
  for (const r of res.rows) {
    if (r.missing) { p(`▸ ${r.code} — ${r.name}`); p('   غائب عن المنصة تماماً.'); p(); continue; }
    const head = r.diffs.length === 0 ? 'مطابق' : `مختلف في ${r.diffs.length} حقلاً`;
    p(`▸ ${r.code} — ${r.name}  ·  ${head}`);
    for (const d of r.diffs) {
      const tag = d.undecidable ? '  (قرار إنسان)' : d.derived ? '  (رقم مشتقّ — يُصحَّح من مصدره لا بالكتابة عليه)' : '';
      const fmt = (v) => (typeof v === 'number' ? sar(v) : (v == null || v === '' ? 'غير مسجَّل' : v));
      p(`   • ${d.label}: المنصة «${fmt(d.platform)}» ← الملف «${fmt(d.file)}»${tag}`);
    }
    p();
  }

  p('٢ · التسكين (ورقة فريق العمل)');
  p(line());
  const groups = { 'موظف غير موجود': [], 'تسكين ناقص': [], 'نسبة مختلفة': [], 'اسم مكرر': [], 'مطابق': [] };
  for (const s of res.staffing) (groups[s.state] || (groups[s.state] = [])).push(s);
  for (const [state, list] of Object.entries(groups)) {
    if (!list.length) continue;
    p(`${state} — ${list.length} صفاً`);
    for (const s of list) {
      const extra = state === 'نسبة مختلفة' ? ` (المنصة ${s.platform_pct}% ← الملف ${s.pct}%)` : ` (${s.pct}%)`;
      p(`   • ${s.person} → ${s.code}${extra}${s.job_title ? ' · ' + s.job_title : ''}`);
    }
    p();
  }
  if (res.extraStaffing.length) {
    p(`تسكين في المنصة بلا صفٍّ في الملف — ${res.extraStaffing.length}`);
    for (const x of res.extraStaffing) p(`   • ${x.person} على ${x.code} (${x.pct}%)`);
    p();
  }

  p('٣ · الفواتير (بدون ضريبة)');
  p(line());
  for (const v of res.invoiceRows) {
    if (v.state === 'مطابق') continue;
    p(`   • ${v.code} — ${v.label} · ${v.date} · ${sar(v.net_sar)} ريال — ${v.state} (أساس: ${v.basis})`);
  }
  if (res.invoiceRows.every((v) => v.state === 'مطابق')) p('   كل فواتير الملف لها نظير في المنصة.');
  if (res.extraInvoices.length) {
    p();
    p(`إيرادات في المنصة بلا سطر في الملف — ${res.extraInvoices.length}`);
    for (const x of res.extraInvoices) p(`   • ${x.code} شهر ${x.month} · ${sar(x.net_sar)} ريال · ${x.label ?? ''}`);
  }
  p();

  p('٤ · بنود جدول الكميات');
  p(line());
  for (const it of res.itemRows.sort((a, b) => a.code.localeCompare(b.code, 'ar'))) {
    const ok = it.missing.length === 0 && it.extra.length === 0 && it.billingDiff.length === 0;
    if (ok) continue;
    p(`   • ${it.code}: الملف ${it.fileCount} بنداً / المنصة ${it.platCount} · مطابق ${it.matched}`
      + (it.missing.length ? ` · ناقص ${it.missing.length}` : '')
      + (it.extra.length ? ` · زائد ${it.extra.length}` : '')
      + (it.billingDiff.length ? ` · حالة فوترة مختلفة ${it.billingDiff.length}` : ''));
    for (const b of it.billingDiff) p(`       – «${b.name}» مفوتر في الملف / «${b.platform}» في المنصة`);
  }
  const cleanItems = res.itemRows.filter((it) => !it.missing.length && !it.extra.length && !it.billingDiff.length).length;
  p(`   مشاريع بنودها مطابقة تماماً: ${cleanItems} من ${res.itemRows.length}`);
  p();

  p('٥ · التكاليف');
  p(line());
  let costClean = 0;
  for (const k of res.costRows) {
    if (k.platform_halalas == null) { p(`   • ${k.code}: الملف ${sar(k.file_halalas / 100)} ريال — لا نظير مسجَّل في المنصة (يتعذّر التحقق)`); continue; }
    if (Math.abs(k.file_halalas - k.platform_halalas) <= TOL) { costClean++; continue; }
    p(`   • ${k.code}: المنصة ${sar(k.platform_halalas / 100)} ← الملف ${sar(k.file_halalas / 100)} ريال (مقياس المنصة: ${k.basis})`);
  }
  p(`   مشاريع تكاليفها مطابقة: ${costClean} من ${res.costRows.length}`);
  p();

  p('٦ · تحتاج قرار إنسان');
  p(line('═'));
  if (!res.humans.length) p('   لا شيء.');
  for (const h of res.humans) { p(`▸ ${h.title}`); p(`   ${h.why}`); }
  p();
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// سطر الأوامر
// ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) o[m[1]] = m[2] ?? true;
  }
  return o;
}

export async function loadPlatform(opts) {
  if (opts.api) {
    const cookie = opts.cookie
      ? readFileSync(opts.cookie, 'utf8').split('\n').filter((l) => l.includes('sanad_sid'))
        .map((l) => { const f = l.split('\t'); return `${f[5]}=${f[6]}`; }).join('; ')
      : (opts.rawCookie || '');
    if (!cookie) throw new Error('القراءة الحيّة تحتاج ملف جلسة (--cookie) — سجّل الدخول أولاً.');
    return { plat: await readPlatformApi({ base: String(opts.api).replace(/\/$/, ''), cookie }), source: `المنصة الحيّة (${opts.api})` };
  }
  return { plat: await readPlatformDb(), source: 'قاعدة بيانات المنصة (قراءة فقط)' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) { console.error('استعمال: --file=<ملف المالك.xlsm> [--api=<العنوان> --cookie=<ملف الجلسة>] [--out=<ملف>]'); process.exit(2); }
  const file = readWorkbook(opts.file);
  const { plat, source } = await loadPlatform(opts);
  const res = reconcile(file, plat);
  const text = renderReport(res, { file: opts.file, source });
  if (opts.out) { writeFileSync(opts.out, text, 'utf8'); console.log(`كُتب التقرير في ${opts.out}`); }
  else console.log(text);
  if (!opts.api) { const { close } = await import('../src/core/db/index.js'); await close?.(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('تعذّر إتمام الكشف:', e.message); process.exit(1); });
}
