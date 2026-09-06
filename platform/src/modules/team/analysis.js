// ── تحليل الاستخدام وفحص الحالة والمتابعة — S17/S18 (وحدة الفريق والموارد) ────────────────
//
// «الإشارة ليست حكماً بل سؤالاً يُطرح على المدير مع أدلته» — الموجّه §7.2. الجدول يقرأ لكل
// مورد ثلاثة أرقام لا تُخلط: التسكين المؤكد (من capacity-model عبر capacity-read)، وحِمل المهام
// (pmo/task-load.js — المقياس D21 المستقل)، والتغطية المالية للفرد — وهي **غير متاحة** في هذه
// النسخة (C8 في EXECUTION-LOG: لا منهج معتمداً من المالية) فتُقال كذلك ولا تُخترع لها بيانات.
//
// ثم تُشتقّ إشارةٌ واحدة بقواعد §7.2 المكتوبة هنا حرفاً، وتُقال قاعدتها في `basis_ar` مع كل صف.
// والمتابعة مهمةٌ حقيقية في نظام المهام القائم (tasks.quickAddTask) مربوطةٌ بحالة `analysis_case`
// فريدةٍ بمفتاح (المورد، السنة، الشهر، الإشارة) — «امنع تكاثر التنبيه نفسه عند كل تحديث».
import { all, get, insert, update, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { badRequest, forbidden, notFound } from '../../core/http/errors.js';
import { MONTHS_AR } from '../../core/i18n/time.js';
import { taskStatusLabel } from '../../core/i18n/task-vocab.js';
import { taskLoadFor, TASK_LOAD_BASIS_AR } from '../pmo/task-load.js';
import { quickAddTask } from '../pmo/tasks.js';
import { namesByIds } from '../org/people.js';
import { canReadResources, resourceScopeSql, loadReadableResource, RESOURCE_TYPE_AR, resourceTypeOf, leadsResource } from './access.js';
import { figuresFor } from './capacity-read.js';
import { monthKey } from './capacity-model.js';

const N = (v) => Number(v) || 0;
const ph = (arr) => arr.map(() => '?').join(',');

export const SIGNALS = Object.freeze({
  high_alloc_low_load: 'تسكين يحتاج مراجعة',
  low_alloc_high_load: 'التزامات لا تعكسها الخطة',
  internal_high: 'مراجعة الأولويات والميزانية',
  high_load_pressure: 'راجع توازن الالتزامات',
  data_missing: 'بيانات غير مكتملة',
  capacity_freeing: 'فرصة تخطيط',
  check_upcoming: 'تحقق من الطلب القادم',
  none: 'لا يوجد تعارض ظاهر',
});
export const SIGNAL_KEYS = Object.keys(SIGNALS);

// قواعد الإشارات كما تُقال للقارئ — نصٌّ واحد يُعرض في التعريفات ويُكتب على كل صف.
export const SIGNAL_RULE_AR = Object.freeze({
  high_alloc_low_load: 'تسكين مؤكد 90% فأكثر مع حِمل مهام منخفض',
  low_alloc_high_load: 'تسكين مؤكد 40% فأقل مع حِمل مهام مرتفع',
  internal_high: 'العمل الداخلي 60% فأكثر من التسكين المؤكد',
  high_load_pressure: 'حِمل مهام مرتفع مع تسكين مؤكد 70% فأكثر',
  data_missing: 'الشهر خارج فترة الارتباط أو بلا طاقة مسجلة',
  capacity_freeing: 'التسكين ينتهي خلال 60 يوماً ولا تسكين بعده',
  check_upcoming: 'طلب تسكين معلَّق في الشهر القادم',
  none: 'لا تنطبق قاعدة من القواعد أعلاه',
});

export const TASK_LOAD_LEVEL_AR = Object.freeze({ low: 'منخفض', medium: 'متوسط', high: 'مرتفع', unmeasured: 'غير مقاس' });
export const LOAD_LEVEL_RULE_AR = 'مستويات حِمل المهام: أقل من 40 منخفض، حتى 100 متوسط، فوق 100 مرتفع؛ وما بلا أي نسبة مقدَّرة = غير مقاس.';
export const COVERAGE_UNAVAILABLE = Object.freeze({
  state: 'unavailable', state_ar: 'غير متاحة',
  note_ar: 'لا يوجد منهج معتمد من المالية لتغطية الفرد في هذه النسخة — تُقرأ تغطية المشروع والقطاع من الإيراد المحقق لمن يقرأ المال',
});

// أسئلة فحص الحالة (S18) — لكل إشارة أسئلتها، ولا حكمَ آلي.
const QUESTIONS_AR = Object.freeze({
  high_alloc_low_load: ['هل المهام مسجَّلة على المنصة بنسبها المقدَّرة؟', 'هل التسكين ما زال يعكس العمل الفعلي هذا الشهر؟', 'هل يمكن تحرير جزء من الطاقة لاحتياجٍ قادم؟'],
  low_alloc_high_load: ['ما العمل الذي تأتي منه هذه المهام ولم يُسكَّن عليه؟', 'هل يلزم طلب تسكين يعكس الالتزام الفعلي؟', 'هل بعض المهام يمكن إعادة إسنادها؟'],
  internal_high: ['ما البند الداخلي الذي يستهلك أكثر الطاقة، وهل له ميزانية؟', 'هل يمكن تحويل جزء منه إلى عملٍ لعميل؟', 'هل الأولويات الداخلية ما زالت قائمة؟'],
  high_load_pressure: ['أي المهام يمكن تأجيلها أو إعادة إسنادها؟', 'هل يوجد عائق يرفع الحِمل بلا إنجاز؟', 'هل يلزم مورد مساند لهذا الشهر؟'],
  data_missing: ['هل تاريخ التعيين أو المغادرة مسجَّل صحيحاً؟', 'هل الطاقة التعاقدية مسجلة؟', 'هل السجل مؤرشف بلا تاريخ مغادرة؟'],
  capacity_freeing: ['أي احتياجٍ قادم يمكن أن يغطّيه هذا المورد؟', 'هل يمتد العمل الحالي فعلاً أم ينتهي في موعده؟', 'هل يلزم تسكين مبدئي على فرصةٍ قادمة؟'],
  check_upcoming: ['هل الطلب المعلَّق ما زال مطلوباً؟', 'هل يتعارض مع تسكينٍ مؤكد في الشهر نفسه؟', 'من يبتّ فيه ومتى؟'],
  none: ['هل ثمة التزام غير مسجَّل على المنصة؟', 'هل الخطة تعكس ما يُنجَز فعلاً؟'],
});

// ── حِمل المهام بمستوياته — القاعدة تُقال في basis_ar ─────────────────────────────────────
export function taskLoadLevel(load, { hasAccount = true } = {}) {
  if (!hasAccount) {
    return { level: 'unmeasured', level_ar: TASK_LOAD_LEVEL_AR.unmeasured, pct: 0, unsized: 0, open: 0,
      basis_ar: 'لا حساب دخول مرتبط بهذا المورد — المهام تُسنَد إلى الحسابات، فحِمله غير مقاس. ' + LOAD_LEVEL_RULE_AR };
  }
  const pct = N(load?.pct); const unsized = N(load?.unsized); const open = N(load?.open);
  let level;
  if (open > 0 && pct === 0 && unsized > 0) level = 'unmeasured';
  else if (pct < 40) level = 'low';
  else if (pct <= 100) level = 'medium';
  else level = 'high';
  const detail = open === 0 ? 'لا مهام مفتوحة مسنَدة إليه.'
    : `${pct}% من ${open} ${open === 1 ? 'مهمة مفتوحة' : 'مهام مفتوحة'}${unsized ? `، منها ${unsized} بلا نسبة مقدَّرة` : ''}.`;
  return { level, level_ar: TASK_LOAD_LEVEL_AR[level], pct, unsized, open,
    basis_ar: `${TASK_LOAD_BASIS_AR} ${detail} ${LOAD_LEVEL_RULE_AR}` };
}

// ── الجسر بين الموظف وحسابه — من الجهتين لأن المنتج يكتب الاثنين ─────────────────────────
export async function userIdsForEmployees(employeeIds) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await all(`SELECT e.id employee_id, e.user_id emp_user, u.id acc_user, COALESCE(u.name_ar, u.username) acc_name
       FROM employee e LEFT JOIN app_user u ON u.employee_id = e.id AND u.deleted_at IS NULL
      WHERE e.id IN (${ph(ids)})`, ids);
  for (const r of rows) {
    if (map.has(r.employee_id)) continue;
    const uid = r.acc_user || r.emp_user || null;
    if (uid) map.set(r.employee_id, uid);
  }
  return map;
}

