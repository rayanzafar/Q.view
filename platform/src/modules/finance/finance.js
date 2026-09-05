// Finance module — the contract→deliverable→progress-claim→collection lifecycle,
// aggregated per project manager, per contract, per deliverable. Scope + audit enforced.
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { can, canSeeSensitive, effectiveScope } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { config } from '../../core/config.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import {
  monthAxis, yearTrack, summarizeKeyed, monthlyFractions,
  collectionsByMonth, collectionRows, invoicesByStatus, invoicedByMonth, revenueByMonth,
  expenseAggregate, costLineAggregate, projectAllocations, purchaseOrderRows, expenseTypeSuggestions,
} from '../../core/reports/project-cash.js';
import {
  readableProject, canReadExpenses, canAddExpense, canApproveExpense,
  expenseRowsFor, presentExpenses, EXPENSE_STATUS_AR,
} from './expenses.js';
import { splitGross, netSum, vatSum, netSql } from './vat.js';

const FY = () => config.fiscalYear;

// ── أيّ رقمٍ صافٍ وأيّ رقمٍ إجمالي — القاعدة الواحدة التي تحكم هذا الملف كله ─────────────────
// قرار المالك: «الإيراد يُحسب صافياً، والمطالبة والمستحق والتحصيل إجمالاً» — لأن العميل يدفع
// الإجمالي والشركة تعترف بالصافي. فالتقسيم ليس ذوقاً بل يتبع السؤال الذي يجيب عنه الرقم:
//   • **صافٍ**: الإيراد المحقق. وهو الرقم الذي يُقارن بالمستهدف (والمستهدفات صافية أصلاً)،
//     ويدخل معادلة الهامش مقابل كلفةٍ صافية بطبيعتها. هذا الرقم وحده يُسمّى «إيراداً».
//   • **إجمالي**: المفوتر (مطالبةٌ على العميل)، والمحصَّل (نقدٌ دخل الحساب فعلاً)، والمستحق
//     (ما زال العميل مديناً به)، وقيمة العقد (ما وقّعه العميل)، وأعمار الذمم. حجبُ الضريبة عن
//     هذه يجعل المستحق أقلّ مما يُطالَب به فعلاً — أي رقماً لا يطابق كشف الحساب مع العميل.
//   • ولا يُستبدل رقمٌ برقم: كل مبلغٍ يحمل ضريبةً يخرج من هنا بثلاثة حقول — `x_halalas`
//     (الإجمالي، على معناه السابق حرفياً فلا يتغيّر تحت قارئٍ لم يُخطَر) و`x_net_halalas`
//     و`x_vat_halalas`. الشاشة تختار أيّها تُبرز، ولا تحسب شيئاً بنفسها.
// والاستثناء الوحيد: `revenue_halalas` صار صافياً. وهو تغيير معنى مقصود ومطلوب حرفياً — الرقم
// الذي اسمه «الإيراد» يجب أن يكون الإيراد. ويرافقه `revenue_gross_halalas` لمن يحتاج الإجمالي.

// invoice.issue_date is a 'YYYY-MM-DD' string; the table has no year column, so derive the
// fiscal year from the date. Reused wherever billing figures must respect the selected year.
const YEAR_PRED = (alias = '') => `CAST(substr(${alias}issue_date,1,4) AS INTEGER) = ?`;

// ── نسبة الفاتورة إلى عميل — القاعدة الواحدة في المنصة ───────────────────────────────────────
// الأسبقية: عميل الفاتورة نفسها إن وُجد، وإلا عميل مشروعها. لا مسار ثالث.
//   • `invoice.client_id` هو ما كُتب على الفاتورة صراحةً لحظة إصدارها — بما فيها فواتير
//     المستخلصات التي يكتب فيها `createProgressClaim` عميلَ العقد أدناه. فهو أدقّ ما لدينا.
//   • الفواتير المُرحَّلة من النظام القديم تصل بلا عميل وبمشروع فقط، فمشروعها هو المسار
//     الاحتياطي الوحيد. ومشروعٌ محذوف لا ينسب فاتورته إلى أحد (شرط الحذف داخل الوصل نفسه).
//   • عميل **العقد** ليس مساراً ثالثاً: العقد يكتب عميله في الفاتورة أصلاً، فالمرور عبره يعيد
//     المصدر نفسه ويُسقط في الطريق كل فاتورة بلا عقد. كان هذا سبب اختلاف نسبة الفاتورة الواحدة
//     بين شاشة المالية وقائمة العملاء وصفحة العميل — ثلاث إجابات لسؤال واحد. صار المسار واحداً.
// تُستعمل الصيغتان معاً دائماً: JOIN يجلب مشروع الفاتورة، وCOL يعطي معرّف العميل المنسوب.
export const INVOICE_CLIENT_JOIN = (inv = 'i', prj = 'p') =>
  `LEFT JOIN project ${prj} ON ${prj}.id = ${inv}.project_id AND ${prj}.deleted_at IS NULL`;
export const INVOICE_CLIENT_COL = (inv = 'i', prj = 'p') => `COALESCE(${inv}.client_id, ${prj}.client_id)`;

// Outstanding (AR) per invoice = amount − retention − collected.
// **إجمالي بثلاثة أطرافه**: ما يبقى على العميل هو ما طولب به شاملاً الضريبة ناقصَ ما دفعه شاملاً
// الضريبة. لو حُسب صافياً لخرج رقمٌ لا يطابق كشف الحساب مع العميل ولا ما يُطالَب به قانوناً.
async function outstanding(inv) {
  const collected = (await get('SELECT COALESCE(SUM(amount_halalas),0) v FROM collection WHERE invoice_id = ?', [inv.id])).v;
  return Math.max(0, inv.amount_halalas - (inv.retention_halalas || 0) - collected);
}

// ── الإيراد المحقق داخل نطاق القارئ ──────────────────────────────────────────────────────────
// جدول الإيراد لا يحمل مالكاً، فالتضييق الوحيد الممكن عليه هو القطاع: من يقرأ الفواتير على مستوى
// الشركة يرى الإيراد كله، ومن دونه يرى إيراد قطاعه، ومن لا يقرأ الفواتير أصلاً لا يرى رقماً.
// تعريف واحد لأن هذا الرقم هو ضلع الجسر المالي **ومقام** معادلة «فترة التحصيل» معاً: افتراقهما هو
// ما كان يقسم مستحقّ قطاعٍ واحد على إيراد الشركة كاملة فتخرج فترة تحصيل أقصر من الحقيقة بأضعاف.
// ويعود بالوجوه الثلاثة معاً: الصافي هو «الإيراد» الذي يُعرض ويُقارن بالمستهدف، والإجمالي هو
// مقام «فترة التحصيل» أدناه — فالبسط (المستحق) إجمالي، وقسمةُ إجماليٍّ على صافٍ تطيل الفترة
// خمسة عشر بالمئة بلا سبب. طرفا الكسر من عالمٍ واحد، كما وُحِّد نطاقهما من قبل.
async function scopedRevenue(user, year) {
  // جدول الإيراد يحمل القطاع فقط — لا مالكاً ولا مشروعاً — فالتضييق الوحيد الذي يمثّله هو القطاع.
  // من نطاقه دون القطاع (مشروع/فريق/خاصتي) لا يعبّر عنه هذا الجدول: فيُرَدّ **بلا رقم** بدل توسيعه
  // إلى إيراد القطاع كله — وهو ما كان يمنح مدير المشروع إيراد قطاعه بأكمله. والقراءة على مستوى
  // الشركة تراه كاملاً، والقطاع (والإدارة التي تفشل مفتوحةً إلى القطاع) ترى قطاعها.
  const scope = effectiveScope(user, 'read', 'invoice');
  let clause, params;
  if (scope === 'company') { clause = '1=1'; params = [year]; }
  else if (scope === 'sector' || scope === 'department') { clause = 'sector_id = ?'; params = [year, user.sector_id ?? null]; }
  else { clause = '1=0'; params = [year]; }
  const r = await get(`SELECT ${netSum('amount_halalas', 'net_amount_halalas')} net,
       ${vatSum('amount_halalas', 'net_amount_halalas')} vat,
       COALESCE(SUM(amount_halalas),0) gross
     FROM revenue_line WHERE year = ? AND ${clause}`, params);
  return { net: r.net, vat: r.vat, gross: r.gross };
}

