#!/usr/bin/env node
// كشفُ صحّة الهيكلة وربط الحسابات — تشخيصٌ فقط، لا يكتب صفاً واحداً ولا سطر تدقيق.
//
//   node --experimental-sqlite scripts/audit-org-links.mjs
//   node --experimental-sqlite scripts/audit-org-links.mjs --sector SOLUTIONS
//   node --experimental-sqlite scripts/audit-org-links.mjs --json
//
// ── لماذا هذا الكشف أصلاً ─────────────────────────────────────────────────────
// علاقةُ «هذا الحسابُ هو هذا الموظف» مخزَّنة في **عمودين متقابلين**: `employee.user_id`
// و`app_user.employee_id`. امتلاءُ أحدهما دون الآخر لا يُنتج خطأً ولا رسالة — يُنتج صمتاً
// مزدوجاً: شجرةُ الهيكل تقرأ عمود الموظف فتقول «بلا حساب دخول»، وملفُّ الشخص يقرأ عمود الحساب
// فيقول «غير مربوط بسجل موظف»، والشخص في الحقيقة له الاثنان معاً. كِلا الشاشتين تكذب بثقة.
// («إسحاق سيد» و«يعقوب سيد» عينُ هذه الحالة على البيانات الحيّة.)
//
// ولذلك يصنّف هذا الكشف **بالاسم** لا بالعدد وحده: رقمٌ مجرّد لا يُصلَح، والاسم يُصلَح.
//
// ── ما لا يفعله ──────────────────────────────────────────────────────────────
// لا يُصلح، ولا يخمّن، ولا يفعّل حساباً، ولا يرسل بريداً. الإصلاح القاطع وحده في
// scripts/fix-org-links.mjs (معاينةٌ افتراضياً)، والتفعيل والدعوة قرارُ إنسانٍ منفصل.
import { all, get, close } from '../src/core/db/index.js';
import { nowIso } from '../src/core/util/ids.js';
import { normName, isDelivery } from '../src/modules/org/org.js';
// صيغ العدد بالعربية (مفرد/مثنى/جمع) من مصدرها الواحد في المنصة — لا نسخة ثانية تقول
// «1 سطر تسكين» بينما بقية الشاشات تقول «تسكين واحد».
import { countPhrase } from '../src/modules/org/org-quality.js';

// ─────────────────────────────────────────────────────────────────────────────
// أدوات المطابقة
// ─────────────────────────────────────────────────────────────────────────────

// بريدٌ صالح = نفس المِحكّ الذي تطبّقه المنصة عند الدعوة (src/modules/identity/identity.js).
// نسخةٌ ثانية بقاعدة أرخى ستقول «صالح» عن عنوانٍ ترفضه الدعوة، فيُرسَل إلى إنسانٍ ما لا يصل.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const isValidEmail = (v) => EMAIL_RE.test(String(v == null ? '' : v).trim());

// مفتاح لاتيني بصيغة **مجموعة كلمات**: «Ishaq Sayed» و«ishaq.sayed@evcsol.com» و«u_ishaq_sayed»
// تُنتج كلها {ishaq, sayed}. الكلمات ذات الحرف الواحد تُطرح (بادئة «u_» في أسماء الدخول ليست
// جزءاً من اسم أحد)، والترتيب لا يُعتدّ به لأن ترتيب الاسمين يختلف بين مصدر ومصدر.
export function latinTokens(s) {
  return [...new Set(String(s == null ? '' : s).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((t) => t.length > 1))].sort();
}
const tokenKey = (s) => latinTokens(s).join(' ');
const emailLocal = (v) => String(v == null ? '' : v).split('@')[0] || '';

// كل المفاتيح اللاتينية التي يحملها حسابُ دخول: اسمه الإنجليزي، واسم الدخول، ومقدّمة بريده.
function userLatinKeys(u) {
  return [...new Set([tokenKey(u.name_en), tokenKey(u.username), tokenKey(emailLocal(u.email))].filter(Boolean))];
}
const empLatinKeys = (e) => [...new Set([tokenKey(e.name_en)].filter(Boolean))];

// ─────────────────────────────────────────────────────────────────────────────
// ما يُعدّ «عملاً نشطاً» لشخص — الأساس الذي نقول عليه إن حساباً معطَّلاً يُوقف عملاً قائماً
// ─────────────────────────────────────────────────────────────────────────────
const OPEN_TASK = "status NOT IN ('DONE','CANCELLED')";
const OPEN_PROJECT = "status NOT IN ('COMPLETED','CANCELLED')";

