// ── صورة المال على المشروع: مجموعة الاستعلامات ─────────────────────────────────────────────
// طبقة قراءة صرفة خلف `projectMoney` في modules/finance/finance.js: استعلام مجمَّع **واحد** لكل
// رقم (لا استعلام لكل صف)، بلا أي فحص صلاحية وبلا تنسيق — الفحص والتشكيل مسؤولية الخدمة، وهذا
// الملف في `core` فلا يستورد من `modules` أبداً.
//
// قواعد ملزمة في كل استعلام هنا:
//   • SQL محمول على المحرّكَين: لا strftime ولا date('now')؛ جزء التاريخ عبر substr(col,1,7).
//   • GROUP BY صارم: كل عمود غير مُجمَّع مذكور في التجميع.
//   • المال عدد صحيح بالهللات — لا كسور ولا نصوص.
//   • **الغياب ليس صفراً**: الدوال تُرجع ما سُجِّل فعلاً (`any` + عدد الصفوف + الأشهر التي بلا
//     تاريخ)، ولا تُلفّق شهراً ولا تُوزّع مبلغاً على أشهر لم يُسجَّل فيها. تحويل «لا شيء مسجَّل»
//     إلى رسالة يقرأها المستخدم يتم في الخدمة، لأنه قرار عرض لا قرار بيانات.
import { all } from '../db/index.js';
import { MONTHS_AR } from '../i18n/time.js';

const num = (v) => Number(v) || 0;

// مفتاح الشهر الموحَّد «YYYY-MM» — نفس شكل substr(col,1,7) على المحرّكَين.
export const ym = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// محور الأشهر الاثني عشر للسنة المعروضة (اسم الشهر من النموذج الزمني الواحد للمنصة).
export const monthAxis = (year) =>
  Array.from({ length: 12 }, (_, i) => ({ month: i + 1, key: ym(year, i + 1), label: MONTHS_AR[i] }));

// ── تلخيص صفوف مُجمَّعة بمفتاح شهر «YYYY-MM» ─────────────────────────────────────────────────
// المدخل: [{ key, amount_halalas, count }]. المُخرَج: هل سُجِّل شيء أصلاً · المجموع الكلي · العدد ·
// المبالغ لكل شهر · ما لا تاريخ له · السنوات التي فيها تسجيل. الصف الذي لا يحمل تاريخاً لا يُنسب
// إلى شهر تخميناً: يُعزل في `undated` كي تستطيع الشاشة قول «مبالغ بلا تاريخ» بدل إسقاطها بصمت
// أو حشرها في شهر لم تقع فيه. مُصدَّرة كي تستعملها الخدمة على صفوفها المُجمَّعة بلا نسخة ثانية.
export function summarizeKeyed(rows) {
  const byKey = Object.create(null);
  const years = new Set();
  let total = 0; let count = 0;
  const undated = { amount_halalas: 0, count: 0 };
  for (const r of rows) {
    const amount = num(r.amount_halalas);
    const n = num(r.count);
    total += amount; count += n;
    const key = r.key == null ? '' : String(r.key);
    if (key.length < 7) { undated.amount_halalas += amount; undated.count += n; continue; }
    const cur = byKey[key] || { amount_halalas: 0, count: 0 };
    byKey[key] = { amount_halalas: cur.amount_halalas + amount, count: cur.count + n };
    years.add(Number(key.slice(0, 4)));
  }
  return { any: count > 0, total_halalas: total, count, byKey, undated, years: [...years].sort((a, b) => a - b) };
}
// صفوف الاستعلامات تأتي بعمودَي `ym` و`n` — تُحوَّل إلى الشكل أعلاه في موضع واحد.
const summarizeMonthly = (rows) =>
  summarizeKeyed(rows.map((r) => ({ key: r.ym, amount_halalas: r.amount_halalas, count: r.n })));

// شريط الاثني عشر شهراً لسنة بعينها من ملخّص أعلاه. الأصفار هنا **قياس حقيقي**: الملخّص يقول
// إن هناك تسجيلاً، وهذا الشهر لم يقع فيه شيء. أما «لا تسجيل إطلاقاً» فيُعرف من `any` لا من الشريط.
export function yearTrack(summary, year) {
  const months = [];
  let total = 0; let count = 0;
  for (let m = 1; m <= 12; m++) {
    const key = ym(year, m);
    const cell = summary.byKey[key] || { amount_halalas: 0, count: 0 };
    months.push({ month: m, key, label: MONTHS_AR[m - 1], amount_halalas: cell.amount_halalas, count: cell.count });
    total += cell.amount_halalas; count += cell.count;
  }
  return { months, total_halalas: total, count };
}