// ── Bridge + AR + DSO (scope-filtered, year-filtered) ──
export async function financeSummary(user, year = FY()) {
  // Alias invoice as `i` everywhere so the scope clause is unambiguous even when joined (collection JOIN invoice).
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  const c = f.clause, p = f.params;
  // Bookings and revenue must respect the caller's scope too, else a sector user sees company-wide
  // bookings/revenue against their sector-only AR — an inconsistent (and over-broad) bridge.
  const bookingsScope = scopeFilter(user, 'opportunity', 'read', {
    sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id', deptCol: 'o.department_id',
    grantCol: 'o.department_id', memberCol: 'o.id',
  });
  const bookings = (await get(`SELECT COALESCE(SUM(o.value_halalas),0) v FROM opportunity o JOIN stage st ON st.id=o.stage_id
     WHERE st.is_won=1 AND o.exclude_from_sales=0 AND o.year=? AND o.deleted_at IS NULL
       AND (${bookingsScope.clause})`, [year, ...bookingsScope.params])).v;
  const revenue = await scopedRevenue(user, year); // نفس المصدر الذي يستعمله dso — لا نسختان
  // المفوتر: **إجمالي** (مطالبة على العميل) ومعه صافيه وضريبته. نسبة التحصيل تُقاس بين إجماليَّين
  // (محصَّل ÷ مفوتر) لأن الاثنين حركةُ مالٍ مع العميل، لا اعترافٌ بإيراد.
  const inv = await get(`SELECT COALESCE(SUM(i.amount_halalas),0) gross,
       ${netSum('i.amount_halalas', 'i.net_amount_halalas')} net,
       ${vatSum('i.amount_halalas', 'i.net_amount_halalas')} vat
     FROM invoice i WHERE ${c} AND i.deleted_at IS NULL AND i.status != 'DRAFT' AND ${YEAR_PRED('i.')}`, [...p, year]);
  const col = await get(`SELECT COALESCE(SUM(col.amount_halalas),0) gross,
       ${netSum('col.amount_halalas', 'col.net_amount_halalas')} net,
       ${vatSum('col.amount_halalas', 'col.net_amount_halalas')} vat
     FROM collection col JOIN invoice i ON i.id=col.invoice_id
     WHERE ${c} AND i.deleted_at IS NULL AND i.status != 'DRAFT' AND ${YEAR_PRED('i.')}`, [...p, year]);
  const invoices = await all(`SELECT i.* FROM invoice i WHERE ${c} AND i.deleted_at IS NULL AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED('i.')}`, [...p, year]);
  let ar = 0;
  for (const inv2 of invoices) ar += await outstanding(inv2);
  return {
    year, bookings_halalas: bookings,
    // الإيراد صافٍ — وهذا هو الحقل الوحيد الذي تغيّر معناه في هذه الترحيلة، عمداً وبقرار مكتوب.
    revenue_halalas: revenue.net, revenue_gross_halalas: revenue.gross, revenue_vat_halalas: revenue.vat,
    invoiced_halalas: inv.gross, invoiced_net_halalas: inv.net, invoiced_vat_halalas: inv.vat,
    collected_halalas: col.gross, collected_net_halalas: col.net, collected_vat_halalas: col.vat,
    ar_halalas: ar,
    collectionRate: inv.gross ? Math.round((col.gross / inv.gross) * 100) : 0,
    dso: await dso(user, year), aging: await arAging(user, year),
  };
}

// AR aging buckets by days since issue_date on outstanding invoices.
// Optional {sector}: focus on one sector (sector command center) — the invoice's own sector,
// falling back to its project's sector (same COALESCE path used across finance views).
// Existing callers (arAging(user, year)) are unchanged in signature and result.
export async function arAging(user, year = FY(), { sector, dept, client } = {}) {
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  // قصّ إدارة/عميل اختياري (مركز القطاع): الإدارة عبر مشروع الفاتورة، والعميل من الفاتورة
  // نفسها وإلا من مشروعها — نفس قاعدة invoiceScopeSql في المقاييس.
  const dc = { clause: '', args: [] };
  if (dept === 'none') dc.clause += ' AND p.department_id IS NULL';
  else if (dept) { dc.clause += ' AND p.department_id = ?'; dc.args.push(dept); }
  if (client) { dc.clause += ' AND COALESCE(i.client_id, p.client_id) = ?'; dc.args.push(client); }
  const rows = await all(`SELECT i.* FROM invoice i LEFT JOIN project p ON p.id = i.project_id
     WHERE ${f.clause} AND i.deleted_at IS NULL AND i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED('i.')}
     ${sector ? 'AND COALESCE(i.sector_id, p.sector_id) = ?' : ''}${dc.clause}`,
    [...f.params, year, ...(sector ? [sector] : []), ...dc.args]);
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const now = Date.now();
  for (const inv of rows) {
    const out = await outstanding(inv);
    if (out <= 0) continue;
    const base = inv.issue_date ? new Date(inv.issue_date).getTime() : now;
    const days = Math.floor((now - base) / 86400000);
    const b = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
    buckets[b] += out;
  }
  return buckets;
}

// DSO = (AR / revenue) * period days (simplified, YTD) for the given year.
export async function dso(user, year = FY()) {
  const f = scopeFilter(user, 'invoice', 'read');
  const rows = await all(`SELECT * FROM invoice WHERE ${f.clause} AND deleted_at IS NULL AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND ${YEAR_PRED()}`, [...f.params, year]);
  let ar = 0;
  for (const i of rows) ar += await outstanding(i);
  // البسط والمقام من النطاق نفسه: مستحقُّ ما يراه القارئ ÷ إيرادُ ما يراه القارئ. كان المقام
  // إيراد الشركة كاملاً بينما البسط مستحقّ القطاع وحده — قسمة طرفين من عالمين مختلفين.
  // وبعد فصل الضريبة يُشترط توحيدٌ ثانٍ: البسط (المستحق) إجمالي لأن العميل مدينٌ بالإجمالي،
  // فالمقام إجمالي كذلك. قسمةُ مستحقٍّ إجمالي على إيرادٍ صافٍ كانت تطيل فترة التحصيل خمسة عشر
  // بالمئة وهماً — والرقم يُقرأ إنذاراً تشغيلياً فيُتّخذ عليه قرار.
  const rev = (await scopedRevenue(user, year)).gross;
  const month = year === FY() ? new Date().getUTCMonth() + 1 : 12; // prior years use a full-year period
  return rev ? Math.round((ar / rev) * (month * 30)) : 0;
}

// ── Per project manager ──
// كل أعمدة الصف على أساس واحد: نطاق القارئ ∩ السنة المختارة. قبل ذلك كان الصف يروي قصتين —
// «مفوتر» و«محصَّل» للسنة المختارة بجوار «قيمة عقود» مدى الحياة — فتخرج نسبة فوترة بلا معنى؛
// وكان الفرعان (المحصَّل وقيمة العقود) يُستعلمان بمعرّف المدير وحده بلا شرط النطاق، فيقرأ
// مستخدمُ قطاعٍ أرقام فواتير ومشاريع قطاعات لا يملك رؤيتها.
export async function financeByPM(user, year = FY()) {
  // Qualify the scope column to the aliased invoice table so it is unambiguous against app_user.sector_id.
  const f = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  // group invoices by project owner (PM), within the selected fiscal year
  // كل أرقام هذا الصف **إجمالية**: مدير المشروع يقرأ ما طولب به عميله وما دفعه وما بقي عليه.
  // ويُضاف صافي المفوتر بجانبه لا مكانه — من يريد نصيب مديره من الإيراد المعترف به يقرأ الصافي،
  // ومن يتابع المطالبة والتحصيل يقرأ الإجمالي، ولا يُخلط الاثنان في خانةٍ واحدة.
  const rows = await all(`SELECT COALESCE(u.name_ar, u.username, 'غير محدد') pm, i.owner_user_id,
      COALESCE(SUM(CASE WHEN i.status!='DRAFT' THEN i.amount_halalas ELSE 0 END),0) invoiced,
      COALESCE(SUM(CASE WHEN i.status!='DRAFT' THEN ${netSql('i.amount_halalas', 'i.net_amount_halalas')} ELSE 0 END),0) invoiced_net,
      COUNT(*) n
    FROM invoice i LEFT JOIN app_user u ON u.id=i.owner_user_id
    WHERE ${f.clause} AND i.deleted_at IS NULL AND ${YEAR_PRED('i.')} GROUP BY i.owner_user_id, u.name_ar, u.username ORDER BY invoiced DESC`, [...f.params, year]);
  // المحصَّل: على فواتير الصف نفسها — النطاق نفسه والسنة نفسها واستبعاد المحذوف نفسه. تحصيلٌ على
  // فاتورة محذوفة أو خارج النطاق كان يرفع «المحصَّل» فوق «المفوتر» في السطر ذاته.
  const collectedBy = new Map((await all(`SELECT i.owner_user_id uid, COALESCE(SUM(col.amount_halalas),0) v
     FROM collection col JOIN invoice i ON i.id = col.invoice_id
     WHERE ${f.clause} AND i.deleted_at IS NULL AND ${YEAR_PRED('i.')}
     GROUP BY i.owner_user_id`, [...f.params, year])).map((r) => [r.uid, r.v]));
  // قيمة العقود: عقود المشاريع التي فُوتر عليها فعلاً في هذه السنة وداخل هذا النطاق — لا كل
  // مشاريع المدير منذ نشأة الشركة. المشروع لا يحمل عمود سنة، فالسنة تصل إليه من فواتيرها.
  const contractBy = new Map((await all(`SELECT d.uid uid, COALESCE(SUM(p.contract_value_halalas),0) v
     FROM (SELECT DISTINCT i.owner_user_id uid, i.project_id pid FROM invoice i
           WHERE ${f.clause} AND i.deleted_at IS NULL AND i.project_id IS NOT NULL AND ${YEAR_PRED('i.')}) d
     JOIN project p ON p.id = d.pid AND p.deleted_at IS NULL
     GROUP BY d.uid`, [...f.params, year])).map((r) => [r.uid, r.v]));
  return rows.map((r) => {
    const collected = collectedBy.get(r.owner_user_id) || 0;
    return { pm: r.pm, invoices: r.n, contract_halalas: contractBy.get(r.owner_user_id) || 0,
      invoiced_halalas: r.invoiced, invoiced_net_halalas: r.invoiced_net,
      invoiced_vat_halalas: r.invoiced - r.invoiced_net,
      collected_halalas: collected,
      outstanding_halalas: Math.max(0, r.invoiced - collected) };
  });
}

