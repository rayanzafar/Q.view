// تقرير الفترة — «إصدار التقرير الأسبوعي أو الشهري أو الربعي من خلال المنصة بشكل سريع وسهل».
//
// هذا الملف يجيب سؤالين اثنين لا ثالث لهما:
//   (١) **ما حدود الفترة واسمها؟** نموذج زمني واحد للأسبوع والشهر والربع، أسماؤه العربية
//       مستمدة حصراً من `core/i18n/time.js` (لا اختصارات عربية — قاعدة منتج موثّقة هناك).
//   (٢) **ماذا حدث في هذه الفترة داخل هذه العدسة؟** العدسات ست: الشركة · قطاع · إدارة ·
//       شخص · فرصة · مشروع. والأقسام ثمانية بترتيب ثابت: المساهمات · المهام · التقدم ·
//       العوائق · الطاقة · الإشغال · التعارضات · القرارات المطلوبة.
//
// ثلاث قواعد تحكم كل رقم هنا، وهي سبب طول الملف:
//
//   • **لا رقم مخترع ولا مقدَّر.** كل قيمة تعود من صف مسجَّل. وحين لا يوجد المُدخَل أصلاً
//     (مثال حيّ: المهام لم تُنسب إلى إدارات لأن الترحيلة 010 لم تُعبّئ شيئاً تلقائياً عن قصد)
//     يعود القسم بحالة `absent` ونصٍّ عربي يقول ذلك صراحةً — **لا صفر**. الصفر واقعةٌ مقيسة
//     («لم يُنجَز شيء») والغياب واقعةٌ أخرى («لا يوجد ما يُقاس»)، ولا يجوز أن يتشابها بصرياً.
//
//   • **تعريفا الإشغال لا يُخلطان أبداً.** في المنصة مقياسان مختلفان يحملان الاسم نفسه:
//       – «الطاقة المخطَّطة» من `allocation.monthly_json` (أساس `sectorStaffing` و`staffingRoster`)،
//       – «الإشغال القابل للفوترة» من `time_entry` (أساس `sectorUtilization`).
//     لكلٍّ قسم مستقل، ولكل قسم سطر `basis_ar` يسمّي مصدره على الشاشة. لا جمع بينهما ولا متوسط.
//
//   • **الحساب يُعاد استعماله لا يُعاد كتابته.** ما تحسبه `metrics.js` يُستدعى منها كما هو
//     (`companyOverview` · `sectorDashboard` · `sectorStaffing` · `sectorUtilization` ·
//     `projectKpis` · `pipelineCoverage` · `winRate` · `grossMargin`) حتى لا يقول التقرير
//     رقماً تخالفه اللوحة. الحسابات الجديدة هنا هي وحدها ما لا مقابل له: نوافذ الفترة.
//
// قابلية النقل (SQLite + Postgres): لا `strftime` ولا `date('now')` — كل تاريخ يُحسب في JS
// ويُربَط معاملاً، ومقارنات التواريخ عبر `substr(col,1,10)`، والمنطقيات أعداد 0/1.
import { all, get, insert, tx } from '../db/index.js';
import { audit } from '../audit/index.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { can, effectiveScope, canSeeSensitive } from '../rbac/index.js';
import { SCOPE_RANK } from '../rbac/matrix.js';
import { seesCompanyPerformance } from '../policy/pages.js';
import { MONTHS_AR, QUARTERS_AR } from '../i18n/time.js';
import { countAr } from '../i18n/plural.js';
import { CAPACITY, capacityLabel, health, HEALTH_ORDER, HEALTH } from '../i18n/thresholds.js';
import { id, nowIso, fmtSar } from '../util/ids.js';
import {
  companyOverview, sectorDashboard, sectorStaffing, sectorUtilization,
  projectKpis, pipelineCoverage, winRate, grossMargin,
} from './metrics.js';

// ═══════════════════════════ (١) النموذج الزمني ═══════════════════════════════

const DAY = 86400000;
// بداية الأسبوع: الأحد. أسبوع العمل السعودي (الأحد–الخميس) يقع كاملاً داخل فترة واحدة،
// ولو بدأ الأسبوع الاثنين لانقسم أسبوع العمل الواحد على تقريرين. الرقم هنا مرجع واحد.
export const WEEK_START_DOW = 0;
export const PERIOD_KINDS = ['week', 'month', 'quarter'];
export const PERIOD_LABELS_AR = { week: 'أسبوعي', month: 'شهري', quarter: 'ربع سنوي' };

const utcDay = (y, m, d) => new Date(Date.UTC(y, m, d));
const isoDay = (d) => d.toISOString().slice(0, 10);

