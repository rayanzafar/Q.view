#!/usr/bin/env node
// ── كشفُ ما يضيفه دفترُ التعبئة إلى المنصة — قراءةٌ فقط، لا كتابةَ صفٍّ واحد ───────────────
//
//   node --experimental-sqlite scripts/reconcile-workbook.mjs --file=<الدفتر.xlsx> --out=<مسار بلا امتداد> \
//        [--sector=<المعرّف أو الاسم>] [--allow-conflicts] [--year=2026] \
//        [--map=<خريطة المشاريع>] [--emp-map=<خريطة الزملاء>]
//
// ── الخريطة المُعتمدة ────────────────────────────────────────────────────────
// حين يسمّي الدفترُ المشروعَ بعنوان العقد الكامل وتسمّيه المنصةُ باختصارٍ داخلي، لا يُنقذ
// التشابهُ اللفظي شيئاً: يُنشئ نسخةً ثانيةً من مشروعٍ قائم. لذلك يُقبل ملفُّ خريطةٍ يقرّه
// إنسانٌ بعد فحص البيّنة (العميل، عدد المخرجات، تطابق أسماء المخرجات)، فيُلزِم الكشفَ
// بالاقتران المُقرّ ويعطِّل المطابقةَ اللفظية لذلك السطر وحده. وشكلُ الملف قائمةٌ من
// {workbook_name, live_id, live_name, verdict, evidence}: يُؤخذ السطر متى كان له معرّفٌ
// قائم وحكمُه SAME أو LIKELY؛ وDIFFERENT أو بلا معرّفٍ يعني «أنشئه»؛ وما لم يُذكر في
// الخريطة يعود إلى المطابقة اللفظية كما كان. ومعرّفٌ لا وجود له في المنصة يوقف الكشف.
//
// يُخرج ملفّين بالاسم نفسه: `<out>.json` خطةٌ يقرأها `apply-workbook.mjs` وحده، و`<out>.md`
// تقريرٌ عربيٌّ يقرأه المالك قبل أن يأذن بالتطبيق. ولا شيء بينهما مخفيّ: كل ما في الخطة مذكورٌ
// في التقرير، وكل ما تعذّر أو التبس مذكورٌ كذلك — فالموافقة على ما لا يُرى ليست موافقة.
//
// ── لماذا قراءةٌ فقط بالبناء لا بالانضباط ────────────────────────────────────
// هذا الملف يستورد من طبقة القاعدة ثلاثَ دوالَّ قراءة (all/get/close) ولا شيء غيرها: لا
// insert ولا update ولا run ولا tx ولا أي خدمةٍ من `src/modules`. فالكتابة ليست ممنوعةً هنا
// بالاتفاق بل غيرَ موجودةٍ أصلاً. والمطابقةُ نفسها في `lib/workbook-read.mjs` بلا قاعدةٍ بتاتاً.
//
// ── القواعد التي تحكم الكشف ─────────────────────────────────────────────────
//   • الاسمُ المكتوب باليد يُطابَق بتسامحٍ محسوب: تطابقٌ حرفي ثم احتواءٌ وحيد ثم تشابهُ كلمات
//     ≥٠٫٧ وبفارقٍ ≥٠٫١٥ عن التالي. وما دون ذلك ليس ترجيحاً بل تعارضٌ يُرفع إلى إنسان.
//   • الخانةُ الفارغة لا تمسح شيئاً، وبقيّةُ صف المثال تُعامل كالفارغة وتُذكر.
//   • الاسم المخزَّن في المنصة لا يُبدَّل أبداً باسم الدفتر — الدفتر يحمل أخطاءً إملائية.
//   • التاريخ الملتبس (يوم وشهر كلاهما ≤١٢) لا يُخمَّن: يُذكر بقراءتيه ويُترك للفريق.
//   • المخرجُ يُطابَق **داخل مشروعه وحده**؛ ومخرجٌ لم يُطابَق باسمه لكنّ مبلغه يساوي مبلغَ
//     مخرجٍ قائمٍ في المشروع نفسه (بفارق هللتين) ليس جديداً بل تعارضٌ — وإلا تضاعف الإيراد.
//   • «مفوتر؟ نعم» لا تُنشئ فاتورةً ولو حملت رقماً وتاريخاً (قرار المالك): تُذكر كلها في
//     «مفوتر بلا فاتورة» ليصحّحها من يملك مسار المالية.
//   • «المعلم» تُكتب مرحلةً على المشروع (`project_phase`) لا معلَماً: مسارُ الحوكمة لا يربط
//     المخرج بمعلَم إطلاقاً، والمرحلة هي الرابط الوحيد القائم.
//
// ── رموز الخروج ─────────────────────────────────────────────────────────────
//   ٠ نظيف · ٣ في الخطة تعارضاتٌ ولم يُمرَّر `--allow-conflicts` · ١ خطأ يمنع إتمام الكشف.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  readWorkbook, normArabic, matchOne, parseDateCell, netToStoredHalalas, numberOf,
  diffOf, projectStatusKey, ragKey, deliverableStatusKey, allocationTypeKey,
  PROJECT_STATUS_LABELS, RAG_LABELS, ROLE_LABELS,
} from './lib/workbook-read.mjs';
import { netOfGross } from '../src/modules/finance/vat.js';
import { DELIVERABLE_STATUS_AR } from '../src/web/i18n/glossary.js';

// ─────────────────────────────────────────────────────────────────────────────
// §0 أدوات العرض
// ─────────────────────────────────────────────────────────────────────────────

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** رقمٌ للعرض بفواصل الآلاف — أرقام لاتينية كما تعرضها المنصة في الجداول المالية. */
const num2 = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—'
  : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const intFmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
/** ترقيمٌ عربيٌّ لعناوين الأقسام. */
const arNum = (n) => String(n).split('').map((d) => AR_DIGITS[Number(d)] ?? d).join('');
const trim = (v) => (v == null ? '' : String(v).trim());
const halToSar = (h) => Math.round(Number(h || 0)) / 100;
const sarToHal = (s) => Math.round(Number(s || 0) * 100);
const nowIso = () => new Date().toISOString();
/** خانةٌ في جدول ماركداون: العمود الفاصل يكسر الجدول إن ورد داخل نص. */
const cell = (v) => String(v ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ');

const firstLabel = (labels, key) => {
  const v = labels[key];
  return Array.isArray(v) ? v[0] : (v || key);
};
const projectStatusAr = (k) => (k ? firstLabel(PROJECT_STATUS_LABELS, k) : '—');
const ragAr = (k) => (k ? firstLabel(RAG_LABELS, k) : '—');
const dlvStatusAr = (k) => (k ? (DELIVERABLE_STATUS_AR[k] || k) : '—');
const roleAr = (k) => (k ? (ROLE_LABELS[k] || k) : '—');

// الحِملُ المسجَّل على المنصة كما يُقرأ من خريطة الأشهر: نسبةٌ من طاقة الشهر ومدىً من شهرٍ إلى
// شهر. ولو اختلفت النسبةُ شهراً بشهر رُدَّت أعلاها مع بيانِ أنها متفاوتة، كي لا يُقارَن رقمٌ
// واحدٌ بما ليس واحداً.
function liveLoadOf(a) {
  let mj = a?.monthly_json;
  if (typeof mj === 'string') { try { mj = JSON.parse(mj || '{}'); } catch { mj = {}; } }
  if (!mj || typeof mj !== 'object') mj = {};
  const months = Object.entries(mj)
    .map(([m, v]) => [Number(m), Number(v)])
    .filter(([m, v]) => Number.isInteger(m) && m >= 1 && m <= 12 && Number.isFinite(v) && v > 0)
    .sort((x, y) => x[0] - y[0]);
  const pcts = [...new Set(months.map(([, v]) => Math.round(v * 100)))];
  return {
    pct: pcts.length ? Math.max(...pcts) : null,
    pct_varies: pcts.length > 1,
    fromMonth: months.length ? months[0][0] : (a?.month_start ?? null),
    toMonth: months.length ? months[months.length - 1][0] : (a?.month_end ?? null),
  };
}

// أسماءُ الحقول كما يقرؤها صاحب العمل — لا يظهر اسمُ عمودٍ مخزَّن في تقرير.
const FIELD_AR = {
  name_ar: 'الاسم', name_en: 'الاسم الإنجليزي', status: 'الحالة', rag: 'مؤشر الصحة',
  progress_pct: 'نسبة الإنجاز', start_date: 'تاريخ البداية', end_date: 'تاريخ النهاية',
  contract_value_sar: 'قيمة العقد شاملةً الضريبة', budget_sar: 'الميزانية', po_value_sar: 'قيمة أمر الشراء',
  pm_name: 'مدير المشروع', department_id: 'الإدارة', client_id: 'العميل', client_ref: 'العميل',
  amount_sar: 'المبلغ شاملاً الضريبة', period: 'شهر الاستحقاق', notes: 'ملاحظة', phase_id: 'المرحلة',
  phase_ref: 'المرحلة', job_title: 'المسمى الوظيفي', hire_date: 'تاريخ التعيين',
  capacity_pct: 'نسبة الدوام', employment_type: 'نوع التوظيف', owner_user_id: 'مالك السجل',
};

// ─────────────────────────────────────────────────────────────────────────────
// §0-ب الخريطة المُعتمدة — اقترانٌ يقرّه إنسان، يسبق المطابقة اللفظية
// ─────────────────────────────────────────────────────────────────────────────

/** حكمٌ يُلزِم الكشفَ بالاقتران. وما عداه (DIFFERENT أو فراغ) يعني: لا نظير له، فأنشئه. */
const MAP_VERDICTS = new Set(['SAME', 'LIKELY']);

/**
 * بيّنةُ الاقتران في سطرٍ عربيٍّ واحد — لأن التقرير يُظهر سببَ الاقتران لا درجةَ تشابه.
 * @param {*} ev البيّنة كما وردت في ملف الخريطة (نصّاً أو كائناً)
 * @returns {string}
 */
function mapEvidenceSummary(ev) {
  if (ev == null) return 'اقترانٌ مُقرّ بلا بيّنةٍ مكتوبة';
  if (typeof ev === 'string') return trim(ev) || 'اقترانٌ مُقرّ بلا بيّنةٍ مكتوبة';
  if (typeof ev !== 'object') return String(ev);
  const parts = [];
  if (ev.same_client === true) parts.push('الجهة نفسها');
  else if (ev.same_client === false) parts.push('الجهة مختلفة في الدفتر');
  if (ev.wb_deliverables != null || ev.live_deliverables != null) {
    parts.push(`مخرجات الدفتر ${intFmt(ev.wb_deliverables ?? 0)} مقابل ${intFmt(ev.live_deliverables ?? 0)} في المنصة`);
  }
  if (ev.name_exact != null) parts.push(`${intFmt(ev.name_exact)} اسمَ مخرجٍ متطابقاً حرفياً`);
  if (ev.amount_hits_any != null) parts.push(`${intFmt(ev.amount_hits_any)} مبلغاً متطابقاً`);
  if (ev.token_subset === true) parts.push('اسمُ الدفتر أطولُ يحوي اسمَ المنصة كاملاً');
  if (ev.email_equal === true) parts.push('البريد نفسه');
  if (ev.weak === true) parts.push('اقترانٌ ضعيفٌ راجعه إنسان');
  if (!parts.length) {
    for (const [k, v] of Object.entries(ev)) {
      if (v == null || typeof v === 'object') continue;
      parts.push(`${k}: ${v}`);
      if (parts.length >= 3) break;
    }
  }
  return parts.join(' · ') || 'اقترانٌ مُقرّ بلا بيّنةٍ مكتوبة';
}

/**
 * يقرأ ملفَ خريطةٍ ويحوّله إلى فهرسٍ بالاسم المطبَّع.
 * @param {string} path مسار الملف
 * @param {string} subjectAr «المشاريع» أو «الزملاء» — للرسائل وحدها
 * @returns {{byName: Map<string, object>, entries: Array<object>, creates: Array<object>, path: string}}
 */
function loadApprovedMap(path, subjectAr) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    throw new Error(`تعذّرت قراءة خريطة ${subjectAr} من «${path}»: ${e.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`خريطة ${subjectAr} في «${path}» ليست ملفَّ بياناتٍ سليماً: ${e.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.pairs) ? parsed.pairs : null);
  if (!list) throw new Error(`خريطة ${subjectAr} في «${path}» يجب أن تكون قائمةَ اقتراناتٍ — راجع الملف`);
  const byName = new Map();
  const creates = [];
  for (const [i, e] of list.entries()) {
    const wbName = trim(e?.workbook_name);
    if (!wbName) throw new Error(`خريطة ${subjectAr}: السطر رقم ${i + 1} بلا اسمٍ في الدفتر — لا يُقترن مجهول`);
    const key = normArabic(wbName);
    if (byName.has(key)) {
      throw new Error(`خريطة ${subjectAr}: الاسم «${wbName}» مذكورٌ مرتين — احذف التكرار قبل الكشف`);
    }
    const liveId = trim(e?.live_id);
    const verdict = String(e?.verdict || '').toUpperCase();
    if (!liveId || !MAP_VERDICTS.has(verdict)) { creates.push({ ...e, key, workbook_name: wbName }); continue; }
    byName.set(key, {
      workbook_name: wbName,
      live_id: liveId,
      live_name: trim(e?.live_name) || null,
      verdict,
      evidence: mapEvidenceSummary(e?.evidence),
      used: false,
    });
  }
  return { byName, entries: list, creates, path };
}