// ── Per contract ──
export async function financeByContract(user) {
  // Qualify the scope column to the aliased contract table (project also exposes sector_id → ambiguous otherwise).
  // Contracts have no owner column; if a role ever reads at 'own' scope, resolve ownership via the linked project.
  const f = scopeFilter(user, 'contract', 'read', { sectorCol: 'c.sector_id', ownerCol: 'p.owner_user_id' });
  const fi = scopeFilter(user, 'invoice', 'read');
  const fc = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id', projectCol: 'i.project_id' });
  const contracts = await all(`SELECT c.*, cl.name_ar client_name, p.name_ar project_name, p.owner_user_id
     FROM contract c LEFT JOIN client cl ON cl.id=c.client_id LEFT JOIN project p ON p.id=c.project_id
     WHERE ${f.clause} AND c.deleted_at IS NULL ORDER BY c.value_halalas DESC LIMIT 200`, f.params);
  // العقد: قيمته وما فُوتر منه وما تبقّى — ثلاثتها **إجمالية**، فنسبة الفوترة والمتبقي يقارنان
  // طرفين من عالمٍ واحد. ويُعرض صافي القيمة وصافي المفوتر بجانبهما لمن يسأل عن الإيراد لا عن
  // المطالبة: قيمة عقدٍ بعشرة ملايين تعني إيراداً معترفاً به قدره ٨٬٦٩٥٬٦٥٢ لا عشرة.
  const rows = await Promise.all(contracts.map(async (c) => {
    const i = await get(`SELECT COALESCE(SUM(amount_halalas),0) gross,
         ${netSum('amount_halalas', 'net_amount_halalas')} net
       FROM invoice WHERE contract_id=? AND ${fi.clause} AND status!='DRAFT' AND deleted_at IS NULL`, [c.id, ...fi.params]);
    const invoiced = i.gross;
    const collected = (await get(`SELECT COALESCE(SUM(col.amount_halalas),0) v
      FROM collection col JOIN invoice i ON i.id=col.invoice_id
      WHERE i.contract_id=? AND ${fc.clause} AND i.deleted_at IS NULL AND i.status!='DRAFT'`, [c.id, ...fc.params])).v;
    const value = c.value_halalas || 0;
    const valueNet = c.net_value_halalas ?? splitGross(value).net_halalas;
    return { ...c, invoiced_halalas: invoiced, invoiced_net_halalas: i.net, collected_halalas: collected,
      net_value_halalas: valueNet, vat_halalas: value - valueNet,
      billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
      backlog_halalas: Math.max(0, c.value_halalas - invoiced),
      backlog_net_halalas: Math.max(0, valueNet - i.net),
      outstanding_halalas: Math.max(0, invoiced - collected) };
  }));
  // Reconciliation: invoices not tied to any contract must still appear, else the by-contract
  // total silently understates financeSummary.invoiced. Surface them as one explicit bucket.
  const un = await get(`SELECT COALESCE(SUM(amount_halalas),0) inv,
       ${netSum('amount_halalas', 'net_amount_halalas')} "invNet", COUNT(*) n FROM invoice
     WHERE ${fi.clause} AND contract_id IS NULL AND status!='DRAFT' AND deleted_at IS NULL`, fi.params);
  if (un.inv > 0) {
    const unCollected = (await get(`SELECT COALESCE(SUM(col.amount_halalas),0) v FROM collection col JOIN invoice i ON i.id=col.invoice_id
       WHERE i.contract_id IS NULL AND ${fc.clause} AND i.deleted_at IS NULL AND i.status!='DRAFT'`, fc.params)).v;
    rows.push({ id: null, code: '—', client_name: '—', project_name: 'فواتير غير مرتبطة بعقد', unassigned: true,
      value_halalas: 0, net_value_halalas: 0, vat_halalas: 0,
      invoiced_halalas: un.inv, invoiced_net_halalas: un.invNet, collected_halalas: unCollected,
      billed_pct: null, backlog_halalas: 0, backlog_net_halalas: 0,
      outstanding_halalas: Math.max(0, un.inv - unCollected) });
  }
  return rows;
}

// ── Per client ── contract value, invoiced, collected, outstanding (AR) grouped by client.
// كل الأرقام هنا **تراكمية منذ البداية** لا سنوية (قيمة العقد رصيدٌ لا تدفّق، ولا يحمل العقد سنة)،
// فالأساس واحد على الصف كله. الوسيط `year` باقٍ لتوافق المستدعين ولا يُستعمل عمداً — تسنينُ عمودٍ
// واحد دون البقية هو بالضبط الخلط الذي عولج في financeByPM أعلاه.
export async function financeByClient(user, year = FY()) {
  const f = scopeFilter(user, 'contract', 'read', { sectorCol: 'c.sector_id', ownerCol: 'p.owner_user_id' });
  const rows = await all(`SELECT cl.id, cl.name_ar,
      COUNT(DISTINCT c.id) contracts, COALESCE(SUM(c.value_halalas),0) value_halalas,
      ${netSum('c.value_halalas', 'c.net_value_halalas')} net_value_halalas
     FROM contract c JOIN client cl ON cl.id=c.client_id LEFT JOIN project p ON p.id=c.project_id
     WHERE ${f.clause} AND c.deleted_at IS NULL GROUP BY cl.id, cl.name_ar ORDER BY value_halalas DESC LIMIT 40`, f.params);
  // المفوتر والمحصَّل يُنسبان بقاعدة نسبة الفاتورة الواحدة (عميل الفاتورة ثم عميل مشروعها)، لا عبر
  // عميل العقد: المرور بالعقد كان يُسقط كل فاتورة بلا عقد وينسب فاتورةً إلى عميلٍ غير المكتوب عليها.
  // وداخل نطاق القارئ على الفواتير — وإلا قرأ مستخدمُ قطاعٍ فواتيرَ قطاعات أخرى لعميله.
  const fi = scopeFilter(user, 'invoice', 'read', { sectorCol: 'i.sector_id', ownerCol: 'i.owner_user_id' });
  const CID = INVOICE_CLIENT_COL('i', 'ip');
  const JOIN = INVOICE_CLIENT_JOIN('i', 'ip');
  const sumBy = async (sql, params) => new Map((await all(sql, params)).map((r) => [r.cid, r]));
  // إجمالي وصافٍ في استعلامٍ واحد لكل مصدر — لا استعلام ثانٍ للصافي، فالرقمان من نفس مجموعة
  // الصفوف بالضرورة ولا يمكن أن يفترقا لو تغيّر شرطٌ في أحدهما دون الآخر.
  const invoicedBy = await sumBy(`SELECT ${CID} cid, COALESCE(SUM(i.amount_halalas),0) v,
       ${netSum('i.amount_halalas', 'i.net_amount_halalas')} net FROM invoice i ${JOIN}
     WHERE ${fi.clause} AND i.deleted_at IS NULL AND i.status != 'DRAFT' AND ${CID} IS NOT NULL
     GROUP BY ${CID}`, fi.params);
  const collectedBy = await sumBy(`SELECT ${CID} cid, COALESCE(SUM(col.amount_halalas),0) v,
       ${netSum('col.amount_halalas', 'col.net_amount_halalas')} net
     FROM collection col JOIN invoice i ON i.id = col.invoice_id ${JOIN}
     WHERE ${fi.clause} AND i.deleted_at IS NULL AND ${CID} IS NOT NULL
     GROUP BY ${CID}`, fi.params);
  return rows.map((r) => {
    const inv = invoicedBy.get(r.id);
    const col = collectedBy.get(r.id);
    const invoiced = inv?.v || 0;
    const collected = col?.v || 0;
    return { ...r, vat_halalas: (r.value_halalas || 0) - (r.net_value_halalas || 0),
      invoiced_halalas: invoiced, invoiced_net_halalas: inv?.net || 0,
      collected_halalas: collected, collected_net_halalas: col?.net || 0,
      outstanding_halalas: Math.max(0, invoiced - collected) };
  }).filter((r) => r.value_halalas > 0 || r.invoiced_halalas > 0);
}