const monthLabelAr = (y, m) => `${MONTHS_AR[m - 1]} ${y}`;
const addMonths = (y, m, k) => { let yy = y; let mm = m + k; while (mm > 12) { mm -= 12; yy += 1; } while (mm < 1) { mm += 12; yy -= 1; } return { year: yy, month: mm }; };
const HORIZON = 3;          // الأشهر القادمة التي تُقرأ مع شهر التحليل (60 يوماً + شهر تحقق)
const FREEING_WITHIN = 1;   // آخر شهرٍ مسكَّن هو الشهر نفسه أو الذي يليه ⇒ ينتهي خلال 60 يوماً

function parsePeriod({ year, month } = {}) {
  const now = new Date();
  const y = Number(year) || now.getUTCFullYear();
  const m = Number(month) || now.getUTCMonth() + 1;
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('السنة غير صحيحة — أدخلها بأربعة أرقام مثل 2026');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر رقم من 1 إلى 12');
  return { year: y, month: m, key: monthKey(y, m), label_ar: monthLabelAr(y, m) };
}

// ── قاعدة الإشارة — الترتيب هو ترتيب §7.2؛ الأولى المنطبقة تُعلَن وتُقال قاعدتها ─────────
export function signalFor({ f0, next = [], load, emp }) {
  const say = (key, why) => ({ key, label_ar: SIGNALS[key], rule_ar: SIGNAL_RULE_AR[key], why_ar: why });
  if (!f0 || f0.state === 'out') {
    // سبب الغياب يُقال باسمه: أرشفةٌ بلا تاريخ مغادرة، أو مغادرةٌ قبل الشهر، أو تعيينٌ بعده.
    const end = String(emp?.end_date || '').slice(0, 10); const hire = String(emp?.hire_date || '').slice(0, 10);
    const start = f0 ? `${f0.key}-01` : null;
    let reason = 'الشهر خارج فترة الارتباط';
    if (!emp) reason = 'لا سجل مورد';
    else if (Number(emp.active) === 0 && !end) reason = 'السجل مؤرشف بلا تاريخ مغادرة';
    else if (end && start && end < start) reason = `انتهى الارتباط في ${end}`;
    else if (hire && start && hire > start) reason = `الارتباط يبدأ ${hire}`;
    return say('data_missing', reason);
  }
  const c = N(f0.confirmedPct);
  const lvl = load?.level || 'unmeasured';
  const internalPct = f0.items.filter((it) => it.kind === 'bucket' && it.status === 'confirmed').reduce((a, it) => a + N(it.pct), 0);
  const internalShare = c > 0 ? Math.round((internalPct / c) * 100) : 0;
  if (c >= 90 && lvl === 'low') return say('high_alloc_low_load', `مؤكد ${c}% وحِمل المهام ${N(load?.pct)}%`);
  if (c <= 40 && lvl === 'high') return say('low_alloc_high_load', `مؤكد ${c}% وحِمل المهام ${N(load?.pct)}%`);
  if (c > 0 && internalShare >= 60) return say('internal_high', `العمل الداخلي ${internalPct}% من ${c}% (${internalShare}%)`);
  if (lvl === 'high' && c >= 70) return say('high_load_pressure', `حِمل المهام ${N(load?.pct)}% مع تسكين ${c}%`);
  // نهاية التسكين: آخر شهرٍ فيه مؤكدٌ داخل الأفق، وما بعده صفرٌ حتى آخر الأفق.
  const series = [f0, ...next];
  let last = -1;
  for (let i = 0; i < series.length; i++) if (series[i] && series[i].state !== 'out' && N(series[i].confirmedPct) > 0) last = i;
  if (c > 0 && last >= 0 && last <= FREEING_WITHIN && series.length > FREEING_WITHIN + 1) {
    const after = series.slice(last + 1);
    if (after.length && after.every((f) => !f || f.state === 'out' || N(f.confirmedPct) === 0))
      return say('capacity_freeing', `آخر تسكين مؤكد في ${monthLabelAr(series[last].year, series[last].month)} ولا تسكين بعده`);
  }
  if (next[0] && N(next[0].pendingPct) > 0) return say('check_upcoming', `طلب معلَّق ${N(next[0].pendingPct)}% في ${monthLabelAr(next[0].year, next[0].month)}`);
  return say('none', c > 0 ? `مؤكد ${c}% وحِمل ${TASK_LOAD_LEVEL_AR[lvl]}` : 'بلا تسكين مؤكد هذا الشهر');
}

