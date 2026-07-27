// PMO — Tasks service with Quick Add. Employees manage own tasks; managers see team/project scope.
import { all, get, insert, update } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

// ترتيب الإلحاح المشترك بين كل استعلامات المهام — مصدر واحد فلا يختلف ترتيب القائمة عن اللوح.
const PRIORITY_ORDER = "CASE %s.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END";
const prioritySql = (pfx) => PRIORITY_ORDER.replace('%s', pfx.replace(/\.$/, '') || 't');

// حساب تاريخ بـJS ثم ربطه كنص — لا دوال تواريخ في SQL (القاعدة المحمولة بين المحرّكين).
export function addDays(isoDay, n) {
  const t = Date.parse(String(isoDay).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return String(isoDay).slice(0, 10);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

// ── مرشّحات مشتركة بين «مهامي» و«مهام فريقي» ────────────────────────────────
// عدسة واحدة على نفس البيانات: أي مرشّح يظهر في القائمة يعمل حرفياً في اللوح والتقويم،
// ولا يُبنى مرشّح خاص بعرض دون غيره. `today` تاريخ مربوط (YYYY-MM-DD) لا دالة قاعدة بيانات،
// كي يكون الاختبار حاسماً ولا يتغيّر الجواب بتغيّر ساعة الخادم.
//
// معنى «نافذة اليوم» صراحةً: كل ما استُحق اليوم أو قبله، **زائد** ما بدأتَه فعلاً أو ما تعطّل —
// لأن المهمة التي فتحتها اليوم هي على طاولتك اليوم مهما كان موعدها المكتوب. هذا هو «اليوم
// المنتهي» الذي يمكن إغلاقه، لا القائمة اللانهائية.
function applyTaskFilters(where, params, f, today, pfx = 't.') {
  const p = pfx;
  if (f.status) { where.push(`${p}status = ?`); params.push(f.status); }
  if (f.priority) { where.push(`${p}priority = ?`); params.push(f.priority); }
  if (f.assignee) { where.push(`${p}assignee_user_id = ?`); params.push(f.assignee); }
  if (f.project) { where.push(`${p}project_id = ?`); params.push(f.project); }
  if (f.opportunity) { where.push(`${p}opportunity_id = ?`); params.push(f.opportunity); }
  if (f.q) { where.push(`LOWER(${p}title) LIKE ?`); params.push('%' + String(f.q).toLowerCase().trim() + '%'); }
  if (f.kind === 'project') where.push(`${p}project_id IS NOT NULL`);
  else if (f.kind === 'opportunity') where.push(`${p}opportunity_id IS NOT NULL`);
  else if (f.kind === 'internal') where.push(`${p}project_id IS NULL AND ${p}opportunity_id IS NULL`);
  if (f.flag === 'nostep') where.push(`(${p}next_step IS NULL OR ${p}next_step = '')`);
  else if (f.flag === 'blocked') where.push(`${p}status = 'BLOCKED'`);
  else if (f.flag === 'noparent') where.push(`${p}project_id IS NULL AND ${p}opportunity_id IS NULL`);
  // النافذة الزمنية
  const w = f.window;
  if (w === 'overdue') { where.push(`${p}due_date IS NOT NULL AND substr(${p}due_date,1,10) < ?`); params.push(today); }
  else if (w === 'today' || f.today) {
    where.push(`((${p}due_date IS NOT NULL AND substr(${p}due_date,1,10) <= ?) OR ${p}status IN ('IN_PROGRESS','BLOCKED'))`);
    params.push(today);
  } else if (w === 'week') { where.push(`${p}due_date IS NOT NULL AND substr(${p}due_date,1,10) <= ?`); params.push(addDays(today, 7)); }
  else if (w === 'nodate') where.push(`${p}due_date IS NULL`);
  // مدى تواريخ صريح (شبكة التقويم تطلب شهراً بعينه) — المهام بلا موعد تُطلب بنافذة nodate
  // في استدعاء منفصل، لأن «بلا موعد» ليست تاريخاً خارج المدى بل غياب تاريخ أصلاً.
  if (f.from) { where.push(`${p}due_date IS NOT NULL AND substr(${p}due_date,1,10) >= ?`); params.push(String(f.from).slice(0, 10)); }
  if (f.to) { where.push(`${p}due_date IS NOT NULL AND substr(${p}due_date,1,10) <= ?`); params.push(String(f.to).slice(0, 10)); }
  // المنجَز القديم لا يُعاد سرده إلى الأبد — يُقصر على نافذة قريبة حين تُطلب
  if (f.doneSince) { where.push(`(${p}status != 'DONE' OR (${p}completed_at IS NOT NULL AND substr(${p}completed_at,1,10) >= ?))`); params.push(String(f.doneSince).slice(0, 10)); }
  if (f.openOnly) where.push(`${p}status NOT IN ('DONE','CANCELLED')`);
}

const clampLimit = (n, def = 500) => Math.max(1, Math.min(500, Number(n) || def));

// "My tasks" — always own; managers can pass a projectId they can access.
// يعود بسياق المهمة معها (اسم المشروع/الفرصة/الإدارة) باستعلام واحد لا باستعلام لكل صف —
// الصفحة كانت تجمع الأسماء بنفسها بعد القراءة، فتكرّرت المعرفة في مكانين.
export async function myTasks(user, filters = {}) {
  const today = String(filters.todayDate || nowIso().slice(0, 10)).slice(0, 10);
  const where = ['t.deleted_at IS NULL', 't.assignee_user_id = ?'];
  const params = [user.id];
  applyTaskFilters(where, params, filters, today);
  return await all(`SELECT t.*, p.name_ar AS project_name, o.title_ar AS opportunity_name,
      d.name_ar AS department_name, u.name_ar AS assignee_name, u.username AS assignee_username
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
    LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
    LEFT JOIN department d ON d.id = t.department_id AND d.deleted_at IS NULL
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${prioritySql('t')}, t.due_date
    LIMIT ${clampLimit(filters.limit)}`, params);
}

// «مهامي في هذا القطاع» — مهام الشخص نفسه داخل قطاع بعينه، الأقرب موعداً أولاً ثم الأعلى أولوية.
// لا حارس نطاق هنا وليس سهواً: الشرط `assignee_user_id = ?` هو الحارس — لا تعود إلا المهام
// المُسنَدة إلى صاحب الطلب، وهي مهامه أينما كانت (صفحة «مهامي» مفتوحة لكل من يدخل المنصة).
// المهمة تخص القطاع إذا حملت القطاع نفسه أو كانت على مشروع من مشاريعه.
export async function mySectorTasks(user, sectorId, opts = {}) {
  if (!user?.id || !sectorId) return [];
  const where = ['t.deleted_at IS NULL', 't.assignee_user_id = ?', '(t.sector_id = ? OR p.sector_id = ?)'];
  const params = [user.id, sectorId, sectorId];
  if (!opts.includeDone) where.push("t.status NOT IN ('DONE', 'CANCELLED')");
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  return await all(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.blocked_reason,
            t.project_id, t.opportunity_id, p.name_ar AS project_name
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(substr(t.due_date, 1, 10), '9999-12-31'),
               CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
               t.created_at
      LIMIT ${limit}`, params);
}

// «أثر الأيام» — عدد ما أُنجز فعلاً كل يوم خلال آخر N يوماً، من `completed_at` المسجَّل وحده.
// لا سلاسل ولا نقاط ولا أوسمة (قرار موثّق في docs/benchmarks.md): رقم حقيقي أو فراغ معلن.
export async function completionTrend(user, opts = {}) {
  const days = Math.max(1, Math.min(31, Number(opts.days) || 7));
  const today = String(opts.today || nowIso().slice(0, 10)).slice(0, 10);
  const start = addDays(today, -(days - 1));
  const rows = await all(
    `SELECT substr(completed_at,1,10) AS day, COUNT(*) AS n FROM task
      WHERE deleted_at IS NULL AND assignee_user_id = ? AND status = 'DONE'
        AND completed_at IS NOT NULL
        AND substr(completed_at,1,10) >= ? AND substr(completed_at,1,10) <= ?
      GROUP BY substr(completed_at,1,10)`, [user.id, start, today]);
  const byDay = Object.fromEntries(rows.map((r) => [r.day, Number(r.n) || 0]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(start, i);
    return { day, done: byDay[day] || 0 };
  });
}

export async function projectTasks(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ? AND deleted_at IS NULL', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  return await all('SELECT * FROM task WHERE project_id = ? AND deleted_at IS NULL ORDER BY status, due_date', [projectId]);
}

// إسناد مهمة لشخص آخر: الفحص يحتاج **قطاع المُسنَد إليه** لا معرّفه وحده. تمرير هدف بلا قطاع
// كان يجعل فحص النطاق القطاعي يمرّ فراغاً، فيستطيع أي دور بنطاق قطاع أن يدفع مهمة إلى قائمة
// أي مستخدم في الشركة كلها. نحلّ قطاعه من حسابه ونمرّره صراحةً.
async function assertMayAssign(user, assigneeId) {
  if (!assigneeId || assigneeId === user.id) return;
  const target = await get('SELECT id, sector_id FROM app_user WHERE id = ? AND deleted_at IS NULL AND active = 1', [assigneeId]);
  if (!target) throw badRequest('المستخدم المُسنَد إليه غير موجود');
  if (!can(user, 'update', 'task', { sector_id: target.sector_id, assignee_user_id: assigneeId, user_id: assigneeId }))
    throw forbidden('إسناد مهمة لشخص آخر يتطلب صلاحية إدارية على قطاعه');
}

// ربط المهمة بجهتها (مشروع / فرصة / إدارة): الرابط يجب أن يشير إلى شيء **يصل إليه صاحب الطلب**.
// بلا هذا الفحص يستطيع أي شخص أن يعلّق مهمته على مشروع أو فرصة خارج نطاقه، فتظهر في صفحة ذلك
// المشروع وفي عدّاداته — تلويثُ نطاقٍ لا يملكه. الفحص يحمل صف الوجهة كاملاً لا معرّفه وحده،
// وإلا مرّ فارغاً كما يمرّ أي فحص بلا هدف.
async function assertMayLink(user, data) {
  if (data.project_id) {
    const p = await get('SELECT id, sector_id, department_id, owner_user_id FROM project WHERE id = ? AND deleted_at IS NULL', [data.project_id]);
    if (!p) throw badRequest('المشروع المختار غير موجود — اختر مشروعاً من القائمة');
    if (!can(user, 'read', 'project', p)) throw forbidden('هذا المشروع خارج نطاقك — اربط المهمة بمشروع من قائمتك');
  }
  if (data.opportunity_id) {
    const o = await get('SELECT id, sector_id, department_id, owner_user_id FROM opportunity WHERE id = ? AND deleted_at IS NULL', [data.opportunity_id]);
    if (!o) throw badRequest('الفرصة المختارة غير موجودة — اخترها من القائمة');
    if (!can(user, 'read', 'opportunity', o)) throw forbidden('هذه الفرصة خارج نطاقك — اربط المهمة بفرصة من قائمتك');
  }
  if (data.department_id) {
    const d = await get('SELECT id, sector_id FROM department WHERE id = ? AND deleted_at IS NULL', [data.department_id]);
    if (!d) throw badRequest('الإدارة المختارة غير موجودة — اخترها من القائمة');
  }
}

// المهمة تُنسب إلى جهة واحدة: مشروع أو فرصة أو عمل داخلي. اختيار جهة يمسح الأخرى صراحةً
// بدل تركِ رابطين متناقضين يظهران في مكانين ويُحسبان مرتين.
function normalizeParent(patch, data) {
  if ('project_id' in data && data.project_id) { patch.project_id = data.project_id; patch.opportunity_id = null; patch.work_kind = 'project'; }
  else if ('opportunity_id' in data && data.opportunity_id) { patch.opportunity_id = data.opportunity_id; patch.project_id = null; patch.work_kind = 'opportunity'; }
  else if (('project_id' in data && !data.project_id) || ('opportunity_id' in data && !data.opportunity_id)) {
    patch.project_id = null; patch.opportunity_id = null; patch.work_kind = data.work_kind || 'internal';
  }
  if ('work_kind' in data && data.work_kind && !patch.work_kind) patch.work_kind = data.work_kind;
  return patch;
}

const blankToNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Quick Add — minimal fields, instant. Defaults assignee to self.
export async function quickAddTask(ctx, data) {
  const user = ctx.user;
  if (!data.title || !String(data.title).trim()) throw badRequest('عنوان المهمة مطلوب');
  const assignee = data.assignee_user_id || user.id;
  // بوابة الإنشاء: كانت غائبة تماماً. `assertMayAssign` يحرس **الإسناد لغيرك** فقط، ويعود
  // مبكّراً حين يُسنِد المرء لنفسه — فبقي الباب مفتوحاً لكل حساب مسجَّل، ومنه حساب العميل
  // الخارجي: أنشأ مهمة فعلياً في قطاع لا علاقة له به لأن القطاع يُؤخذ من الطلب بلا تحقق.
  // الفحص هنا يحمل **القطاع الهدف** لا وجوده وحده، وإلا مرّ فارغاً كما يمرّ الفحص بلا هدف.
  // من منحُه بنطاق «خاصتي» لا يختار القطاع أصلاً. الفحص وحده لا يكفي هنا: «خاصتي» تمرّ على
  // «المهمة لي» بصرف النظر عن القطاع المكتوب في الطلب — فيستطيع موظف أن يزرع مهمةً في لوحة
  // قطاع آخر بلا أن يكسر أي قاعدة. القطاع يُثبَّت على قطاع صاحبه بدل رفض الطلب: المنع هنا
  // يعطّل مساراً مشروعاً، والتثبيت يُبقيه يعمل ويسدّ الزرع معاً.
  const ownOnly = effectiveScope(user, 'create', 'task') === 'own';
  const sectorId = (ownOnly ? user.sector_id : (data.sector_id || user.sector_id)) || null;
  if (!can(user, 'create', 'task', { sector_id: sectorId, assignee_user_id: assignee }))
    throw forbidden('إنشاء المهام خارج نطاقك — اختر قطاعاً ضمن صلاحيتك أو اطلب التفعيل من مدير النظام');
  await assertMayAssign(user, assignee); // الفحص يحمل قطاع المُسنَد إليه لا معرّفه وحده
  await assertMayLink(user, data);       // والرابط الأبوي يشير إلى ما يصل إليه فعلاً
  const parent = normalizeParent({}, data);
  const tid = id('tsk'); const now = nowIso();
  await insert('task', {
    id: tid, title: String(data.title).trim(), description: data.description || null,
    work_kind: parent.work_kind || data.work_kind || 'project',
    project_id: parent.project_id ?? (data.project_id || null),
    opportunity_id: parent.opportunity_id ?? (data.opportunity_id || null),
    sector_id: sectorId, department_id: data.department_id || null,
    assignee_user_id: assignee, priority: data.priority || 'P2', status: 'TODO',
    start_date: data.start_date || null, due_date: data.due_date || null,
    estimate_hours: data.estimate_hours ?? null, recurring: data.recurring || null,
    next_step: blankToNull(data.next_step),
    created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'task', resourceId: tid, sectorId });
  return await get('SELECT * FROM task WHERE id = ?', [tid]);
}

// «مهام فريقي» — أول رؤية للمدير لمن يعمل على ماذا. لم تكن موجودة إطلاقاً: كل مستخدم يرى
// مهامه وحده. النطاق يُبنى من الاستعلام نفسه (لا تصفية بعد القراءة) فلا يُقرأ ما لا يُسمح به.
export async function teamTasks(user, filters = {}) {
  // ملاحظة دقيقة: can(...) بلا هدف يعيد «صحيح» لمجرد وجود المنح مهما كان نطاقه — فالموظف
  // العادي (نطاق «خاصتي») كان يمرّ. السؤال هنا نطاقي لا وجودي: هل يتجاوز نطاقه نفسه؟
  const scope = effectiveScope(user, 'update', 'task');
  if (!scope || scope === 'own') throw forbidden('عرض مهام الفريق يتطلب صلاحية إدارية على فريق أو قطاع');
  const where = ['t.deleted_at IS NULL'];
  const params = [];
  // الافتراضي كما كان: المنجَز خارج لوحة المدير. ومن يطلبه صراحةً (عرض اللوح بعمود «منجز»)
  // يمرّر includeDone — العدسة واحدة والبيانات واحدة.
  if (!filters.includeDone) where.push("t.status != 'DONE'");
  // ── محور «فريقي» يُشتقّ من نطاق المنح نفسه، لا من عمود النطاق على الحساب ──
  // كان الاشتقاق بالقطاع دائماً: `(t.sector_id = ? OR u.sector_id = ?)` — فمدير الإدارة، وكل
  // منحه بنطاق «إدارة»، يرى مهام القطاع كله لا مهام إدارته. والمصدران (منح الدور وعمود النطاق)
  // كانا مختلطين: الشركة من العمود والباقي من القطاع — وهو عين التناقض الذي أنتج التسريب.
  //   • «شركة»  ⟵ بلا ترشيح (كما كان لكل من نطاق منحه شركي).
  //   • «إدارة» ⟵ أهل إدارته وحدهم.
  //   • ما دون ذلك (قطاع/مشروع/فريق) ⟵ القطاع كما كان حرفياً.
  // بنية الوصل: المهمة تُمسك بحساب المُسنَد إليه، والإدارة تسكن **سجل الموظف** لا الحساب —
  // فالجسر هو app_user.employee_id ⟵ employee.department_id. وصلة واحدة داخل الاستعلام،
  // لا استعلام لكل صف.
  // قرار موثَّق (فشل آمن): حسابٌ غير مربوط بسجل موظف ⟵ إدارته **مجهولة**، والمجهول يُستبعد
  // ولا يُدرج؛ الوصلة الخارجية تُنتج فراغاً فيُسقطه شرط المساواة. وكذلك المهمة بلا مُسنَد إليه:
  // لا شخص لها فلا إدارة. إدراج المجهول كان سيُعيد التسريب من الباب نفسه الذي أُغلق.
  if (scope === 'department') {
    // إدارة القارئ نفسها مجهولة (حسابه غير مربوط بموظف) ⟵ لوحة فارغة لا لوحة قطاع.
    if (!user.department_id) return [];
    where.push('emp.department_id = ?');
    params.push(user.department_id);
  } else if (scope !== 'company') {
    where.push('(t.sector_id = ? OR u.sector_id = ?)');
    params.push(user.sector_id, user.sector_id);
  }
  const today = String(filters.todayDate || nowIso().slice(0, 10)).slice(0, 10);
  if (filters.overdue) { where.push('t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?'); params.push(today); }
  applyTaskFilters(where, params, filters, today);
  const rows = await all(`SELECT t.*, u.name_ar assignee_name, u.username assignee_username,
       p.name_ar project_name, o.title_ar opportunity_name, d.name_ar department_name
     FROM task t
     LEFT JOIN app_user u ON u.id = t.assignee_user_id
     LEFT JOIN employee emp ON emp.id = u.employee_id AND emp.deleted_at IS NULL
     LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
     LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
     LEFT JOIN department d ON d.id = t.department_id AND d.deleted_at IS NULL
     WHERE ${where.join(' AND ')}
     ORDER BY ${prioritySql('t')}, t.due_date
     LIMIT ${clampLimit(filters.limit)}`, params);
  // تجميع حسب الشخص: هذا سؤال المدير الحقيقي «من يعمل على ماذا» لا قائمة مسطّحة.
  const byPerson = new Map();
  for (const r of rows) {
    const key = r.assignee_user_id || '—';
    if (!byPerson.has(key)) {
      byPerson.set(key, { userId: r.assignee_user_id, name: r.assignee_name || r.assignee_username || 'غير مُسنَدة', tasks: [], overdue: 0, blocked: 0, noStep: 0, done: 0 });
    }
    const b = byPerson.get(key);
    b.tasks.push(r);
    if (r.status === 'DONE') b.done++;
    else if (r.due_date && String(r.due_date).slice(0, 10) < today) b.overdue++;
    if (r.blocked_reason || r.status === 'BLOCKED') b.blocked++;
    if (r.status !== 'DONE' && !String(r.next_step || '').trim()) b.noStep++;
  }
  // الأكثر تأخراً أولاً — المدير يحتاج المشكلة في الأعلى لا الترتيب الأبجدي.
  return [...byPerson.values()].sort((a, b) => (b.overdue - a.overdue) || (b.tasks.length - a.tasks.length));
}

// تحديث جماعي — تنظيف عشرين مهمة متأخرة في ثوانٍ بدل عشرين إعادة تحميل للصفحة.
// كل مهمة تمر بفحص updateTask نفسه؛ لا مسار مختصر يتجاوز الصلاحية.
export async function bulkUpdateTasks(ctx, taskIds, data) {
  const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).filter(Boolean))];
  if (!ids.length) throw badRequest('اختر مهمة واحدة على الأقل');
  if (ids.length > 100) throw badRequest('حدّد 100 مهمة كحد أقصى في المرة الواحدة');
  const allowed = {};
  for (const k of ['status', 'priority', 'due_date', 'assignee_user_id', 'project_id', 'opportunity_id', 'next_step', 'department_id'])
    if (k in data) allowed[k] = data[k];
  if (!Object.keys(allowed).length) throw badRequest('حدّد ما تريد تغييره');
  const done = []; const failed = [];
  for (const tid of ids) {
    try { await updateTask(ctx, tid, allowed); done.push(tid); }
    catch (e) { failed.push({ id: tid, reason: e.message }); }
  }
  return { updated: done.length, failed };
}

export async function updateTask(ctx, taskId, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [taskId]);
  if (!row) throw notFound('المهمة غير موجودة');
  // own task, or manager with scope
  const isOwn = row.assignee_user_id === user.id || row.created_by === user.id;
  if (!isOwn && !can(user, 'update', 'task', row)) throw forbidden();
  // إعادة الإسناد بوابة منفصلة: ملكية المهمة تخوّل تعديل محتواها لا دفعها إلى قائمة شخص آخر.
  // كانت assignee_user_id تُعدَّل بلا أي فحص على الوجهة، فيستطيع أي موظف إغراق قائمة أي مستخدم.
  if ('assignee_user_id' in data && data.assignee_user_id !== row.assignee_user_id) {
    await assertMayAssign(user, data.assignee_user_id);
  }
  // وإعادة الربط بوابة ثالثة: كانت القائمة المسموحة تُسقط كل رابط أبوي بصمت، فالمهمة تُخلق
  // مرة واحدة ولا تُصحَّح أبداً — تُنشأ على المشروع الخطأ فتبقى عليه إلى الأبد.
  await assertMayLink(user, data);
  const patch = {};
  for (const k of ['title', 'description', 'status', 'priority', 'progress_pct', 'due_date',
    'start_date', 'estimate_hours', 'blocked_reason', 'assignee_user_id', 'next_step', 'department_id']) {
    if (k in data) patch[k] = data[k];
  }
  if ('next_step' in patch) patch.next_step = blankToNull(patch.next_step);
  if ('blocked_reason' in patch) patch.blocked_reason = blankToNull(patch.blocked_reason);
  if ('progress_pct' in patch) patch.progress_pct = Math.max(0, Math.min(100, Math.round(Number(patch.progress_pct) || 0)));
  normalizeParent(patch, data);
  // العائق يُكتب ويُوجَّه: «معطَّل» بلا سبب مكتوب هي بالضبط الحالة التي لا يصلها أحد ولا يرفعها
  // أحد. الرسالة تقول ماذا يُكتب لا أن الحقل مطلوب.
  const nextStatus = 'status' in patch ? patch.status : row.status;
  if (nextStatus === 'BLOCKED') {
    const reason = 'blocked_reason' in patch ? patch.blocked_reason : row.blocked_reason;
    if (!reason) throw badRequest('اكتب سبب التعطيل ومَن يستطيع رفعه — المهمة المعطَّلة بلا سبب لا تصل إلى أحد');
  } else if (row.status === 'BLOCKED' && nextStatus !== 'BLOCKED' && !('blocked_reason' in patch)) {
    patch.blocked_reason = null; // زال التعطيل فيزول سببه، ولا يبقى نصّاً قديماً يُقرأ خطأً
  }
  if (data.status === 'DONE' && row.status !== 'DONE') { patch.completed_at = nowIso(); patch.progress_pct = 100; }
  // إعادة فتح مهمة منجَزة تمحو ختم الإنجاز — وإلا بقيت تُحسب في «أنجزت اليوم» وهي مفتوحة.
  if ('status' in patch && patch.status !== 'DONE' && row.status === 'DONE') patch.completed_at = null;
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('task', taskId, patch);
  await audit(ctx, { action: 'update', resource: 'task', resourceId: taskId, detail: { status: patch.status } });
  return await get('SELECT * FROM task WHERE id = ?', [taskId]);
}
