#!/usr/bin/env node
// «صفوف الملء المسبق» — يقرأ ما هو مسجَّل اليوم على المنصة لقطاعٍ واحد، ويكتبه بالشكل الذي
// يبتلعه مولّد دفتر البيانات (scripts/make-sap-intake-workbook.mjs --prefill) فيصل الفريقَ دفترٌ
// معبأ بحقيقته الحالية بدل ورقة بيضاء.
//
//   node --experimental-sqlite scripts/export-sector-intake.mjs --sector=CONSULTING --out=صفوف.json
//   SANAD_DB=<ملف.db> node --experimental-sqlite scripts/export-sector-intake.mjs --sector=... --out=...
//   … --with-costs   ← يضيف ورقة «التكاليف»
//
// ⚠ سرّية: ‏--with-costs يكتب تكاليف المشاريع في الملف. الملف الناتج (ودفترُه المعبأ) يُسلَّم إلى
// قائد القطاع وحده — لا يُعمَّم على فريق التعبئة ولا يُرسَل في مجموعة. وبدون هذا الخيار لا تُقرأ
// أي تكلفة أصلاً.
//
// قراءةٌ محضة: لا كتابة واحدة إلى القاعدة، ولا استدعاء خدمة، ولا سائق قاعدة مباشر — كل شيء عبر
// `src/core/db/index.js` بمعاملات `?` وحدها، فيعمل الملف نفسه على SQLite وعلى Postgres حين يُضبط
// DATABASE_URL (لا strftime ولا تجميع بلا GROUP BY كامل — والتجميعات كلها استعلاماتٌ مرتبطة
// تُرجع صفاً واحداً، فلا GROUP BY في الملف كله).
//
// المخرَج: { "clients": [[خانة, …], …], "opportunities": […], "oppteam": […], "projects": […],
//            "deliverables": […], "employees": […], "employeetargets": […],
//            "staffing": […], "costlines": […] }
// وترتيب الخانات في كل صف = ترتيب أعمدة الورقة في المولّد حرفاً بحرف — تُقرأ المواصفة منه
// مباشرةً (import) كي لا يفترق الملفان أبداً.
//
// ── المال يُكتب صافياً ────────────────────────────────────────────────────────────────────────
// المخزَّن في المنصة **إجمالي** (شاملُ الضريبة) بنص القاعدة في migrations/019_vat_split.sql،
// وعمود الدفتر اسمه «بدون ضريبة» — فيُقسَم على 1.15 ويُقرَّب إلى هللتين. وخانة «مع الضريبة»
// تُترك فارغةً هنا عمداً: المولّد يكتب فيها صيغةً محسوبة =ROUND(س×1.15،2)، فلو كُتب فيها رقمٌ
// من هنا لضاع تحت الصيغة أو تناقض معها. والعمود الذي لا يقول «بدون ضريبة» (الميزانية، أمر
// الشراء، التكلفة) يُكتب كما هو مخزَّن — التكلفة صافيةٌ بطبيعتها، والباقي مطالبةٌ إجمالية.
//
// وإلى جانبه ملخّص عربي «<الملف>.summary.txt»: كم صفاً في كل ورقة، وكم صفاً ينقصه عمود إلزامي.
import { writeFileSync } from 'node:fs';
import { all, close } from '../src/core/db/index.js';
import { toSar } from '../src/core/util/ids.js';
import { enumLabel, normalizeText } from '../src/modules/io/parse.js';
import projectsAdapter from '../src/modules/io/adapters/projects.js';
import { roleLabelOf } from '../src/modules/io/adapters/staffing.js';
import { TEAM_ROLE_LABELS } from '../src/modules/crm/oppteam.js';
import {
  workBucketLabel, DELIVERABLE_STATUS_AR, ENGAGEMENT_TYPE_AR, SOLICITATION_TYPE_AR,
} from '../src/web/i18n/glossary.js';
import { SHEETS, sheetKey, setWithCosts, isRequired, isCalc, isHelper } from './make-sap-intake-workbook.mjs';

// حالة المشروع ومؤشر صحته: التسميات العربية تُقرأ من محوّل المشاريع نفسه لا تُكتب هنا ثانيةً،
// فما نكتبه في الدفتر هو حرفياً ما سيقبله المحوّل حين يعود الدفتر.
const enumOf = (key) => projectsAdapter.columns.find((c) => c.key === key).enum;
const STATUS_LABEL = (v) => (v ? enumLabel(enumOf('status'), v) : '');
const RAG_LABEL = (v) => (v ? enumLabel(enumOf('rag'), v) : '');