// ── تحليل مجموعة موارد على شهرٍ — القلب المشترك للجدول وفحص الحالة ───────────────────────
async function analyze(emps, period) {
  const ids = emps.map((e) => e.id);
  const to = addMonths(period.year, period.month, HORIZON);
  const [{ figures }, uids] = await Promise.all([
    figuresFor(ids, period.key, monthKey(to.year, to.month), { includePending: true }),
    userIdsForEmployees(ids),
  ]);
  const loads = await taskLoadFor([...uids.values()]);
  const cases = ids.length ? await all(`SELECT id, employee_id, signal, status, task_id, owner_user_id, due_date
      FROM analysis_case WHERE year = ? AND month = ? AND employee_id IN (${ph(ids)})`, [period.year, period.month, ...ids]) : [];
  const caseMap = new Map(cases.map((c) => [`${c.employee_id}:${c.signal}`, c]));
  const rows = [];
  for (const e of emps) {
    const fg = figures.get(e.id);
    if (!fg) continue;
    const f0 = fg.months[0]; const next = fg.months.slice(1);
    const uid = uids.get(e.id) || null;
    const load = taskLoadLevel(uid ? (loads.get(uid) || { pct: 0, unsized: 0, open: 0 }) : null, { hasAccount: !!uid });
    const signal = signalFor({ f0, next, load, emp: e });
    const internalPct = f0.state === 'out' ? null : f0.items.filter((it) => it.kind === 'bucket' && it.status === 'confirmed').reduce((a, it) => a + N(it.pct), 0);
    const c = caseMap.get(`${e.id}:${signal.key}`) || null;
    rows.push({
      employeeId: e.id, name: e.name_ar, job_title: e.job_title || '', userId: uid,
      department_id: e.department_id || null, department_name: e.department_name || null,
      sector_id: e.sector_id || null, sector_name: e.sector_name || null,
      resourceType: resourceTypeOf(e), resourceType_ar: RESOURCE_TYPE_AR[resourceTypeOf(e)],
      engagement: f0.state,
      confirmedPct: f0.confirmedPct, billablePct: f0.billablePct, tentativePct: f0.tentativePct, pendingPct: f0.pendingPct,
      internalPct, availablePct: f0.availablePct, overPct: f0.overPct,
      capacityPct: f0.capacity.nominalPct || null,
      items: f0.items.map((it) => ({ kind: it.kind, id: it.targetId, label: it.label, pct: it.pct, status: it.status, billable: it.billable })),
      upcoming: next.map((f) => ({ key: f.key, confirmedPct: f.confirmedPct, pendingPct: f.pendingPct, tentativePct: f.tentativePct, state: f.state })),
      taskLoad: load,
      coverage: { ...COVERAGE_UNAVAILABLE },
      signal,
      hasCase: !!c, caseId: c?.id || null, caseStatus: c?.status || null,
      _emp: e, _f0: f0,
    });
  }
  return rows;
}

