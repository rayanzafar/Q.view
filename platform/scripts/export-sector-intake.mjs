#!/usr/bin/env node
// «صفوف الملء المسبق» — يقرأ ما هو مسجَّل اليوم على المنصة لقطاعٍ واحد، ويكتبه بالشكل الذي
// يبتلعه مولّد دفتر البيانات (scripts/make-sap-intake-workbook.mjs --prefill) فيصل الفريقَ دفترٌ
// معبأ بحقيقته الحالية بدل ورقة بيضاء.
//
//   node --experimental-sqlite scripts/export-sector-intake.mjs --sector=CONSULTING --out=صفوف.json
//   SANAD_DB=<ملف.db> node --experimental-sqlite scripts/export-sector-intake.mjs --sector=... --out=...
//
// قراءةٌ محضة: لا كتابة واحدة إلى القاعدة، ولا استدعاء خدمة، ولا سائق قاعدة مباشر — كل شيء عبر
// `src/core/db/index.js` بمعاملات `?` وحدها، فيعمل الملف نفسه على SQLite وعلى Postgres حين يُضبط
// DATABASE_URL (لا strftime ولا تجميع بلا GROUP BY كامل).
//
// المخرَج: { "clients": [[خانة, …], …], "opportunities": […], "projects": […], "employees": […], "staffing": […] }
// وترتيب الخانات في كل صف = ترتيب أعمدة الورقة في المولّد حرفاً بحرف — تُقرأ المواصفة منه
// مباشرةً (import) كي لا يفترق الملفان أبداً.
//
// وإلى جانبه ملخّص عربي «<الملف>.summary.txt»: كم صفاً في كل ورقة، وكم صفاً ينقصه عمود إلزامي.
import { writeFileSync } from 'node:fs';
import { all, close } from '../src/core/db/index.js';
import { toSar } from '../src/core/util/ids.js';
import { enumLabel, normalizeText } from '../src/modules/io/parse.js';
import projectsAdapter from '../src/modules/io/adapters/projects.js';
import { roleLabelOf } from '../src/modules/io/adapters/staffing.js';
import { workBucketLabel } from '../src/web/i18n/glossary.js';
import { SHEETS, sheetKey } from './make-sap-intake-workbook.mjs';

// حالة المشروع ومؤشر صحته: التسميات العربية تُقرأ من محوّل المشاريع نفسه لا تُكتب هنا ثانيةً،
// فما نكتبه في الدفتر هو حرفياً ما سيقبله المحوّل حين يعود الدفتر.
const enumOf = (key) => projectsAdapter.columns.find((c) => c.key === key).enum;
const STATUS_LABEL = (v) => (v ? enumLabel(enumOf('status'), v) : '');
const RAG_LABEL = (v) => (v ? enumLabel(enumOf('rag'), v) : '');

const money = (halalas) => {
  const sar = toSar(halalas);
  return sar ? Math.round(sar * 100) / 100 : '';
};
const txt = (v) => (v == null ? '' : String(v));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v));

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
  out.duplicates = clients.length - unique.length;
  return out;
}

async function opportunityRows(sectorId) {
  // الفرص المكسوبة تُستبعَد عمداً: لكل فرصة مكسوبة مشروعٌ على المنصة (المرآة في
  // src/modules/crm/opp-project-sync.js تصنع أحدهما من الآخر في الاتجاهين). فلو كُتبت هنا لعادت
  // من الاستيراد فرصةً جديدة تُولِّد مشروعاً ثانياً — رقمٌ مكرّر في المحفظة. المكسوب يعيش في
  // ورقة «المشاريع» وحدها، وهو نفس ما تقوله التعليمات للفريق.
  const rows = await all(`
    SELECT o.id, o.title_ar, o.year, o.value_halalas, o.next_action, o.notes,
           c.name_ar client_name, st.name_ar stage_name, st.is_won is_won,
           u.name_ar owner_name, u.username owner_username, d.name_ar dept_name
    FROM opportunity o
    LEFT JOIN client c ON c.id = o.client_id
    LEFT JOIN stage st ON st.id = o.stage_id
    LEFT JOIN app_user u ON u.id = o.owner_user_id AND u.deleted_at IS NULL
    LEFT JOIN department d ON d.id = o.department_id AND d.deleted_at IS NULL
    WHERE o.sector_id = ? AND o.deleted_at IS NULL
    ORDER BY o.created_at`, [sectorId]);
  return rows.filter((o) => !Number(o.is_won)).map((o) => ({
    'العنوان': txt(o.title_ar),
    'العميل': txt(o.client_name),
    'الإدارة': txt(o.dept_name),
    // اسم المرحلة كما هو على المنصة الآن (يختلف بين بذرة وأخرى) — المحوّل يطابقه على جدول المراحل
    'المرحلة': txt(o.stage_name),
    'القيمة (ريال)': money(o.value_halalas),
    'السنة': num(o.year),
    'الخطوة التالية': txt(o.next_action),
    // ورقة «الفرص» لا تحمل عمود «المسؤول» المستورَد، بل «المتابع من الفريق» المُلتقط — فيُكتب
    // فيه اسم المسؤول كما يطابقه المحوّل (الاسم العربي وإلا اسم الدخول).
    'المتابع من الفريق': txt(o.owner_name || o.owner_username),
    'ملاحظات': txt(o.notes),
  }));
}