export async function contractDetail(user, contractId) {
  const c = await get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'read', 'contract', c)) throw forbidden();
  const client = await get('SELECT name_ar FROM client WHERE id=?', [c.client_id]);
  const project = await get('SELECT id, name_ar, owner_user_id, progress_pct FROM project WHERE id=?', [c.project_id]);
  const invoices = await Promise.all((await all("SELECT * FROM invoice WHERE contract_id=? AND deleted_at IS NULL ORDER BY issue_date, claim_no", [contractId]))
    .map(async (i) => {
      const net = i.net_amount_halalas ?? splitGross(i.amount_halalas || 0).net_halalas;
      return { ...i, net_amount_halalas: net, vat_halalas: (i.amount_halalas || 0) - net,
        outstanding_halalas: await outstanding(i) };
    }));
  const deliverables = project ? await all("SELECT * FROM deliverable WHERE project_id=? AND deleted_at IS NULL ORDER BY month", [project.id]) : [];
  const issued = invoices.filter((i) => i.status !== 'DRAFT');
  const invoiced = issued.reduce((a, i) => a + i.amount_halalas, 0);
  // صافي المفوتر من المخزَّن إن سُجِّل، وإلا بالقاعدة القياسية — نفس صيغة COALESCE في SQL، مكتوبةً
  // هنا في الشيفرة لأن الصفوف مقروءة أصلاً ولا داعي لاستعلامٍ ثانٍ عليها.
  const netOfRow = (r, gross, netCol) => (r[netCol] ?? splitGross(gross).net_halalas);
  const invoicedNet = issued.reduce((a, i) => a + netOfRow(i, i.amount_halalas, 'net_amount_halalas'), 0);
  const valueNet = c.net_value_halalas ?? splitGross(c.value_halalas || 0).net_halalas;
  return { contract: c, client: client?.name_ar, project, invoices, deliverables,
    // قيمة العقد ونسبة الفوترة والمتبقي: إجمالية (مطالبة). والصافي بجانبها لسؤال الإيراد.
    invoiced_halalas: invoiced, invoiced_net_halalas: invoicedNet,
    invoiced_vat_halalas: invoiced - invoicedNet,
    contract_net_value_halalas: valueNet, contract_vat_halalas: (c.value_halalas || 0) - valueNet,
    billed_pct: c.value_halalas ? Math.round((invoiced / c.value_halalas) * 100) : 0,
    backlog_halalas: Math.max(0, c.value_halalas - invoiced),
    backlog_net_halalas: Math.max(0, valueNet - invoicedNet) };
}

// ── Progress claim (مستخلص) — generate an invoice from delivered deliverables on a contract ──
// شرطان لا يسقطان مهما كان شكل الطلب: المخرَج **من مشروع هذا العقد**، وحالته تسمح بالمطالبة
// (مُسلَّم أو مقبول). كان تمرير معرّفات صريحة يُسقط الشرطين معاً في آنٍ واحد، فيخرج مستخلصُ عقدِ
// قطاعٍ حاملاً مخرَجَ مشروعِ قطاعٍ آخر. والأثر مضاعف ولا رجعة فيه عملياً:
//   • إيرادٌ يُنسب إلى قطاع وعميل ليسا صاحبَيه — وهو بالضبط الخلط الذي طُلب إنهاؤه في نسبة كل
//     رقم إلى عميله ومشروعه الصحيحين.
//   • والمخرَج الغريب يُختم «مفوتراً»، فيتخطاه فحص «سبق تفويتره» في عقده الحقيقي إلى الأبد،
//     ويخسر مشروعه إيراده بصمت.
// والرفض هنا **صريح لا صامت**: ما لا يصلح يُسمّى سببه ويُرَدّ الطلب كله. الإسقاط الصامت يترك
// صاحب الطلب يظن أنه طالب بما لم يُطالَب به — وهو أسوأ من المنع.
// ملاحظة على الصلاحية: الحارس هو العقد (`can(create invoice, c)`) + انتماء المخرَج إلى مشروعه.
// لا يُفحص منح «مخرَج» على الصف لأن المالية لا تملكه أصلاً، فاشتراطه يقطع إصدار المستخلصات كلها.
const CLAIMABLE_STATUSES = ['DELIVERED', 'ACCEPTED']; // مُسلَّم · مقبول

export async function createProgressClaim(ctx, { contractId, deliverableIds = [], periodLabel }) {
  const user = ctx.user;
  const c = await get('SELECT * FROM contract WHERE id = ? AND deleted_at IS NULL', [contractId]);
  if (!c) throw notFound('العقد غير موجود');
  if (!can(user, 'create', 'invoice', c)) throw forbidden('إصدار المستخلصات يتطلب صلاحية مالية/قيادة قطاع');
  if (!c.project_id) throw badRequest('هذا العقد غير مرتبط بمشروع، والمستخلص يُبنى على مخرجات مشروعه. اربط العقد بمشروعه أولاً.');
  const project = await get('SELECT * FROM project WHERE id=?', [c.project_id]);
  const ids = [...new Set((Array.isArray(deliverableIds) ? deliverableIds : []).filter(Boolean).map(String))];
  // المخرجات المفوترة سابقاً: استعلام مجمَّع واحد لمجموعة المعرّفات كلها، لا استعلام لكل صف.
  const billedAmong = async (rows) => {
    if (!rows.length) return new Set();
    const ph = rows.map(() => '?').join(',');
    return new Set((await all(`SELECT deliverable_id FROM invoice_line WHERE deliverable_id IN (${ph})`,
      rows.map((d) => d.id))).map((r) => r.deliverable_id));
  };
  let toClaim;
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const rows = await all(`SELECT * FROM deliverable WHERE id IN (${ph}) AND deleted_at IS NULL`, ids);
    const found = new Map(rows.map((d) => [d.id, d]));
    const mine = rows.filter((d) => d.project_id === c.project_id);
    const billed = await billedAmong(rows);
    const missing = ids.filter((i) => !found.has(i)).length;
    const foreign = rows.length - mine.length;
    // «سبق تفويتره» يسبق «لم يُسلَّم» — والمصدر سطورُ الفاتورة لا حالة المخرَج. الفوترة لم تعد
    // تكتب شيئاً على الحالة (ترحيلة ٠١٧)، فالحالة تقول ما فعله الفريق وسطرُ الفاتورة يقول ما
    // طُولب به، وكلٌّ يُقرأ من مصدره.
    const already = mine.filter((d) => billed.has(d.id));
    const notReady = mine.filter((d) => !billed.has(d.id) && !CLAIMABLE_STATUSES.includes(String(d.status)));
    const ready = mine.filter((d) => !billed.has(d.id) && CLAIMABLE_STATUSES.includes(String(d.status)));
    // أسباب الرفض تُجمع كلها ثم تُقال مرة واحدة، كي يصحّح المستخدم اختياره في محاولة واحدة.
    // المخرجات الغريبة تُعدّ ولا تُسمّى: تسميتها كشفٌ لعمل قطاع آخر لمن لا يقرؤه.
    const problems = [];
    if (missing) problems.push(`${missing} مخرَجاً غير موجود أو محذوف`);
    if (foreign) problems.push(`${foreign} مخرَجاً من مشروع آخر لا من مشروع هذا العقد`);
    if (notReady.length) problems.push(`مخرجات لم تُسلَّم بعد: ${notReady.map((d) => d.name_ar).join('، ')}`);
    if (already.length) problems.push(`مخرجات سبق تفويترها: ${already.map((d) => d.name_ar).join('، ')}`);
    if (problems.length) throw badRequest(`تعذّر إصدار المستخلص — ${problems.join(' · ')}. صحّح الاختيار وأعد المحاولة.`);
    toClaim = ready;
  } else {
    const rows = await all(`SELECT * FROM deliverable WHERE project_id = ? AND status IN ('DELIVERED','ACCEPTED')
       AND deleted_at IS NULL`, [c.project_id]);
    const billed = await billedAmong(rows);
    toClaim = rows.filter((d) => !billed.has(d.id)); // الاختيار التلقائي يتخطى المفوتر بلا إزعاج
  }
  if (!toClaim.length) throw badRequest('لا توجد مخرجات مؤهلة للمستخلص (مسلّمة وغير مفوترة)');
  // مبلغ المستخلص **إجمالي** كمبالغ المخرجات التي بُني منها (سعر المخرَج مع العميل يشمل الضريبة،
  // وهو ما يصير رقم الفاتورة). والفصل يُحسب على مجموع الفاتورة لا على كل مخرَج على حدة: جمعُ
  // صوافي المخرجات قد ينقص عن صافي المجموع بهللاتٍ بعدد المخرجات، فتخرج فاتورةٌ صافيها زائد
  // ضريبتها لا يساوي مبلغها. الفصل مرة واحدة على الرقم المعروض في المستند.
  const amount = toClaim.reduce((a, d) => a + (d.amount_halalas || 0), 0);
  const amountSplit = splitGross(amount);
  // cumulative claim number on this contract
  const claimCount = (await get('SELECT COUNT(*) n FROM invoice WHERE contract_id=? AND kind=\'progress_claim\'', [contractId])).n;
  const invId = id('inv'); const now = nowIso();
  // المُسلَّم تراكمياً: الحالة وحدها تكفي الآن. كانت القائمة تضمّ «مُفوتر» و«مدفوع» لأن الفوترة
  // كانت تمحو حالة التسليم فيلزم استرجاعها منها — وقد زال السبب بزوال المحو.
  const totalDelivered = (await get("SELECT COALESCE(SUM(amount_halalas),0) v FROM deliverable WHERE project_id=? AND status IN ('DELIVERED','ACCEPTED') AND deleted_at IS NULL", [c.project_id])).v;
  // فاتورةٌ + سطورُها + ختمُ الفوترة على كل مخرَج + التدقيق: كتابةٌ واحدة لا تتجزّأ. بلا معاملةٍ
  // كان عطبٌ في المنتصف يترك فاتورةً بسطورٍ ناقصة أو مخرجاتٍ مختومةً لفاتورةٍ لم تكتمل.
  await tx(async () => {
    await insert('invoice', {
      id: invId, code: `${c.code || 'INV'}-C${claimCount + 1}`, contract_id: contractId, project_id: c.project_id,
      client_id: c.client_id, sector_id: c.sector_id, amount_halalas: amount,
      net_amount_halalas: amountSplit.net_halalas, vat_halalas: amountSplit.vat_halalas,
      issue_date: now.slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), status: 'ISSUED',
      kind: 'progress_claim', claim_no: String(claimCount + 1), period_label: periodLabel || null,
      progress_pct: c.value_halalas ? Math.round((totalDelivered / c.value_halalas) * 100) : null,
      owner_user_id: project?.owner_user_id || null, created_at: now, created_by: user.id,
    });
    for (const d of toClaim) {
      await insert('invoice_line', { id: id('il'), invoice_id: invId, deliverable_id: d.id, label: d.name_ar, amount_halalas: d.amount_halalas || 0 });
      // ختمُ الفوترة **بجانب** الحالة لا فوقها. كان هذا السطر يكتب `status = 'INVOICED'` فيمحو
      // «تم الاعتماد»، فيصير المخرَج الذي اعتمده العميل مخرَجاً لا يُعرف أقُبل أم لا — والفوترة
      // تُقرأ إنجازاً. صرفُ المستخلص واقعةٌ مالية لا شهادةَ إنجاز، فلا تلمس عمل الفريق.
      await update('deliverable', d.id, { invoiced_at: now, updated_at: now });
    }
    await audit(ctx, { action: 'create', resource: 'invoice', resourceId: invId, sectorId: c.sector_id,
      detail: { kind: 'progress_claim', claim_no: claimCount + 1, deliverables: toClaim.length, amount } });
  });
  return await get('SELECT * FROM invoice WHERE id=?', [invId]);
}