const strip = (r) => { const { _emp, _f0, ...rest } = r; return rest; };

async function scopedEmployees(user, period, { department, sector } = {}) {
  const sc = resourceScopeSql(user, 'e', sector);
  const where = [sc.clause];
  const params = [...sc.params];
  // الموردون الحاضرون في الشهر: النشط، ومن غادر بتاريخٍ لا يسبق بداية الشهر (فتظهر مغادرته لا تختفي).
  where.push('(e.active = 1 OR (e.end_date IS NOT NULL AND substr(e.end_date,1,10) >= ?))');
  params.push(`${period.key}-01`);
  const wantDept = String(department || '').trim();
  if (wantDept && !sc.blind) {
    let ok = false;
    if (sc.departments?.length) ok = sc.departments.includes(wantDept);
    else {
      const d = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [wantDept]);
      ok = !!d && (!sc.sector || d.sector_id === sc.sector);
    }
    if (!ok) throw forbidden('هذه الإدارة خارج نطاقك — اختر إدارةً من قطاعك أو إداراتك');
    where.push('e.department_id = ?'); params.push(wantDept);
  }
  if (sc.clause === '1=0') return [];
  return await all(`SELECT e.*, d.name_ar department_name, s.name_ar sector_name
       FROM employee e
       LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
       LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL
      WHERE ${where.join(' AND ')} ORDER BY e.name_ar`, params);
}