const VAT_RATE = 1.15;              // النسبة نفسها المكتوبة في صيغة المولّد
const money = (halalas) => {
  const sar = toSar(halalas);
  return sar ? Math.round(sar * 100) / 100 : '';
};
// المبلغ الصافي من المخزَّن الإجمالي — لعمود «… بدون ضريبة» وحده
const netMoney = (halalas) => {
  const sar = toSar(halalas);
  return sar ? Math.round((sar / VAT_RATE) * 100) / 100 : '';
};
const txt = (v) => (v == null ? '' : String(v));
const day = (v) => txt(v).slice(0, 10);   // التواريخ نصوصٌ بصيغة 2026-01-31 كما يقرؤها المحوّل
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v));
const pct = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Math.round(Number(v)));
const YES = 'نعم'; const NO = 'لا';
// الاسم لا المعرّف: كل شخصٍ في الدفتر يُكتب باسمه العربي، وإلا فباسم دخوله — لا معرّف واحد يصل
// الفريق، ولا يُطلب منه أن يعرفه.
const personName = (nameAr, username) => txt(nameAr || username);

// ── التسكين: من المخطط الشهري إلى (من شهر / إلى شهر / الإشغال) ────────────────
// الدفتر لا يحمل اثني عشر عموداً للأشهر، بل مدى ونسبة — فيُقرأ المخطط ويُختزل إلى مداه.
// والمخطط غير المنتظم (نسب مختلفة بين شهر وشهر) يُذكر في الملخّص كي يعرف الفريق أنه سيُسوّى.
function rangeOfMonths(monthlyJson, monthStart, monthEnd) {
  let mj = {};
  try { mj = JSON.parse(monthlyJson || '{}'); } catch { mj = {}; }
  const months = Array.from({ length: 12 }, (_, i) => Number(mj[i + 1] || 0));
  const first = months.findIndex((v) => v > 0) + 1;
  if (!first) {
    // لا مخطط شهري محفوظ: يُستعمل المدى المسجَّل على الصف إن وُجد، بلا نسبة مخترعة
    const f = num(monthStart); const t = num(monthEnd);
    return { from: f, to: t, pct: '', irregular: false };
  }
  let last = 12;
  while (last > first && months[last - 1] === 0) last--;
  const v = months[first - 1];
  let irregular = false;
  for (let m = first; m <= last; m++) if (Math.abs(months[m - 1] - v) > 0.004) irregular = true;
  return { from: first, to: last, pct: Math.round(v * 100), irregular };
}

// ── القراءات ─────────────────────────────────────────────────────────────────
async function resolveSector(key) {
  const rows = await all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  const k = String(key).trim();
  const hit = rows.find((s) => s.id === k)
    || rows.find((s) => String(s.name_ar).trim() === k);
  if (!hit) {
    throw new Error(`لا قطاع بهذا الاسم أو المعرّف: «${k}» — المتاح: ${rows.map((s) => `${s.id} (${s.name_ar})`).join('، ')}`);
  }
  return hit;
}