async function projectRows(sectorId) {
  const rows = await all(`
    SELECT p.id, p.name_ar, p.status, p.rag, p.progress_pct, p.contract_value_halalas,
           p.budget_halalas, p.start_date, p.end_date, p.pm_name,
           c.name_ar client_name, d.name_ar dept_name
    FROM project p
    LEFT JOIN client c ON c.id = p.client_id
    LEFT JOIN department d ON d.id = p.department_id AND d.deleted_at IS NULL
    WHERE p.sector_id = ? AND p.deleted_at IS NULL
    ORDER BY p.created_at`, [sectorId]);
  return rows.map((p) => ({
    'اسم المشروع': txt(p.name_ar),
    'العميل': txt(p.client_name),
    'الإدارة': txt(p.dept_name),
    'حالة المشروع': STATUS_LABEL(p.status),
    'مؤشر الصحة': RAG_LABEL(p.rag),
    'نسبة الإنجاز (%)': num(p.progress_pct == null ? '' : Math.round(Number(p.progress_pct))),
    'قيمة العقد (ريال)': money(p.contract_value_halalas),
    'الميزانية (ريال)': money(p.budget_halalas),
    // التواريخ نصوصٌ بصيغة 2026-01-31 كما يكتبها الوضع التجريبي وكما يقرؤها المحوّل
    'تاريخ البداية': txt(p.start_date).slice(0, 10),
    'تاريخ النهاية': txt(p.end_date).slice(0, 10),
    'مدير المشروع': txt(p.pm_name),
  }));
}

async function employeeRows(sectorId) {
  const rows = await all(`
    SELECT e.id, e.name_ar, e.name_en, e.job_title, e.employment_type, e.user_id,
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
    'مدير الإدارة؟': (e.user_id && e.manager_user_id && e.user_id === e.manager_user_id) ? 'نعم' : '',
    'نوع التوظيف': txt(e.employment_type),
    'البريد الإلكتروني': txt(e.email),
  }));
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
  out.irregular = irregular;
  out.asideBuckets = buckets;
  out.asideOtherSector = otherSector;
  out.asideGoneProject = goneProject;
  return out;
}

const READERS = {
  clients: clientRows,
  opportunities: opportunityRows,
  projects: projectRows,
  employees: employeeRows,
  staffing: staffingRows,
};

// ── التشغيل ──────────────────────────────────────────────────────────────────
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  if (!args.sector || args.sector === true) throw new Error('حدّد القطاع: --sector=<المعرّف أو الاسم>');
  const out = String(args.out && args.out !== true ? args.out : 'صفوف-القطاع.json');
  const sector = await resolveSector(args.sector);

  const data = {};
  const notes = [];
  for (const spec of SHEETS) {
    const key = sheetKey(spec);
    const reader = READERS[key];
    if (!reader) throw new Error(`لا قارئ لورقة «${spec.name}»`);
    const objRows = await reader(sector.id);
    if (objRows.irregular) notes.push(`التسكين: ${objRows.irregular} صفاً مخططه الشهري غير منتظم — كُتب بمداه ونسبته الأولى.`);
    if (objRows.asideBuckets && objRows.asideBuckets.size) {
      const parts = [...objRows.asideBuckets].map(([k, n]) => `${k}: ${n}`).join('، ');
      notes.push(`التسكين: ${[...objRows.asideBuckets.values()].reduce((a, b) => a + b, 0)} تسكيناً على بنودٍ داخلية بلا مشروع لم يُكتب (${parts}) — ورقة «التسكين» تحمل المشاريع وحدها، وهذه البنود تبقى كما هي على المنصة.`);
    }
    if (objRows.asideOtherSector) notes.push(`التسكين: ${objRows.asideOtherSector} تسكيناً على مشروع قطاعٍ آخر لم يُكتب — المشروع يُدار في قطاعه.`);
    if (objRows.asideGoneProject) notes.push(`التسكين: ${objRows.asideGoneProject} تسكيناً على مشروعٍ محذوف لم يُكتب.`);
    if (objRows.duplicates) notes.push(`العملاء: ${objRows.duplicates} سجلاً باسم مكرر لم يُكتب — الاسم موجود مرة واحدة في الورقة.`);
    // الترتيب من المولّد لا من هنا: أي عمود يُضاف هناك يظهر هنا فارغاً بدل أن ينزلق الصف
    data[key] = objRows.map((r) => spec.columns.map((c) => {
      const v = r[c.header];
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
    const reqIdx = spec.columns.map((c, i) => (c.required ? i : -1)).filter((i) => i >= 0);
    const missing = rows.filter((r) => reqIdx.some((i) => r[i] === '' || r[i] == null)).length;
    const blanks = spec.columns.map((c, i) => {
      const n = rows.filter((r) => r[i] === '' || r[i] == null).length;
      return n ? `${c.header}: ${n}` : null;
    }).filter(Boolean);
    lines.push(`${spec.name}: ${rows.length} صفاً — ينقصه عمود إلزامي: ${missing}`);
    if (blanks.length) lines.push(`   خانات فارغة تحتاج إكمالاً — ${blanks.join('، ')}`);
  }
  if (notes.length) { lines.push(''); lines.push(...notes); }
  lines.push('');
  lines.push('الفرص المكسوبة غير مدرجة: كل فرصة مكسوبة لها مشروع على المنصة، وهي في ورقة «المشاريع».');
  writeFileSync(`${out}.summary.txt`, lines.join('\n') + '\n', 'utf8');

  console.log(`✔ ${out}`);
  for (const spec of SHEETS) console.log(`  ${spec.name}: ${data[sheetKey(spec)].length}`);
  console.log(`✔ ${out}.summary.txt`);
  await close();
}

main().catch(async (e) => {
  console.error(`✗ ${e.message}`);
  try { await close(); } catch { /* لا شيء */ }
  process.exit(1);
});