/** S17 — جدول الاستخدام لشهرٍ: التسكين المؤكد، القابل للفوترة، حِمل المهام، التغطية (غير متاحة)، الإشارة. */
export async function utilizationTable(user, { year, month, department, signal, sector } = {}) {
  if (!canReadResources(user)) throw forbidden('تحليل الاستخدام يتطلب صلاحية عرض الفريق — اطلبها من مدير النظام');
  const period = parsePeriod({ year, month });
  const want = String(signal || '').trim();
  if (want && !SIGNALS[want]) throw badRequest('الإشارة المطلوبة غير معروفة — اختر من قائمة الإشارات');
  const emps = await scopedEmployees(user, period, { department, sector });
  let rows = (await analyze(emps, period)).map(strip);
  const bySignal = {};
  for (const k of SIGNAL_KEYS) bySignal[k] = 0;
  for (const r of rows) bySignal[r.signal.key] += 1;
  if (want) rows = rows.filter((r) => r.signal.key === want);
  return {
    period, rows, total: rows.length,
    counts: { resources: emps.length, bySignal },
    signals: SIGNAL_KEYS.map((k) => ({ key: k, label_ar: SIGNALS[k], rule_ar: SIGNAL_RULE_AR[k], count: bySignal[k] })),
    definitions_ar: [
      'التسكين المؤكد: نسبة من طاقة المورد في الشهر من مصفوفة التسكين (المبدئي والمعلَّق لا يُخصمان).',
      'القابل للفوترة: التسكين المؤكد على مشاريع العملاء.',
      TASK_LOAD_BASIS_AR + ' ' + LOAD_LEVEL_RULE_AR,
      `التغطية المالية للفرد: ${COVERAGE_UNAVAILABLE.state_ar} — ${COVERAGE_UNAVAILABLE.note_ar}.`,
      ...SIGNAL_KEYS.map((k) => `${SIGNALS[k]}: ${SIGNAL_RULE_AR[k]}.`),
      'الإشارة سؤال يُفحص مع أدلته، لا حكم.',
    ],
    basis_ar: 'الأرقام من الطاقة التعاقدية المسجلة والتسكين المؤكد للشهر، وحِمل المهام من النسب المقدَّرة على المهام المفتوحة. الإشارة الأولى المنطبقة بترتيب القواعد.',
    asOf: nowIso(),
  };
}

function shapeCase(c, task = null, closedBy = null) {
  if (!c) return null;
  let evidence = null; try { evidence = JSON.parse(c.evidence_json || 'null'); } catch { evidence = null; }
  return {
    id: c.id, employeeId: c.employee_id, year: c.year, month: c.month, key: monthKey(c.year, c.month),
    signal: { key: c.signal, label_ar: SIGNALS[c.signal] || c.signal },
    status: c.status, status_ar: c.status === 'closed' ? 'مغلقة' : c.status === 'explained' ? 'مفسَّرة' : 'مفتوحة',
    ownerUserId: c.owner_user_id || null, due_date: c.due_date || null, note: c.note || null,
    evidence, task_id: c.task_id || null,
    task: task ? { id: task.id, title: task.title, status: task.status, status_ar: taskStatusLabel(task.status), due_date: task.due_date || null,
      assignee_user_id: task.assignee_user_id, deleted: !!task.deleted_at } : null,
    created_by: c.created_by || null, created_at: c.created_at, updated_at: c.updated_at || null,
    closedBy: closedBy?.user_id || null, closedByName: closedBy?.name || null, closedAt: closedBy?.at || null,
  };
}
async function closureOf(caseId) {
  const a = await get(`SELECT user_id, username, at FROM audit_log WHERE resource = 'analysis_case' AND resource_id = ? AND action = 'close'
      ORDER BY at DESC LIMIT 1`, [caseId]);
  if (!a) return null;
  const names = await namesByIds([a.user_id]);
  return { user_id: a.user_id, name: names.get(a.user_id) || a.username || null, at: a.at };
}
async function loadCaseWithTask(c) {
  if (!c) return null;
  const task = c.task_id ? await get('SELECT id, title, status, due_date, assignee_user_id, deleted_at FROM task WHERE id = ?', [c.task_id]) : null;
  return shapeCase(c, task, c.status === 'closed' ? await closureOf(c.id) : null);
}