export async function recordCollection(ctx, { invoiceId, amountSar, collectedAt, method }) {
  const user = ctx.user;
  const inv = await get('SELECT * FROM invoice WHERE id=? AND deleted_at IS NULL', [invoiceId]);
  if (!inv) throw notFound('الفاتورة غير موجودة');
  if (!can(user, 'update', 'invoice', inv) && !can(user, 'create', 'collection', inv)) throw forbidden();
  const amt = toHalalas(amountSar);
  if (!(amt > 0)) throw badRequest('مبلغ غير صالح');
  const out = await outstanding(inv);
  if (amt > out + 1) throw badRequest(`المبلغ يتجاوز المتبقي (${(out / 100).toLocaleString()} ر.س.)`);
  // المبلغ المُدخَل **إجمالي**: العميل يحوّل ما هو مكتوب على الفاتورة شاملاً الضريبة، ومقارنتُه
  // بالمتبقي أعلاه تجري بين إجماليَّين. ويُفصَل عند التسجيل كي تُطابق التحصيلاتُ الفواتيرَ على
  // الأساسين معاً — فيُعرف كم من النقد الداخل إيرادٌ للشركة وكم منه ضريبةٌ تُورَّد للدولة.
  const split = splitGross(amt);
  const newOut = out - amt;
  const settled = newOut <= 0;
  // التحصيل + قلبُ حالة الفاتورة + ختمُ التحصيل على مخرجاتها + التدقيق: كتابةٌ واحدة لا تتجزّأ.
  // بلا معاملةٍ كان عطبٌ في المنتصف يسجّل تحصيلاً بلا قلب الحالة (أو العكس) فيتناقض الرقمان.
  await tx(async () => {
    await insert('collection', { id: id('col'), invoice_id: invoiceId, amount_halalas: amt,
      net_amount_halalas: split.net_halalas, vat_halalas: split.vat_halalas,
      collected_at: collectedAt || nowIso().slice(0, 10), method: method || 'تحويل', created_at: nowIso() });
    await update('invoice', invoiceId, { status: settled ? 'PAID' : 'PARTIALLY_PAID' });
    // ختمُ التحصيل ينزل على مخرجات الفاتورة **حين تُسدَّد كاملة** لا مع أول دفعة: نسبة التحصيل
    // تُقاس بالمخرَج، ومخرَجٌ سُدِّد ثلثه ليس محصَّلاً. وهو ختم ثالث مستقل — لا يقول شيئاً عن
    // التسليم ولا عن الاعتماد، ولا يمسّ حالة المخرَج.
    if (settled) {
      await run(`UPDATE deliverable SET collected_at = ?, updated_at = ?
         WHERE collected_at IS NULL AND deleted_at IS NULL
           AND id IN (SELECT deliverable_id FROM invoice_line WHERE invoice_id = ? AND deliverable_id IS NOT NULL)`,
      [nowIso(), nowIso(), invoiceId]);
    }
    await audit(ctx, { action: 'update', resource: 'invoice', resourceId: invoiceId, sectorId: inv.sector_id, detail: { collected: amt, settled } });
  });
  return await get('SELECT * FROM invoice WHERE id=?', [invoiceId]);
}

// ═══ صورة المال على المشروع الواحد ═══════════════════════════════════════════════════════════
// «عشان يبين الكاش إن والكاش آوت والمصروفات والتسكين على المشروع ونسبتهم حسب الشهر» — حمولة
// واحدة تجيب هذا السؤال بأرقام مسجَّلة فقط. القواعد التي بُنيت عليها، وهي ما يجعلها قابلة للتصديق:
//
//   ① الداخل النقدي ≠ المفوتر ≠ الإيراد. المنصة تقرأ المال جسراً لا جمعاً (انظر `financeSummary`):
//      تعاقد ← إيراد محقق ← مفوتر ← محصَّل، وكل ضلع من جدوله. المحصَّل وحده «كاش إن».
//   ② الخارج النقدي = المصروف **المدفوع** وحده. المعتمد غير المدفوع التزامٌ لم يخرج بعد، فيظهر
//      بجانبه لا داخله — نفس تمييز «المفوتر» عن «المحصَّل» مقلوباً.
//   ③ **الغياب ليس صفراً**: ما لم يُسجَّل يعود بلا رقم (`recorded: false` والمبلغ فارغ) كي تقول
//      الشاشة «لا مصروفات مسجّلة» لا «٠ ريال». والصفر داخل شريط شهري لمشروع له تسجيل صفرٌ حقيقي.
//   ④ لا رقم مُختَلق: لا توزيع ولا تقدير ولا كلفة «مفترضة». ما لا مصدر له يُقال إنه غير مسجَّل.
//   ⑤ الصلاحية تُفحص هنا لا في الشاشة: صف المشروع أولاً، ثم منح كل مصدر على حدة. من لا يرى
//      الكلفة يبقى يرى الداخل النقدي ونسب التسكين — الحجب على الحقل لا على الصفحة.
const pickYear = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : FY();
};
const sumOf = (rows) => rows.reduce((a, r) => a + (Number(r.amount_halalas) || 0), 0);
const countOf = (rows) => rows.reduce((a, r) => a + (Number(r.count) || 0), 0);
// مبلغ لا يراه من لا يملك بوابة الكلفة: يعود فارغاً لا صفراً — الفراغ يُقرأ «مقيَّد»، والصفر كذب.
const gated = (visible, value) => (visible ? value : null);