// يقبل تاريخاً أو نصاً بصيغة سنة-شهر-يوم؛ يعيد بداية اليوم بالتوقيت العالمي أو null.
function toDay(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return utcDay(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const d = utcDay(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// «أسبوع 20–26 يوليو 2026» · «أسبوع 27 ديسمبر 2026 – 2 يناير 2027» — أسماء أشهر كاملة دائماً.
function weekLabelAr(from, to) {
  const fy = from.getUTCFullYear(), ty = to.getUTCFullYear();
  const fm = from.getUTCMonth(), tm = to.getUTCMonth();
  const fd = from.getUTCDate(), td = to.getUTCDate();
  if (fy !== ty) return `أسبوع ${fd} ${MONTHS_AR[fm]} ${fy} – ${td} ${MONTHS_AR[tm]} ${ty}`;
  if (fm !== tm) return `أسبوع ${fd} ${MONTHS_AR[fm]} – ${td} ${MONTHS_AR[tm]} ${ty}`;
  return `أسبوع ${fd}–${td} ${MONTHS_AR[fm]} ${fy}`;
}

/**
 * حدود فترة واسمها العربي.
 * @param {'week'|'month'|'quarter'} kind نوع الفترة
 * @param {Date|string} anchor أي يوم داخل الفترة المطلوبة
 * @param {Date|string} today اللحظة المرجعية (لتحديد هل الفترة جارية أم مكتملة)
 * @returns {{kind,from,to,anchor,year,index,label_ar,months,partial,future,complete,as_of}}
 */
export function resolvePeriod(kind, anchor = new Date(), today = new Date()) {
  const k = String(kind || '').trim().toLowerCase();
  if (!PERIOD_KINDS.includes(k)) {
    throw badRequest('نوع الفترة غير معروف — اختر: أسبوع أو شهر أو ربع سنة.');
  }
  const a = toDay(anchor);
  if (!a) throw badRequest('تاريخ الفترة غير مفهوم — اخترها من قائمة الفترات.');
  const t = toDay(today) || toDay(new Date());

  let from, to, year, index, label_ar;
  if (k === 'week') {
    from = new Date(a.getTime() - ((a.getUTCDay() - WEEK_START_DOW + 7) % 7) * DAY);
    to = new Date(from.getTime() + 6 * DAY);
    year = from.getUTCFullYear();
    index = null;
    label_ar = weekLabelAr(from, to);
  } else if (k === 'month') {
    from = utcDay(a.getUTCFullYear(), a.getUTCMonth(), 1);
    to = utcDay(a.getUTCFullYear(), a.getUTCMonth() + 1, 0);
    year = a.getUTCFullYear();
    index = a.getUTCMonth() + 1;
    label_ar = `${MONTHS_AR[a.getUTCMonth()]} ${year}`;
  } else {
    const q = Math.floor(a.getUTCMonth() / 3);
    from = utcDay(a.getUTCFullYear(), q * 3, 1);
    to = utcDay(a.getUTCFullYear(), q * 3 + 3, 0);
    year = a.getUTCFullYear();
    index = q + 1;
    label_ar = `${QUARTERS_AR[q]} ${year}`;
  }

  const months = [];
  for (let d = utcDay(from.getUTCFullYear(), from.getUTCMonth(), 1); d <= to;
    d = utcDay(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) {
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const future = t < from;
  const complete = t > to;
  return {
    kind: k, from: isoDay(from), to: isoDay(to), anchor: isoDay(from),
    year, index, label_ar, months,
    partial: !future && !complete, future, complete, as_of: isoDay(t),
  };
}

// الفترة السابقة لنفس النوع (اليوم الذي يسبق بدايتها).
export function previousPeriod(period, today = new Date()) {
  const from = toDay(period?.from);
  if (!from) throw badRequest('لا يمكن تحديد الفترة السابقة — اختر فترة من القائمة.');
  return resolvePeriod(period.kind, new Date(from.getTime() - DAY), today);
}

// قائمة فترات جاهزة للاختيار (الأحدث أولاً) — مصدر قائمة «الفترة» في الشاشة.
export function periodChoices(kind, today = new Date(), count = 8) {
  const out = [];
  let p = resolvePeriod(kind, today, today);
  for (let i = 0; i < Math.max(1, count); i++) {
    out.push({ anchor: p.anchor, label_ar: p.label_ar, current: i === 0, partial: p.partial });
    p = previousPeriod(p, today);
  }
  return out;
}

// ═══════════════════════════ (٢) العدسات والحُرّاس ═════════════════════════════

export const LENSES = ['company', 'sector', 'department', 'person', 'opportunity', 'project'];
export const LENS_LABELS_AR = {
  company: 'الشركة', sector: 'قطاع', department: 'إدارة',
  person: 'شخص', opportunity: 'فرصة', project: 'مشروع',
};

// **اتساع** المنح لا مجرد وجودها. `can(u,'read','report',{sector_id})` تعود صحيحاً لمن منحُه
// بنطاق «مشروع» لأن صفّ القطاع لا يحمل معرّف مشروع، فيمرّ الفحص فارغاً. تقرير القطاع يحتاج
// منحاً يبلغ القطاع فعلاً — ومصادره الثلاثة المقبولة: التقارير أو المشاريع أو الأشخاص.
const WIDTH_RESOURCES = ['report', 'project', 'employee'];
function widthAtLeast(user, minScope) {
  const need = SCOPE_RANK[minScope] || 0;
  return WIDTH_RESOURCES.some((r) => {
    const s = effectiveScope(user, 'read', r);
    return !!s && (SCOPE_RANK[s] || 0) >= need;
  });
}

// شروط الفتح كدوال نقية (بلا قاعدة بيانات): يستعملها الحارس عند البناء **وقائمةُ الاختيار**
// في الشاشة. المصدر واحد كي لا تعرض القائمة جهةً يردّها النظام عند فتحها — وهو أسوأ من إخفائها.
export function sectorReadable(user, row) {
  if (!user || !row) return false;
  if (user.scope !== 'company' && user.sector_id !== row.id) return false;
  return widthAtLeast(user, 'sector');
}
export function departmentReadable(user, row) {
  if (!user || !row) return false;
  if (user.scope !== 'company' && user.sector_id !== row.sector_id) return false;
  const narrow = effectiveScope(user, 'read', 'employee') === 'department'
    || effectiveScope(user, 'read', 'report') === 'department';
  if (narrow && user.department_id !== row.id) return false;
  return widthAtLeast(user, 'department');
}
export function personReadable(user, row) {
  if (!user || !row) return false;
  if (row.id === user.id) return true;                      // تقريرك عن نفسك متاح دائماً
  // شرط الاتساع أولاً وقبل `can`: صفّ الشخص لا يحمل معرّف مشروع، فمنحٌ بنطاق «مشروع» يجتاز
  // `scopeReaches` فارغاً — وبه كان مدير المشروع يفتح تقرير أي شخص في قطاعه (ساعاته ومهامه
  // وحمله). تقرير شخص آخر يبدأ من نطاق الإدارة فأوسع.
  if (!widthAtLeast(user, 'department')) return false;
  const t = { sector_id: row.sector_id, department_id: row.department_id, user_id: row.id };
  return can(user, 'read', 'employee', t) || can(user, 'read', 'report', t);
}

// حارس كل عدسة داخل الخدمة لا في المسار: التقرير لا يُظهر ما لا يحق لقارئه رؤيته.
async function resolveScope(user, lens, targetId) {
  const l = String(lens || '').trim().toLowerCase();
  if (!LENSES.includes(l)) throw badRequest('عدسة التقرير غير معروفة — اختر: الشركة أو قطاع أو إدارة أو شخص أو فرصة أو مشروع.');
  if (!user) throw forbidden('يلزم تسجيل الدخول لعرض التقرير.');
  if (l !== 'company' && !targetId) {
    throw badRequest(`اختر ${LENS_LABELS_AR[l]} أولاً ثم اعرض التقرير.`);
  }

  if (l === 'company') {
    // نفس بوابة لوحة القيادة حرفياً — و`companyOverview` ترفض أصلاً من نافذته أضيق من الشركة.
    if (!seesCompanyPerformance(user)) {
      throw forbidden('تقرير الشركة كاملة يحتاج صلاحية قراءة تقارير الشركة ومؤشراتها. اعرض تقرير قطاعك أو إدارتك، أو اطلب من مدير النظام إضافة الصلاحية.');
    }
    return { lens: l, id: null, name_ar: 'الشركة كاملة', kind_ar: 'الشركة' };
  }

  if (l === 'sector') {
    const row = await get('SELECT id, name_ar FROM sector WHERE id = ? AND deleted_at IS NULL', [targetId]);
    if (!row) throw notFound('القطاع المطلوب غير موجود — اختر قطاعاً من القائمة.');
    if (user.scope !== 'company' && user.sector_id !== row.id) {
      throw forbidden('هذا القطاع خارج نطاقك — اعرض تقرير قطاعك.');
    }
    if (!sectorReadable(user, row)) {
      throw forbidden('تقرير القطاع كاملاً يحتاج صلاحية تبلغ القطاع. اعرض تقرير مشروعك أو تقريرك الشخصي.');
    }
    return { lens: l, id: row.id, name_ar: row.name_ar, kind_ar: 'قطاع', sectorId: row.id };
  }

  if (l === 'department') {
    const row = await get(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name
       FROM department d LEFT JOIN sector s ON s.id = d.sector_id
       WHERE d.id = ? AND d.deleted_at IS NULL`, [targetId]);
    if (!row) throw notFound('الإدارة المطلوبة غير موجودة — اخترها من القائمة.');
    if (user.scope !== 'company' && user.sector_id !== row.sector_id) {
      throw forbidden('هذه الإدارة تتبع قطاعاً آخر — اعرض إدارات قطاعك.');
    }
    // من نطاق منحه «إدارة» يرى إدارته وحدها — لا كل إدارات قطاعه.
    const narrow = effectiveScope(user, 'read', 'employee') === 'department'
      || effectiveScope(user, 'read', 'report') === 'department';
    if (narrow && user.department_id !== row.id) {
      throw forbidden('هذه الإدارة خارج نطاقك — تقريرك يغطي إدارتك أنت.');
    }
    if (!departmentReadable(user, row)) {
      throw forbidden('تقرير الإدارة يحتاج صلاحية تبلغ الإدارة. اعرض تقرير مشروعك أو تقريرك الشخصي.');
    }
    return { lens: l, id: row.id, name_ar: row.name_ar, kind_ar: 'إدارة',
      sectorId: row.sector_id, departmentId: row.id, parent_ar: row.sector_name || '' };
  }

  if (l === 'person') {
    const row = await get(`SELECT u.id, u.name_ar, u.username, u.sector_id, u.employee_id,
         e.department_id, e.job_title, e.name_ar emp_name, s.name_ar sector_name
       FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id
       LEFT JOIN sector s ON s.id = u.sector_id
       WHERE u.id = ? AND u.deleted_at IS NULL`, [targetId]);
    if (!row) throw notFound('الشخص المطلوب غير موجود — اختره من القائمة.');
    // تقرير عن شخص آخر = اطّلاع على فريق: يُفحص على صفّه هو (قطاعه وإدارته)، لا على وجود المنح.
    if (!personReadable(user, row)) {
      throw forbidden('تقرير شخص آخر يحتاج صلاحية الاطلاع على فريقه. تقريرك عن نفسك متاح لك دائماً.');
    }
    return { lens: l, id: row.id, name_ar: row.name_ar || row.emp_name || row.username || 'مستخدم',
      kind_ar: 'شخص', sectorId: row.sector_id || null, departmentId: row.department_id || null,
      userId: row.id, employeeId: row.employee_id || null, job_ar: row.job_title || '',
      parent_ar: row.sector_name || '', self: row.id === user.id };
  }

  if (l === 'project') {
    const row = await get(`SELECT p.id, p.name_ar, p.sector_id, p.department_id, p.owner_user_id,
         p.status, p.rag, p.progress_pct, p.start_date, p.end_date, s.name_ar sector_name, c.name_ar client_name
       FROM project p LEFT JOIN sector s ON s.id = p.sector_id LEFT JOIN client c ON c.id = p.client_id
       WHERE p.id = ? AND p.deleted_at IS NULL`, [targetId]);
    if (!row) throw notFound('المشروع المطلوب غير موجود — اختره من القائمة.');
    if (!can(user, 'read', 'project', row)) {
      throw forbidden('هذا المشروع خارج نطاقك — اعرض مشاريعك من قائمة المشاريع.');
    }
    return { lens: l, id: row.id, name_ar: row.name_ar, kind_ar: 'مشروع',
      sectorId: row.sector_id || null, departmentId: row.department_id || null, projectId: row.id,
      parent_ar: [row.sector_name, row.client_name].filter(Boolean).join(' · '), row };
  }

  const row = await get(`SELECT o.id, o.title_ar, o.sector_id, o.department_id, o.owner_user_id,
       o.value_halalas, o.win_pct, o.stage_id, o.stage_changed_at, o.next_action,
       st.name_ar stage_name, COALESCE(st.is_won,0) is_won, COALESCE(st.is_lost,0) is_lost,
       s.name_ar sector_name, c.name_ar client_name
     FROM opportunity o LEFT JOIN stage st ON st.id = o.stage_id
     LEFT JOIN sector s ON s.id = o.sector_id LEFT JOIN client c ON c.id = o.client_id
     WHERE o.id = ? AND o.deleted_at IS NULL`, [targetId]);
  if (!row) throw notFound('الفرصة المطلوبة غير موجودة — اخترها من القائمة.');
  if (!can(user, 'read', 'opportunity', row)) {
    throw forbidden('هذه الفرصة خارج نطاقك — اعرض فرصك من قائمة الفرص.');
  }
  return { lens: 'opportunity', id: row.id, name_ar: row.title_ar, kind_ar: 'فرصة',
    sectorId: row.sector_id || null, departmentId: row.department_id || null, opportunityId: row.id,
    parent_ar: [row.sector_name, row.client_name].filter(Boolean).join(' · '), row };
}

// ═══════════════════ (٣) مرشِّحات النطاق لكل جدول وكل عدسة ════════════════════
// كل دالة تعيد { where, params } تُركَّب داخل استعلام يعرف جداوله ووصلاته سلفاً.

const N = (v) => Number(v) || 0;

function taskWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'COALESCE(t.sector_id, p.sector_id) = ?', params: [sc.sectorId] };
    case 'department': return { where: 't.department_id = ?', params: [sc.departmentId] };
    case 'person': return { where: 't.assignee_user_id = ?', params: [sc.userId] };
    case 'project': return { where: 't.project_id = ?', params: [sc.projectId] };
    default: return { where: 't.opportunity_id = ?', params: [sc.opportunityId] };
  }
}

function projectWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'p.sector_id = ?', params: [sc.sectorId] };
    case 'department': return { where: 'p.department_id = ?', params: [sc.departmentId] };
    case 'person': return {
      where: `(p.owner_user_id = ? OR (? IS NOT NULL AND EXISTS(
        SELECT 1 FROM allocation a WHERE a.project_id = p.id AND a.employee_id = ? AND a.deleted_at IS NULL)))`,
      params: [sc.userId, sc.employeeId || '', sc.employeeId || ''] };
    case 'project': return { where: 'p.id = ?', params: [sc.projectId] };
    default: return { where: 'p.source_opp_id = ?', params: [sc.opportunityId] };
  }
}

function oppWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'o.sector_id = ?', params: [sc.sectorId] };
    case 'department': return { where: 'o.department_id = ?', params: [sc.departmentId] };
    case 'person': return { where: 'o.owner_user_id = ?', params: [sc.userId] };
    case 'opportunity': return { where: 'o.id = ?', params: [sc.opportunityId] };
    default: return null; // المشروع لا يُقاس بالفرص — انظر رسالة الغياب في قسم المساهمات
  }
}

function deliverableWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'COALESCE(d.sector_id, p.sector_id) = ?', params: [sc.sectorId] };
    case 'department': return { where: 'p.department_id = ?', params: [sc.departmentId] };
    case 'project': return { where: 'd.project_id = ?', params: [sc.projectId] };
    case 'opportunity': return { where: 'p.source_opp_id = ?', params: [sc.opportunityId] };
    default: return null; // المخرَج لا يحمل مالكاً فردياً في النموذج
  }
}

// ساعات العمل: نطاق «الأشخاص» (قطاع/إدارة الشخص) لا نطاق المشروع — نفس أساس `sectorUtilization`.
function timeWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'u.sector_id = ?', params: [sc.sectorId] };
    case 'department': return { where: 'e.department_id = ?', params: [sc.departmentId] };
    case 'person': return { where: 'te.user_id = ?', params: [sc.userId] };
    case 'project': return { where: 'te.project_id = ?', params: [sc.projectId] };
    default: return { where: 'te.opportunity_id = ?', params: [sc.opportunityId] };
  }
}

// المخاطر: الفرصة لا تحمل مخاطر في النموذج، والشخص يُقاس بما **يملكه** من مخاطر لا بمخاطر قطاعه.
function riskWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'COALESCE(r.sector_id, p.sector_id) = ?', params: [sc.sectorId] };
    case 'department': return { where: 'p.department_id = ?', params: [sc.departmentId] };
    case 'person': return { where: 'r.owner_user_id = ?', params: [sc.userId] };
    case 'project': return { where: 'r.project_id = ?', params: [sc.projectId] };
    default: return null;
  }
}

function allocWhere(sc) {
  switch (sc.lens) {
    case 'company': return { where: '1=1', params: [] };
    case 'sector': return { where: 'a.sector_id = ?', params: [sc.sectorId] };
    case 'department': return { where: 'a.department_id = ?', params: [sc.departmentId] };
    case 'person': return sc.employeeId ? { where: 'a.employee_id = ?', params: [sc.employeeId] } : null;
    case 'project': return { where: 'a.project_id = ?', params: [sc.projectId] };
    default: return null; // التسكين الشهري يُسجَّل على المشاريع لا على الفرص
  }
}

// ═════════════════════ (٤) لَبِنات القسم: رقم مقيس أم غياب ════════════════════

const figure = (label_ar, display, extra = {}) => ({ label_ar, display, ...extra });
// رقم غير قابل للقياس: يُعرض نصّه لا صفراً.
const missing = (label_ar, absence_ar) => ({ label_ar, display: null, absence_ar });
// رقمٌ إن وُجد أساسه، ونصُّ غياب إن لم يوجد — الفرق بين «صفر مقيس» و«لا شيء يُقاس» في سطر واحد.
const figureOr = (label_ar, ok, display, absence_ar, extra = {}) =>
  (ok ? figure(label_ar, display, extra) : missing(label_ar, absence_ar));
const absentSection = (key, title_ar, absence_ar, hint_ar = '', basis_ar = '') =>
  ({ key, title_ar, basis_ar, state: 'absent', absence_ar, hint_ar, figures: [], rows: [] });

const pctText = (v) => `${Math.round(v)}%`;
// اتفاق العدد والمعدود من مصدر المنصة الواحد. الصفر يبقى رقماً ظاهراً («0 ساعة») لا «لا ساعات»:
// الصفر هنا قياسٌ فعلي (ساعات مسجّلة غير قابلة للفوترة)، وصياغة النفي تجعله يُقرأ غياباً.
const hoursText = (v) => {
  const h = Math.round(N(v) * 10) / 10;
  if (h === 0) return '0 ساعة';
  if (!Number.isInteger(h)) return `${h} ساعة`;
  return countAr(h, { one: 'ساعة واحدة', two: 'ساعتان', few: 'ساعات', many: 'ساعة' });
};

// نصوص الغياب لكل عدسة — الفراغ يُسمّى بلغة صاحبه لا برسالة عامة.
const NO_TASKS_AR = {
  company: 'لا مهام مسجّلة في المنصة بعد',
  sector: 'لا مهام مسجّلة على هذا القطاع بعد',
  department: 'لا مهام منسوبة إلى هذه الإدارة بعد',
  person: 'لا مهام مُسندة إلى هذا الشخص بعد',
  project: 'لا مهام مسجّلة على هذا المشروع بعد',
  opportunity: 'لا مهام مرتبطة بهذه الفرصة بعد',
};
const NO_TASKS_HINT_AR = {
  department: 'نسبة المهمة إلى إدارة قرار بشري يُسجَّل من شاشة المهمة، ولم يُملأ تلقائياً لأي مهمة قديمة — فالفراغ هنا يعني «لم يُنسب بعد» لا «لا عمل».',
  person: 'تظهر الأرقام هنا بمجرد إسناد أول مهمة إلى هذا الشخص.',
  opportunity: 'تظهر الأرقام هنا بمجرد ربط أول مهمة بهذه الفرصة.',
};
const NO_ALLOC_AR = {
  company: 'لا تسكين شهري مسجّل لهذه السنة',
  sector: 'لا تسكين شهري مسجّل على هذا القطاع لهذه السنة',
  department: 'لا تسكين منسوب إلى هذه الإدارة بعد',
  person: 'لا تسكين شهري مسجّل لهذا الشخص',
  project: 'لا أحد مسكَّن على هذا المشروع بعد',
  opportunity: 'التسكين الشهري يُسجَّل على المشاريع لا على الفرص',
};

// ═════════════════════════════ (٥) الأقسام الثمانية ═══════════════════════════

// ── المساهمات: ما أضافته هذه العدسة خلال الفترة (صفقات · مخرجات · إيراد معترف به) ──
async function contributionsSection(user, sc, period) {
  const figures = []; const rows = []; const notes = [];
  let anyBase = false;

  const ow = oppWhere(sc);
  if (ow) {
    const ever = N((await get(`SELECT COUNT(*) n FROM opportunity o WHERE o.deleted_at IS NULL AND ${ow.where}`, ow.params))?.n);
    if (!ever) {
      figures.push(missing('صفقات فائزة في الفترة', sc.lens === 'department'
        ? 'لا فرص منسوبة إلى هذه الإدارة بعد' : 'لا فرص مسجّلة ضمن هذا النطاق بعد'));
    } else {
      anyBase = true;
      const won = await get(`SELECT COUNT(*) n, COALESCE(SUM(o.value_halalas),0) v
        FROM opportunity o JOIN stage st ON st.id = o.stage_id
        WHERE o.deleted_at IS NULL AND st.is_won = 1 AND o.exclude_from_sales = 0
          AND o.stage_changed_at IS NOT NULL
          AND substr(o.stage_changed_at,1,10) BETWEEN ? AND ? AND ${ow.where}`,
      [period.from, period.to, ...ow.params]);
      figures.push(figure('صفقات فائزة في الفترة', String(N(won?.n)), { tone: N(won?.n) ? 'good' : '' }));
      figures.push(figure('قيمة الصفقات الفائزة', fmtSar(N(won?.v))));
      if (N(won?.n)) {
        const list = await all(`SELECT o.title_ar, o.value_halalas, c.name_ar client
          FROM opportunity o JOIN stage st ON st.id = o.stage_id LEFT JOIN client c ON c.id = o.client_id
          WHERE o.deleted_at IS NULL AND st.is_won = 1 AND o.exclude_from_sales = 0
            AND o.stage_changed_at IS NOT NULL
            AND substr(o.stage_changed_at,1,10) BETWEEN ? AND ? AND ${ow.where}
          ORDER BY o.value_halalas DESC LIMIT 5`, [period.from, period.to, ...ow.params]);
        for (const r of list) rows.push({ title: r.title_ar, sub: r.client || 'بلا عميل مسجّل', meta: fmtSar(r.value_halalas), tone: 'good' });
      }
    }
  } else {
    figures.push(missing('صفقات فائزة في الفترة', 'المساهمة التجارية تُقاس على الفرصة لا على المشروع'));
  }

  const dw = deliverableWhere(sc);
  if (dw) {
    const dl = await get(`SELECT COUNT(*) total,
        SUM(CASE WHEN d.delivered_at IS NOT NULL AND substr(d.delivered_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) delivered_n,
        SUM(CASE WHEN d.accepted_at IS NOT NULL AND substr(d.accepted_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) accepted_n,
        SUM(CASE WHEN d.accepted_at IS NOT NULL AND substr(d.accepted_at,1,10) BETWEEN ? AND ? THEN COALESCE(d.amount_halalas,0) ELSE 0 END) accepted_v
      FROM deliverable d LEFT JOIN project p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND ${dw.where}`,
    [period.from, period.to, period.from, period.to, period.from, period.to, ...dw.params]);
    if (!N(dl?.total)) {
      figures.push(missing('مخرجات مُسلَّمة في الفترة', 'لا مخرجات مسجّلة ضمن هذا النطاق بعد'));
    } else {
      anyBase = true;
      figures.push(figure('مخرجات مُسلَّمة في الفترة', String(N(dl.delivered_n))));
      figures.push(figure('مخرجات مقبولة في الفترة', String(N(dl.accepted_n)), { tone: N(dl.accepted_n) ? 'good' : '' }));
      figures.push(figure('قيمة المخرجات المقبولة', fmtSar(N(dl.accepted_v))));
    }
  } else {
    figures.push(missing('مخرجات مُسلَّمة في الفترة', 'المخرَج يُسجَّل على المشروع ولا يحمل مالكاً فرداً'));
  }

  // مساهمة الشخص الأولى عمله المنجز لا صفقاته: نفس مرشِّح المهام ونفس نافذة الفترة، بلا حساب ثانٍ.
  if (sc.lens === 'person') {
    const tw = taskWhere(sc);
    const t = await get(`SELECT COUNT(*) total,
        SUM(CASE WHEN t.completed_at IS NOT NULL AND substr(t.completed_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) done_period
      FROM task t LEFT JOIN project p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND ${tw.where}`, [period.from, period.to, ...tw.params]);
    if (N(t?.total)) { anyBase = true; figures.unshift(figure('مهام أنجزها في الفترة', String(N(t.done_period)), { tone: N(t.done_period) ? 'good' : '' })); }
    else figures.unshift(missing('مهام أنجزها في الفترة', NO_TASKS_AR.person));
  }

  // الإيراد المعترف به مسجَّل بالشهر لا باليوم — فلا يُقسَّم على أسبوع، ولا يُقدَّر.
  if (['company', 'sector', 'department', 'project'].includes(sc.lens)) {
    if (period.kind === 'week') {
      figures.push(missing('إيراد معترف به في الفترة', 'الإيراد المعترف به يُسجَّل شهرياً — لا يظهر على مدى أسبوع'));
    } else {
      const parts = period.months.map(() => '(year = ? AND month = ?)').join(' OR ');
      const mp = period.months.flatMap((m) => [m.year, m.month]);
      const scopeSql = sc.lens === 'company' ? ''
        : sc.lens === 'sector' ? 'AND sector_id = ?'
          : sc.lens === 'project' ? 'AND project_id = ?'
            : 'AND project_id IN (SELECT id FROM project WHERE department_id = ? AND deleted_at IS NULL)';
      const sp = sc.lens === 'company' ? []
        : [sc.lens === 'sector' ? sc.sectorId : sc.lens === 'project' ? sc.projectId : sc.departmentId];
      const rev = await get(`SELECT COUNT(*) n, COALESCE(SUM(amount_halalas),0) v FROM revenue_line
        WHERE (${parts}) ${scopeSql}`, [...mp, ...sp]);
      if (!N(rev?.n)) {
        figures.push(missing('إيراد معترف به في الفترة', 'لا بنود إيراد مسجّلة لأشهر هذه الفترة'));
      } else { anyBase = true; figures.push(figure('إيراد معترف به في الفترة', fmtSar(N(rev.v)))); }
      // بند إيراد بلا شهر مسجَّل موجودٌ فعلاً في البيانات المنقولة، ولا يقع في أي فترة. إسقاطه
      // صامتاً يجعل مجموع فترات السنة أقلّ من إيراد السنة بلا تفسير — فيُقال العدد صراحةً.
      const orphan = await get(`SELECT COUNT(*) n FROM revenue_line
        WHERE year = ? AND month IS NULL ${scopeSql}`, [period.year, ...sp]);
      if (N(orphan?.n)) {
        notes.push(`${N(orphan.n)} من بنود إيراد هذه السنة بلا شهر مسجَّل، فلا تقع في أي فترة ولم تُحتسب هنا.`);
      }
    }
  }

  if (!figures.some((f) => f.display != null)) {
    return absentSection('contributions', 'المساهمات',
      'لا مساهمات قابلة للقياس ضمن هذا النطاق بعد',
      'المساهمة تُقاس من الفرص الفائزة والمخرجات المقبولة وبنود الإيراد — أيٌّ منها بمجرد تسجيله يظهر هنا.');
  }
  return { key: 'contributions', title_ar: 'المساهمات', basis_ar: 'وقائع مؤرَّخة داخل الفترة',
    state: 'data', figures, rows, rows_title_ar: 'أكبر الصفقات الفائزة في الفترة',
    note_ar: notes.join(' · '), measuredBase: anyBase };
}

// ── المهام: استعلام واحد يعطي وجودَ الأساس وكل أرقام الفترة معاً ──
async function tasksSection(user, sc, period) {
  const tw = taskWhere(sc);
  const asOf = period.complete ? period.to : period.as_of;
  const agg = await get(`SELECT COUNT(*) total,
      SUM(CASE WHEN COALESCE(t.status,'TODO') = 'DONE' THEN 1 ELSE 0 END) done_all,
      SUM(CASE WHEN COALESCE(t.status,'TODO') = 'BLOCKED' THEN 1 ELSE 0 END) blocked_now,
      SUM(CASE WHEN COALESCE(t.status,'TODO') NOT IN ('DONE','CANCELLED') THEN 1 ELSE 0 END) open_now,
      SUM(CASE WHEN t.completed_at IS NOT NULL AND substr(t.completed_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) done_period,
      SUM(CASE WHEN substr(t.created_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) created_period,
      SUM(CASE WHEN t.due_date IS NOT NULL AND substr(t.due_date,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) due_period,
      SUM(CASE WHEN COALESCE(t.status,'TODO') NOT IN ('DONE','CANCELLED') AND t.due_date IS NOT NULL
                AND substr(t.due_date,1,10) < ? THEN 1 ELSE 0 END) overdue
    FROM task t LEFT JOIN project p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND ${tw.where}`,
  [period.from, period.to, period.from, period.to, period.from, period.to, asOf, ...tw.params]);

  if (!N(agg?.total)) {
    return absentSection('tasks', 'المهام', NO_TASKS_AR[sc.lens],
      NO_TASKS_HINT_AR[sc.lens] || 'تظهر الأرقام هنا بمجرد تسجيل أول مهمة ضمن هذا النطاق.');
  }

  const rows = (await all(`SELECT t.title, COALESCE(t.status,'TODO') status, t.due_date, t.blocked_reason,
      u.name_ar assignee, p.name_ar project
    FROM task t LEFT JOIN project p ON p.id = t.project_id LEFT JOIN app_user u ON u.id = t.assignee_user_id
    WHERE t.deleted_at IS NULL AND ${tw.where}
      AND COALESCE(t.status,'TODO') NOT IN ('DONE','CANCELLED')
      AND (COALESCE(t.status,'TODO') = 'BLOCKED'
        OR (t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?))
    ORDER BY t.due_date LIMIT 8`, [...tw.params, asOf])).map((r) => ({
    title: r.title,
    sub: [r.project, r.assignee].filter(Boolean).join(' · ') || 'بلا مشروع ولا مكلَّف',
    meta: r.status === 'BLOCKED' ? (r.blocked_reason ? `مُعطَّلة: ${r.blocked_reason}` : 'مُعطَّلة')
      : `تاريخ الاستحقاق ${String(r.due_date).slice(0, 10)}`,
    tone: 'bad',
  }));

  return {
    key: 'tasks', title_ar: 'المهام', basis_ar: 'سجل المهام', state: 'data',
    figures: [
      figure('أُنجزت في الفترة', String(N(agg.done_period)), { tone: N(agg.done_period) ? 'good' : '' }),
      figure('فُتحت في الفترة', String(N(agg.created_period))),
      figure('استحقاقها داخل الفترة', String(N(agg.due_period))),
      figure('مفتوحة الآن', String(N(agg.open_now))),
      figure('متأخرة عن استحقاقها', String(N(agg.overdue)), { tone: N(agg.overdue) ? 'bad' : 'good' }),
      figure('مُعطَّلة الآن', String(N(agg.blocked_now)), { tone: N(agg.blocked_now) ? 'bad' : 'good' }),
    ],
    rows, rows_title_ar: 'مهام متأخرة أو مُعطَّلة',
  };
}

// ── التقدم: المشاريع ونِسبها ومعالمها ومخرجاتها المستحقة في أشهر الفترة ──
async function progressSection(user, sc, period) {
  if (sc.lens === 'opportunity') {
    // تقدّم الفرصة = حركة مراحلها داخل الفترة (سجل مؤرَّخ حقيقي، لا نسبة مخترعة).
    const moves = await all(`SELECT h.changed_at, sf.name_ar from_name, stt.name_ar to_name
      FROM opportunity_stage_history h
      LEFT JOIN stage sf ON sf.id = h.from_stage_id LEFT JOIN stage stt ON stt.id = h.to_stage_id
      WHERE h.opportunity_id = ? AND substr(h.changed_at,1,10) BETWEEN ? AND ?
      ORDER BY h.changed_at`, [sc.opportunityId, period.from, period.to]);
    const cur = sc.row || {};
    const figures = [
      figure('المرحلة الحالية', cur.stage_name || 'غير محدّدة'),
      figureOr('احتمال الفوز المسجَّل', cur.win_pct != null, cur.win_pct != null ? pctText(cur.win_pct) : '',
        'لم يُسجَّل احتمال فوز لهذه الفرصة'),
      figure('حركات المرحلة في الفترة', String(moves.length), { tone: moves.length ? 'good' : '' }),
    ];
    return { key: 'progress', title_ar: 'التقدم', basis_ar: 'سجل حركة المراحل', state: 'data', figures,
      rows: moves.map((m) => ({ title: `${m.from_name || 'بداية'} ← ${m.to_name || 'مرحلة أخرى'}`,
        sub: String(m.changed_at).slice(0, 10), meta: '', tone: '' })),
      rows_title_ar: 'حركة المراحل داخل الفترة',
      note_ar: cur.next_action ? `الخطوة التالية المسجَّلة: ${cur.next_action}` : 'لا خطوة تالية مسجّلة لهذه الفرصة' };
  }

  const pw = projectWhere(sc);
  const projects = await all(`SELECT p.id, p.name_ar, COALESCE(p.status,'IN_PROGRESS') status,
      p.rag, COALESCE(p.progress_pct,0) progress_pct
    FROM project p WHERE p.deleted_at IS NULL AND ${pw.where} ORDER BY p.name_ar LIMIT 400`, pw.params);
  if (!projects.length) {
    return absentSection('progress', 'التقدم',
      sc.lens === 'department' ? 'لا مشاريع منسوبة إلى هذه الإدارة بعد' : 'لا مشاريع ضمن هذا النطاق بعد',
      sc.lens === 'department' ? 'نسبة المشروع إلى إدارة تُسجَّل من شاشة المشروع — الفراغ هنا يعني «لم يُنسب بعد».' : '');
  }

  const active = projects.filter((p) => p.status === 'IN_PROGRESS');
  const withProgress = projects.filter((p) => N(p.progress_pct) > 0);
  const noProgress = projects.length - withProgress.length;
  const avg = withProgress.length
    ? Math.round(withProgress.reduce((a, p) => a + N(p.progress_pct), 0) / withProgress.length) : null;
  const counts = {};
  for (const p of active) { const k = health(p.rag).key; counts[k] = (counts[k] || 0) + 1; }

  // المعالم المستحقة داخل الفترة ونتيجتها — سجل مؤرَّخ.
  const ms = await get(`SELECT COUNT(*) total,
      SUM(CASE WHEN COALESCE(m.status,'PENDING') = 'MET' THEN 1 ELSE 0 END) met,
      SUM(CASE WHEN COALESCE(m.status,'PENDING') = 'MISSED' THEN 1 ELSE 0 END) missed
    FROM milestone m JOIN project p ON p.id = m.project_id
    WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND ${pw.where}
      AND m.due_date IS NOT NULL AND substr(m.due_date,1,10) BETWEEN ? AND ?`,
  [...pw.params, period.from, period.to]);

  const figures = [
    figure('مشاريع قيد التنفيذ', String(active.length)),
    figureOr('متوسط نسبة الإنجاز', avg != null, avg != null ? pctText(avg) : '',
      'لا نسبة إنجاز مسجّلة على أي مشروع هنا'),
    figure('حالة المحفظة', HEALTH_ORDER.map((k) => `${HEALTH[k].label} ${counts[k] || 0}`).join(' · ')),
    figureOr('معالم مستحقة في الفترة', !!N(ms?.total),
      `${N(ms?.total)} · تحقّق ${N(ms?.met)} · فات ${N(ms?.missed)}`,
      'لا معالم مستحقة داخل هذه الفترة'),
  ];

  return {
    key: 'progress', title_ar: 'التقدم', basis_ar: 'نِسب الإنجاز المسجَّلة على المشاريع', state: 'data',
    figures,
    rows: active.slice()
      .sort((a, b) => N(a.progress_pct) - N(b.progress_pct)).slice(0, 8)
      .map((p) => ({ title: p.name_ar, sub: health(p.rag).label,
        meta: N(p.progress_pct) > 0 ? pctText(p.progress_pct) : 'بلا نسبة إنجاز مسجّلة',
        tone: health(p.rag).key === 'RED' ? 'bad' : health(p.rag).key === 'AMBER' ? 'warn' : '' })),
    rows_title_ar: 'أبطأ المشاريع تقدماً',
    note_ar: noProgress ? `${noProgress} من المشاريع هنا بلا نسبة إنجاز مسجّلة — لم تدخل في المتوسط.` : '',
  };
}

// ── العوائق: مهام مُعطَّلة · مخاطر مفتوحة · مخرجات فاتت أشهرها ──
async function blockersSection(user, sc, period) {
  const tw = taskWhere(sc);
  const blocked = await all(`SELECT t.title, t.blocked_reason, p.name_ar project, u.name_ar assignee
    FROM task t LEFT JOIN project p ON p.id = t.project_id LEFT JOIN app_user u ON u.id = t.assignee_user_id
    WHERE t.deleted_at IS NULL AND COALESCE(t.status,'TODO') = 'BLOCKED' AND ${tw.where}
    ORDER BY t.updated_at DESC LIMIT 6`, tw.params);
  const taskBase = N((await get(`SELECT COUNT(*) n FROM task t LEFT JOIN project p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND ${tw.where}`, tw.params))?.n);

  const rw = riskWhere(sc);
  let risks = []; let riskBase = 0;
  if (rw) {
    riskBase = N((await get(`SELECT COUNT(*) n FROM risk r LEFT JOIN project p ON p.id = r.project_id
      WHERE r.deleted_at IS NULL AND ${rw.where}`, rw.params))?.n);
    risks = await all(`SELECT r.title, COALESCE(r.impact,'') impact, p.name_ar project
      FROM risk r LEFT JOIN project p ON p.id = r.project_id
      WHERE r.deleted_at IS NULL AND COALESCE(r.status,'OPEN') != 'CLOSED' AND ${rw.where}
      ORDER BY CASE COALESCE(r.impact,'') WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 6`,
    rw.params);
  }

  const dw = deliverableWhere(sc);
  let lateDlv = []; let dlvBase = 0;
  if (dw) {
    dlvBase = N((await get(`SELECT COUNT(*) n FROM deliverable d LEFT JOIN project p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND ${dw.where}`, dw.params))?.n);
    const endY = Number(period.to.slice(0, 4)); const endM = Number(period.to.slice(5, 7));
    lateDlv = await all(`SELECT d.name_ar, d.year, d.month, p.name_ar project
      FROM deliverable d LEFT JOIN project p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL AND ${dw.where}
        AND COALESCE(d.status,'PENDING') IN ('PENDING','DELIVERED')
        AND d.year IS NOT NULL AND d.month IS NOT NULL
        AND (d.year < ? OR (d.year = ? AND d.month < ?))
      ORDER BY d.year, d.month LIMIT 6`, [...dw.params, endY, endY, endM]);
  }

  if (!taskBase && !riskBase && !dlvBase) {
    return absentSection('blockers', 'العوائق', 'لا مهام ولا مخاطر ولا مخرجات مسجّلة ضمن هذا النطاق بعد',
      'العوائق تُقرأ من المهام المُعطَّلة والمخاطر المفتوحة والمخرجات التي فات شهرها — لا شيء منها مسجَّل هنا حتى الآن.');
  }

  const rows = [
    ...blocked.map((b) => ({ title: b.title, sub: [b.project, b.assignee].filter(Boolean).join(' · ') || 'مهمة',
      meta: b.blocked_reason || 'مُعطَّلة بلا سبب مكتوب', tone: 'bad' })),
    ...risks.map((r) => ({ title: r.title, sub: r.project || 'خطر على مستوى القطاع',
      meta: r.impact === 'high' ? 'أثر مرتفع' : r.impact === 'medium' ? 'أثر متوسط' : 'أثر منخفض أو غير مسجّل',
      tone: r.impact === 'high' ? 'bad' : 'warn' })),
    ...lateDlv.map((d) => ({ title: d.name_ar, sub: d.project || 'مخرَج',
      meta: `مستحق ${MONTHS_AR[Number(d.month) - 1] || ''} ${d.year} ولم يُقبل بعد`, tone: 'warn' })),
  ];

  const figures = [
    figureOr('مهام مُعطَّلة الآن', !!taskBase, String(blocked.length), NO_TASKS_AR[sc.lens],
      { tone: blocked.length ? 'bad' : 'good' }),
    figureOr('مخاطر مفتوحة', !!riskBase, String(risks.length),
      rw ? 'لا مخاطر مسجّلة ضمن هذا النطاق بعد' : 'المخاطر تُسجَّل على المشاريع لا على الفرص',
      { tone: risks.length ? 'warn' : 'good' }),
    figureOr('مخرجات فات شهرها ولم تُقبل', !!dlvBase, String(lateDlv.length),
      dw ? 'لا مخرجات مسجّلة ضمن هذا النطاق بعد' : 'المخرَج يُسجَّل على المشروع ولا يحمل مالكاً فرداً',
      { tone: lateDlv.length ? 'warn' : 'good' }),
  ];

  return { key: 'blockers', title_ar: 'العوائق', basis_ar: 'مهام مُعطَّلة ومخاطر مفتوحة ومخرجات متأخرة',
    state: 'data', figures, rows: rows.slice(0, 10), rows_title_ar: 'ما يعيق العمل الآن',
    note_ar: rows.length ? '' : 'لا عائق مسجَّل — الأرقام أعلاه مقيسة على سجلات موجودة فعلاً.' };
}

// ── الطاقة: الحمل المخطَّط من التسكين الشهري (لا من ساعات العمل) ──
// حساب الحمل نسخة طبق الأصل من `sectorStaffing`: مجموع كسور الشهر لكل شخص ثم ×100 وتقريب.
async function plannedLoad({ where, params, months }) {
  const years = [...new Set(months.map((m) => m.year))];
  const yph = years.map(() => '?').join(',');
  const rows = await all(`SELECT a.employee_id, a.person_name_ar, a.year, a.monthly_json,
      e.name_ar emp_name, e.job_title
    FROM allocation a LEFT JOIN employee e ON e.id = a.employee_id
    WHERE a.deleted_at IS NULL AND a.year IN (${yph}) AND ${where}`, [...years, ...params]);
  const byKey = {};
  for (const r of rows) {
    const key = r.employee_id || r.person_name_ar || '—';
    const b = (byKey[key] ||= { key, employee_id: r.employee_id || null,
      name: r.emp_name || r.person_name_ar || 'غير مسمّى', job: r.job_title || '', load: {} });
    let mj = {}; try { mj = JSON.parse(r.monthly_json || '{}'); } catch { mj = {}; }
    for (const m of months) {
      if (Number(r.year) !== m.year) continue;
      b.load[`${m.year}-${m.month}`] = (b.load[`${m.year}-${m.month}`] || 0) + (Number(mj[String(m.month)]) || 0);
    }
  }
  return Object.values(byKey).map((b) => {
    const pcts = months.map((m) => Math.round((b.load[`${m.year}-${m.month}`] || 0) * 100));
    return { ...b, pcts,
      avg: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : 0,
      peak: pcts.length ? Math.max(...pcts) : 0 };
  }).sort((x, y) => y.peak - x.peak || y.avg - x.avg);
}

async function capacitySection(user, sc, period) {
  const basis = 'الطاقة المخطَّطة — من التسكين الشهري (لا من ساعات العمل)';
  const aw = allocWhere(sc);
  if (!aw) return absentSection('capacity', 'الطاقة', NO_ALLOC_AR[sc.lens],
    sc.lens === 'opportunity'
      ? 'فريق الفرصة يُسجَّل بنسبة مشاركة، والطاقة الشهرية تُسجَّل على المشاريع — الرقمان مقياسان مختلفان ولا يُجمعان.'
      : 'يظهر هنا بمجرد تسجيل أول تسكين شهري ضمن هذا النطاق.', basis);

  // القطاع يستدعي `sectorStaffing` نفسها التي تغذّي مركز القطاع — ضمانة ألا يفترق الرقمان.
  let people;
  if (sc.lens === 'sector' && period.months.length && period.months.every((m) => m.year === period.months[0].year)) {
    const st = await sectorStaffing(sc.sectorId, period.months[0].year);
    people = st.employees.map((e) => {
      const pcts = period.months.map((m) => N(e.months[m.month - 1]));
      return { name: e.name, job: e.job, pcts,
        avg: Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length), peak: Math.max(...pcts) };
    }).sort((x, y) => y.peak - x.peak || y.avg - x.avg);
  } else {
    people = await plannedLoad({ where: aw.where, params: aw.params, months: period.months });
  }

  if (!people.length) {
    return absentSection('capacity', 'الطاقة', NO_ALLOC_AR[sc.lens],
      sc.lens === 'department'
        ? 'نسبة التسكين إلى إدارة تُسجَّل من شاشة التسكين ولم تُملأ تلقائياً — الفراغ هنا يعني «لم يُنسب بعد».'
        : 'يظهر هنا بمجرد تسجيل أول تسكين شهري ضمن هذا النطاق.', basis);
  }

  const avg = Math.round(people.reduce((a, p) => a + p.avg, 0) / people.length);
  const over = people.filter((p) => p.peak > CAPACITY.over).length;
  const free = people.filter((p) => p.avg < CAPACITY.healthy).length;
  const monthsText = period.months.map((m) => `${MONTHS_AR[m.month - 1]} ${m.year}`).join(' · ');

  return {
    key: 'capacity', title_ar: 'الطاقة', basis_ar: basis, state: 'data',
    figures: [
      figure('أشخاص لهم تسكين في الفترة', String(people.length)),
      figure('متوسط الحمل المخطَّط', pctText(avg), { tone: avg > CAPACITY.over ? 'bad' : avg >= CAPACITY.healthy ? 'good' : 'warn' }),
      figure('فوق الطاقة في أحد أشهر الفترة', String(over), { tone: over ? 'bad' : 'good' }),
      figure('لديهم سعة متاحة', String(free), { tone: free ? 'warn' : '' }),
    ],
    rows: people.slice(0, 8).map((p) => ({ title: p.name, sub: p.job || 'بلا مسمى وظيفي مسجّل',
      meta: `${pctText(p.avg)} · ${capacityLabel(p.avg)}`,
      tone: p.peak > CAPACITY.over ? 'bad' : p.avg >= CAPACITY.healthy ? '' : 'warn' })),
    rows_title_ar: 'الحمل المخطَّط لكل شخص',
    note_ar: `التسكين مسجَّل شهرياً؛ أشهر هذه الفترة: ${monthsText}.`,
  };
}

// ── الإشغال: الساعات القابلة للفوترة من سجل الوقت (مقياس آخر غير الطاقة أعلاه) ──
async function utilizationSection(user, sc, period) {
  const basis = 'الإشغال القابل للفوترة — من سجل الوقت (مقياس مستقل عن الطاقة المخطَّطة)';
  const tw = timeWhere(sc);
  const join = `FROM time_entry te
    LEFT JOIN app_user u ON u.id = te.user_id
    LEFT JOIN employee e ON e.id = u.employee_id`;
  const ever = N((await get(`SELECT COUNT(*) n ${join} WHERE te.deleted_at IS NULL AND ${tw.where}`, tw.params))?.n);
  if (!ever) {
    return absentSection('utilization', 'الإشغال',
      'لا ساعات مسجّلة لهذا النطاق في المنصة بعد',
      'الإشغال يُحسب من سجل الوقت — يظهر بمجرد تسجيل أول ساعة.', basis);
  }
  const agg = await get(`SELECT COUNT(*) n, COALESCE(SUM(te.hours),0) total,
      COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours ELSE 0 END),0) billable,
      COUNT(DISTINCT te.user_id) people
    ${join} WHERE te.deleted_at IS NULL AND ${tw.where} AND te.entry_date BETWEEN ? AND ?`,
  [...tw.params, period.from, period.to]);
  if (!N(agg?.n)) {
    return absentSection('utilization', 'الإشغال', 'لا ساعات مسجّلة خلال هذه الفترة',
      'النسبة تحتاج ساعات مسجّلة داخل الفترة — بلا ساعات لا نسبة، ولا تُعرض صفراً لأن الصفر يعني «عمل بلا فوترة» لا «لا تسجيل».', basis);
  }

  // القطاع يستدعي `sectorUtilization` نفسها التي يغذّي بها تقرير القوى العاملة — لا حساب موازٍ.
  let rows = [];
  if (sc.lens === 'sector') {
    rows = (await sectorUtilization(sc.sectorId, period.from, period.to))
      .sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 8)
      .map((p) => ({ title: p.name_ar, sub: `${hoursText(p.total)} إجمالاً`,
        meta: `${pctText(p.utilization_pct)} قابلة للفوترة`, tone: '' }));
  } else if (sc.lens !== 'person') {
    rows = (await all(`SELECT COALESCE(u.name_ar, u.username) nm, COALESCE(SUM(te.hours),0) total,
        COALESCE(SUM(CASE WHEN te.billable = 1 THEN te.hours ELSE 0 END),0) billable
      ${join} WHERE te.deleted_at IS NULL AND ${tw.where} AND te.entry_date BETWEEN ? AND ?
      GROUP BY u.name_ar, u.username ORDER BY total DESC LIMIT 8`,
    [...tw.params, period.from, period.to]))
      .map((r) => ({ title: r.nm || 'غير مسمّى', sub: `${hoursText(r.total)} إجمالاً`,
        meta: `${pctText(N(r.total) ? (N(r.billable) / N(r.total)) * 100 : 0)} قابلة للفوترة`, tone: '' }));
  }

  const pct = N(agg.total) ? (N(agg.billable) / N(agg.total)) * 100 : 0;
  return {
    key: 'utilization', title_ar: 'الإشغال', basis_ar: basis, state: 'data',
    figures: [
      figure('ساعات مسجّلة في الفترة', hoursText(agg.total)),
      figure('منها قابلة للفوترة', hoursText(agg.billable)),
      figure('نسبة الإشغال القابل للفوترة', pctText(pct), { tone: pct >= CAPACITY.healthy ? 'good' : 'warn' }),
      figure('عدد من سجّل ساعات', String(N(agg.people))),
    ],
    rows, rows_title_ar: 'الإشغال حسب الشخص',
    note_ar: 'الإشغال مقياس سعة تشغيلية لا تقييم فردي؛ لا يُستخدم ترتيباً علنياً ولا أساساً لمقارنة الأشخاص.',
  };
}

// ── التعارضات: من يتجاوز طاقته الكاملة في أحد أشهر الفترة ──
// التجاوز يُقاس على **مجموع** تسكين الشخص كله لا على حصّة هذه العدسة وحدها: من عليه 40% هنا
// و90% في مشروع آخر هو المتعارض، ولن يظهر لو قِسنا الحصة فقط.
async function conflictsSection(user, sc, period) {
  const basis = 'تجاوز الطاقة المخطَّطة — من التسكين الشهري';
  let ids = [];
  if (sc.lens === 'person') {
    if (!sc.employeeId) {
      return absentSection('conflicts', 'التعارضات', 'هذا الحساب غير مرتبط بملف موظف',
        'التعارض يُقاس من تسكين الموظف — يظهر بعد ربط الحساب بملفه في الفريق.', basis);
    }
    ids = [sc.employeeId];
  } else if (sc.lens === 'opportunity') {
    ids = (await all(`SELECT DISTINCT m.employee_id FROM membership m
      WHERE m.group_kind = 'opportunity' AND m.group_id = ? AND m.deleted_at IS NULL
        AND m.employee_id IS NOT NULL`, [sc.opportunityId])).map((r) => r.employee_id);
    if (!ids.length) {
      return absentSection('conflicts', 'التعارضات', 'لا فريق مسجَّل على هذه الفرصة بعد',
        'يظهر التعارض بعد تسجيل أعضاء فريق الفرصة وربطهم بتسكين شهري.', basis);
    }
  } else {
    const aw = allocWhere(sc);
    if (!aw) return absentSection('conflicts', 'التعارضات', NO_ALLOC_AR[sc.lens], '', basis);
    const years = [...new Set(period.months.map((m) => m.year))];
    const yph = years.map(() => '?').join(',');
    ids = (await all(`SELECT DISTINCT a.employee_id FROM allocation a
      WHERE a.deleted_at IS NULL AND a.employee_id IS NOT NULL AND a.year IN (${yph}) AND ${aw.where}`,
    [...years, ...aw.params])).map((r) => r.employee_id);
    if (!ids.length) {
      return absentSection('conflicts', 'التعارضات', NO_ALLOC_AR[sc.lens],
        sc.lens === 'department'
          ? 'نسبة التسكين إلى إدارة تُسجَّل يدوياً ولم تُملأ تلقائياً — الفراغ هنا يعني «لم يُنسب بعد».'
          : 'يظهر التعارض بمجرد وجود تسكين شهري ضمن هذا النطاق.', basis);
    }
  }

  const ph = ids.map(() => '?').join(',');
  const totals = await plannedLoad({ where: `a.employee_id IN (${ph})`, params: ids, months: period.months });
  const over = totals.filter((p) => p.peak > CAPACITY.over);
  const rows = [];
  for (const p of over.slice(0, 8)) {
    const worst = p.pcts.indexOf(p.peak);
    const m = period.months[worst] || period.months[0];
    rows.push({ title: p.name, sub: p.job || 'بلا مسمى وظيفي مسجّل',
      meta: `${pctText(p.peak)} في ${MONTHS_AR[m.month - 1]} ${m.year}`, tone: 'bad' });
  }
  return {
    key: 'conflicts', title_ar: 'التعارضات', basis_ar: basis, state: 'data',
    figures: [
      figure('أشخاص فوق طاقتهم في الفترة', String(over.length), { tone: over.length ? 'bad' : 'good' }),
      figureOr('أعلى حمل مسجَّل', totals.length > 0, totals.length ? pctText(totals[0].peak) : '',
        'لا تسكين لهؤلاء في أشهر الفترة'),
    ],
    rows, rows_title_ar: 'تعارضات تحتاج قراراً',
    note_ar: `التجاوز فوق ${CAPACITY.over}% من الطاقة الكاملة، ويُقاس على مجموع تسكين الشخص في المنصة كلها لا على حصّة هذا النطاق وحده.`,
  };
}

// ── القرارات المطلوبة: طلبات اعتماد معلّقة، كلٌّ بهويّة سجلّه الحقيقية ──
// عمودان هنا كانا يسمّيان ما لا وجود له: `expense.title` و`proposal.title_ar` — والجدولان لا
// يملكان عمود عنوان أصلاً. الاستعلام كان يرفع خطأ فيبتلعه `catch` أدناه، فيقرأ المالك «مصروف»
// و«عرض» بلا هوية ولا يعرف أن ثمة عطلاً. الوصف الحقيقي في الجدولين هو `type` و`kind`، وهما
// المستعملان الآن — واختبار `report-approval-names` يفحص كل زوج (جدول، عمود) على المخطط نفسه
// كي يسقط الخطأ المطبعي القادم في الاختبار لا صامتاً على شاشة المالك.
const APPROVAL_NAME_COL = { opportunity: 'title_ar', contract: 'code', invoice: 'code', expense: 'type', proposal: 'kind' };
// موارد بلا جدول أسماء إطلاقاً (`timesheet` سجلّه `time_entry` ولا اسم له): تُعلن صراحةً كي
// يبقى `catch` شبكةَ أمان لا مساراً معتاداً — فمن يبتلع الأخطاء بلا تمييز يبتلع الأعطال معها.
const APPROVAL_NO_NAME = new Set(['timesheet']);
const APPROVAL_RES_AR = { opportunity: 'فرصة', proposal: 'عرض', expense: 'مصروف', deliverable: 'مخرَج',
  timesheet: 'سجل وقت', invoice: 'فاتورة', project: 'مشروع', contract: 'عقد' };
export const _approvalNameCols = () => ({ cols: { ...APPROVAL_NAME_COL }, noName: new Set(APPROVAL_NO_NAME), fallback: 'name_ar' });

// أسماء السجلات المطلوب اعتمادها — دفعة واحدة لكل نوع، وبلا اختلاق عند الغياب.
export async function approvalTargetNames(rows) {
  const byRes = {};
  for (const r of rows) if (r.resource && r.resource_id) (byRes[r.resource] ||= new Set()).add(r.resource_id);
  const names = {};
  for (const [res, set] of Object.entries(byRes)) {
    if (!/^[a-z_]+$/.test(res)) continue;            // اسم الجدول من قائمة مغلقة لا من مدخلات
    if (APPROVAL_NO_NAME.has(res)) { names[res] = {}; continue; }   // معلَن لا مُكتشَف بالخطأ
    const col = APPROVAL_NAME_COL[res] || 'name_ar';
    const ids = [...set];
    const ph = ids.map(() => '?').join(',');
    try {
      const found = await all(`SELECT id, ${col} nm FROM ${res} WHERE id IN (${ph})`, ids);
      names[res] = Object.fromEntries(found.map((f) => [f.id, f.nm]));
    } catch { names[res] = {}; }                      // جدول بلا عمود اسم — يبقى بلا اسم لا باسم مخترع
  }
  return names;
}

async function decisionsSection(user, sc, period) {
  const where = ['ar.status = \'PENDING\'']; const params = [];
  if (sc.lens === 'sector') { where.push('ar.sector_id = ?'); params.push(sc.sectorId); }
  else if (sc.lens === 'department') {
    where.push(`ar.requested_by IN (SELECT u.id FROM app_user u JOIN employee e ON e.id = u.employee_id
      WHERE e.department_id = ?)`);
    params.push(sc.departmentId);
  } else if (sc.lens === 'person') { where.push('ar.requested_by = ?'); params.push(sc.userId); }
  else if (sc.lens === 'project') {
    where.push(`(ar.resource_id = ? OR (ar.resource = 'deliverable' AND ar.resource_id IN
      (SELECT id FROM deliverable WHERE project_id = ? AND deleted_at IS NULL)))`);
    params.push(sc.projectId, sc.projectId);
  } else if (sc.lens === 'opportunity') { where.push('ar.resource_id = ?'); params.push(sc.opportunityId); }
  else if (user.scope !== 'company') { where.push('ar.sector_id = ?'); params.push(user.sector_id || ''); }

  const rows = await all(`SELECT ar.id, ar.resource, ar.resource_id, ar.amount_halalas, ar.created_at,
      ar.current_step, wd.name_ar workflow, COALESCE(u.name_ar, u.username) requester
    FROM approval_request ar
    LEFT JOIN workflow_definition wd ON wd.id = ar.workflow_id
    LEFT JOIN app_user u ON u.id = ar.requested_by
    WHERE ${where.join(' AND ')} ORDER BY ar.created_at LIMIT 10`, params);
  const names = await approvalTargetNames(rows);
  const asOf = Date.parse(period.complete ? period.to : period.as_of);

  const visible = rows.filter((r) => !r.resource || can(user, 'read', r.resource, { sector_id: sc.sectorId }) || user.scope === 'company');
  const items = visible.map((r) => {
    const nm = names[r.resource]?.[r.resource_id];
    const kind = APPROVAL_RES_AR[r.resource] || 'طلب';
    const days = r.created_at ? Math.max(0, Math.round((asOf - Date.parse(String(r.created_at).slice(0, 10))) / DAY)) : null;
    return {
      title: nm ? `${kind}: ${nm}` : `${kind} بانتظار القرار`,
      sub: [r.workflow, r.requester ? `رفعه ${r.requester}` : null].filter(Boolean).join(' · '),
      meta: [r.amount_halalas ? fmtSar(r.amount_halalas) : null, days == null ? null : `منتظر ${days} يوماً`]
        .filter(Boolean).join(' · '),
      tone: days != null && days > 7 ? 'bad' : 'warn',
    };
  });

  return {
    key: 'decisions', title_ar: 'القرارات المطلوبة', basis_ar: 'طلبات الاعتماد المعلّقة', state: 'data',
    figures: [
      figure('طلبات بانتظار قرار', String(items.length), { tone: items.length ? 'warn' : 'good' }),
      figure('إجمالي المبالغ المعلّقة', fmtSar(visible.reduce((a, r) => a + N(r.amount_halalas), 0))),
    ],
    rows: items, rows_title_ar: 'ما ينتظر قراراً',
    note_ar: items.length ? '' : 'لا طلب اعتماد معلّق — رقم مقيس على سجل الاعتمادات لا فراغ في البيانات.',
  };
}

// ═════════════════ (٦) سياق السنة: يُقرأ من `metrics.js` كما هو ════════════════
// أرقام «منذ بداية السنة» توضع في ترويسة التقرير مفصولةً عن أرقام الفترة بوضوح، ومصدرها
// نفس الدوال التي تغذّي لوحة القيادة ومركز القطاع — فلا يقول التقرير رقماً تخالفه الشاشة.
async function yearContext(user, sc, period) {
  const year = period.year;
  const out = [];
  const money = (l, v) => out.push({ label_ar: l, display: fmtSar(v) });
  try {
    if (sc.lens === 'company') {
      const ov = await companyOverview(user, { year });
      money('الإيراد منذ بداية السنة', ov.totals.revenue);
      money('المبيعات منذ بداية السنة', ov.totals.sales);
      money('خط الفرص المفتوح', ov.pipeline_halalas);
      const wr = await winRate(null, year);
      out.push({ label_ar: 'نسبة الفوز', display: pctText(wr.rate) });
    } else if (sc.lens === 'sector') {
      const sd = await sectorDashboard(user, sc.sectorId, { year });
      if (sd) {
        money('الإيراد منذ بداية السنة', sd.revenue_halalas);
        money('المبيعات منذ بداية السنة', sd.sales_halalas);
        const cov = await pipelineCoverage(sc.sectorId, year);
        out.push({ label_ar: 'تغطية خط الفرص', display: cov.coverage == null ? 'لا مستهدف مسجّل' : `${cov.coverage}×` });
        const wr = await winRate(sc.sectorId, year);
        out.push({ label_ar: 'نسبة الفوز', display: pctText(wr.rate) });
        if (canSeeSensitive(user, 'margin')) {
          const gm = await grossMargin(sc.sectorId, year);
          out.push({ label_ar: 'هامش الربح', display: gm.margin_pct == null ? 'لا إيراد مسجَّل لحسابه' : pctText(gm.margin_pct), sensitive: 'margin' });
        }
      }
    } else if (sc.lens === 'project') {
      const k = await projectKpis(sc.projectId);
      out.push({ label_ar: 'إنجاز المهام', display: k.totalTasks ? pctText(k.taskCompletionRate) : 'لا مهام مسجّلة' });
      out.push({ label_ar: 'قبول المخرجات', display: k.totalDeliverables ? pctText(k.deliverableAcceptanceRate) : 'لا مخرجات مسجّلة' });
      out.push({ label_ar: 'مهام متأخرة', display: String(k.lateTasks) });
    } else if (sc.lens === 'opportunity') {
      const r = sc.row || {};
      money('قيمة الفرصة', N(r.value_halalas));
      out.push({ label_ar: 'المرحلة', display: r.stage_name || 'غير محدّدة' });
    }
  } catch { /* سياق السنة إضافة لا شرط: غيابه لا يمنع تقرير الفترة */ }
  return out;
}

// ═════════════════════════ (٧) بناء التقرير كاملاً ═════════════════════════════

/**
 * تقرير فترة كامل لعدسة واحدة، بصلاحيات قارئه.
 * @param {object} user المستخدم القارئ
 * @param {object} opts { period:'week'|'month'|'quarter', anchor, lens, targetId, today }
 */
export async function buildPeriodReport(user, opts = {}) {
  const period = resolvePeriod(opts.period || 'week', opts.anchor || new Date(), opts.today || new Date());
  const sc = await resolveScope(user, opts.lens || 'company', opts.targetId);
  const sections = [];
  sections.push(await contributionsSection(user, sc, period));
  sections.push(await tasksSection(user, sc, period));
  sections.push(await progressSection(user, sc, period));
  sections.push(await blockersSection(user, sc, period));
  sections.push(await capacitySection(user, sc, period));
  sections.push(await utilizationSection(user, sc, period));
  sections.push(await conflictsSection(user, sc, period));
  sections.push(await decisionsSection(user, sc, period));
  const context = await yearContext(user, sc, period);
  const gates = ['margin', 'cost', 'salary'].filter((g) => canSeeSensitive(user, g));

  return {
    period,
    lens: sc.lens,
    lens_ar: LENS_LABELS_AR[sc.lens],
    target: { id: sc.id, name_ar: sc.name_ar, kind_ar: sc.kind_ar, sector_id: sc.sectorId || null,
      parent_ar: sc.parent_ar || '', job_ar: sc.job_ar || '' },
    title_ar: `تقرير ${PERIOD_LABELS_AR[period.kind]} — ${sc.name_ar}`,
    context,
    sections,
    generated_at: nowIso(),
    reader_ar: user?.name_ar || user?.username || '',
    gates,
    key: snapshotKey(sc.lens, sc.id, period),
  };
}

// خيارات العدسات المتاحة لهذا القارئ — تُبنى منها قوائم الاختيار في الشاشة.
// كل صف يمرّ بشرط الفتح نفسه الذي يطبّقه الحارس: ما لا يُفتح لا يُعرض في القائمة أصلاً.
export async function lensOptions(user, opts = {}) {
  const limit = Number(opts.limit) || 200;
  const companyWide = user.scope === 'company';
  const secParams = companyWide ? [] : [user.sector_id || ''];
  const secFilter = companyWide ? '' : 'AND s.id = ?';
  const sectors = (await all(`SELECT s.id, s.name_ar FROM sector s
      WHERE s.deleted_at IS NULL AND s.active = 1 ${secFilter} ORDER BY s.sort_order, s.name_ar`, secParams))
    .filter((s) => sectorReadable(user, s));

  const deptWhere = ['d.deleted_at IS NULL', 'd.active = 1'];
  const deptParams = [];
  if (!companyWide) { deptWhere.push('d.sector_id = ?'); deptParams.push(user.sector_id || ''); }
  const departments = (await all(`SELECT d.id, d.name_ar, d.sector_id, s.name_ar sector_name FROM department d
     LEFT JOIN sector s ON s.id = d.sector_id
     WHERE ${deptWhere.join(' AND ')} ORDER BY s.name_ar, d.name_ar LIMIT ?`, [...deptParams, limit]))
    .filter((d) => departmentReadable(user, d));

  const peopleWhere = ['u.deleted_at IS NULL', 'u.active = 1'];
  const peopleParams = [];
  if (!companyWide) { peopleWhere.push('(u.sector_id = ? OR u.id = ?)'); peopleParams.push(user.sector_id || '', user.id); }
  const people = (await all(`SELECT u.id, COALESCE(u.name_ar, u.username) name_ar, u.sector_id,
       e.department_id, s.name_ar sector_name
     FROM app_user u LEFT JOIN sector s ON s.id = u.sector_id
     LEFT JOIN employee e ON e.id = u.employee_id
     WHERE ${peopleWhere.join(' AND ')} ORDER BY u.name_ar LIMIT ?`, [...peopleParams, limit]))
    .filter((p) => personReadable(user, p));

  const projWhere = ['p.deleted_at IS NULL'];
  const projParams = [];
  if (!companyWide) { projWhere.push('p.sector_id = ?'); projParams.push(user.sector_id || ''); }
  const projects = (await all(`SELECT p.id, p.name_ar, p.sector_id, p.department_id, p.owner_user_id
     FROM project p WHERE ${projWhere.join(' AND ')}
     ORDER BY p.name_ar LIMIT ?`, [...projParams, limit]))
    .filter((p) => can(user, 'read', 'project', p));

  const oppWhereSql = ['o.deleted_at IS NULL'];
  const oppParams = [];
  if (!companyWide) { oppWhereSql.push('o.sector_id = ?'); oppParams.push(user.sector_id || ''); }
  const opportunities = (await all(`SELECT o.id, o.title_ar name_ar, o.sector_id, o.department_id, o.owner_user_id
     FROM opportunity o WHERE ${oppWhereSql.join(' AND ')} ORDER BY o.value_halalas DESC LIMIT ?`,
  [...oppParams, limit])).filter((o) => can(user, 'read', 'opportunity', o));

  // الجهة الافتراضية = أوسع ما **يفتحه** القارئ فعلاً، لا أوسع ما تعرضه القائمة: مدير مشروع
  // كان يهبط على تقرير قطاع يردّه النظام، فأول ما يراه في الشاشة رسالة منع لم يطلبها.
  const company = seesCompanyPerformance(user);
  const defaultScope = company ? 'company:'
    : sectors.length ? `sector:${sectors[0].id}`
      : departments.length ? `department:${departments[0].id}`
        : projects.length ? `project:${projects[0].id}`
          : `person:${user.id}`;
  return {
    company, sectors, departments, people, projects, opportunities,
    defaultScope, defaultLens: defaultScope.split(':')[0],
  };
}

// ═════════════════════════ (٨) النسخ المحفوظة ═════════════════════════════════
// جدول `report_snapshot` قائم منذ أول ترحيلة ولم يُكتب فيه صف واحد قط. هنا يبدأ استعماله:
// كل إصدار يُحفَظ بمفتاح ثابت (عدسة#هدف#نوع الفترة#بدايتها) فتُفتَح الفترة نفسها لاحقاً وتُقارن.

const snapshotKey = (lens, targetId, period) => `${lens}#${targetId || '*'}#${period.kind}#${period.from}`;

/**
 * إصدار التقرير وحفظ نسخته. كتابة واحدة داخل معاملة مع سطر تدقيق.
 * @returns {{id, key, period_label, created_at}}
 */
export async function savePeriodSnapshot(ctx, opts = {}) {
  const user = ctx?.user;
  const report = await buildPeriodReport(user, opts);
  const html = renderPeriodReport(report).html;
  const sid = id('rsnap'); const now = nowIso();
  await tx(async () => {
    await insert('report_snapshot', {
      id: sid,
      report_id: null,                                  // تقرير فترة مُصدَر بالطلب، لا تعريفاً مجدولاً
      scope_ref: report.key,
      period_label: report.period.label_ar,
      html,
      data_json: JSON.stringify({
        lens: report.lens, targetId: report.target.id, target_name: report.target.name_ar,
        period: report.period, context: report.context, sections: report.sections,
        gates: report.gates, title_ar: report.title_ar,
      }),
      created_at: now,
      created_by: user?.id || null,
    });
    await audit(ctx, {
      action: 'create', resource: 'report', resourceId: sid,
      sectorId: report.target.sector_id || (user?.sector_id || null),
      detail: { kind: 'period_snapshot', lens: report.lens, target: report.target.id,
        period: report.period.kind, from: report.period.from, label: report.period.label_ar },
    });
  });
  return { id: sid, key: report.key, period_label: report.period.label_ar, created_at: now, report, html };
}

// النسخ المحفوظة لهذه العدسة وهذا الهدف (الأحدث أولاً).
export async function listPeriodSnapshots(user, opts = {}) {
  const sc = await resolveScope(user, opts.lens || 'company', opts.targetId);
  const prefix = `${sc.lens}#${sc.id || '*'}#`;
  const rows = await all(`SELECT s.id, s.scope_ref, s.period_label, s.created_at,
      COALESCE(u.name_ar, u.username) created_by_name
    FROM report_snapshot s LEFT JOIN app_user u ON u.id = s.created_by
    WHERE s.scope_ref LIKE ? ORDER BY s.created_at DESC LIMIT 20`, [prefix + '%']);
  return rows.map((r) => ({ id: r.id, period_label: r.period_label,
    created_at: r.created_at, created_by_name: r.created_by_name || '' }));
}

// فتح نسخة محفوظة — الصلاحية تُعاد فحصها الآن على عدسة النسخة، لا على من حفظها.
export async function readPeriodSnapshot(user, snapshotId) {
  const row = await get('SELECT * FROM report_snapshot WHERE id = ?', [snapshotId]);
  if (!row) throw notFound('النسخة المحفوظة غير موجودة — اخترها من قائمة النسخ.');
  let data = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
  await resolveScope(user, data.lens || String(row.scope_ref || '').split('#')[0], data.targetId);
  // نسخة تحوي أرقاماً حسّاسة لا تُفتح لمن لا يملك بوابتها — الحفظ لا يمنح صلاحية.
  for (const g of (data.gates || [])) {
    if (['margin', 'cost', 'salary'].includes(g) && !canSeeSensitive(user, g)) {
      throw forbidden('هذه النسخة تحتوي أرقاماً خارج صلاحيتك — اطلب نسخة من صاحب الصلاحية أو أصدر تقريرك بنفسك.');
    }
  }
  return { id: row.id, period_label: row.period_label, created_at: row.created_at, html: row.html, data };
}

// مقارنة نسخة الفترة الحالية بنسخة الفترة السابقة إن كانت محفوظة (بلا اختلاق عند غيابها).
export async function comparePreviousSnapshot(user, report) {
  const prev = previousPeriod(report.period);
  const key = snapshotKey(report.lens, report.target.id, prev);
  const row = await get('SELECT id, period_label, data_json FROM report_snapshot WHERE scope_ref = ? ORDER BY created_at DESC LIMIT 1', [key]);
  if (!row) {
    return { available: false, period_label: prev.label_ar,
      message_ar: `لا نسخة محفوظة لـ${prev.label_ar} — احفظ نسخة كل فترة لتصبح المقارنة ممكنة.` };
  }
  let data = {}; try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
  const byKey = Object.fromEntries((data.sections || []).map((s) => [s.key, s]));
  const deltas = [];
  for (const s of report.sections) {
    const old = byKey[s.key];
    if (!old || old.state !== 'data' || s.state !== 'data') continue;
    for (const f of s.figures) {
      const of_ = (old.figures || []).find((x) => x.label_ar === f.label_ar);
      if (!of_ || of_.display == null || f.display == null) continue;
      if (of_.display !== f.display) deltas.push({ section_ar: s.title_ar, label_ar: f.label_ar, before: of_.display, after: f.display });
    }
  }
  return { available: true, id: row.id, period_label: prev.label_ar, deltas: deltas.slice(0, 12) };
}

// ═══════════════════════ (٩) نسخة للطباعة والحفظ ══════════════════════════════

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TONE_COLOR = { good: '#047857', warn: '#a16207', bad: '#dc2626', '': '#1e293b' };

/**
 * مستند مستقل قابل للطباعة والحفظ (نفس بيانات الشاشة حرفياً — لا حساب ثانٍ).
 * @returns {{title:string, html:string}}
 */
export function renderPeriodReport(report) {
  const secHtml = report.sections.map((s) => {
    if (s.state === 'absent') {
      return `<section style="margin:18px 0;padding:14px 16px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc">
        <div style="font-weight:800;font-size:14px;color:#1e293b">${esc(s.title_ar)}</div>
        <div style="font-size:13px;color:#5b6472;margin-top:6px">${esc(s.absence_ar)}</div>
        ${s.hint_ar ? `<div style="font-size:11.5px;color:#79828f;margin-top:4px">${esc(s.hint_ar)}</div>` : ''}
      </section>`;
    }
    const figs = s.figures.map((f) => `<td style="padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc" valign="top">
      <div style="font-size:11px;color:#5b6472">${esc(f.label_ar)}</div>
      ${f.display == null
    ? `<div style="font-size:12px;color:#79828f;font-style:italic;margin-top:4px">${esc(f.absence_ar || 'غير متاح')}</div>`
    : `<div style="font-size:19px;font-weight:800;color:${TONE_COLOR[f.tone || ''] || TONE_COLOR['']}">${esc(f.display)}</div>`}
    </td>`).join('');
    const rowsHtml = (s.rows || []).length ? `<div style="font-size:12px;font-weight:700;margin:12px 0 6px;color:#1e293b">${esc(s.rows_title_ar || '')}</div>
      <table width="100%" cellspacing="0" style="font-size:12.5px;border-collapse:collapse">
        ${s.rows.map((r) => `<tr>
          <td style="padding:6px;border-top:1px solid #e2e8f0;font-weight:600">${esc(r.title)}</td>
          <td style="padding:6px;border-top:1px solid #e2e8f0;color:#5b6472">${esc(r.sub || '')}</td>
          <td style="padding:6px;border-top:1px solid #e2e8f0;text-align:end;color:${TONE_COLOR[r.tone || ''] || TONE_COLOR['']}">${esc(r.meta || '')}</td>
        </tr>`).join('')}
      </table>` : '';
    return `<section style="margin:18px 0">
      <div style="font-weight:800;font-size:14px;color:#1e293b">${esc(s.title_ar)}</div>
      ${s.basis_ar ? `<div style="font-size:11px;color:#79828f;margin-bottom:8px">${esc(s.basis_ar)}</div>` : ''}
      <table width="100%" cellspacing="6" style="border-collapse:separate"><tr>${figs}</tr></table>
      ${rowsHtml}
      ${s.note_ar ? `<div style="font-size:11px;color:#5b6472;margin-top:8px">${esc(s.note_ar)}</div>` : ''}
    </section>`;
  }).join('');

  const ctx = report.context.length ? `<table width="100%" cellspacing="6" style="border-collapse:separate"><tr>${
    report.context.map((c) => `<td style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px;background:#fff">
      <div style="font-size:11px;color:#5b6472">${esc(c.label_ar)}</div>
      <div style="font-size:15px;font-weight:800;color:#1e293b">${esc(c.display)}</div></td>`).join('')
  }</tr></table>` : '';

  const stateLine = report.period.future ? 'فترة لم تبدأ بعد — لا وقائع مسجّلة فيها'
    : report.period.partial ? `فترة جارية — الأرقام حتى ${report.period.as_of}`
      : 'فترة مكتملة';

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title_ar)}</title>
<style>@media print{.noprint{display:none}}body{margin:0;background:#f1f5f9;
font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a;line-height:1.8}</style></head>
<body><div style="max-width:820px;margin:0 auto;padding:22px 14px">
  <div class="noprint" style="text-align:end;margin-bottom:10px">
    <button type="button" onclick="window.print()" style="border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:.45rem .9rem;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer">طباعة أو حفظ كملف</button>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
    <div style="background:linear-gradient(120deg,#244A99,#834798);padding:18px 22px;color:#fff">
      <div style="font-size:12px;opacity:.9">EVC · رؤية الخبراء الاستشارية · منصة سند</div>
      <div style="font-size:19px;font-weight:800;margin-top:3px">${esc(report.title_ar)}</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:2px">${esc(report.period.label_ar)} · ${esc(stateLine)}</div>
      ${report.target.parent_ar ? `<div style="font-size:11.5px;opacity:.8">${esc(report.target.parent_ar)}</div>` : ''}
    </div>
    <div style="padding:16px 22px">
      ${ctx}
      ${secHtml}
    </div>
    <div style="padding:12px 22px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#5b6472">
      صدر من منصة سند في ${esc(String(report.generated_at).slice(0, 16).replace('T', ' '))}${report.reader_ar ? ` · باسم ${esc(report.reader_ar)}` : ''} ·
      كل رقم هنا مقروء من سجل مسجَّل، وما لا سجل له مكتوب نصاً لا صفراً.
    </div>
  </div>
</div></body></html>`;
  return { title: report.title_ar, html };
}