function buildEvidence(row, period) {
  const f0 = row._f0; const e = row._emp;
  const asOf = nowIso();
  const planning = { label_ar: 'مصفوفة التسكين', href: `/app/team/planning?from=${period.key}&to=${period.key}` };
  const items = f0.items.filter((it) => it.status === 'confirmed').map((it) => `${it.label} ${it.pct}%`).join(' · ');
  const ev = [
    { title_ar: 'التسكين المؤكد', value_ar: f0.state === 'out' ? 'خارج فترة الارتباط' : `${row.confirmedPct}% من طاقته${items ? ' — ' + items : ' — بلا تسكين'}`, source: planning, asOf },
    { title_ar: 'حِمل المهام', value_ar: `${row.taskLoad.level_ar}${row.taskLoad.open ? ` (${row.taskLoad.pct}% من ${row.taskLoad.open} مهام، ${row.taskLoad.unsized} بلا نسبة)` : ' (لا مهام مفتوحة)'}`,
      source: { label_ar: 'مهام الشخص', href: row.userId ? `/app/person/${row.userId}?tab=tasks` : null }, asOf },
    { title_ar: 'العمل الداخلي', value_ar: f0.state === 'out' ? '—' : `${row.internalPct}%${row.confirmedPct ? ` (${Math.round((row.internalPct / row.confirmedPct) * 100)}% من المؤكد)` : ''}`, source: planning, asOf },
    { title_ar: 'الأشهر القادمة', value_ar: row.upcoming.map((u) => `${MONTHS_AR[Number(u.key.slice(5, 7)) - 1]} ${u.state === 'out' ? 'خارج الارتباط' : `${u.confirmedPct}%`}${u.pendingPct ? ` (طلب معلَّق ${u.pendingPct}%)` : ''}`).join(' · '), source: planning, asOf },
    { title_ar: 'الارتباط والطاقة', value_ar: `${e.hire_date ? 'من ' + String(e.hire_date).slice(0, 10) : 'بلا تاريخ تعيين'}${e.end_date ? ' إلى ' + String(e.end_date).slice(0, 10) : ''} — الطاقة ${row.capacityPct != null ? row.capacityPct + '%' : 'غير مسجلة'}`,
      source: { label_ar: 'ملف المورد', href: `/app/team/resources/${e.id}?tab=engagement` }, asOf },
    { title_ar: 'التغطية المالية', value_ar: `${COVERAGE_UNAVAILABLE.state_ar} — ${COVERAGE_UNAVAILABLE.note_ar}`, source: { label_ar: 'قرار الإدارة لهذه النسخة', href: null }, asOf },
  ];
  return ev;
}