async function activeWorkOf({ userId, employeeId, year }) {
  const w = { tasks: 0, projects: 0, opportunities: 0, allocations: 0 };
  if (userId) {
    w.tasks = (await get(
      `SELECT COUNT(*) AS n FROM task WHERE assignee_user_id = ? AND deleted_at IS NULL AND ${OPEN_TASK}`, [userId])).n;
    w.projects = (await get(
      `SELECT COUNT(*) AS n FROM project WHERE owner_user_id = ? AND deleted_at IS NULL AND ${OPEN_PROJECT}`, [userId])).n;
    w.opportunities = (await get(
      `SELECT COUNT(*) AS n FROM opportunity o LEFT JOIN stage st ON st.id = o.stage_id
        WHERE o.owner_user_id = ? AND o.deleted_at IS NULL
          AND COALESCE(st.is_won, 0) = 0 AND COALESCE(st.is_lost, 0) = 0`, [userId])).n;
  }
  if (employeeId) {
    w.allocations = (await get(
      'SELECT COUNT(*) AS n FROM allocation WHERE employee_id = ? AND deleted_at IS NULL AND year >= ?',
      [employeeId, year])).n;
  }
  w.total = w.tasks + w.projects + w.opportunities + w.allocations;
  return w;
}

export function workPhrase(w) {
  const parts = [
    w.tasks ? `مهامّ مفتوحة: ${w.tasks}` : null,
    w.allocations ? `تسكين: ${w.allocations}` : null,
    w.projects ? `مشاريع قائمة باسمه: ${w.projects}` : null,
    w.opportunities ? `فرص مفتوحة باسمه: ${w.opportunities}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'لا عمل مفتوح';
}

// ─────────────────────────────────────────────────────────────────────────────
// «سجلٌّ بلا حساب» ليس كلُّه عطلاً: من غادر أو أُوقف لا يحتاج باباً يدخل منه، ومن ليس على
// التوظيف الأساسي (متعاون · مؤقت · استشاري · متدرب) قد لا يحتاج حساباً أصلاً. نفصل المشروع عن
// العطل صراحةً، لأن كشفاً يعدّ الغياب المشروع عطلاً يُدرَّب المالك على تجاهله كله.
// ─────────────────────────────────────────────────────────────────────────────
const NON_CORE_TYPES = new Set(['متعاون', 'مؤقت', 'استشاري', 'متدرب', 'موسمي', 'متعاقد']);

function employeeNoAccountVerdict(e, today) {
  if (Number(e.active) === 0) return 'غير نشط — لا يحتاج باب دخول';
  if (e.end_date && e.end_date <= today) return `غادر في ${e.end_date} — لا يحتاج باب دخول`;
  if (e.status && String(e.status).trim() !== 'نشط') return `حالته «${e.status}» — لا يحتاج باب دخول`;
  if (NON_CORE_TYPES.has(String(e.employment_type || '').trim())) return `${e.employment_type} — الحساب اختياري لا لازم`;
  return null; // فجوة حقيقية
}

// «حسابٌ بلا سجل موظف» مشروعٌ أيضاً لحسابات العرض (demo.*) وللمستخدم الخارجي وللحساب المعطَّل:
// هؤلاء ليسوا موظفين أصلاً، فغياب سجل الموظف عنهم هو الشكل الصحيح لا نقصٌ فيه.
function userNoEmployeeVerdict(u) {
  if (String(u.username || '').startsWith('demo.')) return 'حساب عرض — ليس موظفاً';
  if (u.role_id === 'external') return 'مستخدم خارجي — ليس موظفاً';
  if (u.role_id === 'viewer') return 'حساب اطّلاع — ليس موظفاً';
  if (Number(u.active) === 0) return 'حساب مغلق — لا يخص أحداً على رأس العمل';
  return null; // فجوة حقيقية
}

// ─────────────────────────────────────────────────────────────────────────────
// الكشف
// ─────────────────────────────────────────────────────────────────────────────
// كل التواريخ تُمرَّر لا تُقرأ من الساعة، كي يُعاد الكشف نفسه غداً فيعطي النتيجة نفسها.
export async function auditOrgLinks(opts = {}) {
  const today = opts.today || nowIso().slice(0, 10);
  const year = Number(opts.year) || Number(today.slice(0, 4));
  const solutionsKey = opts.sector || 'SOLUTIONS';

  const users = await all(
    `SELECT id, username, email, name_ar, name_en, role_id, employee_id, sector_id, scope,
            active, deactivated_at, last_login_at
       FROM app_user WHERE deleted_at IS NULL ORDER BY username`);
  const emps = await all(
    `SELECT id, name_ar, name_en, user_id, sector_id, department_id, job_title,
            employment_type, status, active, hire_date, end_date
       FROM employee WHERE deleted_at IS NULL ORDER BY name_ar`);
  const sectors = await all('SELECT id, name_ar, kind, lead_user_id FROM sector WHERE deleted_at IS NULL ORDER BY sort_order, name_ar');
  const deps = await all('SELECT id, sector_id, name_ar, manager_user_id FROM department WHERE deleted_at IS NULL ORDER BY name_ar');

  const userById = new Map(users.map((u) => [u.id, u]));
  const empById = new Map(emps.map((e) => [e.id, e]));
  const secById = new Map(sectors.map((s) => [s.id, s]));
  const depById = new Map(deps.map((d) => [d.id, d]));
  const secName = (sid) => (sid && secById.has(sid) ? secById.get(sid).name_ar : null);

  // من يشير إلى من — تُقرأ مرة واحدة ويُبنى عليها كل تصنيف بعدها.
  const push = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };
  const claimedByUser = new Map();   // employee_id ⟵ [حسابات تدّعيه]
  for (const u of users) if (u.employee_id) push(claimedByUser, u.employee_id, u);
  const claimedByEmp = new Map();    // user_id ⟵ [سجلات موظفين تدّعيه]
  for (const e of emps) if (e.user_id) push(claimedByEmp, e.user_id, e);

  const person = (u, e) => ({
    user_id: u ? u.id : null, username: u ? u.username : null, user_name_ar: u ? (u.name_ar || null) : null,
    email: u ? (u.email || null) : null, role_id: u ? u.role_id : null,
    employee_id: e ? e.id : null, employee_name_ar: e ? e.name_ar : null,
    sector_id: (e && e.sector_id) || (u && u.sector_id) || null,
    sector_name_ar: secName((e && e.sector_id) || (u && u.sector_id) || null),
    department_name_ar: e && e.department_id && depById.has(e.department_id) ? depById.get(e.department_id).name_ar : null,
  });

  // ── ١ · ربطٌ نصفُه ناقص، في الاتجاهين ──────────────────────────────────────
  const halfFromUser = [];   // الحساب يشير إلى الموظف، وسجل الموظف لا يشير إليه (عين إسحاق ويعقوب)
  const halfFromEmployee = []; // سجل الموظف يشير إلى الحساب، والحساب لا يشير إليه
  const brokenPointers = []; // إشارة إلى صفٍّ غير موجود أو محذوف
  const conflicts = [];      // إشارتان متعارضتان، أو طرفان يتنازعهما اثنان

  for (const u of users) {
    if (!u.employee_id) continue;
    const e = empById.get(u.employee_id);
    if (!e) {
      brokenPointers.push({ side: 'حساب', ...person(u, null), points_to: u.employee_id,
        why: 'الحساب يشير إلى سجل موظف غير موجود أو محذوف' });
      continue;
    }
    if (e.user_id === u.id) continue; // مربوط تماماً — لا شيء
    const rivals = (claimedByUser.get(e.id) || []).filter((x) => x.id !== u.id);
    if (e.user_id && e.user_id !== u.id) {
      conflicts.push({ kind: 'إشارتان متعارضتان', ...person(u, e),
        why: `حساب ${u.username || u.id} يشير إلى «${e.name_ar}»، وسجل «${e.name_ar}» يشير إلى حساب آخر (${(userById.get(e.user_id) || {}).username || e.user_id})` });
      continue;
    }
    if (rivals.length) {
      conflicts.push({ kind: 'حسابان يتنازعان سجلاً واحداً', ...person(u, e),
        why: `«${e.name_ar}» تدّعيه ${rivals.length + 1} حسابات: ${[u, ...rivals].map((x) => x.username || x.id).join('، ')}` });
      continue;
    }
    halfFromUser.push({ ...person(u, e),
      why: 'الحساب يشير إلى سجل الموظف، وسجل الموظف فارغ — فالشجرة تقول «بلا حساب دخول» وهو خبر كاذب',
      missing_side: 'employee.user_id' });
  }

  for (const e of emps) {
    if (!e.user_id) continue;
    const u = userById.get(e.user_id);
    if (!u) {
      brokenPointers.push({ side: 'سجل موظف', ...person(null, e), points_to: e.user_id,
        why: 'سجل الموظف يشير إلى حساب دخول غير موجود أو محذوف' });
      continue;
    }
    if (u.employee_id === e.id) continue;
    if (u.employee_id && u.employee_id !== e.id) continue; // سُجِّل أعلاه بوصفه تعارضاً
    const rivals = (claimedByEmp.get(u.id) || []).filter((x) => x.id !== e.id);
    if (rivals.length) {
      conflicts.push({ kind: 'سجلان يتنازعان حساباً واحداً', ...person(u, e),
        why: `حساب ${u.username || u.id} تدّعيه ${rivals.length + 1} سجلات موظفين: ${[e, ...rivals].map((x) => x.name_ar).join('، ')}` });
      continue;
    }
    halfFromEmployee.push({ ...person(u, e),
      why: 'سجل الموظف يشير إلى الحساب، وخانة الحساب فارغة — فملفّه يقول «غير مربوط بسجل موظف» ولا تظهر إدارته ولا تسكينه',
      missing_side: 'app_user.employee_id' });
  }

  // ── ٢ · توأمٌ غير مرتبط: حسابٌ وسجلٌّ للشخص نفسه بلا رابط ───────────────────
  // درجة الثقة تُذكر ولا يُبنى عليها إصلاح: التطابق الاسمي **دليلٌ لا إثبات**، والشخصان
  // المتشابهان اسمُهما موجودان في كل شركة. القرار لإنسان في كل الأحوال.
  // «حرٌّ» = لا رابط له من **أيّ** الطرفين. قراءة العمود الواحد وحده تجعل صاحبَ نصف الربط يظهر
  // في ثلاث خانات معاً: نصف ربط، وحسابٌ بلا سجل، وسجلٌّ بلا حساب — وهو شخصٌ واحد بعطلٍ واحد.
  // (وأسوأ من التكرار: كان يمكن أن يُرشَّح «توأماً» لنفسه، فيُقرأ العطل مرتين بوجهين مختلفين.)
  const freeUsers = users.filter((u) => !u.employee_id && !claimedByEmp.has(u.id));
  const freeEmps = emps.filter((e) => !e.user_id && !claimedByUser.has(e.id));
  const countBy = (arr, keyFn) => {
    const m = new Map();
    for (const x of arr) for (const k of [].concat(keyFn(x))) if (k) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const uArName = countBy(freeUsers, (u) => normName(u.name_ar));
  const eArName = countBy(freeEmps, (e) => normName(e.name_ar));
  const uLatin = countBy(freeUsers, userLatinKeys);
  const eLatin = countBy(freeEmps, empLatinKeys);

  const twins = [];
  for (const e of freeEmps) {
    const ar = normName(e.name_ar);
    const lat = empLatinKeys(e);
    for (const u of freeUsers) {
      const sameAr = ar && ar === normName(u.name_ar);
      const sharedLatin = userLatinKeys(u).filter((k) => lat.includes(k));
      if (!sameAr && !sharedLatin.length) continue;
      const uniqueAr = sameAr && uArName.get(ar) === 1 && eArName.get(ar) === 1;
      const uniqueLatin = sharedLatin.length > 0
        && sharedLatin.every((k) => uLatin.get(k) === 1 && eLatin.get(k) === 1);
      const sameSector = !!e.sector_id && e.sector_id === u.sector_id;
      let confidence, basis;
      if (sameAr && uniqueAr) { confidence = sameSector ? 'عالية' : 'عالية'; basis = 'تطابق الاسم العربي كاملاً، ولا اسم ثالث يشبهه'; }
      else if (sameAr) { confidence = 'منخفضة'; basis = 'تطابق الاسم العربي، لكن الاسم نفسه يتكرر على أكثر من شخص'; }
      else if (uniqueLatin) { confidence = 'متوسطة'; basis = `تطابق الاسم اللاتيني «${sharedLatin[0]}» بين البريد أو اسم الدخول والاسم الإنجليزي`; }
      else { confidence = 'منخفضة'; basis = 'تشابه لاتيني غير فريد'; }
      twins.push({ ...person(u, e), confidence, basis, same_sector: sameSector,
        why: 'لكلٍّ منهما وجودٌ في القاعدة، ولا رابط بينهما — وقد يكونان شخصاً واحداً' });
    }
  }
  twins.sort((a, b) => ({ عالية: 0, متوسطة: 1, منخفضة: 2 }[a.confidence] - { عالية: 0, متوسطة: 1, منخفضة: 2 }[b.confidence])
    || String(a.employee_name_ar).localeCompare(String(b.employee_name_ar), 'ar'));
  const twinEmpIds = new Set(twins.map((t) => t.employee_id));
  const twinUserIds = new Set(twins.map((t) => t.user_id));

  // ── ٣ · حسابٌ بلا سجل · سجلٌّ بلا حساب (المشروع مفصولٌ عن العطل) ────────────
  const accountsNoEmployee = { gaps: [], legit: [] };
  for (const u of freeUsers) {
    if (twinUserIds.has(u.id)) continue; // مذكور في «توأم غير مرتبط» — لا يُعدّ مرتين
    const legit = userNoEmployeeVerdict(u);
    const row = { ...person(u, null), verdict: legit };
    (legit ? accountsNoEmployee.legit : accountsNoEmployee.gaps).push(row);
  }
  const employeesNoAccount = { gaps: [], legit: [] };
  for (const e of freeEmps) {
    if (twinEmpIds.has(e.id)) continue;
    const legit = employeeNoAccountVerdict(e, today);
    (legit ? employeesNoAccount.legit : employeesNoAccount.gaps)
      .push({ ...person(null, e), verdict: legit, job_title: e.job_title || null });
  }

  // ── ٤ · موظف بلا قطاع أو بلا إدارة — وأثرُ ذلك بلغة الإنسان ─────────────────
  const noSector = [], noDepartment = [];
  for (const e of emps) {
    if (Number(e.active) === 0) continue;
    const allocN = (await get(
      'SELECT COUNT(*) AS n FROM allocation WHERE employee_id = ? AND deleted_at IS NULL AND year >= ?', [e.id, year])).n;
    if (!e.sector_id) {
      noSector.push({ ...person(null, e), allocations: allocN,
        impact: `لا يظهر في كشف فريق أي قطاع ولا في مقارنة القطاعات، ولا يُحسب ضمن طاقة أحد`
          + (allocN ? ` — وله ${countPhrase(allocN, 'allocation')} لا يدخل في أرقام أي قطاع` : '') });
      continue;
    }
    if (!e.department_id) {
      const sec = secById.get(e.sector_id);
      // الوحدة المساندة شكلها الصحيح **مسطّح**: أشخاص يتبعونها مباشرة بلا إدارات. عدّ ذلك عطلاً
      // يُنتج ملاحظةً لا سبيل إلى إغلاقها أبداً (نفس الاستثناء المقرَّر في org-quality.js).
      if (sec && !isDelivery(sec)) continue;
      noDepartment.push({ ...person(null, e), allocations: allocN,
        impact: `داخل «${sec ? sec.name_ar : e.sector_id}» لكنه خارج كل إدارة: لا يراه أي مدير إدارة في شاشة فريقه`
          + `، ولا يدخل في تجميع أي إدارة`
          + (allocN ? ` — وله ${countPhrase(allocN, 'allocation')} لا يصل إلى إدارة` : '') });
    }
  }

  // ── ٥ · إدارةٌ بلا مدير · ومديرٌ يقود إدارةً لا ينتمي إليها ────────────────
  const depsNoManager = [];
  const managersOutside = [];
  for (const d of deps) {
    const sec = secById.get(d.sector_id);
    if (!d.manager_user_id) {
      depsNoManager.push({ department_id: d.id, department_name_ar: d.name_ar,
        sector_id: d.sector_id, sector_name_ar: sec ? sec.name_ar : d.sector_id,
        impact: 'لا أحد يستلم ما يخص هذه الإدارة — طلباتها وتقاريرها بلا مرسَل إليه' });
      continue;
    }
    const mu = userById.get(d.manager_user_id);
    if (!mu) {
      depsNoManager.push({ department_id: d.id, department_name_ar: d.name_ar,
        sector_id: d.sector_id, sector_name_ar: sec ? sec.name_ar : d.sector_id,
        impact: 'المسؤول المسجَّل حسابٌ غير موجود أو محذوف — الإدارة عملياً بلا مسؤول' });
      continue;
    }
    // إدارة المدير نفسه تُقرأ من سجل موظفه (من أيّ طرفٍ كان الرابط قائماً).
    const me = (mu.employee_id && empById.get(mu.employee_id))
      || (claimedByEmp.get(mu.id) || [])[0] || null;
    if (!me || !me.department_id || me.department_id === d.id) continue;
    const own = depById.get(me.department_id);
    managersOutside.push({ department_id: d.id, department_name_ar: d.name_ar,
      sector_name_ar: sec ? sec.name_ar : d.sector_id,
      manager_username: mu.username, manager_name_ar: mu.name_ar || null,
      own_department_ar: own ? own.name_ar : me.department_id,
      note: `خبرٌ لا عطل: يقود «${d.name_ar}» وهو نفسه مسكَّن في «${own ? own.name_ar : me.department_id}» — قيادةٌ من خارج الإدارة قرارٌ وارد` });
  }

  // ── ٦ · حسابات معطَّلة لأشخاصٍ لهم عملٌ نشط ────────────────────────────────
  const dormantWithWork = [];
  for (const u of users) {
    if (Number(u.active) !== 0) continue;
    const e = (u.employee_id && empById.get(u.employee_id)) || (claimedByEmp.get(u.id) || [])[0] || null;
    const w = await activeWorkOf({ userId: u.id, employeeId: e ? e.id : null, year });
    if (!w.total) continue;
    dormantWithWork.push({ ...person(u, e), work: w, work_phrase: workPhrase(w),
      closed_at: u.deactivated_at || null,
      why: u.deactivated_at
        ? 'مغلق بقرارٍ مختوم، وعليه عملٌ قائم — العمل يحتاج مالكاً آخر، لا الحسابَ يُعاد فتحه تلقائياً'
        : 'غير نشط بلا ختم إغلاق (قد يكون دعوةً معلّقة لم تُستكمل)، وعليه عملٌ قائم' });
  }

  // ── ٧ · قطاع الحلول، شخصاً شخصاً — قبل أن يُرسَل بريدٌ إلى إنسان ────────────
  const solSector = secById.get(solutionsKey)
    || sectors.find((s) => normName(s.name_ar) === normName(solutionsKey))
    || sectors.find((s) => normName(s.name_ar).includes('الحلول')) || null;
  const solutions = { sector_id: solSector ? solSector.id : solutionsKey,
    sector_name_ar: solSector ? solSector.name_ar : null, people: [] };
  if (solSector) {
    const seen = new Set();
    const addPerson = (u, e) => {
      const key = (e ? 'e:' + e.id : '') + '|' + (u ? 'u:' + u.id : '');
      if (seen.has(key)) return;
      seen.add(key);
      const linked = !!(u && e && u.employee_id === e.id && e.user_id === u.id);
      const half = !!(u && e && !linked);
      solutions.people.push({
        name_ar: (e && e.name_ar) || (u && u.name_ar) || (u && u.username) || '—',
        employee_id: e ? e.id : null, user_id: u ? u.id : null, username: u ? u.username : null,
        job_title: e ? (e.job_title || null) : null,
        department_name_ar: e && e.department_id && depById.has(e.department_id) ? depById.get(e.department_id).name_ar : null,
        has_account: !!u,
        link_state: !u ? 'بلا حساب' : (!e ? 'حساب بلا سجل موظف' : (linked ? 'مربوط' : 'نصف ربط')),
        half_link: half,
        activated: u ? Number(u.active) === 1 : false,
        closed_at: u ? (u.deactivated_at || null) : null,
        email: u ? (u.email || null) : null,
        email_ok: u ? isValidEmail(u.email) : false,
        employee_active: e ? Number(e.active) === 1 : null,
        // التوأم المرشَّح يظهر سطرين (سجلٌّ بلا حساب + حسابٌ بلا سجل) لأنه **قد** يكون شخصين.
        // بلا هذه الإشارة يُقرأ الجدول كأن في القطاع شخصين باسم واحد.
        twin_candidate: (e && twinEmpIds.has(e.id)) || (u && twinUserIds.has(u.id)) || false,
      });
    };
    // الحساب المقابل يُلتمس من **الطرفين معاً**: من `employee.user_id` ومن أي حساب يدّعي هذا
    // السجل. لو قرأنا عموداً واحداً لظهر صاحبُ نصف الربط في هذا الجدول «بلا حساب» — أي أن الكشف
    // يُعيد إنتاج الكذبة نفسها التي جاء ليفضحها، وعلى الصفحة التي يُبنى عليها قرار الدعوة.
    const accountOf = (e) => (e.user_id && userById.get(e.user_id)) || (claimedByUser.get(e.id) || [])[0] || null;
    const employeeOf = (u) => (u.employee_id && empById.get(u.employee_id)) || (claimedByEmp.get(u.id) || [])[0] || null;
    for (const e of emps) if (e.sector_id === solSector.id) addPerson(accountOf(e), e);
    for (const u of users) {
      if (u.sector_id !== solSector.id) continue;
      const e = employeeOf(u);
      if (e && e.sector_id === solSector.id) continue; // أُضيف أعلاه ضمن سجلات القطاع — لا يُكرَّر
      addPerson(u, e);
    }
    solutions.people.sort((a, b) => String(a.name_ar).localeCompare(String(b.name_ar), 'ar'));
    solutions.summary = {
      people: solutions.people.length,
      withAccount: solutions.people.filter((p) => p.has_account).length,
      linked: solutions.people.filter((p) => p.link_state === 'مربوط').length,
      halfLinked: solutions.people.filter((p) => p.half_link).length,
      activated: solutions.people.filter((p) => p.activated).length,
      emailOk: solutions.people.filter((p) => p.email_ok).length,
      // من يصلح لدعوةٍ اليوم: له حساب، وبريده صالح، ولم يُفعَّل بعدُ، ولا ختمَ إغلاقٍ عليه.
      invitable: solutions.people.filter((p) => p.has_account && p.email_ok && !p.activated && !p.closed_at).length,
    };
  }

  const totals = {
    users: users.length, employees: emps.length, sectors: sectors.length, departments: deps.length,
    halfFromUser: halfFromUser.length, halfFromEmployee: halfFromEmployee.length,
    brokenPointers: brokenPointers.length, conflicts: conflicts.length,
    twins: twins.length, twinsHigh: twins.filter((t) => t.confidence === 'عالية').length,
    accountsNoEmployeeGaps: accountsNoEmployee.gaps.length, accountsNoEmployeeLegit: accountsNoEmployee.legit.length,
    employeesNoAccountGaps: employeesNoAccount.gaps.length, employeesNoAccountLegit: employeesNoAccount.legit.length,
    noSector: noSector.length, noDepartment: noDepartment.length,
    depsNoManager: depsNoManager.length, managersOutside: managersOutside.length,
    dormantWithWork: dormantWithWork.length,
  };

  return { today, year, totals,
    halfLinks: { fromUser: halfFromUser, fromEmployee: halfFromEmployee, broken: brokenPointers, conflicts },
    twins, accountsNoEmployee, employeesNoAccount,
    placement: { noSector, noDepartment },
    departments: { noManager: depsNoManager, managerOutside: managersOutside },
    dormantWithWork, solutions };
}

// ─────────────────────────────────────────────────────────────────────────────
// العرض — يُقرأ بعينٍ بشرية، لا جدول أرقام
// ─────────────────────────────────────────────────────────────────────────────
const H = (t) => `\n${'─'.repeat(4)} ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`;
const who = (r) => `${r.employee_name_ar || r.user_name_ar || r.username || '—'}`;
const acct = (r) => (r.username ? `الحساب ${r.username}` : 'بلا حساب');

export function renderReport(rep) {
  const L = [];
  const t = rep.totals;
  L.push(`كشف صحّة الهيكلة وربط الحسابات — بتاريخ ${rep.today}`);
  L.push(`${t.users} حساب دخول · ${t.employees} سجل موظف · ${t.sectors} وحدة تنظيمية · ${t.departments} إدارة`);

  L.push(H('١ · ربطٌ نصفُه ناقص'));
  if (!rep.halfLinks.fromUser.length && !rep.halfLinks.fromEmployee.length) L.push('  لا شيء — العمودان متطابقان في كل صف.');
  for (const r of rep.halfLinks.fromEmployee) {
    L.push(`  ✗ ${who(r)} — ${acct(r)}`);
    L.push(`      ${r.why}`);
    L.push('      يُصلَح آلياً: نعم (العلاقة مثبتة في الطرف الآخر، ولا منازع)');
  }
  for (const r of rep.halfLinks.fromUser) {
    L.push(`  ✗ ${who(r)} — ${acct(r)}`);
    L.push(`      ${r.why}`);
    L.push('      يُصلَح آلياً: نعم (العلاقة مثبتة في الطرف الآخر، ولا منازع)');
  }
  for (const r of rep.halfLinks.broken) L.push(`  ⚠ ${who(r)} — ${r.why} (يشير إلى ${r.points_to}) — قرار إنسان`);
  for (const r of rep.halfLinks.conflicts) L.push(`  ⚠ ${r.kind}: ${r.why} — قرار إنسان`);

  L.push(H('٢ · توأمٌ غير مرتبط (حسابٌ وسجلٌّ قد يكونان شخصاً واحداً)'));
  if (!rep.twins.length) L.push('  لا شيء.');
  for (const r of rep.twins) {
    L.push(`  • سجل «${r.employee_name_ar}» ⟷ حساب ${r.username || r.user_id} — ثقة ${r.confidence}`);
    L.push(`      ${r.basis}${r.same_sector ? ' · وكلاهما في القطاع نفسه' : ''}`);
    L.push('      يُصلَح آلياً: لا — التطابق الاسمي دليلٌ لا إثبات. الربط بيد إنسان.');
  }

  L.push(H('٣ · حسابٌ بلا سجل موظف'));
  if (!rep.accountsNoEmployee.gaps.length) L.push('  لا فجوة.');
  for (const r of rep.accountsNoEmployee.gaps)
    L.push(`  ✗ ${r.username}${r.user_name_ar ? ` (${r.user_name_ar})` : ''} — يدخل المنصة ولا سجل موظف له: لا إدارة له ولا تسكين ولا يظهر في أي كشف فريق`);
  if (rep.accountsNoEmployee.legit.length) {
    L.push(`  — مشروع (${rep.accountsNoEmployee.legit.length}) لا يُعدّ عطلاً:`);
    for (const r of rep.accountsNoEmployee.legit) L.push(`      · ${r.username} — ${r.verdict}`);
  }

  L.push(H('٤ · سجلُّ موظفٍ بلا حساب دخول'));
  if (!rep.employeesNoAccount.gaps.length) L.push('  لا فجوة.');
  for (const r of rep.employeesNoAccount.gaps)
    L.push(`  ✗ ${r.employee_name_ar}${r.job_title ? ` — ${r.job_title}` : ''}${r.sector_name_ar ? ` · ${r.sector_name_ar}` : ''} — على رأس العمل ولا باب يدخل منه`);
  if (rep.employeesNoAccount.legit.length) {
    L.push(`  — مشروع (${rep.employeesNoAccount.legit.length}) لا يُعدّ عطلاً:`);
    for (const r of rep.employeesNoAccount.legit) L.push(`      · ${r.employee_name_ar} — ${r.verdict}`);
  }

  L.push(H('٥ · موظف بلا قطاع أو بلا إدارة'));
  if (!rep.placement.noSector.length && !rep.placement.noDepartment.length) L.push('  لا شيء.');
  for (const r of rep.placement.noSector) L.push(`  ✗ ${r.employee_name_ar} — بلا قطاع: ${r.impact}`);
  for (const r of rep.placement.noDepartment) L.push(`  ✗ ${r.employee_name_ar} — بلا إدارة: ${r.impact}`);

  L.push(H('٦ · الإدارات ومسؤولوها'));
  if (!rep.departments.noManager.length && !rep.departments.managerOutside.length) L.push('  لا شيء.');
  for (const r of rep.departments.noManager) L.push(`  ✗ «${r.department_name_ar}» (${r.sector_name_ar}) بلا مسؤول — ${r.impact}`);
  for (const r of rep.departments.managerOutside)
    L.push(`  ℹ ${r.manager_name_ar || r.manager_username} — ${r.note}`);

  L.push(H('٧ · حسابات مغلقة وعليها عملٌ قائم'));
  if (!rep.dormantWithWork.length) L.push('  لا شيء.');
  for (const r of rep.dormantWithWork) {
    L.push(`  ✗ ${who(r)} (${r.username}) — ${r.work_phrase}`);
    L.push(`      ${r.why}`);
    L.push('      يُصلَح آلياً: لا — التفعيل والدعوة قرارُ المالك وحده.');
  }

  L.push(H(`٨ · قطاع الحلول — قبل إرسال أي دعوة`));
  if (!rep.solutions.sector_name_ar) L.push('  القطاع غير موجود في هذه القاعدة.');
  else {
    const s = rep.solutions.summary;
    L.push(`  «${rep.solutions.sector_name_ar}» — في الكشف: ${s.people} · لهم حساب: ${s.withAccount} · مربوط تماماً: ${s.linked}`
      + ` · نصف ربط: ${s.halfLinked} · مفعَّل: ${s.activated} · ببريد صالح: ${s.emailOk} · يصلح لدعوةٍ اليوم: ${s.invitable}`);
    L.push('');
    L.push('  الاسم                     | حساب | الربط                          | مفعَّل | البريد');
    L.push('  ' + '-'.repeat(92));
    for (const p of rep.solutions.people) {
      const pad = (v, n) => String(v).padEnd(n, ' ');
      const state = p.link_state + (p.twin_candidate ? ' (توأم مرشَّح)' : '');
      L.push(`  ${pad(p.name_ar, 24)} | ${pad(p.has_account ? 'نعم' : 'لا', 4)} | ${pad(state, 30)}`
        + ` | ${pad(p.activated ? 'نعم' : (p.closed_at ? 'مغلق' : 'لا'), 5)} | ${p.email_ok ? p.email : (p.email ? `${p.email} (غير صالح)` : 'بلا بريد')}`);
    }
    L.push('');
    L.push('  ملاحظة: هذا كشفٌ فقط. لم يُفعَّل حساب ولم يُرسَل بريد — التفعيل والدعوة قرارك.');
  }

  L.push(H('الخلاصة'));
  L.push(`  يُصلَح آلياً بلا شك — ربطٌ نصفُه ناقص: ${t.halfFromUser + t.halfFromEmployee}`);
  L.push('  يحتاج قرار إنسان — '
    + [`توأم مرشَّح: ${t.twins}`, `تعارض: ${t.conflicts}`, `إشارة مكسورة: ${t.brokenPointers}`,
       `حساب بلا سجل: ${t.accountsNoEmployeeGaps}`, `سجل بلا حساب: ${t.employeesNoAccountGaps}`,
       `بلا قطاع: ${t.noSector}`, `بلا إدارة: ${t.noDepartment}`,
       `إدارة بلا مسؤول: ${t.depsNoManager}`, `حساب مغلق عليه عمل: ${t.dormantWithWork}`].join(' · '));
  L.push('  للإصلاح القاطع وحده: node --experimental-sqlite scripts/fix-org-links.mjs   (معاينة، ثم --apply)');
  return L.join('\n');
}

// ── التشغيل المباشر ─────────────────────────────────────────────────────────
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('audit-org-links.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const rep = await auditOrgLinks({ sector: flag('--sector'), today: flag('--today'), year: flag('--year') });
  console.log(argv.includes('--json') ? JSON.stringify(rep, null, 2) : renderReport(rep));
  await close();
}