async function clientRows(sectorId) {
  const clients = await all(`
    SELECT c.id, c.name_ar, c.name_en, c.type, c.sector_market
    FROM client c
    WHERE c.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM opportunity o WHERE o.client_id = c.id AND o.sector_id = ? AND o.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM project p WHERE p.client_id = c.id AND p.sector_id = ? AND p.deleted_at IS NULL))
    ORDER BY c.name_ar`, [sectorId, sectorId]);
  const first = new Map();
  if (clients.length) {
    const marks = clients.map(() => '?').join(',');
    const contacts = await all(
      `SELECT client_id, name, title, email, phone FROM contact
       WHERE deleted_at IS NULL AND client_id IN (${marks}) ORDER BY created_at`,
      clients.map((c) => c.id));
    for (const ct of contacts) if (!first.has(ct.client_id)) first.set(ct.client_id, ct);
  }
  // اسمان متطابقان لسجلَّين مختلفين (بياناتٌ قديمة) يصلان الفريقَ سطرين لا فرق بينهما، ويعودان
  // في الاستيراد صفّاً مكرراً يرفضه المحرك. يُكتب الأول ويُترك الباقي — والدمج قرارٌ على المنصة.
  const seen = new Set();
  const unique = clients.filter((c) => {
    const k = normalizeText(c.name_ar);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out = unique.map((c) => {
    const ct = first.get(c.id) || {};
    return {
      'اسم العميل': txt(c.name_ar),
      'الاسم الإنجليزي': txt(c.name_en),
      'التصنيف': txt(c.type),
      'القطاع السوقي': txt(c.sector_market),
      'جهة الاتصال': txt(ct.name),
      'منصب جهة الاتصال': txt(ct.title),
      'البريد الإلكتروني': txt(ct.email),
      'الجوال': txt(ct.phone),
    };
  });
  out.notes = clients.length - unique.length
    ? [`العملاء: ${clients.length - unique.length} سجلاً باسم مكرر لم يُكتب — الاسم موجود مرة واحدة في الورقة.`]
    : [];
  return out;
}

// الفرص المكسوبة تُستبعَد عمداً: لكل فرصة مكسوبة مشروعٌ على المنصة (المرآة في
// src/modules/crm/opp-project-sync.js تصنع أحدهما من الآخر في الاتجاهين). فلو كُتبت هنا لعادت
// من الاستيراد فرصةً جديدة تُولِّد مشروعاً ثانياً — رقمٌ مكرّر في المحفظة. المكسوب يعيش في
// ورقة «المشاريع» وحدها، وهو نفس ما تقوله التعليمات للفريق.
const OPEN_OPPS = `o.deleted_at IS NULL AND o.sector_id = ?
  AND NOT EXISTS (SELECT 1 FROM stage sw WHERE sw.id = o.stage_id AND sw.is_won = 1)`;

async function opportunityRows(sectorId) {
  const rows = await all(`
    SELECT o.id, o.title_ar, o.year, o.value_halalas, o.win_pct, o.next_action, o.notes,
           o.engagement_type, o.solicitation_type,
           c.name_ar client_name, st.name_ar stage_name,
           u.name_ar owner_name, u.username owner_username, d.name_ar dept_name
    FROM opportunity o
    LEFT JOIN client c ON c.id = o.client_id
    LEFT JOIN stage st ON st.id = o.stage_id
    LEFT JOIN app_user u ON u.id = o.owner_user_id AND u.deleted_at IS NULL
    LEFT JOIN department d ON d.id = o.department_id AND d.deleted_at IS NULL
    WHERE ${OPEN_OPPS}
    ORDER BY o.created_at`, [sectorId]);
  return rows.map((o) => ({
    'العنوان': txt(o.title_ar),
    'العميل': txt(o.client_name),
    'الإدارة': txt(o.dept_name),
    // اسم المرحلة كما هو على المنصة الآن (يختلف بين بذرة وأخرى) — المحوّل يطابقه على جدول المراحل
    'المرحلة': txt(o.stage_name),
    'نسبة الفوز %': pct(o.win_pct),
    'القيمة بدون ضريبة': netMoney(o.value_halalas),
    'السنة': num(o.year),
    // «تاريخ الإغلاق المتوقع» لا عمود له في القاعدة بعد (الترحيلة مؤجَّلة) — يُلتقط من الفريق
    'نوع الارتباط': ENGAGEMENT_TYPE_AR[String(o.engagement_type || '').toUpperCase()] || '',
    'طريقة الطرح': SOLICITATION_TYPE_AR[String(o.solicitation_type || '').toUpperCase()] || '',
    'مدير الفرصة': personName(o.owner_name, o.owner_username),
    'الخطوة التالية': txt(o.next_action),
    'ملاحظات': txt(o.notes),
  }));
}

async function oppteamRows(sectorId) {
  // عضويةٌ تنتظر تأكيد مدير الموظف ليست عضويةً بعد (migrations/022) — فلا تُكتب، وتُذكر عدداً.
  const rows = await all(`
    SELECT o.title_ar opp_title, e.name_ar emp_name, m.role_in_group, m.allocation_pct,
           COALESCE(m.status, 'ACTIVE') mem_status
    FROM membership m
    JOIN employee e ON e.id = m.employee_id AND e.deleted_at IS NULL
    JOIN opportunity o ON o.id = m.group_id
    WHERE m.group_kind = 'opportunity' AND m.deleted_at IS NULL AND ${OPEN_OPPS}
    ORDER BY o.title_ar, e.name_ar`, [sectorId]);
  const live = rows.filter((m) => m.mem_status !== 'PENDING');
  const out = live.map((m) => ({
    'الفرصة': txt(m.opp_title),
    'الموظف': txt(m.emp_name),
    // «الدور» بكلمته العربية كما تعرضها المنصة (قائد/عضو/مراجع/راعٍ) لا بمفتاحه الإنجليزي
    'الدور': TEAM_ROLE_LABELS[String(m.role_in_group || 'member')] || '',
    'نسبة التخصيص %': pct(m.allocation_pct),
  }));
  const pending = rows.length - live.length;
  out.notes = pending
    ? [`فريق الفرصة: ${pending} عضويةً تنتظر تأكيد مدير الموظف لم تُكتب — تظهر حين تُؤكَّد.`]
    : [];
  return out;
}

async function projectRows(sectorId) {
  const rows = await all(`
    SELECT p.id, p.name_ar, p.status, p.rag, p.progress_pct, p.contract_value_halalas,
           p.po_value_halalas, p.budget_halalas, p.start_date, p.end_date, p.pm_name,
           c.name_ar client_name, d.name_ar dept_name,
           u.name_ar owner_name, u.username owner_username,
           (SELECT MIN(k.signed_at) FROM contract k
             WHERE k.project_id = p.id AND k.deleted_at IS NULL AND k.signed_at IS NOT NULL) signed_at
    FROM project p
    LEFT JOIN client c ON c.id = p.client_id
    LEFT JOIN department d ON d.id = p.department_id AND d.deleted_at IS NULL
    LEFT JOIN app_user u ON u.id = p.owner_user_id AND u.deleted_at IS NULL
    WHERE p.sector_id = ? AND p.deleted_at IS NULL
    ORDER BY p.created_at`, [sectorId]);
  const out = rows.map((p) => ({
    'اسم المشروع': txt(p.name_ar),
    'العميل': txt(p.client_name),
    'الإدارة': txt(p.dept_name),
    // مدير المشروع: صاحب السجل على المنصة إن كان له حساب، وإلا الاسم النصّي المكتوب عليه
    'مدير المشروع': personName(p.owner_name, p.owner_username) || txt(p.pm_name),
    'حالة المشروع': STATUS_LABEL(p.status),
    'مؤشر الصحة': RAG_LABEL(p.rag),
    'نسبة الإنجاز (%)': pct(p.progress_pct),
    // تاريخ توقيع العقد: أقدم عقدٍ غير محذوف على المشروع — وعليه تُحسب مبيعات السنة
    'تاريخ توقيع العقد': day(p.signed_at),
    'قيمة العقد بدون ضريبة': netMoney(p.contract_value_halalas),
    // أمر الشراء مطالبةٌ إجمالية كما هي مخزَّنة — عموده لا يقول «بدون ضريبة»
    'قيمة أمر الشراء': money(p.po_value_halalas),
    'تاريخ البداية': day(p.start_date),
    'تاريخ النهاية': day(p.end_date),
    'الميزانية (ريال)': money(p.budget_halalas),
  }));
  const unsigned = rows.filter((p) => !p.signed_at).length;
  out.notes = unsigned
    ? [`${unsigned} مشروعاً بلا تاريخ توقيع عقد — لن تدخل مبيعات أي سنة.`]
    : [];
  return out;
}

async function deliverableRows(sectorId) {
  // صفٌّ لكل (مخرَج × فاتورته). المخرَج الذي فُوتر على فاتورتين يعود هنا صفَّين، والورقة تحمل
  // سطراً واحداً لكل مخرَج — فتُطوى الفواتير على أقدمها تاريخَ إصدار، ويُذكر المطوي في الملخّص
  // كي لا يظن الفريق أن فاتورةً ضاعت. (الربط عبر invoice_line كما تكتبه خدمة المالية نفسها.)
  // والترتيب مجموعاتٌ تُقرأ: المشروع، ثم معلمه، ثم شهر الاستحقاق — فتصل الورقةُ الفريقَ كتلاً.
  const rows = await all(`
    SELECT d.id, d.name_ar, d.amount_halalas, d.month, d.year, d.due_date, d.status,
           d.delivered_at, d.accepted_at, d.notes, d.invoiced_at, d.collected_at,
           p.name_ar proj_name, m.name_ar milestone_name,
           u.name_ar owner_name, u.username owner_username,
           i.id invoice_id, i.code invoice_code, i.issue_date issue_date,
           (SELECT MIN(k.collected_at) FROM collection k WHERE k.invoice_id = i.id) collected_first
    FROM deliverable d
    JOIN project p ON p.id = d.project_id
    LEFT JOIN milestone m ON m.id = d.milestone_id AND m.deleted_at IS NULL
    LEFT JOIN app_user u ON u.id = d.owner_user_id AND u.deleted_at IS NULL
    LEFT JOIN invoice_line il ON il.deliverable_id = d.id
    LEFT JOIN invoice i ON i.id = il.invoice_id AND i.deleted_at IS NULL
    WHERE p.sector_id = ? AND d.deleted_at IS NULL AND p.deleted_at IS NULL
    ORDER BY p.name_ar, COALESCE(m.name_ar, ''), d.year, d.month, d.name_ar`, [sectorId]);

  const byDeliverable = new Map();
  let collapsed = 0;
  for (const r of rows) {
    const cur = byDeliverable.get(r.id);
    if (!cur) { byDeliverable.set(r.id, r); continue; }
    if (!r.invoice_id) continue;
    if (!cur.invoice_id) { byDeliverable.set(r.id, r); continue; }
    collapsed++;
    // الأقدم إصداراً هو الذي يبقى؛ والفارغ تاريخُ إصداره لا يزاحم مؤرَّخاً
    const a = txt(cur.issue_date); const b = txt(r.issue_date);
    if (b && (!a || b < a)) byDeliverable.set(r.id, r);
  }

  const out = [...byDeliverable.values()].map((d) => {
    const invoiced = !!d.invoice_id || !!d.invoiced_at;
    const collectedAt = d.collected_first || d.collected_at;
    return {
      // الأصل يُكتب صريحاً في كل سطرٍ معبأ: السحب راحةُ من يكتب بيده، لا اختصارٌ لما نكتبه نحن
      'المشروع': txt(d.proj_name),
      'المعلم': txt(d.milestone_name),
      'المخرج': txt(d.name_ar),
      'المبلغ بدون ضريبة': netMoney(d.amount_halalas),
      // الشهر والسنة كما هما مخزَّنان — وبهما يُحسب الإيراد لا بتاريخ الفاتورة ولا التحصيل
      'شهر الاستحقاق': num(d.month),
      'سنة الاستحقاق': num(d.year),
      'تاريخ الاستحقاق': day(d.due_date),
      'حالة المخرج': DELIVERABLE_STATUS_AR[String(d.status || '').toUpperCase()] || '',
      'تاريخ التسليم': day(d.delivered_at),
      'تاريخ الاعتماد': day(d.accepted_at),
      'مفوتر؟': invoiced ? YES : NO,
      'رقم الفاتورة': txt(d.invoice_code),
      'تاريخ الفاتورة': day(d.issue_date || d.invoiced_at),
      'محصَّل؟': collectedAt ? YES : NO,
      'تاريخ التحصيل': day(collectedAt),
      'المسؤول': personName(d.owner_name, d.owner_username),
      'ملاحظة': txt(d.notes),
    };
  });
  const noMonth = out.filter((d) => d['شهر الاستحقاق'] === '').length;
  out.notes = [];
  if (noMonth) out.notes.push(`${noMonth} مخرجاً بلا شهر استحقاق — الإيراد لن يُحسب لها حتى يُكتب.`);
  if (collapsed) {
    out.notes.push(`المخرجات: ${collapsed} فاتورةً إضافية لم تُكتب — المخرَج سطرٌ واحد في الورقة`
      + ' ويحمل أقدم فاتورةٍ له، وبقية فواتيره باقية كما هي على المنصة.');
  }
  return out;
}

async function employeeRows(sectorId) {
  const rows = await all(`
    SELECT e.id, e.name_ar, e.name_en, e.job_title, e.employment_type, e.hire_date,
           e.capacity_pct, e.user_id,
           d.name_ar dept_name, d.manager_user_id manager_user_id, u.email email
    FROM employee e
    LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
    LEFT JOIN app_user u ON u.id = e.user_id AND u.deleted_at IS NULL
    WHERE e.sector_id = ? AND e.deleted_at IS NULL
    ORDER BY e.name_ar`, [sectorId]);
  return rows.map((e) => ({
    'الاسم': txt(e.name_ar),
    'الاسم الإنجليزي': txt(e.name_en),
    'المسمى الوظيفي': txt(e.job_title),
    'الإدارة': txt(e.dept_name),
    'مدير الإدارة؟': (e.user_id && e.manager_user_id && e.user_id === e.manager_user_id) ? YES : '',
    'نوع التوظيف': txt(e.employment_type),
    'تاريخ التعيين': day(e.hire_date),
    'الطاقة %': pct(e.capacity_pct),
    'البريد الإلكتروني': txt(e.email),
  }));
}

// مستهدفات الموظفين: الجدول لم يُنشأ بعد (المرحلة C من الخطة). فتُجرَّب قراءةٌ واحدة، ومتى ردّت
// القاعدةُ خطأً — أياً كان نصّه على SQLite أو Postgres — عُدَّت الورقة فارغة وقيل ذلك في الملخّص،
// ولا يسقط التصدير كله من أجل ورقةٍ لا مكان لبياناتها بعد.
const TARGET_KIND_AR = { sales: 'مبيعات', revenue: 'إيرادات', other: 'أخرى' };
async function targetRows(sectorId) {
  let rows;
  try {
    rows = await all(`
      SELECT e.name_ar emp_name, t.kind, t.kind_label, t.fiscal_year, t.amount_halalas
      FROM employee_target t
      JOIN employee e ON e.id = t.employee_id
      WHERE e.sector_id = ? AND t.deleted_at IS NULL AND e.deleted_at IS NULL
      ORDER BY e.name_ar, t.fiscal_year`, [sectorId]);
  } catch {
    const empty = [];
    empty.notes = ['لا مستهدفات مسجَّلة بعد على المنصة.'];
    return empty;
  }
  const out = rows.map((t) => ({
    'الموظف': txt(t.emp_name),
    'نوع المستهدف': TARGET_KIND_AR[String(t.kind || '').toLowerCase()] || '',
    'السنة': num(t.fiscal_year),
    // المستهدف يُخزَّن صافياً بحكم تعريفه (المستهدفات توضع صافيةً أصلاً) — يُكتب كما هو
    'المستهدف السنوي بدون ضريبة': money(t.amount_halalas),
    'بيان المستهدف': txt(t.kind_label),
  }));
  out.notes = out.length ? [] : ['لا مستهدفات مسجَّلة بعد على المنصة.'];
  return out;
}

async function staffingRows(sectorId) {
  const rows = await all(`
    SELECT a.year, a.monthly_json, a.month_start, a.month_end, a.type,
           e.name_ar emp_name, p.name_ar proj_name
    FROM allocation a
    JOIN employee e ON e.id = a.employee_id
    JOIN project p ON p.id = a.project_id
    WHERE a.deleted_at IS NULL AND e.deleted_at IS NULL AND p.deleted_at IS NULL
      AND p.sector_id = ? AND e.sector_id = ?
    ORDER BY e.name_ar, p.name_ar, a.year`, [sectorId, sectorId]);
  // ما لا يصل الورقةَ يُقال صراحةً في الملخّص، وإلا عدّ الفريقُ صفوفَ الورقة وقارنها بما يراه
  // على المنصة فوجد فرقاً بلا تفسير. ورقة «التسكين» عمودها «المشروع» إلزامي، فتسكينُ **بند
  // داخلي** (تطوير أعمال/منتج/مكتب مشاريع — بلا مشروع) لا مكان له فيها أصلاً، وكذلك تسكينٌ على
  // مشروع قطاعٍ آخر أو مشروعٍ محذوف. ثلاثتها إسقاطٌ صحيح لا خلل في القارئ.
  const aside = await all(`
    SELECT a.work_bucket, a.project_id, p.sector_id p_sector, p.deleted_at p_deleted
    FROM allocation a
    JOIN employee e ON e.id = a.employee_id
    LEFT JOIN project p ON p.id = a.project_id
    WHERE a.deleted_at IS NULL AND e.deleted_at IS NULL AND e.sector_id = ?`, [sectorId]);
  const buckets = new Map();
  let otherSector = 0; let goneProject = 0;
  for (const a of aside) {
    if (!a.project_id) {
      const k = workBucketLabel(a.work_bucket) || 'بند داخلي';
      buckets.set(k, (buckets.get(k) || 0) + 1);
    } else if (!a.p_sector || a.p_deleted) goneProject++;
    else if (a.p_sector !== sectorId) otherSector++;
  }
  let irregular = 0;
  const out = rows.map((a) => {
    const r = rangeOfMonths(a.monthly_json, a.month_start, a.month_end);
    if (r.irregular) irregular++;
    return {
      'الموظف': txt(a.emp_name),
      'المشروع': txt(a.proj_name),
      // السنة تُكتب صراحةً دائماً (KI-092: إسقاطها كان يُسكِّن الجميع على سنة اليوم)
      'السنة': num(a.year),
      // «الدور» يُكتب بكلمته العربية كما تعرضها المنصة (عضو فريق/قائد الفريق…) لا بمفتاحه
      // الإنجليزي: خانةٌ يقرؤها الفريق، ويعيدها المحوّل إلى مفتاحها عند الاستيراد فلا تتغيّر قيمة.
      'الدور': txt(roleLabelOf(a.type)),
      'من شهر': num(r.from),
      'إلى شهر': num(r.to),
      'الإشغال (%)': num(r.pct),
    };
  });
  out.notes = [];
  if (irregular) out.notes.push(`التسكين: ${irregular} صفاً مخططه الشهري غير منتظم — كُتب بمداه ونسبته الأولى.`);
  if (buckets.size) {
    const parts = [...buckets].map(([k, n]) => `${k}: ${n}`).join('، ');
    out.notes.push(`التسكين: ${[...buckets.values()].reduce((a, b) => a + b, 0)} تسكيناً على بنودٍ داخلية بلا مشروع لم يُكتب (${parts}) — ورقة «التسكين» تحمل المشاريع وحدها، وهذه البنود تبقى كما هي على المنصة.`);
  }
  if (otherSector) out.notes.push(`التسكين: ${otherSector} تسكيناً على مشروع قطاعٍ آخر لم يُكتب — المشروع يُدار في قطاعه.`);
  if (goneProject) out.notes.push(`التسكين: ${goneProject} تسكيناً على مشروعٍ محذوف لم يُكتب.`);
  return out;
}

// التكاليف: لا تُقرأ إلا مع --with-costs. والمبلغ يُكتب كما هو مخزَّن — التكلفة صافيةٌ بطبيعتها
// (لا ضريبة عليها) كما تقول تلميحة العمود في الدفتر. و cost_line بلا deleted_at بحكم بنيتها.
async function costRows(sectorId) {
  const rows = await all(`
    SELECT cl.type, cl.amount_halalas, cl.month, cl.year, cl.source, p.name_ar proj_name
    FROM cost_line cl
    JOIN project p ON p.id = cl.project_id
    WHERE cl.sector_id = ? AND p.deleted_at IS NULL
    ORDER BY p.name_ar, cl.year, cl.month`, [sectorId]);
  const out = rows.map((c) => ({
    'المشروع': txt(c.proj_name),
    // النوع عربيٌّ في القاعدة أصلاً (رواتب/تعاقد باطني/أخرى) — يُكتب كما هو
    'نوع التكلفة': txt(c.type),
    'المبلغ (ريال)': money(c.amount_halalas),
    'الشهر': num(c.month),
    'السنة': num(c.year),
    'المصدر': txt(c.source),
  }));
  // ورقة «التكاليف» عمودها «المشروع» إلزامي، فتكلفةٌ بلا مشروع (أو على مشروعٍ محذوف) لا مكان
  // لها فيها — تُعدّ في الملخّص كي لا يُقارن مجموعُ الورقة بمجموع المنصة فيُظنّ نقصاً.
  const aside = await all(
    'SELECT COUNT(*) n FROM cost_line cl LEFT JOIN project p ON p.id = cl.project_id'
    + ' WHERE cl.sector_id = ? AND (cl.project_id IS NULL OR p.id IS NULL OR p.deleted_at IS NOT NULL)',
    [sectorId]);
  const orphan = Number(aside[0] && aside[0].n) || 0;
  out.notes = orphan ? [`التكاليف: ${orphan} بنداً بلا مشروعٍ قائم لم يُكتب — الورقة تحمل تكاليف المشاريع وحدها.`] : [];
  return out;
}

const READERS = {
  clients: clientRows,
  opportunities: opportunityRows,
  oppteam: oppteamRows,
  projects: projectRows,
  deliverables: deliverableRows,
  employees: employeeRows,
  employeetargets: targetRows,
  staffing: staffingRows,
  costlines: costRows,
};

// ── التشغيل ──────────────────────────────────────────────────────────────────
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  if (!args.sector || args.sector === true) throw new Error('حدّد القطاع: --sector=<المعرّف أو الاسم>');
  const out = String(args.out && args.out !== true ? args.out : 'صفوف-القطاع.json');
  // ورقة «التكاليف» تدخل قائمة الأوراق قبل أول قراءة — فمواصفة الأوراق واحدة هنا وفي المولّد
  const withCosts = !!args['with-costs'];
  setWithCosts(withCosts);
  const sector = await resolveSector(args.sector);

  const data = {};
  const notes = [];
  for (const spec of SHEETS) {
    const key = sheetKey(spec);
    const reader = READERS[key];
    if (!reader) throw new Error(`لا قارئ لورقة «${spec.name}»`);
    const objRows = await reader(sector.id);
    for (const n of objRows.notes || []) notes.push(n);
    // الترتيب من المولّد لا من هنا: أي عمود يُضاف هناك يظهر هنا فارغاً بدل أن ينزلق الصف.
    // والعمود المحسوب يبقى فارغاً دائماً — المولّد يكتب فيه صيغته.
    data[key] = objRows.map((r) => spec.columns.map((c) => {
      const v = (isCalc(c) || isHelper(c)) ? '' : r[c.header];
      return v == null ? '' : v;
    }));
    const unknown = objRows.length
      ? Object.keys(objRows[0]).filter((h) => !spec.columns.some((c) => c.header === h))
      : [];
    if (unknown.length) throw new Error(`ورقة «${spec.name}»: أعمدة لا مكان لها في الدفتر: ${unknown.join('، ')}`);
  }

  writeFileSync(out, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // ── الملخّص العربي بجانب الملف ──
  const lines = [`ملخّص بيانات ${sector.name_ar} من المنصة`, ''];
  for (const spec of SHEETS) {
    const rows = data[sheetKey(spec)];
    const reqIdx = spec.columns.map((c, i) => (isRequired(c) ? i : -1)).filter((i) => i >= 0);
    const missing = rows.filter((r) => reqIdx.some((i) => r[i] === '' || r[i] == null)).length;
    const blanks = spec.columns.map((c, i) => {
      // الخانة المحسوبة وخانة السحب فارغتان بالتصميم — لا نقصاً في البيانات
      if (isCalc(c) || isHelper(c)) return null;
      const n = rows.filter((r) => r[i] === '' || r[i] == null).length;
      return n ? `${c.header}: ${n}` : null;
    }).filter(Boolean);
    lines.push(`${spec.name}: ${rows.length} صفاً — ينقصه عمود إلزامي: ${missing}`);
    if (blanks.length) lines.push(`   خانات فارغة تحتاج إكمالاً — ${blanks.join('، ')}`);
  }
  if (notes.length) { lines.push(''); lines.push(...notes); }
  lines.push('');
  lines.push('الفرص المكسوبة غير مدرجة: كل فرصة مكسوبة لها مشروع على المنصة، وهي في ورقة «المشاريع».');
  lines.push('المبالغ في أعمدة «بدون ضريبة» صافيةٌ محسوبةٌ من المخزَّن الإجمالي ÷ 1.15، وخانة «مع الضريبة» يحسبها الدفتر.');
  if (withCosts) lines.push('⚠ هذا الملف يحمل تكاليف المشاريع — يُسلَّم إلى قائد القطاع وحده.');
  writeFileSync(`${out}.summary.txt`, lines.join('\n') + '\n', 'utf8');

  console.log(`✔ ${out}`);
  for (const spec of SHEETS) console.log(`  ${spec.name}: ${data[sheetKey(spec)].length}`);
  console.log(`✔ ${out}.summary.txt`);
  if (withCosts) console.log('⚠ الملف يحمل تكاليف — لقائد القطاع وحده.');
  await close();
}

main().catch(async (e) => {
  console.error(`✗ ${e.message}`);
  try { await close(); } catch { /* لا شيء */ }
  process.exit(1);
});