/** S18 — فحص الحالة: المورد، الإشارة وقاعدتها، الأدلة بمصادرها، الأسئلة، والمتابعة القائمة إن وُجدت. */
export async function caseDetail(user, employeeId, { year, month } = {}) {
  const emp = await loadReadableResource(user, employeeId);
  const period = parsePeriod({ year, month });
  const [full] = await all(`SELECT e.*, d.name_ar department_name, s.name_ar sector_name FROM employee e
       LEFT JOIN department d ON d.id = e.department_id AND d.deleted_at IS NULL
       LEFT JOIN sector s ON s.id = e.sector_id AND s.deleted_at IS NULL WHERE e.id = ?`, [emp.id]);
  const [row] = await analyze([full || emp], period);
  const cases = await all('SELECT * FROM analysis_case WHERE employee_id = ? AND year = ? AND month = ? ORDER BY created_at', [emp.id, period.year, period.month]);
  const current = cases.find((c) => c.signal === row.signal.key) || null;
  return {
    resource: { id: emp.id, name_ar: emp.name_ar, job_title: emp.job_title || '', department_id: emp.department_id || null,
      department_name: full?.department_name || null, sector_id: emp.sector_id || null, sector_name: full?.sector_name || null,
      userId: row.userId, resourceType_ar: row.resourceType_ar },
    period,
    signal: row.signal,
    figures: { confirmedPct: row.confirmedPct, billablePct: row.billablePct, tentativePct: row.tentativePct, pendingPct: row.pendingPct,
      internalPct: row.internalPct, availablePct: row.availablePct, overPct: row.overPct, engagement: row.engagement, items: row.items, upcoming: row.upcoming },
    taskLoad: row.taskLoad,
    coverage: row.coverage,
    evidence: buildEvidence(row, period),
    questions_ar: QUESTIONS_AR[row.signal.key] || QUESTIONS_AR.none,
    followup: await loadCaseWithTask(current),
    otherCases: await Promise.all(cases.filter((c) => c !== current).map((c) => loadCaseWithTask(c))),
    rights: { followup: !!user && (user.role_id === 'admin' || can(user, 'create', 'task')) },
    asOf: nowIso(),
  };
}

/**
 * S18 — إنشاء متابعة: مهمة حقيقية عبر tasks.quickAddTask (عمل داخلي، العنوان يذكر المورد
 * والإشارة) + صف analysis_case. المفتاح الفريد (المورد، السنة، الشهر، الإشارة) يجعل النداء
 * المكرر يعيد الحالة القائمة بدل إنشاء مهمةٍ ثانية. الحالة المغلقة يعاد فتحها بمهمةٍ جديدة.
 */
export async function createFollowup(ctx, employeeId, { year, month, action_ar, ownerUserId, dueDate, note, signal } = {}) {
  const user = ctx.user;
  const emp = await loadReadableResource(user, employeeId);
  const period = parsePeriod({ year, month });
  let sigKey = String(signal || '').trim();
  if (sigKey && !SIGNALS[sigKey]) throw badRequest('الإشارة المطلوبة غير معروفة — اختر من قائمة الإشارات');
  let row = null;
  if (!sigKey) { [row] = await analyze([emp], period); sigKey = row.signal.key; }
  const existing = await get('SELECT * FROM analysis_case WHERE employee_id = ? AND year = ? AND month = ? AND signal = ?',
    [emp.id, period.year, period.month, sigKey]);
  if (existing && existing.status !== 'closed') return { ...(await loadCaseWithTask(existing)), existing: true };
  const owner = String(ownerUserId || user.id).trim();
  const due = dueDate ? String(dueDate).slice(0, 10) : null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw badRequest('موعد المتابعة غير صحيح — أدخله بصيغة سنة-شهر-يوم مثل 2026-10-15');
  const action = String(action_ar || '').trim().slice(0, 80) || 'متابعة';
  const title = `${action} — ${emp.name_ar} — ${SIGNALS[sigKey]} (${period.label_ar})`.slice(0, 200);
  if (!row) { [row] = await analyze([emp], period); }
  const evidence = { signal: sigKey, rule_ar: SIGNAL_RULE_AR[sigKey], why_ar: row?.signal?.why_ar || null,
    confirmedPct: row?.confirmedPct ?? null, internalPct: row?.internalPct ?? null, taskLoad: row ? { level: row.taskLoad.level, pct: row.taskLoad.pct, unsized: row.taskLoad.unsized, open: row.taskLoad.open } : null,
    upcoming: row?.upcoming || [], capturedAt: nowIso() };
  const description = [note ? String(note).trim().slice(0, 1000) : null,
    `الإشارة: ${SIGNALS[sigKey]} — ${SIGNAL_RULE_AR[sigKey]}`, row?.signal?.why_ar ? `الدليل: ${row.signal.why_ar}` : null,
    `فحص الحالة: /app/team/analysis/case/${emp.id}?year=${period.year}&month=${period.month}`].filter(Boolean).join('\n');
  const result = await tx(async () => {
    // المهمة أولاً بحارسها هي (صلاحية الإنشاء والإسناد في tasks.js) — من لا يملك إسنادها لا يفتح حالة.
    const task = await quickAddTask(ctx, {
      title, description, work_kind: 'internal', assignee_user_id: owner, due_date: due,
      sector_id: emp.sector_id || undefined, department_id: emp.department_id || null, category: 'followup', priority: 'P2',
    });
    const now = nowIso();
    if (existing) {
      await update('analysis_case', existing.id, { status: 'open', task_id: task.id, owner_user_id: owner, due_date: due,
        note: note ? String(note).trim().slice(0, 1000) : existing.note, evidence_json: JSON.stringify(evidence), updated_at: now });
      await audit(ctx, { action: 'reopen', resource: 'analysis_case', resourceId: existing.id, sectorId: emp.sector_id,
        detail: { signal: sigKey, task_id: task.id, owner, due_date: due } });
      return { caseId: existing.id, task, reopened: true };
    }
    const cid = id('acase');
    await insert('analysis_case', {
      id: cid, employee_id: emp.id, year: period.year, month: period.month, signal: sigKey, status: 'open',
      evidence_json: JSON.stringify(evidence), task_id: task.id, owner_user_id: owner, due_date: due,
      note: note ? String(note).trim().slice(0, 1000) : null, created_by: user.id, created_at: now,
    });
    await audit(ctx, { action: 'create', resource: 'analysis_case', resourceId: cid, sectorId: emp.sector_id,
      detail: { signal: sigKey, task_id: task.id, owner, due_date: due, period: period.key } });
    return { caseId: cid, task, reopened: false };
  }).catch(async (e) => {
    // سباق إنشاءٍ متزامن على المفتاح الفريد: المعاملة تراجعت (والمهمة معها)، فتُعاد الحالة التي سبقت.
    if (/UNIQUE|unique|duplicate/i.test(String(e?.message || ''))) {
      const raced = await get('SELECT * FROM analysis_case WHERE employee_id = ? AND year = ? AND month = ? AND signal = ?', [emp.id, period.year, period.month, sigKey]);
      if (raced) return { caseId: raced.id, task: null, raced: true };
    }
    throw e;
  });
  const c = await get('SELECT * FROM analysis_case WHERE id = ?', [result.caseId]);
  return { ...(await loadCaseWithTask(c)), existing: !!result.raced, reopened: !!result.reopened };
}