/**
 * يتحقّق أن كلَّ معرّفٍ في الخريطة قائمٌ فعلاً في المنصة — وإلا أوقف الكشف بالاسم.
 * @param {{byName: Map<string, object>}|null} map
 * @param {Array<{id: string}>} liveRows
 * @param {string} subjectAr
 */
function assertMapIdsLive(map, liveRows, subjectAr) {
  if (!map) return;
  const known = new Set(liveRows.map((r) => String(r.id)));
  for (const e of map.byName.values()) {
    if (!known.has(String(e.live_id))) {
      throw new Error(`خريطة ${subjectAr}: «${e.workbook_name}» مقترنٌ بسجلٍّ «${e.live_id}»`
        + ` لا وجود له في هذا القطاع — صحّح الخريطة أو احذف السطر`);
    }
  }
}

/** يُنشئ نتيجةَ مطابقةٍ بشكل matchOne لكنّ مصدرها خريطةٌ مُقرّة. */
function mapHit(entry, row) {
  entry.used = true;
  return { hit: row, score: 1, rule: 'map', ambiguous: false, runnerUp: null, evidence: entry.evidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 قراءة المنصة — SELECT وحدها، بعلامات استفهامٍ للقيم، وبلا دوالِّ تاريخٍ خاصةٍ بمحرّك
// ─────────────────────────────────────────────────────────────────────────────

/**
 * كلُّ ما يحتاجه الكشف من المنصة، بقراءةٍ واحدةٍ لكل جدول.
 * @param {{all: Function}} db طبقةُ القاعدة (القراءة وحدها)
 * @param {string} sectorId معرّف القطاع
 */
async function readLive(db, sectorId) {
  const projects = await db.all(
    `SELECT id, code, name_ar, client_id, department_id, owner_user_id, pm_name, status, rag,
            progress_pct, contract_value_halalas, po_value_halalas, budget_halalas,
            start_date, end_date
       FROM project WHERE deleted_at IS NULL AND sector_id = ? ORDER BY created_at`, [sectorId]);
  const clients = await db.all(
    'SELECT id, name_ar, name_en FROM client WHERE deleted_at IS NULL ORDER BY name_ar');
  const departments = await db.all(
    'SELECT id, name_ar FROM department WHERE deleted_at IS NULL AND sector_id = ? ORDER BY name_ar', [sectorId]);
  const employees = await db.all(
    `SELECT e.id, e.name_ar, e.name_en, e.department_id, e.job_title, e.user_id,
            e.hire_date, e.capacity_pct, u.email AS user_email
       FROM employee e
       LEFT JOIN app_user u ON u.id = e.user_id AND u.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.sector_id = ? ORDER BY e.name_ar`, [sectorId]);
  const deliverables = await db.all(
    `SELECT d.id, d.project_id, d.name_ar, d.amount_halalas, d.month, d.year, d.status,
            d.phase_id, d.notes, d.invoiced_at, d.collected_at,
            d.delivered_at, d.accepted_at, d.status_at, d.created_at
       FROM deliverable d JOIN project p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = ?`, [sectorId]);
  const phases = await db.all(
    `SELECT f.id, f.project_id, f.name_ar
       FROM project_phase f JOIN project p ON p.id = f.project_id
      WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = ?`, [sectorId]);
  const allocations = await db.all(
    `SELECT a.id, a.employee_id, a.project_id, a.year, a.type, a.month_start, a.month_end, a.monthly_json
       FROM allocation a JOIN project p ON p.id = a.project_id
      WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.sector_id = ?`, [sectorId]);
  return { projects, clients, departments, employees, deliverables, phases, allocations };
}

/**
 * القطاعُ المقصود: ما مُرِّر صراحةً، وإلا اسمُ القطاع من خانة هوية الدفتر.
 * يُطابَق بالمعرّف حرفياً ثم بالاسم حرفياً ثم بتسامحِ الأسماء — ويُردّ بعبارةٍ عربيةٍ إن لم يُعرف.
 */
async function resolveSector(db, { wanted, identityName }) {
  const all = await db.all('SELECT id, name_ar FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  const want = trim(wanted);
  if (want) {
    const byId = all.find((s) => String(s.id) === want);
    if (byId) return { ...byId, rule: 'معرّف صريح' };
    const exact = await db.all(
      'SELECT id, name_ar FROM sector WHERE name_ar = ? AND deleted_at IS NULL', [want]);
    if (exact.length === 1) return { ...exact[0], rule: 'اسم صريح' };
    const m = matchOne(want, all);
    if (m.hit) return { ...m.hit, rule: 'اسمٌ مقارب' };
    throw new Error(`لا قطاع في المنصة باسم «${want}» أو بمعرّفه — راجع الاسم أو مرّر معرّف القطاع`);
  }
  const name = trim(identityName);
  if (!name) throw new Error('الدفتر لا يحمل اسم القطاع في بيان الدفتر — مرّر القطاع بنفسك');
  const exact = await db.all(
    'SELECT id, name_ar FROM sector WHERE name_ar = ? AND deleted_at IS NULL', [name]);
  if (exact.length === 1) return { ...exact[0], rule: 'اسم الدفتر' };
  const m = matchOne(name, all);
  if (m.hit) return { ...m.hit, rule: 'اسم الدفتر مقارباً' };
  throw new Error(`قطاع الدفتر «${name}» لا نظير له في المنصة — مرّر القطاع الصحيح`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 خرائط الأعمدة: حقلُ المنصة ← عمودُ الدفتر
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_MAP = {
  status: { header: 'حالة المشروع', kind: 'enum', map: projectStatusKey },
  rag: { header: 'مؤشر الصحة', kind: 'enum', map: ragKey },
  progress_pct: { header: 'نسبة الإنجاز (%)', kind: 'int' },
  start_date: { header: 'تاريخ البداية', kind: 'date' },
  end_date: { header: 'تاريخ النهاية', kind: 'date' },
  contract_value_halalas: { header: 'قيمة العقد بدون ضريبة', kind: 'money' },
  pm_name: { header: 'مدير المشروع' },
};
// الميزانية وأمر الشراء يُكتبان في الدفتر **كما يُخزَّنان** (عمودهما لا يقول «بدون ضريبة»)،
// فلا تُضاف إليهما ضريبة — بخلاف قيمة العقد ومبلغ المخرج.
const PROJECT_PLAIN_MONEY = {
  budget_halalas: 'الميزانية (ريال)',
  po_value_halalas: 'قيمة أمر الشراء',
};
const MONEY_FIELD_OUT = {
  contract_value_halalas: 'contract_value_sar',
  budget_halalas: 'budget_sar',
  po_value_halalas: 'po_value_sar',
  amount_halalas: 'amount_sar',
};
const DELIVERABLE_MAP = {
  amount_halalas: { header: 'المبلغ بدون ضريبة', kind: 'money' },
  status: { header: 'حالة المخرج', kind: 'enum', map: deliverableStatusKey },
  notes: { header: 'ملاحظة' },
};
const EMPLOYEE_MAP = {
  name_en: { header: 'الاسم الإنجليزي' },
  job_title: { header: 'المسمى الوظيفي' },
  employment_type: { header: 'نوع التوظيف' },
  hire_date: { header: 'تاريخ التعيين', kind: 'date' },
  capacity_pct: { header: 'الطاقة %', kind: 'int' },
};
const YES = new Set(['نعم', 'نعم ', 'صح', 'تم']);
const isYes = (v) => YES.has(normArabic(v)) || normArabic(v) === 'نعم';

// حقولٌ في الدفتر لا يكتبها التطبيق — تُقال صراحةً ولا تُدسّ في الخطة.
const NOT_WRITTEN_AR = [
  'رقم الفاتورة وتاريخها وتاريخ التحصيل — تُسجَّل من صفحة المالية عند إصدار المستخلص وتحصيله.',
  'تاريخ التسليم وتاريخ الاعتماد — يُختمان لحظة تغيير حالة المخرج، لا من جدول.',
  'تاريخ توقيع العقد وتاريخ الاستحقاق والمسؤول عن المخرج — لا يكتبها مسار الاستيراد اليوم.',
  'البريد الإلكتروني ومديرو الإدارات — لا يُنشئ الاستيراد حسابات دخول؛ تُسلَّم قائمةً لمسؤول الأنظمة.',
  'نسبة الدوام للموظف الجديد — تُكتب من صفحة الموظف بعد إنشائه.',
  'نسبة الإنجاز وقيمة أمر الشراء لمشروعٍ **جديد** — تُكتبان بعد إنشائه من صفحة المشروع.',
];

// ─────────────────────────────────────────────────────────────────────────────
// §3 الإيراد المعترف به — القاعدة نفسها التي تكتب سطر الإيراد
// ─────────────────────────────────────────────────────────────────────────────

// «سُلِّم» و«اعتُمد» وحدهما اعترافٌ بالإيراد، والمبلغ فوق الصفر — حرفاً كما في
// src/modules/finance/recognition.js، والسنةُ الصريحة تسبق تاريخَ الحدث (revenue-period.js).
const RECOGNIZING = new Set(['DELIVERED', 'ACCEPTED']);
function recognizedYear(state) {
  if (!RECOGNIZING.has(String(state.status || ''))) return null;
  if (!(Number(state.amount_halalas || 0) > 0)) return null;
  if (state.year) return Number(state.year);
  const stamp = String(state.accepted_at || state.delivered_at || state.status_at || state.created_at || '');
  const y = Number(stamp.slice(0, 4));
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
}
/** الإيراد الصافي بالريال من المبلغ الإجمالي المخزَّن بالهللات. */
const netSarOf = (halalas) => netOfGross(Math.round(Number(halalas || 0))) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// §4 بناء الخطة
// ─────────────────────────────────────────────────────────────────────────────

class Plan {
  constructor(meta) {
    this.meta = meta;
    this.clients = []; this.projects = []; this.phases = [];
    this.deliverables = []; this.employees = []; this.allocations = [];
    this.conflicts = [];
    this.matches = { projects: [], employees: [], clients: [] };
    this.reported_only = {
      invoiced_without_date: [], collected_without_invoice: [], example_residue: [],
      accounts_csv: [], unparsable: [], ambiguous_dates: [], period_incomplete: [],
      allocations_already_live: [], allocation_role_differs: [],
    };
    this.totals = { counts: {}, revenue_delta_by_year: {}, revenue_by_year: {} };
  }

  conflict(kind, where, why) { this.conflicts.push({ kind, where, why }); }
}

/** فرقٌ واحدٌ للعرض: الحقل واسمه العربي وقيمته قبل وبعد. */
const show = (field, before, after) => ({ field, ar: FIELD_AR[field] || field, before, after });

/**
 * يبني خطة المطابقة كاملةً من الدفتر ومن حال المنصة.
 * لا يلمس القاعدة: كل ما يحتاجه وصله في `live`.
 */
export function buildPlan(wb, live, { sector, year, file, projectMap = null, employeeMap = null }) {
  // الخريطةُ تسبق كلَّ شيء: معرّفٌ لا وجود له يوقف الكشف قبل أن يُبنى منه سطرٌ واحد.
  assertMapIdsLive(projectMap, live.projects, 'المشاريع');
  assertMapIdsLive(employeeMap, live.employees, 'الزملاء');
  const liveProjectById = new Map(live.projects.map((r) => [String(r.id), r]));
  const liveEmployeeById = new Map(live.employees.map((r) => [String(r.id), r]));
  const plan = new Plan({
    tool: 'reconcile-workbook',
    file,
    sha256: wb.sha256,
    sector_id: sector.id,
    sector_name: sector.name_ar,
    reviewer: wb.identity.reviewer || null,
    generated_at: nowIso(),
    staffing_year: year,
    project_map_file: projectMap?.path || null,
    employee_map_file: employeeMap?.path || null,
  });
  const counts = plan.totals.counts;
  const sheetCount = (key, rows) => {
    counts[key] = counts[key] || { rows: rows.length, matched: 0, update: 0, create: 0, skipped: 0 };
    return counts[key];
  };

  // بقايا صف المثال — من قراءة الدفتر نفسها، ورقةً ورقة.
  for (const [key, sh] of Object.entries(wb.sheets)) {
    for (const r of sh.rows) {
      for (const h of r.residue) {
        plan.reported_only.example_residue.push({ sheet: sh.name, sheet_key: key, row: r.rowNo, column: h });
      }
    }
  }
  // قضايا القراءة (بلا أصل، عمودٌ لم يُفهم) تُنقل كما هي.
  for (const i of wb.issues) {
    plan.reported_only.unparsable.push({ sheet: i.sheet, row: i.rowNo, column: i.header, why: i.reason });
  }

  // ── الإدارات ───────────────────────────────────────────────────────────────
  const deptOf = (name, where) => {
    const q = trim(name);
    if (!q) return null;
    const m = matchOne(q, live.departments, { threshold: 0.85, gap: 0.1 });
    if (m.hit) return m.hit;
    plan.conflict('إدارة غير معروفة', where,
      `الإدارة «${q}» ليست من إدارات ${sector.name_ar} المسجَّلة (${live.departments.map((d) => d.name_ar).join('، ') || 'لا إدارات'}) — أنشئها في المنصة أو صحّح الاسم في الدفتر`);
    return null;
  };
  const deptName = (id) => live.departments.find((d) => d.id === id)?.name_ar || '—';

  // ── العملاء ────────────────────────────────────────────────────────────────
  const clientCounts = sheetCount('clients', wb.sheets.clients?.rows || []);
  // أسماء الجهات تُقرأ من ورقة العملاء **ومن عمود العميل في ورقة المشاريع** — فورقةٌ فارغة
  // لا تعني أن لا جهات في الدفتر، ولذلك يُعدّ الصفُّ هنا بالأسماء المميّزة لا بسطور الورقة.
  const clientRefs = new Map();           // اسمٌ مطبَّع ← {id} أو {ref}
  const clientNames = [];
  for (const r of (wb.sheets.clients?.rows || [])) {
    const n = trim(r.cells['اسم العميل']);
    if (n) clientNames.push({ name: n, where: `ورقة العملاء · سطر ${r.rowNo}` });
  }
  for (const r of (wb.sheets.projects?.rows || [])) {
    const n = trim(r.cells['العميل']);
    if (n) clientNames.push({ name: n, where: `ورقة المشاريع · سطر ${r.rowNo}` });
  }
  for (const { name, where } of clientNames) {
    const key = normArabic(name);
    if (clientRefs.has(key)) continue;
    const m = matchOne(name, live.clients, { threshold: 1.01, gap: 0.15 });   // حرفيٌّ أو احتواء وحده
    if (m.ambiguous) {
      plan.conflict('عميل ملتبس', where, `«${name}» يحتمل أكثر من جهةٍ مسجَّلة — حدّد الاسم كما هو في المنصة`);
      clientRefs.set(key, null);
      continue;
    }
    if (m.hit) {
      clientRefs.set(key, { id: m.hit.id, name: m.hit.name_ar });
      plan.matches.clients.push({ sheet: name, live: m.hit.name_ar, score: m.score, rule: m.rule });
      clientCounts.matched += 1;
      continue;
    }
    const ref = `cl${plan.clients.length + 1}`;
    plan.clients.push({ op: 'create', ref, name_ar: name });
    clientRefs.set(key, { ref, name });
    plan.matches.clients.push({ sheet: name, live: null, score: 0, rule: null });
    clientCounts.create += 1;
  }
  clientCounts.rows = clientRefs.size;
  const clientFor = (name) => (name ? clientRefs.get(normArabic(name)) || null : null);
  const clientLiveName = (id) => live.clients.find((c) => c.id === id)?.name_ar || '—';

  // ── المشاريع ───────────────────────────────────────────────────────────────
  const pCounts = sheetCount('projects', wb.sheets.projects?.rows || []);
  const projectRefs = new Map();          // اسمٌ مطبَّع في الدفتر ← {id|ref, name}
  const usedLiveProjects = new Set();
  for (const r of (wb.sheets.projects?.rows || [])) {
    const name = trim(r.cells['اسم المشروع']);
    const where = `ورقة المشاريع · سطر ${r.rowNo}`;
    if (!name) { pCounts.skipped += 1; continue; }
    collectAmbiguousDates(plan, r, ['تاريخ البداية', 'تاريخ النهاية', 'تاريخ توقيع العقد'], where, name);
    const pMapped = projectMap?.byName.get(normArabic(name)) || null;
    const m = pMapped
      ? mapHit(pMapped, liveProjectById.get(String(pMapped.live_id)))
      : matchOne(name, live.projects, { threshold: 0.7, gap: 0.15 });
    const dept = deptOf(r.cells['الإدارة'], `${where} · «${name}»`);
    const client = clientFor(r.cells['العميل']);

    if (m.ambiguous) {
      plan.conflict('مشروع ملتبس', where,
        `«${name}» يقارب أكثر من مشروعٍ قائم (أقربها «${m.hit?.name_ar || m.runnerUp?.name_ar || '—'}») — سمِّه كما هو في المنصة`);
      plan.matches.projects.push({ sheet: name, live: null, score: m.score, rule: m.rule, decision: 'تعارض' });
      pCounts.skipped += 1;
      projectRefs.set(normArabic(name), null);
      continue;
    }
    if (m.hit) {
      if (usedLiveProjects.has(m.hit.id)) {
        plan.conflict('مشروعان لصفٍّ واحد', where,
          `«${name}» يُطابق المشروع نفسه الذي طابقه سطرٌ قبله («${m.hit.name_ar}») — احذف التكرار من الدفتر`);
        pCounts.skipped += 1;
        projectRefs.set(normArabic(name), null);
        continue;
      }
      usedLiveProjects.add(m.hit.id);
      const patch = diffOf(m.hit, r, PROJECT_MAP);
      const display = [];
      for (const [field, val] of Object.entries(patch)) {
        if (field === 'status') display.push(show(field, projectStatusAr(m.hit.status), projectStatusAr(val)));
        else if (field === 'rag') display.push(show(field, ragAr(m.hit.rag), ragAr(val)));
        else if (field === 'contract_value_halalas') display.push(show('contract_value_sar', num2(halToSar(m.hit.contract_value_halalas)), num2(halToSar(val))));
        else display.push(show(field, m.hit[field] ?? '—', val));
      }
      plainMoney(patch, display, m.hit, r);
      renameMoney(patch);
      if (dept && dept.id !== m.hit.department_id) {
        patch.department_id = dept.id;
        display.push(show('department_id', deptName(m.hit.department_id), dept.name_ar));
      }
      if (client && !m.hit.client_id) {
        if (client.id) { patch.client_id = client.id; display.push(show('client_id', '—', client.name)); }
        else { patch.client_ref = client.ref; display.push(show('client_ref', '—', client.name)); }
      }
      plan.matches.projects.push({ sheet: name, live: m.hit.name_ar, score: m.score, rule: m.rule, evidence: m.evidence || null, decision: Object.keys(patch).length ? 'تصحيح' : 'لا جديد' });
      pCounts.matched += 1;
      projectRefs.set(normArabic(name), { id: m.hit.id, name: m.hit.name_ar });
      if (Object.keys(patch).length) {
        plan.projects.push({ op: 'update', id: m.hit.id, live_name: m.hit.name_ar, sheet_name: name, score: m.score, rule: m.rule, evidence: m.evidence || null, patch, display });
        pCounts.update += 1;
      } else pCounts.skipped += 1;
      continue;
    }
    // لا مطابق: مشروعٌ جديد — ولا يُنشأ بلا جهةٍ يعمل لها.
    if (!client) {
      plan.conflict('مشروع جديد بلا عميل', where,
        `«${name}» لا نظير له في المنصة، وخانة العميل فارغة أو ملتبسة — الجهة شرطٌ لإنشاء مشروع`);
      plan.matches.projects.push({ sheet: name, live: null, score: m.score, rule: m.rule, decision: 'تعارض' });
      pCounts.skipped += 1;
      projectRefs.set(normArabic(name), null);
      continue;
    }
    const data = diffOf(null, r, PROJECT_MAP);
    const display = [];
    for (const [field, val] of Object.entries(data)) {
      if (field === 'status') display.push(show(field, '—', projectStatusAr(val)));
      else if (field === 'rag') display.push(show(field, '—', ragAr(val)));
      else display.push(show(field === 'contract_value_halalas' ? 'contract_value_sar' : field, '—',
        field === 'contract_value_halalas' ? num2(halToSar(val)) : val));
    }
    plainMoney(data, display, null, r);
    renameMoney(data);
    data.name_ar = name;
    // بابُ إنشاء المشروع لا يكتب نسبة الإنجاز ولا قيمة أمر الشراء — تُحذفان من الخطة
    // ومن العرض معاً كي لا يَعِد التقريرُ بما لن يُكتب، وهما مذكورتان في «حقولٌ لا تُكتب».
    for (const f of ['progress_pct', 'po_value_sar']) {
      if (data[f] == null) continue;
      delete data[f];
      const i = display.findIndex((d) => d.field === f);
      if (i >= 0) display.splice(i, 1);
    }
    if (dept) { data.department_id = dept.id; display.push(show('department_id', '—', dept.name_ar)); }
    if (client.id) { data.client_id = client.id; display.push(show('client_id', '—', client.name)); }
    else { data.client_ref = client.ref; display.push(show('client_ref', '—', client.name)); }
    const ref = `pr${plan.projects.filter((x) => x.op === 'create').length + 1}`;
    plan.projects.push({ op: 'create', ref, sheet_name: name, data, display });
    plan.matches.projects.push({ sheet: name, live: null, score: m.score, rule: m.rule, decision: 'إضافة' });
    projectRefs.set(normArabic(name), { ref, name });
    pCounts.create += 1;
  }
  const projectFor = (name) => (name ? projectRefs.get(normArabic(name)) ?? undefined : undefined);
  /** يُلحق مرجعَ المشروع بعنصرٍ في الخطة كما يفهمه التطبيق (معرّفٌ قائم أو مرجعُ مولودٍ في الجولة). */
  const attachProject = (obj, p) => {
    if (p.id) obj.project_id = p.id; else obj.project_ref = p.ref;
    obj.project_name = p.name;
    return obj;
  };

  // ── المراحل («المعلم» في ورقة المخرجات) ────────────────────────────────────
  const phaseRefs = new Map();            // `${projectKey}|${phaseName}` ← {id|ref}
  const phaseKeyOf = (pk, n) => `${pk}|${normArabic(n)}`;
  const dlvRows = wb.sheets.deliverables?.rows || [];
  for (const r of dlvRows) {
    const pname = trim(r.parent);
    const phName = trim(r.cells['المعلم']);
    if (!phName) continue;
    const p = projectFor(pname);
    if (!p) continue;
    const pk = p.id || p.ref;
    const key = phaseKeyOf(pk, phName);
    if (phaseRefs.has(key)) continue;
    const livePhases = p.id ? live.phases.filter((f) => f.project_id === p.id) : [];
    const hit = livePhases.find((f) => normArabic(f.name_ar) === normArabic(phName));
    if (hit) { phaseRefs.set(key, { id: hit.id, name: hit.name_ar }); continue; }
    const ref = `ph${plan.phases.length + 1}`;
    plan.phases.push(attachProject({ ref, name_ar: phName }, p));
    phaseRefs.set(key, { ref, name: phName });
  }

  // ── المخرجات ───────────────────────────────────────────────────────────────
  const dCounts = sheetCount('deliverables', dlvRows);
  const usedLiveDlv = new Set();
  const orphanCounts = new Map();
  const revBefore = {}; const revAfter = {};
  const addRev = (bucket, y, v) => { if (y == null) return; bucket[y] = (bucket[y] || 0) + v; };

  for (const r of dlvRows) {
    const where = `ورقة المخرجات · سطر ${r.rowNo}`;
    const name = trim(r.cells['المخرج']);
    const pname = trim(r.parent);
    const p = projectFor(pname);
    if (!name) { dCounts.skipped += 1; continue; }
    if (!p) {
      dCounts.skipped += 1;
      orphanCounts.set(pname, (orphanCounts.get(pname) || 0) + 1);
      continue;
    }
    collectAmbiguousDates(plan, r, ['تاريخ الاستحقاق'], where, name);

    // الفوترة والتحصيل: يُذكران ولا يُكتبان — قرارُ المالك.
    const netSar = numberOf(r.cells['المبلغ بدون ضريبة']);
    if (isYes(r.cells['مفوتر؟'])) {
      const invDate = parseDateCell(r.cells['تاريخ الفاتورة']).date;
      plan.reported_only.invoiced_without_date.push({
        name, project: p.name, amount_sar: netSar, row: r.rowNo,
        invoice_no: trim(r.cells['رقم الفاتورة']) || null,
        had_date: !!invDate, date: invDate || null,
      });
    }
    if (isYes(r.cells['محصَّل؟'])) {
      plan.reported_only.collected_without_invoice.push({
        name, project: p.name, amount_sar: netSar, row: r.rowNo,
        date: parseDateCell(r.cells['تاريخ التحصيل']).date || null,
      });
    }

    // الفترة: شهرٌ وسنةٌ معاً أو لا فترة — نصفُ الفترة يردّه مسار الحفظ أصلاً.
    const month = numberOf(r.cells['شهر الاستحقاق']);
    const yearCell = numberOf(r.cells['سنة الاستحقاق']);
    let period = null;
    if (month != null && yearCell != null
        && Number.isInteger(month) && month >= 1 && month <= 12 && yearCell >= 2000 && yearCell <= 2100) {
      period = `${yearCell}-${String(month).padStart(2, '0')}`;
    } else if (month != null || yearCell != null) {
      plan.reported_only.period_incomplete.push({
        name, project: p.name, row: r.rowNo,
        month: month ?? null, year: yearCell ?? null,
        why: 'شهر الاستحقاق وسنته يُكتبان معاً — أحدهما وحده لا يؤرّخ الإيراد',
      });
    }

    const phName = trim(r.cells['المعلم']);
    const phase = phName ? phaseRefs.get(phaseKeyOf(p.id || p.ref, phName)) : null;
    const candidates = p.id ? live.deliverables.filter((d) => d.project_id === p.id) : [];
    const m = p.id ? matchOne(name, candidates, { threshold: 1.01, gap: 0.15 }) : { hit: null, score: 0, rule: null, ambiguous: false };

    if (m.ambiguous) {
      plan.conflict('مخرج ملتبس', where, `«${name}» في «${p.name}» يقارب أكثر من مخرجٍ قائم — سمِّه كما هو في المنصة`);
      dCounts.skipped += 1;
      continue;
    }
    if (m.hit && usedLiveDlv.has(m.hit.id)) {
      plan.conflict('مخرجان لصفٍّ واحد', where,
        `«${name}» في «${p.name}» يُطابق المخرج الذي طابقه سطرٌ قبله — احذف التكرار من الدفتر`);
      dCounts.skipped += 1;
      continue;
    }
    if (m.hit) {
      usedLiveDlv.add(m.hit.id);
      const patch = diffOf(m.hit, r, DELIVERABLE_MAP);
      const display = [];
      for (const [field, val] of Object.entries(patch)) {
        if (field === 'status') display.push(show(field, dlvStatusAr(m.hit.status), dlvStatusAr(val)));
        else if (field === 'amount_halalas') display.push(show('amount_sar', num2(halToSar(m.hit.amount_halalas)), num2(halToSar(val))));
        else display.push(show(field, m.hit[field] ?? '—', val));
      }
      const liveP = m.hit.year && m.hit.month ? `${m.hit.year}-${String(m.hit.month).padStart(2, '0')}` : null;
      if (period && period !== liveP) { patch.period = period; display.push(show('period', liveP || '—', period)); }
      if (phase && !m.hit.phase_id) {
        if (phase.id) patch.phase_id = phase.id; else patch.phase_ref = phase.ref;
        display.push(show('phase_id', '—', phase.name));
      }
      renameMoney(patch);
      dCounts.matched += 1;
      if (!Object.keys(patch).length) { dCounts.skipped += 1; continue; }
      plan.deliverables.push({ op: 'update', id: m.hit.id, live_name: m.hit.name_ar, sheet_name: name, project_id: m.hit.project_id, project_name: p.name, patch, display });
      dCounts.update += 1;
      revenueDelta(revBefore, revAfter, m.hit, patch, period);
      continue;
    }
    // لم يُطابَق بالاسم: مبلغٌ مساوٍ لمخرجٍ قائمٍ في المشروع نفسه ⇒ تكرارٌ لا إضافة.
    // ويُستثنى من المقارنة مخرجٌ قائمٌ طابقه سطرٌ آخر بالاسم في هذه الجولة: تساوي المبلغين
    // حينئذٍ مفسَّرٌ (مشروعٌ فيه دفعاتٌ متساوية)، لا دليلَ إعادةِ إدخالٍ باسمٍ ثانٍ.
    const gross = netSar == null ? null : netToStoredHalalas(netSar);
    const twin = gross == null ? null : candidates.find((d) => !usedLiveDlv.has(d.id)
      && Number(d.amount_halalas || 0) > 0 && Math.abs(Number(d.amount_halalas || 0) - gross) <= 2);
    if (twin) {
      plan.conflict('مبلغٌ مكرَّر باسمٍ مختلف', where,
        `«${name}» في «${p.name}» لا نظير له بالاسم، لكن مبلغه (${num2(netSar)} ريال) يساوي مبلغ «${twin.name_ar}» المسجَّل — إضافته تعدّ المال مرتين؛ صحّح الاسم في الدفتر أو أكّد أنه عملٌ آخر`);
      dCounts.skipped += 1;
      continue;
    }
    const data = diffOf(null, r, DELIVERABLE_MAP);
    const display = [];
    for (const [field, val] of Object.entries(data)) {
      if (field === 'status') display.push(show(field, '—', dlvStatusAr(val)));
      else if (field === 'amount_halalas') display.push(show('amount_sar', '—', num2(halToSar(val))));
      else display.push(show(field, '—', val));
    }
    data.name_ar = name;
    if (period) { data.period = period; display.push(show('period', '—', period)); }
    if (phase) {
      if (phase.id) data.phase_id = phase.id; else data.phase_ref = phase.ref;
      display.push(show('phase_id', '—', phase.name));
    }
    renameMoney(data);
    const item = attachProject({ op: 'create', sheet_name: name, data, display }, p);
    plan.deliverables.push(item);
    dCounts.create += 1;
    revenueDelta(revBefore, revAfter, null, data, period);
  }
  for (const [pname, n] of orphanCounts) {
    plan.conflict('مخرجات بلا مشروع', 'ورقة المخرجات',
      `${intFmt(n)} مخرجاً تحت «${pname || 'بلا اسم'}» — المشروع نفسه لم يُطابَق أو تعارض، فمخرجاته موقوفة معه`);
  }

  // ── الإيراد المعترف به قبل وبعد ────────────────────────────────────────────
  for (const y of new Set([...Object.keys(revBefore), ...Object.keys(revAfter)])) {
    const b = Math.round((revBefore[y] || 0) * 100) / 100;
    const a = Math.round((revAfter[y] || 0) * 100) / 100;
    const d = Math.round((a - b) * 100) / 100;
    plan.totals.revenue_by_year[y] = { before: b, after: a, delta: d };
    plan.totals.revenue_delta_by_year[y] = d;
  }

  // ── الموظفون ───────────────────────────────────────────────────────────────
  const eCounts = sheetCount('employees', wb.sheets.employees?.rows || []);
  const employeeRefs = new Map();
  const usedLiveEmp = new Set();
  for (const r of (wb.sheets.employees?.rows || [])) {
    const name = trim(r.cells['الاسم']);
    const where = `ورقة الموظفين · سطر ${r.rowNo}`;
    if (!name) { eCounts.skipped += 1; continue; }
    collectAmbiguousDates(plan, r, ['تاريخ التعيين'], where, name);
    const dept = deptOf(r.cells['الإدارة'], `${where} · «${name}»`);
    const email = trim(r.cells['البريد الإلكتروني']);
    const isManager = isYes(r.cells['مدير الإدارة؟']);
    const eMapped = employeeMap?.byName.get(normArabic(name)) || null;
    const m = eMapped
      ? mapHit(eMapped, liveEmployeeById.get(String(eMapped.live_id)))
      : matchOne(name, live.employees, { threshold: 0.85, gap: 0.15 });

    if (m.ambiguous) {
      plan.conflict('موظف ملتبس', where, `«${name}» يقارب أكثر من زميلٍ مسجَّل — اكتب الاسم الرباعي كما هو في المنصة`);
      eCounts.skipped += 1;
      employeeRefs.set(normArabic(name), null);
    } else if (m.hit) {
      if (usedLiveEmp.has(m.hit.id)) {
        plan.conflict('موظفان لصفٍّ واحد', where, `«${name}» يُطابق الزميل الذي طابقه سطرٌ قبله («${m.hit.name_ar}») — احذف التكرار`);
        eCounts.skipped += 1;
        employeeRefs.set(normArabic(name), null);
      } else {
        usedLiveEmp.add(m.hit.id);
        employeeRefs.set(normArabic(name), { id: m.hit.id, name: m.hit.name_ar });
        plan.matches.employees.push({ sheet: name, live: m.hit.name_ar, score: m.score, rule: m.rule, evidence: m.evidence || null });
        eCounts.matched += 1;
        const patch = {}; const display = [];
        const jt = trim(r.cells['المسمى الوظيفي']);
        if (jt && !r.residue.includes('المسمى الوظيفي') && jt !== trim(m.hit.job_title)) {
          patch.job_title = jt; display.push(show('job_title', m.hit.job_title || '—', jt));
        }
        if (dept && dept.id !== m.hit.department_id) {
          patch.department_id = dept.id; display.push(show('department_id', deptName(m.hit.department_id), dept.name_ar));
        }
        if (Object.keys(patch).length) {
          plan.employees.push({ op: 'update', id: m.hit.id, live_name: m.hit.name_ar, sheet_name: name, patch, display });
          eCounts.update += 1;
        } else eCounts.skipped += 1;
        pushAccountRow(plan, { name: m.hit.name_ar, email, dept: dept?.name_ar || deptName(m.hit.department_id), isManager, live: m.hit });
        continue;
      }
    } else {
      const data = diffOf(null, r, EMPLOYEE_MAP);
      const display = Object.entries(data).map(([f, v]) => show(f, '—', v));
      data.name_ar = name;
      if (dept) { data.department_id = dept.id; display.push(show('department_id', '—', dept.name_ar)); }
      const ref = `em${plan.employees.filter((x) => x.op === 'create').length + 1}`;
      plan.employees.push({ op: 'create', ref, sheet_name: name, data, display });
      employeeRefs.set(normArabic(name), { ref, name });
      eCounts.create += 1;
      pushAccountRow(plan, { name, email, dept: dept?.name_ar || '—', isManager, live: null });
      continue;
    }
    pushAccountRow(plan, { name, email, dept: dept?.name_ar || '—', isManager, live: null });
  }
  const employeeFor = (name) => (name ? employeeRefs.get(normArabic(name)) ?? undefined : undefined);

  // ── التسكين ────────────────────────────────────────────────────────────────
  const sCounts = sheetCount('staffing', wb.sheets.staffing?.rows || []);
  const seen = new Set();
  for (const r of (wb.sheets.staffing?.rows || [])) {
    const where = `ورقة التسكين · سطر ${r.rowNo}`;
    const empName = trim(r.cells['الموظف']);
    const pname = trim(r.parent || r.cells['المشروع']);
    const p = projectFor(pname);
    const e = employeeFor(empName);
    if (!empName || !pname) { sCounts.skipped += 1; continue; }
    if (!p) {
      plan.conflict('تسكين بلا مشروع', where, `«${empName}» على «${pname}» — المشروع لم يُطابَق أو تعارض، فالتسكين موقوف معه`);
      sCounts.skipped += 1; continue;
    }
    if (!e) {
      plan.conflict('تسكين بلا موظف', where, `«${empName}» على «${p.name}» — الاسم لم يُطابَق زميلاً في ${sector.name_ar} ولا أُضيف، فالتسكين موقوف`);
      sCounts.skipped += 1; continue;
    }
    let type = allocationTypeKey(r.cells['الدور']);
    if (!type) {
      type = 'member';
      plan.reported_only.unparsable.push({
        sheet: 'التسكين', row: r.rowNo, column: 'الدور', value: r.cells['الدور'] ?? null,
        why: 'الصفة غير معروفة — سُجِّل عضو فريق، فصحّحها من القائمة إن كانت غير ذلك',
      });
    }
    const yearCell = numberOf(r.cells['السنة']);
    const y = yearCell && yearCell >= 2000 && yearCell <= 2100 ? Math.round(yearCell) : year;
    const from = Math.max(1, Math.min(12, Math.round(numberOf(r.cells['من شهر']) ?? 1)));
    const to = Math.max(from, Math.min(12, Math.round(numberOf(r.cells['إلى شهر']) ?? 12)));
    const pct = Math.max(0, Math.min(150, Math.round(numberOf(r.cells['الإشغال (%)']) ?? 100)));
    // المنصةُ لا تحفظ للشخص إلا تسكيناً واحداً على المشروع في السنة مهما اختلفت الصفة، فالمفتاحُ
    // هنا بالشخص والمشروع والسنة وحدها — لا بالصفة. وبغير ذلك يُخطَّط سطرٌ ثانٍ ترفضه المنصة.
    const key = `${e.id || e.ref}|${p.id || p.ref}|${y}`;
    if (seen.has(key)) { sCounts.skipped += 1; continue; }
    seen.add(key);
    const liveAlloc = (e.id && p.id)
      ? live.allocations.find((a) => a.employee_id === e.id && a.project_id === p.id && Number(a.year) === y)
      : null;
    if (liveAlloc) {
      // قائمٌ على المنصة. فإن اختلفت الصفةُ بقيت صفةُ المنصة كما هي بقرار المالك، ويُذكر الفرق
      // ولا يُكتب. وإن اتّفقت فهو المسجَّلُ أصلاً كما كان — ويُذكر معه فرقُ الحِمل إن وُجد.
      const liveType = String(liveAlloc.type || '') || null;
      const load = liveLoadOf(liveAlloc);
      const entry = {
        employee: e.name, project: p.name, year: y,
        live_role: liveType, workbook_role: type,
        live_role_ar: roleAr(liveType), workbook_role_ar: roleAr(type),
        pct_live: load.pct, pct_workbook: pct, pct_live_varies: load.pct_varies,
        months_live: (load.fromMonth != null && load.toMonth != null) ? `${load.fromMonth}–${load.toMonth}` : null,
        months_workbook: `${from}–${to}`,
        load_differs: load.pct !== pct || load.fromMonth !== from || load.toMonth !== to,
      };
      if (liveType !== type) plan.reported_only.allocation_role_differs.push(entry);
      else plan.reported_only.allocations_already_live.push({ ...entry, type, type_ar: roleAr(type) });
      sCounts.skipped += 1;
      continue;
    }
    const item = attachProject({ type, pct, fromMonth: from, toMonth: to, year: y, employee_name: e.name, type_ar: roleAr(type) }, p);
    if (e.id) item.employee_id = e.id; else item.employee_ref = e.ref;
    plan.allocations.push(item);
    sCounts.create += 1;
  }

  // أوراقٌ لم تُقرأ صفوفُها أصلاً تُذكر بأصفارها كي لا يظنّ القارئ أنها طُبِّقت.
  for (const key of ['opportunities', 'oppteam', 'employeetargets', 'costlines']) {
    sheetCount(key, wb.sheets[key]?.rows || []);
    counts[key].skipped = counts[key].rows;
  }

  // سطرُ خريطةٍ لم يجد اسمَه في الدفتر ليس خبراً محايداً: إمّا الاسم كُتب بغير ما في الخريطة،
  // وإمّا الصفُّ حُذف من الدفتر. يُذكر في التقرير ليُراجع، ولا يوقف الكشف.
  const unusedOf = (map) => (map ? [...map.byName.values()].filter((e) => !e.used).map((e) => e.workbook_name) : []);
  plan.meta.project_map_unused = unusedOf(projectMap);
  plan.meta.employee_map_unused = unusedOf(employeeMap);
  plan.meta.project_map_used = projectMap ? [...projectMap.byName.values()].filter((e) => e.used).length : 0;
  plan.meta.employee_map_used = employeeMap ? [...employeeMap.byName.values()].filter((e) => e.used).length : 0;
  return plan;
}

/** المبالغ التي تُكتب في الدفتر كما تُخزَّن (بلا إضافة ضريبة): الميزانية وأمر الشراء. */
function plainMoney(target, display, live, row) {
  for (const [field, header] of Object.entries(PROJECT_PLAIN_MONEY)) {
    if (row.residue.includes(header)) continue;
    const n = numberOf(row.cells[header]);
    if (n == null) continue;
    const next = sarToHal(n);
    if (live && Math.abs(next - Number(live[field] || 0)) <= 2) continue;
    target[field] = next;
    display.push(show(MONEY_FIELD_OUT[field], live ? num2(halToSar(live[field])) : '—', num2(n)));
  }
}

/** الهللات المخزَّنة ⟵ الريال الذي تقبله الخدمات (‏`toHalalas` تتولّى العودة). */
function renameMoney(obj) {
  for (const [field, out] of Object.entries(MONEY_FIELD_OUT)) {
    if (obj[field] == null) continue;
    obj[out] = halToSar(obj[field]);
    delete obj[field];
  }
}

/** التواريخ الملتبسة: تُذكر بقراءتيها ولا تُكتب. */
function collectAmbiguousDates(plan, row, headers, where, subject) {
  for (const h of headers) {
    const raw = row.cells[h];
    if (raw == null || raw === '' || row.residue.includes(h)) continue;
    const d = parseDateCell(raw);
    if (d.ambiguous) {
      plan.reported_only.ambiguous_dates.push({
        where, subject, column: h, value: String(raw),
        as_day_month: d.ambiguous.dmy, as_month_day: d.ambiguous.mdy, why: d.reason,
      });
    } else if (!d.date && d.reason && d.reason !== 'خانة فارغة') {
      plan.reported_only.unparsable.push({ sheet: where, row: row.rowNo, column: h, value: String(raw), why: d.reason });
    }
  }
}

/** صفٌّ في قائمة مسؤول الأنظمة: بريدٌ أو صفةُ مديرِ إدارةٍ لا يكتبهما الاستيراد. */
function pushAccountRow(plan, { name, email, dept, isManager, live }) {
  if (!email && !isManager) return;
  const malformed = !!email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email);
  plan.reported_only.accounts_csv.push({
    name, email: email || null, department: dept || '—',
    is_manager: !!isManager, has_account: !!(live && live.user_email),
    current_email: live?.user_email || null,
    note: malformed ? 'البريد ناقصٌ أو غير مكتمل — راجعه' : '',
  });
}

/** أثرُ صفٍّ واحدٍ على الإيراد المعترف به: الحال قبل، والحال بعد تطبيق الرقعة. */
function revenueDelta(before, after, liveRow, patchOrData, period) {
  const now = nowIso();
  const stateBefore = liveRow
    ? { status: liveRow.status, amount_halalas: liveRow.amount_halalas, year: liveRow.year,
      accepted_at: liveRow.accepted_at, delivered_at: liveRow.delivered_at, status_at: liveRow.status_at, created_at: liveRow.created_at }
    : null;
  const nextStatus = 'status' in patchOrData ? patchOrData.status : (liveRow ? liveRow.status : 'DRAFT');
  const nextAmount = patchOrData.amount_sar != null
    ? sarToHal(patchOrData.amount_sar)
    : Number(liveRow?.amount_halalas || 0);
  const nextYear = period ? Number(period.slice(0, 4)) : (liveRow?.year ?? null);
  const statusChanged = 'status' in patchOrData && (!liveRow || patchOrData.status !== liveRow.status);
  const stateAfter = {
    status: nextStatus, amount_halalas: nextAmount, year: nextYear,
    // التطبيق يختم `status_at` بلحظته عند كل تغيير حالة، ومخرجٌ جديدٌ يُختم بها دائماً.
    accepted_at: statusChanged ? null : liveRow?.accepted_at,
    delivered_at: statusChanged ? null : liveRow?.delivered_at,
    status_at: statusChanged || !liveRow ? now : liveRow?.status_at,
    created_at: liveRow?.created_at || now,
  };
  const yb = stateBefore ? recognizedYear(stateBefore) : null;
  const ya = recognizedYear(stateAfter);
  if (yb != null) before[yb] = (before[yb] || 0) + netSarOf(stateBefore.amount_halalas);
  if (yb != null) after[yb] = after[yb] || 0;
  if (ya != null) {
    after[ya] = (after[ya] || 0) + netSarOf(stateAfter.amount_halalas);
    before[ya] = before[ya] || 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 التقرير العربي
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_AR = {
  clients: 'العملاء', opportunities: 'الفرص', oppteam: 'فريق الفرصة', projects: 'المشاريع',
  deliverables: 'المخرجات', employees: 'الموظفون', employeetargets: 'مستهدفات الموظفين',
  staffing: 'التسكين', costlines: 'التكاليف',
};
const RULE_AR = { exact: 'تطابق حرفي', contains: 'احتواء', jaccard: 'تشابه كلمات', map: 'خريطةٌ مُعتمدة' };
const MAX_LIST = 400;   // حدُّ ما يُسرد صفاً صفاً في التقرير — وما فوقه يُلخَّص برقمه

export function renderReport(plan, { live }) {
  const L = []; const p = (s = '') => L.push(s);
  const ro = plan.reported_only;
  let n = 0;
  const head = (t) => { n += 1; p(); p(`## ${arNum(n)} · ${t}`); p(); };

  p(`# تقرير مطابقة دفتر بيانات ${plan.meta.sector_name}`);
  p();
  p(`- الدفتر: \`${plan.meta.file}\``);
  p(`- بصمة الدفتر: \`${plan.meta.sha256}\``);
  p(`- القطاع في المنصة: ${plan.meta.sector_name} · مراجِع الدفتر: ${plan.meta.reviewer || '—'}`);
  p(`- تاريخ الكشف: ${plan.meta.generated_at.slice(0, 10)} · سنة التسكين المفترضة عند غيابها: ${plan.meta.staffing_year}`);
  p();
  p('> هذا كشفٌ لا تطبيق: لم يُكتب في المنصة حرفٌ واحد. وما دونه هنا هو **ما سيُكتب** إن أُذن به.');

  head('خلاصة بالأرقام');
  p('| الورقة | صفوف في الدفتر | طُوبقت على المنصة | ستُصحَّح | ستُضاف | تُركت |');
  p('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [key, c] of Object.entries(plan.totals.counts)) {
    p(`| ${SHEET_AR[key] || key} | ${intFmt(c.rows)} | ${intFmt(c.matched)} | ${intFmt(c.update)} | ${intFmt(c.create)} | ${intFmt(c.skipped)} |`);
  }
  p();
  p(`عملاء سيُضافون: ${intFmt(plan.clients.length)} · مراحل ستُضاف: ${intFmt(plan.phases.length)}`
    + ` · تسكينات ستُسجَّل: ${intFmt(plan.allocations.length)} · تعارضات تنتظر قراراً: ${intFmt(plan.conflicts.length)}.`);

  head('أثر العملية على الإيراد المعترف به');
  const years = Object.keys(plan.totals.revenue_by_year).sort();
  if (!years.length) p('لا أثر: لا مخرج في هذه الخطة يبلغ حالةَ تسليمٍ أو اعتمادٍ بمبلغٍ فوق الصفر.');
  else {
    p('| السنة | قبل (ريال) | بعد (ريال) | الفرق (ريال) |');
    p('| --- | ---: | ---: | ---: |');
    let tb = 0; let ta = 0;
    for (const y of years) {
      const r = plan.totals.revenue_by_year[y];
      tb += r.before; ta += r.after;
      p(`| ${y} | ${num2(r.before)} | ${num2(r.after)} | ${num2(r.delta)} |`);
    }
    p(`| **المجموع** | **${num2(tb)}** | **${num2(ta)}** | **${num2(ta - tb)}** |`);
    p();
    p('الأرقام **بدون ضريبة** (كما يُحسب الإيراد المعترف به)، وتخصّ المخرجات التي تمسّها هذه الخطة وحدها لا إيراد القطاع كلَّه.');
    p('والاعتراف يقع على «تم التسليم» و«تم الاعتماد» وحدهما؛ ومخرجٌ بلا شهر استحقاقٍ يُنسب إلى سنة تغيير حالته — لذلك يُرجى ملء شهر الاستحقاق وسنته قبل التطبيق.');
  }

  head('مطابقة المشاريع');
  if (!plan.matches.projects.length) p('لا مشاريع في الدفتر.');
  else {
    p('| اسمه في الدفتر | اسمه في المنصة | الدرجة | القاعدة | البيّنة | القرار |');
    p('| --- | --- | ---: | --- | --- | --- |');
    for (const m of plan.matches.projects) {
      // اقترانُ الخريطة لا درجةَ له: سببُه بيّنةٌ راجعها إنسان، لا قربُ حروف.
      const score = m.rule === 'map' ? '—' : (m.score ? m.score.toFixed(2) : '—');
      p(`| ${cell(m.sheet)} | ${cell(m.live || 'لا نظير')} | ${score} | ${RULE_AR[m.rule] || '—'} | ${cell(m.evidence || '—')} | ${m.decision} |`);
    }
    p();
    p('الاسم المسجَّل في المنصة **لا يتغيّر**: الدفتر يُطابَق عليه ولا يُصحّحه.');
    if (plan.meta.project_map_file) {
      p();
      p(`اقترانُ ${intFmt(plan.meta.project_map_used || 0)} مشروعاً جاء من خريطةٍ مُعتمدة: ${cell(plan.meta.project_map_file)}.`);
      if (plan.meta.project_map_unused?.length) {
        p(`وفي الخريطة ${intFmt(plan.meta.project_map_unused.length)} سطراً لم يُقابله اسمٌ في الدفتر: ${plan.meta.project_map_unused.map((x) => `«${cell(x)}»`).join('، ')} — راجع كتابة الاسم.`);
      }
    }
  }

  head('التعديلات المقترحة');
  p('### المشاريع');
  p();
  const projUpd = plan.projects.filter((x) => x.op === 'update');
  const projNew = plan.projects.filter((x) => x.op === 'create');
  if (!projUpd.length) p('لا تصحيح على مشروعٍ قائم.');
  for (const it of projUpd) {
    p(`- **${it.live_name}**`);
    for (const d of it.display) p(`  - ${d.ar}: ${cell(d.before)} ← ${cell(d.after)}`);
  }
  if (projNew.length) {
    p();
    p('**مشاريع ستُضاف:**');
    for (const it of projNew) {
      p(`- **${it.data.name_ar}** — ${it.display.map((d) => `${d.ar}: ${cell(d.after)}`).join(' · ') || 'بلا تفاصيل'}`);
    }
  }
  p();
  p('### المخرجات');
  p();
  const dUpd = plan.deliverables.filter((x) => x.op === 'update');
  const dNew = plan.deliverables.filter((x) => x.op === 'create');
  p(`مخرجات ستُصحَّح: ${intFmt(dUpd.length)} · مخرجات ستُضاف: ${intFmt(dNew.length)}.`);
  p();
  p('المبالغ أدناه **شاملةٌ الضريبة** كما تُخزَّن على المنصة، والدفتر يكتبها بدون ضريبة — فالفرق بينهما خمسة عشر بالمئة لا خطأ في النقل.');
  p();
  const byProject = new Map();
  for (const it of plan.deliverables) {
    const k = it.project_name || '—';
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(it);
  }
  let listed = 0;
  for (const [proj, items] of byProject) {
    p(`- **${proj}** (${intFmt(items.length)})`);
    for (const it of items) {
      if (listed >= MAX_LIST) continue;
      listed += 1;
      const label = it.op === 'create' ? `يُضاف «${it.data.name_ar}»` : `يُصحَّح «${it.live_name}»`;
      p(`  - ${label}: ${it.display.map((d) => `${d.ar}: ${cell(d.before)} ← ${cell(d.after)}`).join(' · ') || 'بلا حقول'}`);
    }
  }
  if (listed >= MAX_LIST) p(`  - … وبقيّة المخرجات مسرودةٌ في ملف الخطة (عُرض ${intFmt(MAX_LIST)} منها هنا).`);
  p();
  p('### الموظفون');
  p();
  if (plan.meta.employee_map_file) {
    const mapped = plan.matches.employees.filter((m) => m.rule === 'map');
    p(`اقترانُ ${intFmt(mapped.length)} زميلاً جاء من خريطةٍ مُعتمدة: ${cell(plan.meta.employee_map_file)}.`);
    for (const m of mapped) p(`- «${cell(m.sheet)}» ← **${cell(m.live)}** — ${cell(m.evidence || 'اقترانٌ مُقرّ')}`);
    if (plan.meta.employee_map_unused?.length) {
      p(`وفي الخريطة ${intFmt(plan.meta.employee_map_unused.length)} سطراً لم يُقابله اسمٌ في الدفتر: ${plan.meta.employee_map_unused.map((x) => `«${cell(x)}»`).join('، ')}.`);
    }
    p();
  }
  if (!plan.employees.length) p('لا تغيير على سجلات الزملاء.');
  for (const it of plan.employees) {
    const label = it.op === 'create' ? `يُضاف «${it.data.name_ar}»` : `يُصحَّح «${it.live_name}»`;
    p(`- ${label}: ${it.display.map((d) => `${d.ar}: ${cell(d.before)} ← ${cell(d.after)}`).join(' · ') || 'بلا حقول'}`);
  }
  p();
  p('### التسكين');
  p();
  if (!plan.allocations.length) p('لا تسكين جديد.');
  for (const it of plan.allocations) {
    p(`- ${it.employee_name} على «${it.project_name}» — ${it.type_ar} · ${intFmt(it.pct)}% · من الشهر ${it.fromMonth} إلى ${it.toMonth} · سنة ${it.year}`);
  }
  if (ro.allocations_already_live.length) {
    p();
    p(`ومسجَّلٌ أصلاً بنفس الصفة (لن يُكرَّر): ${intFmt(ro.allocations_already_live.length)} تسكيناً.`);
  }
  if (ro.allocation_role_differs.length) {
    p();
    p(`وقائمٌ بصفةٍ غير التي في الدفتر: ${intFmt(ro.allocation_role_differs.length)} تسكيناً — تفصيلُها في بابٍ مستقل أدناه، وصفةُ المنصة باقيةٌ كما هي.`);
  }
  if (plan.clients.length || plan.phases.length) {
    p();
    p('### العملاء والمراحل');
    p();
    for (const c of plan.clients) p(`- جهة ستُضاف: **${c.name_ar}**`);
    for (const f of plan.phases) p(`- مرحلة ستُضاف: **${f.name_ar}** على «${f.project_name}»`);
  }
  p();
  p('**حقولٌ في الدفتر لا يكتبها هذا المسار:**');
  for (const s of NOT_WRITTEN_AR) p(`- ${s}`);

  head('التعارضات — تحتاج قراراً قبل التطبيق');
  if (!plan.conflicts.length) p('لا تعارض. ');
  else {
    p('| النوع | الموضع | السبب |');
    p('| --- | --- | --- |');
    for (const c of plan.conflicts) p(`| ${cell(c.kind)} | ${cell(c.where)} | ${cell(c.why)} |`);
  }

  head('مفوتر بلا فاتورة');
  p('«مفوتر؟ = نعم» في الدفتر لا تُنشئ فاتورةً على المنصة — الفوترة تُسجَّل من صفحة المالية عند إصدار المستخلص. وهذه قائمتها كاملةً لتُسوّى من هناك:');
  p();
  if (!ro.invoiced_without_date.length) p('لا شيء.');
  else {
    p('| المخرج | المشروع | المبلغ بدون ضريبة | رقم الفاتورة | تاريخها |');
    p('| --- | --- | ---: | --- | --- |');
    for (const r of ro.invoiced_without_date.slice(0, MAX_LIST)) {
      p(`| ${cell(r.name)} | ${cell(r.project)} | ${num2(r.amount_sar)} | ${cell(r.invoice_no || 'لا رقم')} | ${cell(r.date || 'لا تاريخ')} |`);
    }
    if (ro.invoiced_without_date.length > MAX_LIST) p(`| … | وبقيّتها في ملف الخطة | ${intFmt(ro.invoiced_without_date.length - MAX_LIST)} | | |`);
  }

  head('محصَّل بلا فاتورة');
  if (!ro.collected_without_invoice.length) p('لا شيء.');
  else for (const r of ro.collected_without_invoice) p(`- ${r.name} — «${r.project}» · ${num2(r.amount_sar)} ريال · التاريخ المكتوب: ${r.date || 'لا تاريخ'}`);

  head('تسكينٌ قائمٌ بصفةٍ مختلفة — تُرك كما هو على المنصة');
  p('المنصةُ تحفظ للشخص تسكيناً واحداً على المشروع في السنة الواحدة. وحيث كُتبت في الدفتر صفةٌ غير');
  p('الصفة المسجَّلة، أُبقيت صفةُ المنصة كما هي بقرارِ المالك، ولم يُكتب من هذه السطور شيء:');
  p();
  if (!ro.allocation_role_differs.length) p('لا شيء.');
  else {
    const loadCell = (pct, months, varies) => (pct == null ? '—'
      : `${intFmt(pct)}%${varies ? ' (متفاوتة بالشهور)' : ''}${months ? ` · الشهور ${months}` : ''}`);
    p('| الزميل | المشروع | السنة | صفتُه على المنصة | صفتُه في الدفتر | حِملُه على المنصة | حِملُه في الدفتر |');
    p('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of ro.allocation_role_differs.slice(0, MAX_LIST)) {
      p(`| ${cell(r.employee)} | ${cell(r.project)} | ${cell(r.year)} | ${cell(r.live_role_ar)} | ${cell(r.workbook_role_ar)}`
        + ` | ${loadCell(r.pct_live, r.months_live, r.pct_live_varies)} | ${loadCell(r.pct_workbook, r.months_workbook, false)} |`);
    }
    if (ro.allocation_role_differs.length > MAX_LIST) {
      p(`| … | وبقيّتها في ملف الخطة | ${intFmt(ro.allocation_role_differs.length - MAX_LIST)} | | | | |`);
    }
    const loadOff = ro.allocation_role_differs.filter((r) => r.load_differs).length;
    p();
    if (loadOff) p(`ومنها ${intFmt(loadOff)} يختلف حِملُها أو مدى شهورها عمّا في الدفتر كذلك — ذُكر ولم يُكتب.`);
    p('فمن أراد تغيير الصفة أو الحِمل فمن صفحة المشروع مباشرةً، لا من هذا المسار.');
  }
  const loadOnlyOff = ro.allocations_already_live.filter((r) => r.load_differs).length;
  if (loadOnlyOff) {
    p();
    p(`وفي المسجَّل أصلاً بنفس الصفة ${intFmt(loadOnlyOff)} تسكيناً يختلف حِملُه أو مدى شهوره عمّا في الدفتر — ذُكر ولم يُكتب.`);
  }

  head('بقايا صف المثال');
  p('الصف الأول من كل ورقة كان مثالاً يُكتب فوقه. وما بقي من خاناته عُومل فارغاً ولم يُكتب:');
  p();
  if (!ro.example_residue.length) p('لا شيء.');
  else {
    const by = new Map();
    for (const r of ro.example_residue) {
      const k = `${r.sheet} · سطر ${r.row}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r.column);
    }
    for (const [k, cols] of by) p(`- ${k}: ${cols.join('، ')}`);
  }

  head('تواريخ ملتبسة');
  p('تاريخٌ يومُه وشهرُه كلاهما اثنا عشر فأقل يحتمل قراءتين، ولم يُخمَّن أيُّهما المقصود:');
  p();
  if (!ro.ambiguous_dates.length) p('لا شيء.');
  else for (const d of ro.ambiguous_dates) {
    p(`- «${d.subject}» · ${d.column} = ${d.value} → إن كان يوم/شهر فهو ${d.as_day_month}، وإن كان شهر/يوم فهو ${d.as_month_day}. اكتبه ‎2026-12-31‎ ليُقرأ يقيناً. (${d.where})`);
  }

  head('خانات تعذّرت قراءتها');
  if (!ro.unparsable.length) p('لا شيء.');
  else for (const u of ro.unparsable.slice(0, MAX_LIST)) {
    p(`- ${u.sheet} · سطر ${u.row} · ${u.column}${u.value ? ` = ${u.value}` : ''} — ${u.why}`);
  }
  if (ro.period_incomplete.length) {
    p();
    p(`وشهرُ استحقاقٍ بلا سنته (أو العكس) في ${intFmt(ro.period_incomplete.length)} مخرجاً — لا يؤرّخ إيراداً حتى يكتمل:`);
    for (const r of ro.period_incomplete.slice(0, 40)) {
      p(`- «${r.name}» — «${r.project}»: الشهر ${r.month ?? '—'} والسنة ${r.year ?? '—'}`);
    }
  }
  const noPeriod = plan.deliverables.filter((d) => !(d.op === 'create' ? d.data.period : (d.patch.period))).length;
  if (noPeriod) {
    p();
    p(`ومخرجاتٌ بلا شهر استحقاقٍ في هذه الخطة: ${intFmt(noPeriod)} — تُكتب، لكنها لا تُنسب إلى شهرٍ يقيناً حتى يُملأ.`);
  }

  head('حسابات ومديرو إدارات — لمسؤول الأنظمة');
  p('الاستيراد لا يُنشئ حسابات دخولٍ ولا يعيّن مديري إدارات. هذه القائمة تُسلَّم لمسؤول الأنظمة ليُنشئ ما يلزم:');
  p();
  if (!ro.accounts_csv.length) p('لا شيء.');
  else {
    p('```');
    p('الاسم,البريد المكتوب في الدفتر,الإدارة,مدير إدارة؟,له حساب اليوم؟,ملاحظة');
    for (const a of ro.accounts_csv) {
      p([a.name, a.email || '', a.department, a.is_manager ? 'نعم' : 'لا', a.has_account ? 'نعم' : 'لا', a.note || '']
        .map((v) => String(v).replace(/[",\n]/g, ' ')).join(','));
    }
    p('```');
  }
  const zombies = live.employees.filter((e) => !e.user_email).length;
  p();
  p(`وللعلم: ${intFmt(zombies)} من زملاء ${plan.meta.sector_name} المسجَّلين اليوم بلا حساب دخولٍ مرتبط.`);

  head('الخطوة التالية');
  p('1. راجع جدول مطابقة المشاريع: أي سطرٍ قرارُه «تعارض» يُحسم في الدفتر (اكتب الاسم كما هو في المنصة) أو يُترك لتقرّره بنفسك.');
  p('2. أكمل في الدفتر ما نقص: شهر الاستحقاق وسنته، وتواريخ المشاريع بصيغة ‎2026-12-31‎، والبريد الإلكتروني للزملاء.');
  p('3. أعد إرسال الدفتر، أو أْذن بالتطبيق على ما هو عليه — والمذكور هنا هو بعينه ما سيُكتب.');
  p();
  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 سطر الأوامر
// ─────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) o[m[1]] = m[2] ?? true;
  }
  return o;
}

const isTrue = (v) => v === true || v === 'true';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file || opts.file === true || !opts.out || opts.out === true) {
    console.error('استعمال: --file=<الدفتر.xlsx> --out=<مسار المخرجات بلا امتداد> [--sector=<المعرّف أو الاسم>] [--allow-conflicts] [--year=2026] [--map=<خريطة المشاريع>] [--emp-map=<خريطة الزملاء>]');
    process.exit(2);
  }
  const year = Number(opts.year) >= 2000 && Number(opts.year) <= 2100 ? Math.round(Number(opts.year)) : 2026;
  const mapOf = (v, subjectAr) => {
    if (v == null || v === false) return null;
    if (v === true || !trim(v)) throw new Error(`خريطة ${subjectAr} بلا مسار — اكتب ‎--…=<مسار الملف>‎`);
    return loadApprovedMap(String(v), subjectAr);
  };
  const projectMap = mapOf(opts.map, 'المشاريع');
  const employeeMap = mapOf(opts['emp-map'], 'الزملاء');
  const wb = readWorkbook(String(opts.file));
  const db = await import('../src/core/db/index.js');
  let plan; let live; let sector;
  try {
    sector = await resolveSector(db, { wanted: opts.sector, identityName: wb.identity.sectorName });
    live = await readLive(db, sector.id);
    plan = buildPlan(wb, live, { sector, year, file: String(opts.file), projectMap, employeeMap });
  } finally {
    await db.close?.();
  }

  const outJson = `${opts.out}.json`;
  const outMd = `${opts.out}.md`;
  writeFileSync(outJson, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  writeFileSync(outMd, `${renderReport(plan, { live })}\n`, 'utf8');

  const c = plan.totals.counts;
  console.log(`الدفتر: ${opts.file}`);
  console.log(`بصمة الدفتر: ${wb.sha256}`);
  console.log(`القطاع: ${sector.name_ar} (${sector.rule})`);
  if (projectMap) console.log(`خريطة المشاريع: ${projectMap.path} — استُعمل ${intFmt(plan.meta.project_map_used)} من ${intFmt(projectMap.byName.size)}${plan.meta.project_map_unused.length ? ` · بلا مقابلٍ في الدفتر: ${plan.meta.project_map_unused.join('، ')}` : ''}`);
  if (employeeMap) console.log(`خريطة الزملاء: ${employeeMap.path} — استُعمل ${intFmt(plan.meta.employee_map_used)} من ${intFmt(employeeMap.byName.size)}${plan.meta.employee_map_unused.length ? ` · بلا مقابلٍ في الدفتر: ${plan.meta.employee_map_unused.join('، ')}` : ''}`);
  console.log(`المنصة اليوم: ${intFmt(live.projects.length)} مشروعاً · ${intFmt(live.deliverables.length)} مخرجاً · ${intFmt(live.employees.length)} زميلاً · ${intFmt(live.departments.length)} إدارة`);
  for (const [key, v] of Object.entries(c)) {
    if (!v.rows) continue;
    console.log(`${SHEET_AR[key] || key}: قُرئ ${intFmt(v.rows)} · طُوبق ${intFmt(v.matched)} · يُصحَّح ${intFmt(v.update)} · يُضاف ${intFmt(v.create)} · تُرك ${intFmt(v.skipped)}`);
  }
  console.log(`عملاء يُضافون ${intFmt(plan.clients.length)} · مراحل تُضاف ${intFmt(plan.phases.length)} · تسكينات ${intFmt(plan.allocations.length)}`);
  const years = Object.keys(plan.totals.revenue_delta_by_year).sort();
  if (years.length) {
    console.log('أثر الإيراد المعترف به (ريال بدون ضريبة): '
      + years.map((y) => `${y}: ${num2(plan.totals.revenue_delta_by_year[y])}`).join(' · '));
  }
  console.log(`تعارضات: ${intFmt(plan.conflicts.length)}`);
  console.log(`كُتبت الخطة في ${outJson}`);
  console.log(`وكُتب التقرير في ${outMd}`);

  if (plan.conflicts.length && !isTrue(opts['allow-conflicts'])) {
    console.log('');
    console.log('في الكشف تعارضاتٌ تحتاج قراراً — راجع قسم «التعارضات» في التقرير، ثم صحّح الدفتر وأعد الكشف، أو مرّر ‎--allow-conflicts‎ إن كان تجاوزها قراراً واعياً.');
    process.exit(3);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(`تعذّر إتمام الكشف: ${e.message}`);
    try { const db = await import('../src/core/db/index.js'); await db.close?.(); } catch { /* لا شيء */ }
    process.exit(1);
  });
}