export async function projectMoney(user, projectId, opts = {}) {
  const p = await readableProject(user, projectId);      // حارس الصف: مشروع خارج النطاق يُرَدّ هنا
  const year = pickYear(opts.year);
  const months = monthAxis(year);

  // بوابات القراءة — كلٌّ على مورده، على صف المشروع نفسه (قطاعه ومالكه ومعرّفه).
  const target = { sector_id: p.sector_id, project_id: p.id, owner_user_id: p.owner_user_id };
  const seesBilling = can(user, 'read', 'invoice', target);     // الفواتير والتحصيل
  const seesRevenue = can(user, 'read', 'revenue_line', target); // الإيراد المحقق
  const seesExpense = canReadExpenses(user, p);                  // سجل المصروفات
  const seesCost = canSeeSensitive(user, 'cost');                // مبالغ الكلفة والمصروفات
  const seesPurchases = can(user, 'read', 'purchase_order', target);

  // قراءات مجمَّعة، كلٌّ استعلام واحد، ولا يُقرأ ما لا يراه القارئ أصلاً.
  const [collections, collectionList, invStatuses, invMonthly, revenue,
    expenseRows, expenseList, expenseTypes, costRows, allocations, poRows] = await Promise.all([
    seesBilling ? collectionsByMonth(p.id) : null,
    seesBilling ? collectionRows(p.id) : null,
    seesBilling ? invoicesByStatus(p.id) : null,
    seesBilling ? invoicedByMonth(p.id) : null,
    seesRevenue ? revenueByMonth(p.id) : null,
    seesExpense ? expenseAggregate(p.id) : null,
    seesExpense ? expenseRowsFor(p.id) : null,
    seesExpense ? expenseTypeSuggestions(p.id, p.sector_id) : null,
    seesCost ? costLineAggregate(p.id) : null,
    projectAllocations(p.id),
    seesPurchases ? purchaseOrderRows(p.id) : null,
  ]);

  const noRight = (what) => `${what} خارج صلاحيات دورك. اطلب من مدير النظام إضافتها إن كان عملك يحتاجها.`;

  // ── الجسر المالي على المشروع: مراحل متتابعة لا تُجمع ──
  const issuedInv = invStatuses ? invStatuses.filter((r) => r.status !== 'DRAFT') : [];
  const invoiced = sumOf(issuedInv);
  const invoicedNet = issuedInv.reduce((a, r) => a + (r.net_halalas || 0), 0);
  const retention = issuedInv.reduce((a, r) => a + r.retention_halalas, 0);
  const draftInvoiced = invStatuses ? sumOf(invStatuses.filter((r) => r.status === 'DRAFT')) : 0;
  const anyInvoice = !!invStatuses && invStatuses.length > 0;
  const collectedAll = collections ? collections.total_halalas : 0;
  // قيمة التعاقد على صف المشروع خانة لقطة مخزَّنة (لا عمود صافٍ لها بقرار ٠١٩: الأعمدة المشتقّة
  // لا تُجمَّد مرتين)، فصافيها يُشتقّ هنا وقت القراءة بالقاعدة الواحدة.
  const contractGross = p.contract_value_halalas > 0 ? p.contract_value_halalas : null;
  const bridge = {
    permitted: seesBilling,
    reason_ar: seesBilling ? null : noRight('أرقام الفوترة والتحصيل'),
    // قيمة التعاقد وأمر شراء العميل من صف المشروع؛ الصفر فيهما يعني «غير مسجَّل» لا «بلا قيمة».
    contract_halalas: contractGross,
    contract_net_halalas: contractGross == null ? null : splitGross(contractGross).net_halalas,
    contract_vat_halalas: contractGross == null ? null : splitGross(contractGross).vat_halalas,
    client_po_halalas: p.po_value_halalas > 0 ? p.po_value_halalas : null,
    // الإيراد المحقق **صافياً** — هو الضلع الوحيد في هذا الجسر الذي يعني «مالُ الشركة»، وبقيةُ
    // الأضلاع مطالبةٌ ونقدٌ متحرّك مع العميل فتبقى إجمالية. ويرافقه إجماليه كي يظهر الفارق
    // مفسَّراً بدل أن يُقرأ تناقضاً بين ضلعين متجاورين.
    revenue: seesRevenue
      ? { permitted: true, recorded: !!revenue?.any,
        total_halalas: revenue?.any ? revenue.net_total_halalas : null,
        gross_total_halalas: revenue?.any ? revenue.total_halalas : null,
        vat_total_halalas: revenue?.any ? revenue.vat_total_halalas : null,
        in_year_halalas: revenue?.any ? yearTrack(revenue, year).net_total_halalas : null }
      : { permitted: false, reason_ar: noRight('الإيراد المحقق'), recorded: null, total_halalas: null,
        gross_total_halalas: null, vat_total_halalas: null, in_year_halalas: null },
    invoiced_halalas: seesBilling && anyInvoice ? invoiced : null,
    invoiced_net_halalas: seesBilling && anyInvoice ? invoicedNet : null,
    invoiced_vat_halalas: seesBilling && anyInvoice ? invoiced - invoicedNet : null,
    draft_invoiced_halalas: seesBilling && draftInvoiced > 0 ? draftInvoiced : null,
    retention_halalas: seesBilling && retention > 0 ? retention : null,
    collected_halalas: seesBilling && collections?.any ? collectedAll : null,
    collected_net_halalas: seesBilling && collections?.any ? collections.net_total_halalas : null,
    collected_vat_halalas: seesBilling && collections?.any ? collections.vat_total_halalas : null,
    // المستحق إجمالي: هو ما يبقى على العميل، والعميل مدينٌ بالضريبة كما هو مدينٌ بالأصل.
    outstanding_halalas: seesBilling && anyInvoice ? Math.max(0, invoiced - retention - collectedAll) : null,
    by_status: seesBilling ? (invStatuses || []).map((r) => ({ status: r.status, count: r.count,
      amount_halalas: r.amount_halalas, net_amount_halalas: r.net_halalas,
      vat_halalas: r.amount_halalas - r.net_halalas })) : [],
    // المفوتر شهرياً بجوار المحصَّل شهرياً — أوضح موضع يظهر فيه أن الرقمين ليسا رقماً واحداً.
    invoiced_monthly: seesBilling && invMonthly?.any ? yearTrack(invMonthly, year).months : null,
    note_ar: 'أضلاع متتابعة لا تُجمع: قيمة التعاقد ثم الإيراد المحقق ثم المفوتر ثم المحصَّل. المحصَّل وحده نقدٌ دخل فعلاً.',
    vat_note_ar: 'الإيراد المحقق بلا ضريبة القيمة المضافة — وهو ما يخصّ الشركة. أما قيمة التعاقد والمفوتر والمحصَّل والمستحق فمع الضريبة، لأنها ما يُطالَب به العميل ويدفعه، والضريبة تُورَّد للدولة.',
  };

  // ── ① الداخل النقدي: التحصيلات وحدها ──
  const cashInTrack = collections ? yearTrack(collections, year) : null;
  const cashIn = {
    permitted: seesBilling,
    reason_ar: seesBilling ? null : noRight('حركة التحصيل على المشروع'),
    recorded: seesBilling ? collections.any : null,
    count: seesBilling ? collections.count : null,
    // الداخل النقدي **إجمالي**: ما دخل الحساب فعلاً بما فيه الضريبة. ويُذكر صافيه بجانبه لأن
    // جزءاً منه أمانةٌ تُورَّد للدولة ولا يُنفق — وهذا فرقٌ يخصّ السيولة لا المحاسبة وحدها.
    total_halalas: seesBilling && collections.any ? collections.total_halalas : null,
    net_total_halalas: seesBilling && collections.any ? collections.net_total_halalas : null,
    vat_total_halalas: seesBilling && collections.any ? collections.vat_total_halalas : null,
    in_year_halalas: seesBilling && collections.any ? cashInTrack.total_halalas : null,
    in_year_net_halalas: seesBilling && collections.any ? cashInTrack.net_total_halalas : null,
    in_year_count: seesBilling && collections.any ? cashInTrack.count : null,
    monthly: seesBilling && collections.any ? cashInTrack.months : null,
    undated: seesBilling && collections.undated.count > 0 ? collections.undated : null,
    other_years: seesBilling ? collections.years.filter((y) => y !== year) : [],
    rows: seesBilling ? (collectionList || []).map((c) => ({
      id: c.id, date: c.collected_at || null, amount_halalas: c.amount_halalas,
      net_amount_halalas: c.net_amount_halalas ?? null,
      vat_halalas: c.net_amount_halalas == null ? null : c.amount_halalas - c.net_amount_halalas,
      method: c.method || null, invoice_id: c.invoice_id, invoice_code: c.invoice_code || null,
    })) : [],
    note_ar: 'الداخل النقدي = ما حُصِّل فعلاً على فواتير المشروع. ليس المفوتر ولا الإيراد المحقق.',
    vat_note_ar: 'المبلغ مع ضريبة القيمة المضافة كما دفعه العميل. الصافي هو ما يخصّ الشركة منه.',
  };

  // ── ② الخارج النقدي: المصروف المدفوع وحده، والملتزَم به بجانبه ──
  const exp = expenseRows || [];
  const anyExpense = exp.length > 0;
  const byStatus = (list) => summarizeKeyed(exp.filter((r) => list.includes(r.status)));
  const paid = byStatus(['PAID']);
  const committed = byStatus(['APPROVED']);
  const requested = byStatus(['DRAFT', 'SUBMITTED']);
  const rejected = byStatus(['REJECTED']);
  const paidTrack = yearTrack(paid, year);
  // ── ضريبة المصروف: مقروءةٌ من المسجَّل وحده، ولا تُفترض ──────────────────────────────────
  // الخارج النقدي إجمالي دائماً: ما خرج من الحساب خرج بالضريبة. أما **كلفة** المشروع فهي الصافي
  // متى كانت ضريبة المورّد مستردّة — وهذا لا يُعرف إلا ممّن سجّل المصروف، فلا يُشتقّ هنا بخمسة
  // عشر بالمئة (تبرير الترحيلة ٠١٩: الجدول يخلط مستردّات الموظفين والرسوم المعفاة بالخاضع).
  // فما لم يُسجَّل يخرج فارغاً ليُقال «غير مُسجَّل»، لا صفراً ولا رقماً مفترضاً.
  const vatOfExpenses = (rows) => {
    const netRows = rows.reduce((a, r) => a + (r.net_rows || 0), 0);
    const allRows = rows.reduce((a, r) => a + (r.count || 0), 0);
    if (!netRows) return { recorded: false, partial: false, rows_with_vat: 0, rows_total: allRows,
      net_halalas: null, vat_halalas: null };
    const gross = rows.reduce((a, r) => a + (r.amount_halalas || 0), 0);
    const net = rows.reduce((a, r) => a + (r.net_recorded_halalas || 0), 0);
    // الضريبة لا تُذكر إلا حين تكون مسجَّلة على **كل** الصفوف: طرحُ صافي بعضها من إجمالي كلها
    // يخرج برقمٍ يبدو ضريبةً وليس ضريبة. والتسجيل الجزئي يُقال جزئياً ولا يُكمَّل بافتراض.
    const complete = netRows === allRows;
    return { recorded: true, partial: !complete, rows_with_vat: netRows, rows_total: allRows,
      net_halalas: complete ? net : null, vat_halalas: complete ? gross - net : null };
  };
  const paidVat = vatOfExpenses(exp.filter((r) => r.status === 'PAID'));
  const cashOut = {
    permitted: seesExpense,
    reason_ar: seesExpense ? null : noRight('مصروفات المشروع'),
    amounts_visible: seesExpense ? seesCost : null,
    amounts_reason_ar: seesExpense && !seesCost ? 'مبالغ المصروفات محجوبة عن دورك — يظهر العدد والتوقيت بلا مبالغ.' : null,
    recorded: seesExpense ? anyExpense : null,
    paid: seesExpense ? { count: paid.count, total_halalas: gated(seesCost, paid.any ? paid.total_halalas : null),
      in_year_halalas: gated(seesCost, paid.any ? paidTrack.total_halalas : null), in_year_count: paidTrack.count,
      monthly: paid.any ? paidTrack.months.map((m) => ({ ...m, amount_halalas: gated(seesCost, m.amount_halalas) })) : null,
      undated: paid.undated.count > 0 ? { count: paid.undated.count, amount_halalas: gated(seesCost, paid.undated.amount_halalas) } : null }
      : null,
    committed: seesExpense ? { count: committed.count, total_halalas: gated(seesCost, committed.any ? committed.total_halalas : null) } : null,
    requested: seesExpense ? { count: requested.count, total_halalas: gated(seesCost, requested.any ? requested.total_halalas : null) } : null,
    rejected: seesExpense ? { count: rejected.count } : null,
    other_years: seesExpense ? paid.years.filter((y) => y !== year) : [],
    // الضريبة على المدفوع: مسجَّلة أو غير مسجَّلة، ولا ثالث. الغياب هنا ليس صفراً.
    vat: seesExpense && seesCost ? paidVat : null,
    vat_note_ar: 'المبلغ المدفوع مع الضريبة كما خرج من الحساب. ضريبة المورّد تُسترد فلا تُحسب كلفة على المشروع — وتُعرض هنا حين تُسجَّل مع المصروف، وما لم يُسجَّل يُقال غير مُسجَّل.',
    note_ar: 'الخارج النقدي = المصروف المدفوع فعلاً. المعتمد غير المدفوع التزام لم يخرج بعد، والمطلوب لم يُعتمد أصلاً.',
    sources_ar: 'المصدر الوحيد المسجَّل للخارج النقدي اليوم هو مصروفات المشروع. الرواتب والمشتريات لا تُصرف من هذه الشاشة.',
  };

  // ── ③ المصروفات: القائمة، والتجميع حسب الوصف، وإمكانية الإضافة ──
  const typeMap = new Map();
  for (const r of exp) {
    const key = r.type || '—';
    const cur = typeMap.get(key) || { type: r.type, count: 0, total_halalas: 0, keys: new Set(), statuses: new Set() };
    cur.count += r.count; cur.total_halalas += r.amount_halalas;
    if (r.key) cur.keys.add(r.key);
    cur.statuses.add(r.status);
    typeMap.set(key, cur);
  }
  const byType = [...typeMap.values()]
    .map((t) => {
      const keys = [...t.keys].sort();
      return { type: t.type, count: t.count, total_halalas: gated(seesCost, t.total_halalas),
        months: keys.length, first_month: keys[0] || null, last_month: keys[keys.length - 1] || null,
        statuses: [...t.statuses].map((s) => ({ status: s, status_ar: EXPENSE_STATUS_AR[s] || s })) };
    })
    .sort((a, b) => (b.total_halalas || 0) - (a.total_halalas || 0) || b.count - a.count);
  const expenses = {
    permitted: seesExpense,
    reason_ar: seesExpense ? null : noRight('سجل مصروفات المشروع'),
    amounts_visible: seesExpense ? seesCost : null,
    recorded: seesExpense ? anyExpense : null,
    count: seesExpense ? countOf(exp) : null,
    rows: seesExpense ? presentExpenses(user, expenseList || []) : [],
    by_type: seesExpense ? byType : [],
    type_suggestions: seesExpense ? (expenseTypes || []) : [],
    undated_count: seesExpense ? countOf(exp.filter((r) => !r.key)) : null,
    can_add: canAddExpense(user, p),
    can_approve: canApproveExpense(user, p),
    empty_ar: 'لا مصروفات مسجّلة على هذا المشروع. الغياب هنا يعني أن شيئاً لم يُسجَّل بعد، لا أن المصروف صفر.',
    note_ar: 'المصروف يُسجَّل بوصفه وشهره وسنته، ويمرّ بالاعتماد قبل أن يُحسب خارجاً نقدياً.',
  };

  // ── ④ التسكين شهرياً بالنسب ──
  const forYear = allocations.filter((a) => Number(a.year) === year);
  const peopleMap = new Map();
  for (const a of forYear) {
    const key = a.employee_id || a.person_name_ar || a.id;
    const cur = peopleMap.get(key) || {
      employee_id: a.employee_id || null,
      name: a.employee_name || a.person_name_ar || 'غير محدد',
      job_title: a.job_title || null, types: new Set(), fractions: Array(12).fill(0), allocation_ids: [],
    };
    const fr = monthlyFractions(a.monthly_json);
    for (let i = 0; i < 12; i++) cur.fractions[i] += fr[i];
    if (a.type) cur.types.add(a.type);
    cur.allocation_ids.push(a.id);
    peopleMap.set(key, cur);
  }
  const people = [...peopleMap.values()].map((e) => {
    const monthly = e.fractions.map((f) => Math.round(f * 100));
    const staffed = monthly.filter((m) => m > 0);
    return {
      employee_id: e.employee_id, name: e.name, job_title: e.job_title,
      types: [...e.types], allocation_ids: e.allocation_ids,
      monthly, // نسبة مئوية لكل شهر من أشهر السنة الاثني عشر
      months_staffed: staffed.length,
      peak_pct: monthly.length ? Math.max(...monthly) : 0,
      average_pct: staffed.length ? Math.round(staffed.reduce((a, b) => a + b, 0) / staffed.length) : 0,
      year_share_pct: Math.round(monthly.reduce((a, b) => a + b, 0) / 12),
    };
  }).sort((a, b) => b.year_share_pct - a.year_share_pct || String(a.name).localeCompare(String(b.name), 'ar'));
  const totalPct = Array.from({ length: 12 }, (_, i) => people.reduce((a, e) => a + e.monthly[i], 0));
  const allocYears = [...new Set(allocations.map((a) => Number(a.year)).filter(Number.isInteger))].sort((a, b) => a - b);
  const staffing = {
    recorded: forYear.length > 0,
    people_count: people.length,
    people: forYear.length ? people : [],
    monthly_total_pct: forYear.length ? totalPct : null,
    other_years: allocYears.filter((y) => y !== year),
    undated_count: allocations.filter((a) => !Number.isInteger(Number(a.year))).length,
    empty_ar: 'لا تسكين مسجّل على هذا المشروع في هذه السنة.',
    // الكلفة لكل شخص: لا مصدر لها في المنصة. اشتقاقها من الراتب × النسبة تقديرٌ لا قياس، وهو
    // أيضاً كشفٌ للراتب من الباب الخلفي — والراتب مختوم لمدير النظام وحده بقرار المالك.
    cost: {
      available: false,
      reason_ar: 'كلفة التسكين لكل شخص غير مسجّلة، ولا تُحسب من الراتب × النسبة: ذلك تقدير لا قياس، وفيه كشف للراتب. تظهر النسب هنا، والكلفة المسجّلة على المشروع في «الكلفة المسجّلة».',
    },
    note_ar: 'النسبة الشهرية = حصة الشخص من شهر عمل كامل على هذا المشروع، كما سُجِّلت في تسكينه.',
    total_note_ar: 'المجموع الشهري حاصل جمع نِسَب المسكَّنين، فقد يتجاوز 100% — مثلاً 1200% تعني اثني عشر شخصاً بدوام كامل في ذلك الشهر.',
  };

  // ── الكلفة المسجَّلة على المشروع (بنود الكلفة) — اعترافٌ بكلفة لا حركة صرف ──
  const costSummary = costRows ? summarizeKeyed(costRows) : null;
  const costTrack = costSummary ? yearTrack(costSummary, year) : null;
  const costByType = costRows ? [...costRows.reduce((m, r) => {
    const k = r.type || '—';
    m.set(k, { type: r.type, total_halalas: (m.get(k)?.total_halalas || 0) + r.amount_halalas, count: (m.get(k)?.count || 0) + r.count });
    return m;
  }, new Map()).values()].sort((a, b) => b.total_halalas - a.total_halalas) : [];
  const cost = {
    permitted: seesCost,
    reason_ar: seesCost ? null : noRight('الكلفة المسجّلة على المشروع'),
    recorded: seesCost ? !!costSummary?.any : null,
    total_halalas: seesCost && costSummary?.any ? costSummary.total_halalas : null,
    in_year_halalas: seesCost && costSummary?.any ? costTrack.total_halalas : null,
    monthly: seesCost && costSummary?.any ? costTrack.months : null,
    by_type: seesCost ? costByType : [],
    // «المصروف الفعلي» على صف المشروع خانة مستقلة عن بنود الكلفة، وتُقرأ كما هي بلا جمعها إليها.
    project_actual_spend_halalas: seesCost && p.actual_spend_halalas > 0 ? p.actual_spend_halalas : null,
    empty_ar: 'لا بنود كلفة مسجّلة على هذا المشروع.',
    note_ar: 'بند الكلفة اعترافٌ بكلفة (رواتب أو تعاقد باطني أو غيرها)، وليس بالضرورة نقداً خرج — لذلك لا يُجمع إلى الخارج النقدي.',
  };

  // ── ⑤ الموردون: يُقرأ ما هو مسجَّل، ويُقال صراحةً إن لا مسار لتسجيله ──
  const poVisible = seesPurchases && seesCost;
  const suppliers = {
    status: 'no_write_path',
    permitted: seesPurchases,
    reason_ar: seesPurchases ? null : noRight('مشتريات المشروع من الموردين'),
    recorded: seesPurchases ? (poRows || []).length > 0 : null,
    count: seesPurchases ? (poRows || []).length : null,
    rows: seesPurchases ? (poRows || []).map((r) => ({
      id: r.id, code: r.code || null, supplier_name: r.supplier_name || null,
      // ما دُفع للمورّد إجمالي، وكلفتُه الحقيقية صافيه: ضريبة المورّد مدخلٌ قابل للاسترداد
      // فليست كلفةً على المشروع. الرقمان معاً كي لا يُقرأ أحدهما مكان الآخر.
      amount_halalas: gated(poVisible, r.amount_halalas),
      net_amount_halalas: gated(poVisible, r.net_amount_halalas),
      vat_halalas: gated(poVisible, (r.amount_halalas || 0) - (r.net_amount_halalas || 0)),
      status: r.status || null,
      created_at: r.created_at || null,
    })) : [],
    total_halalas: gated(poVisible, (poRows || []).reduce((a, r) => a + (r.amount_halalas || 0), 0) || null),
    net_total_halalas: gated(poVisible, (poRows || []).reduce((a, r) => a + (r.net_amount_halalas || 0), 0) || null),
    empty_ar: 'لا مشتريات موردين مسجّلة على هذا المشروع.',
    note_ar: 'لا يوجد في المنصة اليوم مسار لتسجيل مشتريات المشروع من الموردين، فما لا يظهر هنا قد يكون مصروفاً فعلاً وسُجِّل خارج المنصة. غيابه ليس صفراً.',
    needs_ar: ['ربط المشترى بالمورد وبالمشروع', 'المبلغ وتاريخ الاستحقاق وتاريخ الصرف',
      'حالة الصرف حتى يدخل الخارج النقدي', 'مرجع أمر الشراء أو العقد مع المورد'],
    workaround_ar: 'حتى يُبنى المسار: يُسجَّل ما دُفع لمورد مصروفاً على المشروع باسم المورد في وصفه، فيدخل الخارج النقدي.',
  };

  // ── الاشتراكات: لا سجل لها أصلاً — يُقال ذلك، ولا يُخترع رقم ولا مفهوم ──
  const subscriptions = {
    status: 'not_tracked',
    total_halalas: null,
    rows: [],
    note_ar: 'الاشتراكات المتكررة ليس لها سجل في المنصة اليوم، فلا رقم يُعرض هنا — وغيابه لا يعني أن المشروع بلا اشتراكات.',
    needs_ar: ['اسم الاشتراك ومزوّده', 'المبلغ ودورة التجديد: شهرية أو سنوية', 'تاريخ البدء وتاريخ التجديد القادم',
      'الجهة التي يُحمَّل عليها: مشروع أو قطاع أو الشركة', 'حالة الإيقاف والتجديد التلقائي'],
    workaround_ar: 'حتى يُبنى السجل: يُسجَّل الاشتراك مصروفاً بالوصف نفسه كل شهر، فيظهر في «مصروفات تتكرر» أدناه ويدخل الخارج النقدي عند صرفه.',
  };

  // ── مصروفات تتكرر: وصفٌ لما تكرر فعلاً في المسجَّل، لا استنتاج «اشتراك» ──
  const recurringRows = byType.filter((t) => t.months >= 2);
  const recurring = {
    basis: 'expenses',
    permitted: seesExpense,
    recorded: seesExpense ? recurringRows.length > 0 : null,
    rows: seesExpense ? recurringRows : [],
    empty_ar: 'لا مصروف تكرر على أكثر من شهر واحد في المسجَّل.',
    note_ar: 'هذه أوصاف مصروفات تكررت في أكثر من شهر كما سُجِّلت — وصفٌ للمسجَّل لا سجل اشتراكات.',
  };

  // ── ما ينقص الصورة: يُقال صراحةً بدل أن يُقرأ صفراً ──
  const gaps = [];
  if (seesExpense && !anyExpense) gaps.push({ key: 'expenses', title_ar: 'لا مصروفات مسجّلة على هذا المشروع',
    detail_ar: 'الخارج النقدي غير معروف — لا لأنه صفر، بل لأن شيئاً لم يُسجَّل بعد.' });
  if (seesBilling && !collections.any) gaps.push({ key: 'cash_in', title_ar: 'لا تحصيلات مسجّلة على هذا المشروع',
    detail_ar: 'إن كان العميل قد دفع فعلاً فالتحصيل لم يُسجَّل بعد على فواتير المشروع.' });
  if (!forYear.length) gaps.push({ key: 'staffing', title_ar: `لا تسكين مسجّل في سنة ${year}`,
    detail_ar: allocYears.length ? `للمشروع تسكين مسجّل في: ${allocYears.join('، ')}.` : 'لا تسكين مسجّل على هذا المشروع في أي سنة.' });
  if (seesExpense && countOf(exp.filter((r) => !r.key)) > 0) gaps.push({ key: 'undated_expenses',
    title_ar: 'مصروفات بلا شهر مسجَّل', detail_ar: 'لا يمكن وضعها على الصورة الشهرية حتى يُسجَّل شهر صرفها.' });
  if (seesBilling && collections.undated.count > 0) gaps.push({ key: 'undated_collections',
    title_ar: 'تحصيلات بلا تاريخ مسجَّل', detail_ar: 'محسوبة في المجموع الكلي وخارج الشريط الشهري حتى يُسجَّل تاريخها.' });
  gaps.push({ key: 'subscriptions', title_ar: 'الاشتراكات المتكررة غير مسجّلة في المنصة',
    detail_ar: subscriptions.workaround_ar });
  if (!(poRows || []).length) gaps.push({ key: 'suppliers', title_ar: 'مشتريات الموردين لا تُسجَّل في المنصة بعد',
    detail_ar: suppliers.workaround_ar });

  return {
    project: { id: p.id, code: p.code || null, name_ar: p.name_ar, sector_id: p.sector_id,
      client_id: p.client_id || null, status: p.status, start_date: p.start_date || null,
      end_date: p.end_date || null, progress_pct: p.progress_pct ?? null },
    year, months,
    bridge, cashIn, cashOut, expenses, staffing, cost, suppliers, subscriptions, recurring, gaps,
  };
}