/** S18 — إغلاق الحالة بتفسير؛ الفاعل مكتوب في الأثر ويُقرأ منه في فحص الحالة. المهمة تبقى لصاحبها. */
export async function closeCase(ctx, caseId, { explanation } = {}) {
  const user = ctx.user;
  const c = await get('SELECT * FROM analysis_case WHERE id = ?', [caseId]);
  if (!c) throw notFound('حالة المتابعة غير موجودة — قد تكون حُذفت');
  const emp = await loadReadableResource(user, c.employee_id);
  // صاحبُ الملف نفسه لا يغلق سؤالاً طُرح عنه (ownsEmployee يمرّ على النفس لأغراض التسكين —
  // لا هنا): الإغلاق لصاحب المتابعة أو كاتبها أو من يدير المورد فعلاً.
  const self = user.employee_id === emp.id || (!!emp.user_id && emp.user_id === user.id);
  const allowed = user.role_id === 'admin' || c.owner_user_id === user.id || c.created_by === user.id
    || (!self && leadsResource(user, emp));
  if (!allowed) throw forbidden('إغلاق الحالة لصاحب المتابعة أو لمن يدير المورد');
  const text = String(explanation || '').trim();
  if (!text) throw badRequest('اكتب تفسير الإغلاق — ما الذي تبيّن وما القرار');
  if (c.status === 'closed') throw badRequest('الحالة مغلقة فعلاً — إن تجدّدت الإشارة أنشئ متابعة جديدة فتُفتح من جديد');
  const now = nowIso();
  await tx(async () => {
    await update('analysis_case', caseId, { status: 'closed', note: text.slice(0, 1000), updated_at: now });
    await audit(ctx, { action: 'close', resource: 'analysis_case', resourceId: caseId, sectorId: emp.sector_id,
      detail: { explanation: text.slice(0, 1000), closed_by: user.id, signal: c.signal, task_id: c.task_id, period: monthKey(c.year, c.month) } });
  });
  return await loadCaseWithTask(await get('SELECT * FROM analysis_case WHERE id = ?', [caseId]));
}