// ── الداخل النقدي: التحصيلات عبر فواتير المشروع ──────────────────────────────────────────────
// المصدر `collection` وحده — لا الفاتورة ولا بند الإيراد. الوصل بالفاتورة هو ما ينسب التحصيل إلى
// المشروع (جدول التحصيل لا يحمل مشروعاً)، وفاتورةٌ محذوفة لا يُحسب تحصيلها كما في بقية المالية.
export async function collectionsByMonth(projectId) {
  const rows = await all(
    `SELECT substr(c.collected_at,1,7) AS ym,
            COALESCE(SUM(c.amount_halalas),0) AS amount_halalas, COUNT(*) AS n
       FROM collection c JOIN invoice i ON i.id = c.invoice_id
      WHERE i.project_id = ? AND i.deleted_at IS NULL
      GROUP BY substr(c.collected_at,1,7)`, [projectId]);
  return summarizeMonthly(rows);
}

// آخر التحصيلات بأسمائها (لجدول «الداخل النقدي»). ما لا تاريخ له يُعرض آخراً لا أن يُحذف.
export async function collectionRows(projectId, limit = 60) {
  const cap = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 60;
  return await all(
    `SELECT c.id, c.amount_halalas, c.collected_at, c.method, c.invoice_id, i.code AS invoice_code
       FROM collection c JOIN invoice i ON i.id = c.invoice_id
      WHERE i.project_id = ? AND i.deleted_at IS NULL
      ORDER BY (c.collected_at IS NULL), c.collected_at DESC
      LIMIT ?`, [projectId, cap]);
}

// ── الفوترة: بالحالة، وبالشهر ────────────────────────────────────────────────────────────────
export async function invoicesByStatus(projectId) {
  const rows = await all(
    `SELECT i.status AS status, COALESCE(SUM(i.amount_halalas),0) AS amount_halalas,
            COALESCE(SUM(i.retention_halalas),0) AS retention_halalas, COUNT(*) AS n
       FROM invoice i WHERE i.project_id = ? AND i.deleted_at IS NULL
      GROUP BY i.status`, [projectId]);
  return rows.map((r) => ({ status: String(r.status || 'DRAFT'), amount_halalas: num(r.amount_halalas),
    retention_halalas: num(r.retention_halalas), count: num(r.n) }));
}

// المفوتر شهرياً بتاريخ الإصدار. تعريف «المفوتر» نفسه المستعمل في ملخّص المالية: كل ما ليس مسودة.
export async function invoicedByMonth(projectId) {
  const rows = await all(
    `SELECT substr(i.issue_date,1,7) AS ym, COALESCE(SUM(i.amount_halalas),0) AS amount_halalas, COUNT(*) AS n
       FROM invoice i
      WHERE i.project_id = ? AND i.deleted_at IS NULL AND i.status != 'DRAFT'
      GROUP BY substr(i.issue_date,1,7)`, [projectId]);
  return summarizeMonthly(rows);
}

// ── الإيراد المحقق على المشروع (بنود الإيراد) ────────────────────────────────────────────────
// الشهر والسنة عمودان صحيحان هنا لا تاريخ نصّي، فالتجميع عليهما مباشرة.
export async function revenueByMonth(projectId) {
  const rows = await all(
    `SELECT r.year AS y, r.month AS m, COALESCE(SUM(r.amount_halalas),0) AS amount_halalas, COUNT(*) AS n
       FROM revenue_line r WHERE r.project_id = ?
      GROUP BY r.year, r.month`, [projectId]);
  return summarizeKeyed(rows.map((r) => ({ key: keyOf(r.y, r.m), amount_halalas: r.amount_halalas, count: r.n })));
}

// سنة/شهر عددان ⟵ مفتاح «YYYY-MM»؛ وما نقص أحد طرفيه لا مفتاح له (يقع في «بلا تاريخ»).
function keyOf(y, m) {
  const yy = Number(y); const mm = Number(m);
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || mm < 1 || mm > 12) return null;
  return ym(yy, mm);
}

// ── المصروفات: تجميعة واحدة تكفي كل الأسئلة ──────────────────────────────────────────────────
// (الوصف × السنة × الشهر × الحالة) في استعلام واحد ⟵ منها تُشتقّ: المدفوع فعلاً (خارج نقدي)،
// والمعتمد غير المدفوع (التزام)، وما زال طلباً، والشريط الشهري، والتكرار حسب الوصف.
// عمود `type` في هذا الجدول هو الحقل الوصفي الوحيد المتاح — لا عمود اسم/وصف في الجدول أصلاً.
export async function expenseAggregate(projectId) {
  const rows = await all(
    `SELECT e.type AS type, e.incurred_year AS y, e.incurred_month AS m, e.status AS status,
            COALESCE(SUM(e.amount_halalas),0) AS amount_halalas, COUNT(*) AS n
       FROM expense e WHERE e.project_id = ? AND e.deleted_at IS NULL
      GROUP BY e.type, e.incurred_year, e.incurred_month, e.status`, [projectId]);
  return rows.map((r) => ({
    type: r.type == null || String(r.type).trim() === '' ? null : String(r.type),
    year: Number.isInteger(Number(r.y)) ? Number(r.y) : null,
    month: Number.isInteger(Number(r.m)) ? Number(r.m) : null,
    key: keyOf(r.y, r.m),
    status: String(r.status || 'DRAFT').toUpperCase(),
    amount_halalas: num(r.amount_halalas), count: num(r.n),
  }));
}

// ── الكلفة المسجَّلة على المشروع (بنود الكلفة) ───────────────────────────────────────────────
// ليست بالضرورة نقداً خرج: بند الكلفة اعترافٌ بكلفة (رواتب، تعاقد باطني، أخرى) لا حركة صرف.
// يبقى منفصلاً عن «الخارج النقدي» عمداً كي لا يُجمع اعترافٌ إلى دفعة فيُقرأ الرقم مرتين.
export async function costLineAggregate(projectId) {
  const rows = await all(
    `SELECT c.type AS type, c.year AS y, c.month AS m,
            COALESCE(SUM(c.amount_halalas),0) AS amount_halalas, COUNT(*) AS n
       FROM cost_line c WHERE c.project_id = ?
      GROUP BY c.type, c.year, c.month`, [projectId]);
  return rows.map((r) => ({
    type: r.type == null || String(r.type).trim() === '' ? null : String(r.type),
    key: keyOf(r.y, r.m), year: Number.isInteger(Number(r.y)) ? Number(r.y) : null,
    month: Number.isInteger(Number(r.m)) ? Number(r.m) : null,
    amount_halalas: num(r.amount_halalas), count: num(r.n),
  }));
}

// ── التسكين على المشروع ──────────────────────────────────────────────────────────────────────
// صفوف التسكين كما هي؛ النِّسَب تُقرأ من `monthly_json` بالدالة أدناه.
export async function projectAllocations(projectId) {
  return await all(
    `SELECT a.id, a.employee_id, a.person_name_ar, a.type, a.year, a.monthly_json,
            e.name_ar AS employee_name, e.job_title
       FROM allocation a LEFT JOIN employee e ON e.id = a.employee_id
      WHERE a.project_id = ? AND a.deleted_at IS NULL
      ORDER BY a.year, a.created_at`, [projectId]);
}

// قراءة خريطة الأشهر {"2":1,"3":0.5} إلى اثني عشر كسراً — **نفس** القراءة المستعملة في كشف
// الفريق (modules/org) وفي مقاييس القطاع (core/reports/metrics): كسر لكل شهر، وما خرج عن 1..12
// يُتجاهل، والنص التالف يُقرأ فراغاً لا خطأً. أُخرجت هنا كدالة مُصدَّرة كي يتوقف تكرارها سطراً
// سطراً في كل مستدعٍ جديد — لا قراءة ثالثة، بل موضع واحد يتجمّع عليه المستدعون تدريجياً.
export function monthlyFractions(monthlyJson) {
  const out = Array(12).fill(0);
  let map = {};
  try { map = JSON.parse(monthlyJson || '{}') || {}; } catch { map = {}; }
  if (typeof map !== 'object') return out;
  for (const [m, frac] of Object.entries(map)) {
    const i = Number(m) - 1;
    if (Number.isInteger(i) && i >= 0 && i < 12) out[i] += Number(frac) || 0;
  }
  return out;
}

// ── الموردون: أوامر الشراء المسجَّلة على المشروع ─────────────────────────────────────────────
// يُقرأ الجدول كما هو. لا يكتب فيه المنتج اليوم شيئاً، فالخدمة تصرّح بذلك بدل أن تعرض «صفراً».
export async function purchaseOrderRows(projectId) {
  return await all(
    `SELECT po.id, po.code, po.status, po.amount_halalas, po.created_at,
            po.supplier_id, s.name_ar AS supplier_name
       FROM purchase_order po LEFT JOIN supplier s ON s.id = po.supplier_id AND s.deleted_at IS NULL
      WHERE po.project_id = ? AND po.deleted_at IS NULL
      ORDER BY po.created_at DESC LIMIT 50`, [projectId]);
}

// أوصاف المصروفات المستعملة فعلاً (على المشروع أو داخل قطاعه) — اقتراحات إدخال من بيانات
// مسجَّلة لا من قائمة مخترعة. بلا مبالغ: هذه أسماء لا أرقام.
export async function expenseTypeSuggestions(projectId, sectorId) {
  const rows = await all(
    `SELECT e.type AS type, COUNT(*) AS n FROM expense e
      WHERE e.deleted_at IS NULL AND e.type IS NOT NULL AND e.type != ''
        AND (e.project_id = ? OR e.sector_id = ?)
      GROUP BY e.type ORDER BY COUNT(*) DESC, e.type LIMIT 12`, [projectId, sectorId || null]);
  return rows.map((r) => String(r.type));
}
