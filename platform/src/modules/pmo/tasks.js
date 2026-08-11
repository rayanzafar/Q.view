// PMO — Tasks service with Quick Add. Employees manage own tasks; managers see team/project scope.
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { departmentScope, departmentInSql, inDepartmentScope } from '../../core/rbac/departments.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { listUserGrants, grantableDepartments } from '../identity/grants.js';
import { raiseDirectApproval, TASK_WORKFLOW_KEY } from '../workflow/engine.js';
import { notify } from '../notifications/notify.js';
import { taskApproval, approvedTaskSql, ownOrApprovedTaskSql, TASK_PENDING, isPendingTask } from './task-approval.js';

// ترتيب الإلحاح المشترك بين كل استعلامات المهام — مصدر واحد فلا يختلف ترتيب القائمة عن اللوح.
const PRIORITY_ORDER = "CASE %s.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END";
const prioritySql = (pfx) => PRIORITY_ORDER.replace('%s', pfx.replace(/\.$/, '') || 't');

// ── المهمة الشخصية: عملُ المرء الذي لا يخصّ أحداً غيره ────────────────────────
// «وفي برضو مكان المهام أضيف شي اسمه مهام شخصية» — بلسان المالك.
//
// **ولا جدول جديد ولا ترحيلة**: جدول المهام يحمل `work_kind` منذ الترحيلة ٠٠١ بقائمة قيم
// مفتوحة (مشروع · فرصة · داخلي · منتج · عرض)، والمهمة تقوم بلا مشروع ولا فرصة أصلاً. فالمهمة
// الشخصية = صفٌّ في الجدول نفسه: `work_kind = 'personal'` + مُسنَدةٌ إلى صاحبها + بلا جهة.
// وبذلك تربح فوراً كل ما بُني للمهام على مدى الشاشة: النافذة الزمنية، واللوح، والتقويم،
// والإنجاز بنقرة، وخطة اليوم، والتغيير الجماعي — بلا سطر بنيةٍ واحد وبلا شاشة ثانية.
//
// ── والفرق الوحيد فرقٌ في مَن يراها ──────────────────────────────────────────
// «داخلي» عملٌ للشركة بلا مشروع، ومديرك يقرؤه بحقّ. و«شخصية» **لا تخرج من حساب صاحبها**:
// لا في لوحة الفريق، ولا في ملف الشخص حين يفتحه غيره، ولا في تقارير الفترة، ولا في قوائم
// المساعد. ولو تسرّبت مرةً واحدة لبطل معناها كله ولن يكتب فيها أحدٌ شيئاً بعدها.
//
// فالحارس هنا **مصدرٌ واحد** يستورده كل من يقرأ المهام عبر الحسابات، لا شرطٌ منسوخ في ستة
// مواضع ينسى سابعُها. والشرط يشمل الصفوف القديمة التي عمودها فارغ (لا شيء منها شخصي).
export const PERSONAL_WORK_KIND = 'personal';
export const isPersonalTask = (row) => String(row?.work_kind || '') === PERSONAL_WORK_KIND;
export const notPersonalSql = (pfx = 't.') => `(${pfx}work_kind IS NULL OR ${pfx}work_kind <> 'personal')`;

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
  else if (f.kind === 'personal') where.push(`${p}work_kind = 'personal'`);
  // «داخلي» و«شخصية» كلاهما بلا جهة مرتبطة، فلولا الاستثناء لابتلع الأولُ الثاني وصار مرشِّح
  // العمل الداخلي يعرض دفتر صاحبه الخاص في عمود عملٍ للشركة. المجموعتان لا تتقاطعان.
  else if (f.kind === 'internal') where.push(`${p}project_id IS NULL AND ${p}opportunity_id IS NULL AND ${notPersonalSql(p)}`);
  if (f.flag === 'nostep') where.push(`(${p}next_step IS NULL OR ${p}next_step = '')`);
  else if (f.flag === 'blocked') where.push(`${p}status = 'BLOCKED'`);
  // و«بلا جهة مرتبطة» عتابٌ على نقصٍ في الربط: المهمة الشخصية ليست ناقصةَ ربطٍ بل مقصودةٌ هكذا.
  else if (f.flag === 'noparent') where.push(`${p}project_id IS NULL AND ${p}opportunity_id IS NULL AND ${notPersonalSql(p)}`);
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
  // ── الموضع الوحيد الذي تظهر فيه مهمةٌ تنتظر اعتماداً ────────────────────────
  // من كتبها يراها هنا معلَّمةً «بانتظار اعتماد مديرك»، وكل ما سواها من قوائم وعدّادات وتقارير
  // لا يقرؤها (`approvedTaskSql`). ولو أُخفيت هنا أيضاً لاختفت لحظة الحفظ فحسبها صاحبها ضاعت
  // وأعاد كتابتها. أمّا من أُسنِدت إليه وليس كاتبها فلا يراها حتى تُضاف إليه فعلاً.
  const vis = ownOrApprovedTaskSql('t.', user.id);
  where.push(vis.clause); params.push(...vis.params);
  applyTaskFilters(where, params, filters, today);
  return await all(`SELECT t.*, p.name_ar AS project_name, o.title_ar AS opportunity_name,
      d.name_ar AS department_name, u.name_ar AS assignee_name, u.username AS assignee_username,
      COALESCE(uc.name_ar, uc.username) AS creator_name, COALESCE(ua.name_ar, ua.username) AS approver_name
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
    LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
    LEFT JOIN department d ON d.id = t.department_id AND d.deleted_at IS NULL
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN app_user uc ON uc.id = t.created_by
    LEFT JOIN app_user ua ON ua.id = t.approved_by
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
  // والمعلَّقة خارج هذه القائمة: شاشة القطاع تعرض عملاً قائماً بلا وسم انتظار، فظهورها هنا
  // يقول إنها أُضيفت وهي لم تُضَف بعد. موضعها المعلَّم شاشةُ «مهامي» وحدها.
  const where = ['t.deleted_at IS NULL', 't.assignee_user_id = ?', '(t.sector_id = ? OR p.sector_id = ?)', approvedTaskSql('t.')];
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
        AND ${approvedTaskSql('')}
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
  // ومهمةٌ تنتظر اعتماد مديرِ كاتبها ليست من عمل المشروع بعد: عرضها هنا يجعل فريق المشروع
  // يعوّل على تسليمٍ لم يوافق عليه أحد.
  return await all(`SELECT * FROM task WHERE project_id = ? AND deleted_at IS NULL AND ${approvedTaskSql('')}
    ORDER BY status, due_date`, [projectId]);
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
//
// و«شخصية» تسبق كل رابط: مهمةٌ شخصية معلَّقة على مشروع تظهر في شاشة ذلك المشروع وفي عدّاداته
// — أي تخرج من حساب صاحبها من الباب الذي وُعد بإغلاقه. فالاختيار حصري: إما جهةٌ وإما شخصية.
// ومعها يسقط القطاع والإدارة: لا قطاع لها ولا إدارة، فلا تدخل تجميعاً لأحد حتى لو غفل حارس.
//
// `current` صفُّ المهمة القائم (فارغ عند الإنشاء). وجودُه يمنع عطلاً صامتاً: محرِّر المهمة
// يرسل `project_id: null, opportunity_id: null` في كل حفظ، فكان الفرع الثالث يقلب كل مهمة
// شخصية إلى «عمل داخلي» بمجرد أن يفتح صاحبها تفاصيلها ويحفظ — فتصير مقروءةً لمديره بلا أن
// يطلب أحدٌ ذلك ولا يظهر التحوّل في أي مكان.
function normalizeParent(patch, data, current = null) {
  if (data.work_kind === PERSONAL_WORK_KIND) {
    patch.work_kind = PERSONAL_WORK_KIND;
    patch.project_id = null; patch.opportunity_id = null;
    patch.sector_id = null; patch.department_id = null;
    return patch;
  }
  if ('project_id' in data && data.project_id) { patch.project_id = data.project_id; patch.opportunity_id = null; patch.work_kind = 'project'; }
  else if ('opportunity_id' in data && data.opportunity_id) { patch.opportunity_id = data.opportunity_id; patch.project_id = null; patch.work_kind = 'opportunity'; }
  else if (('project_id' in data && !data.project_id) || ('opportunity_id' in data && !data.opportunity_id)) {
    patch.project_id = null; patch.opportunity_id = null;
    patch.work_kind = data.work_kind || (isPersonalTask(current) ? PERSONAL_WORK_KIND : 'internal');
  }
  if ('work_kind' in data && data.work_kind && !patch.work_kind) patch.work_kind = data.work_kind;
  return patch;
}

const blankToNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// التاريخ يُقبل فارغاً أو بصيغة القاعدة الواحدة YYYY-MM-DD ويُرفض ما سواها برسالةٍ تقول
// العمل: كان أي نصٍّ يُخزَّن حرفياً («2026-8-15» من ملفٍ مستورَد مثلاً) فتختفي المهمة من كل
// نافذةٍ زمنية ومن البحث وتبقى في اللوح وحده — مهمةٌ شبح لا يجدها صاحبها (KI-044 سابقاً).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v, label) => {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) {
    throw badRequest(`${label} بصيغة غير مقروءة — اختره من منتقي التاريخ`);
  }
  return s;
};

// العنوان مطلوبٌ ومسقوف في الخادم لا في الشاشة وحدها: بلا سقفٍ هنا كان نصُّ آلافِ الأحرف
// يدخل من الباب المباشر فيتضخم الصفُّ والبطاقة والرسالة معاً (KI-047 سابقاً).
const TITLE_MAX = 200;
const titleOf = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw badRequest('عنوان المهمة مطلوب');
  if (s.length > TITLE_MAX) {
    throw badRequest('عنوان المهمة أطول من اللازم — أوجزه في مئتي حرف وضع التفاصيل في الوصف');
  }
  return s;
};

// تصنيف المهمة (اجتماع/تقرير/متابعة…): وسمٌ وصفي قصير — الفراغ لا تصنيف، والطول مقصوصٌ
// عند ستين حرفاً كي لا يتحوّل الوسم إلى فقرةٍ تكسر أعمدة القوائم. القاعدة واحدة في مسارَي
// الإنشاء والتعديل معاً، فلا يختلف ما يُخزَّن باختلاف الباب الذي دخل منه.
const normalizeCategory = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, 60) : null;
};

// Quick Add — minimal fields, instant. Defaults assignee to self.
export async function quickAddTask(ctx, data) {
  const user = ctx.user;
  const title = titleOf(data.title);
  const assignee = data.assignee_user_id || user.id;
  // «شخصية» تعني شخصك أنت. مهمةٌ شخصية تُدفع إلى قائمة غيرك تناقضٌ في ذاتها: صاحبُها يراها
  // في دفتره ومن أنشأها لا يستطيع قراءتها بعدها — فيبدو النظام وكأنه ابتلعها.
  // وموضعُ الفحص **قبل** بوابة النطاق مقصود: التناقض في الطلب نفسه لا في صلاحية صاحبه، فلو
  // تأخّر لخرج الردّ «إنشاء المهام خارج نطاقك» — جوابٌ صحيح عن سؤال آخر، يرسل صاحبه إلى مدير
  // النظام يطلب منحاً لن يصلح شيئاً. أخصُّ سببٍ أولاً.
  const isPersonal = data.work_kind === PERSONAL_WORK_KIND;
  if (isPersonal && assignee !== user.id) {
    throw badRequest('المهمة الشخصية تخصّ صاحبها وحده — لإسنادها إلى زميل اجعلها مهمة عمل');
  }
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
  const projectId = parent.project_id ?? (data.project_id || null);
  // ربط المهمة بمخرَجها — «هذه المهمة جزء من تسليم هذا المخرَج». العمود قائم في البنية منذ
  // البداية ولم يكتبه مسار واحد، فالمهام تُنسب إلى المشروع كله ولا يُعرف أيُّ تسليمٍ تخدم.
  // والشرط أن يكون المخرَج من المشروع نفسه: مهمةٌ تشير إلى مخرَج مشروعٍ آخر تُفسد كل تجميع
  // لاحق بصمت، ولا يظهر العطل إلا في تقرير.
  const deliverableId = (data.deliverable_id || '').toString().trim() || null;
  if (deliverableId) {
    const d = await get('SELECT project_id FROM deliverable WHERE id = ? AND deleted_at IS NULL', [deliverableId]);
    if (!d) throw badRequest('المخرَج المرتبط غير موجود');
    if (!projectId || d.project_id !== projectId) throw badRequest('المخرَج المرتبط من مشروع آخر — اختر مخرَجاً من هذا المشروع');
  }
  const oppId = parent.opportunity_id ?? (data.opportunity_id || null);
  // ── هل تُضاف الآن أم تنتظر مديره ────────────────────────────────────────────
  // القرار يُقرأ من **الجهة بعد تطبيعها** لا من الطلب الخام: `normalizeParent` قد يمحو أحد
  // الرابطين، فقراءةُ الطلب كانت ستُعلّق مهمةً لا جهة لها في النهاية.
  const approval = await taskApproval(user, { project_id: projectId, opportunity_id: oppId });
  const tid = id('tsk'); const now = nowIso();
  // كتابةٌ واحدة لا تتجزّأ: مهمةٌ تُكتب معلَّقةً ثم يتعثّر رفعُ طلبها تنتظر أبداً معتمِداً لا
  // يعلم بها، وطلبٌ يُرفع على مهمةٍ لم تُكتب يفتح شاشةَ اعتمادٍ على عدم. (`tx` معاود الدخول،
  // فمن نادى الدالة داخل معاملته — تطبيق المساعد الذكي مثلاً — ينضمّ إليها ولا يُقسّمها.)
  await tx(async () => {
    await insert('task', {
      id: tid, title, description: data.description || null,
      // النوع يُشتقّ من الجهة الفعلية لا من قيمةٍ افتراضية عمياء: «مشروع» كانت تُكتب على كل
      // طلبٍ لم يسمِّ نوعه — ومنه كل إضافة سريعة بلا جهة — فتُخزَّن مهمةٌ داخلية «مشروعاً»
      // بلا مشروع. الترحيلة ٠٢٩ صحّحت المكتوب، وهذا السطر يسدّ الباب عن الجديد.
      work_kind: parent.work_kind || data.work_kind || (projectId ? 'project' : oppId ? 'opportunity' : 'internal'),
      project_id: projectId,
      deliverable_id: deliverableId,
      opportunity_id: oppId,
      // القطاع والإدارة يسقطان عن الشخصية: لا تدخل تجميع قطاعٍ ولا لوحة إدارة ولا تقرير فترة
      // حتى لو غفل حارسٌ لاحق. الحجب طبقتان — بنيةُ الصفّ وشرطُ الاستعلام — لا طبقةً واحدة.
      sector_id: isPersonal ? null : sectorId,
      department_id: isPersonal ? null : (data.department_id || null),
      assignee_user_id: assignee, priority: data.priority || 'P2', status: 'TODO',
      category: normalizeCategory(data.category),
      // و«تنتظر» ليست حالةَ عمل بل حالةَ وجود: `status` يبقى `TODO` كما هو، والعمود المستقلّ
      // وحده يقول إن المهمة لم تُضَف بعد. فلا يتغيّر معنى الحالة على كل لوحٍ وعدّاد وتقرير.
      approval_state: approval.needsApproval ? TASK_PENDING : null,
      start_date: dateOrNull(data.start_date, 'تاريخ البدء'), due_date: dateOrNull(data.due_date, 'تاريخ الاستحقاق'),
      estimate_hours: data.estimate_hours ?? null, recurring: data.recurring || null,
      next_step: blankToNull(data.next_step),
      created_at: now, created_by: user.id,
    });
    await audit(ctx, { action: 'create', resource: 'task', resourceId: tid, sectorId,
      detail: approval.needsApproval ? { approval: 'PENDING', approver: approval.approverUserId } : undefined });
    if (approval.needsApproval) {
      await raiseDirectApproval(ctx, {
        workflowKey: TASK_WORKFLOW_KEY, resource: 'task', resourceId: tid,
        assigneeUserId: approval.approverUserId, sectorId,
        detail: { title, project_id: projectId, opportunity_id: oppId },
      });
      // والخبرُ يصل بلسان الحالة لا بنصٍّ عام: المدير يقرأ **ما** يُعتمد قبل أن يفتح الشاشة.
      await notify(approval.approverUserId, {
        kind: 'approval',
        title: 'مهمة بانتظار اعتمادك',
        body: `${title} — أضافها ${user.name_ar || user.username || 'أحد أفراد إدارتك'}`,
        ref_resource: 'task', ref_id: tid,
      });
    } else if (assignee !== user.id) {
      // مهمةٌ أُسنِدت إلى غير كاتبها وأُضيفت في حينها — كانت تظهر في قائمته صامتةً بلا اسم
      // مُسنِد ولا خبر (KI-038). الخبرُ باسم من أسندها، والمهمةُ نفسها تحمل الاسم في صفّها.
      await notify(assignee, {
        kind: 'task',
        title: 'مهمة جديدة أُسندت إليك',
        body: `${title} — أسندها ${user.name_ar || user.username || 'مديرك'}`,
        ref_resource: 'task', ref_id: tid,
      });
    }
  });
  return await get('SELECT * FROM task WHERE id = ?', [tid]);
}

// ── من يفتح «مهام فريقي»، ومن يكتب فيها ─────────────────────────────────────
// كانت الشاشة كلها مشروطة بمنح **التعديل**: `effectiveScope(user,'update','task')`. والنتيجة
// أن «المدير المباشر» — وكل منحه قراءةٌ بنطاق إدارته (`read task @department`) وليس له منح
// تعديل واحد — يُرَدّ ٤٠٣ على الشاشة الوحيدة التي وُجد الدور من أجلها. الشاشة شاشة قراءة،
// فالبوابة الصحيحة بوابة قراءة.
// الفصل لا الاستبدال: **الرؤية** من منح القراءة على محور تنظيمي (شركة/إدارة/قطاع)، و**الكتابة**
// (إعادة الإسناد، التغيير الجماعي، تغيير الحالة) تبقى على منح التعديل كما هي حرفياً.
// وحتى لا يفقد أحدٌ وصولاً قائماً: من كان منح تعديله يتجاوز «خاصتي» يبقى مؤهِّلاً كما كان —
// فمدير المشروع (منحه كلها بنطاق «مشروع») يدخل بنفس المحور الذي كان يدخل به، والاستشاري
// (تعديله «خاصتي» وقراءته «مشروع») يبقى ممنوعاً كما كان بالضبط. لا توسعة حرف واحد.
const ORG_SCOPES = new Set(['department', 'sector', 'company']);
export function teamTasksAccess(user) {
  const readScope = effectiveScope(user, 'read', 'task');
  const writeScope = effectiveScope(user, 'update', 'task');
  const canWrite = !!writeScope && writeScope !== 'own';
  const scope = ORG_SCOPES.has(readScope) ? readScope : (canWrite ? writeScope : null);
  return { scope, canRead: !!scope, canWrite };
}

// «مهام فريقي» — أول رؤية للمدير لمن يعمل على ماذا. لم تكن موجودة إطلاقاً: كل مستخدم يرى
// مهامه وحده. النطاق يُبنى من الاستعلام نفسه (لا تصفية بعد القراءة) فلا يُقرأ ما لا يُسمح به.
export async function teamTasks(user, filters = {}) {
  // ملاحظة دقيقة: can(...) بلا هدف يعيد «صحيح» لمجرد وجود المنح مهما كان نطاقه — فالموظف
  // العادي (نطاق «خاصتي») كان يمرّ. السؤال هنا نطاقي لا وجودي: هل يتجاوز نطاقه نفسه؟
  const { scope } = teamTasksAccess(user);
  if (!scope) throw forbidden('عرض مهام الفريق يتطلب صلاحية قراءة مهام إدارة أو قطاع — اطلب تفعيلها من مدير النظام');
  // مهام فريقك عملُهم لا دفاترهم: الشخصية محجوبة عن هذه اللوحة مهما اتّسع نطاق قارئها —
  // وهي محجوبة **في الاستعلام** لا بترشيحٍ بعد القراءة، فلا تُقرأ أصلاً ولا تُعدّ في أي رقم.
  // ولوحة المدير تعرض ما اعتُمد وحده: ما ينتظر اعتماده يقرؤه في شاشة «الاعتمادات» فيقرّر،
  // وظهورُه في اللوحتين معاً يجعله يقرأ حِملاً وافق عليه وهو لم يوافق.
  const where = ['t.deleted_at IS NULL', notPersonalSql('t.'), approvedTaskSql('t.')];
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
  // «أهل إدارته» = أهل **كل إدارة يقودها**، لا إدارة انتمائه وحدها. مديرٌ يقود إدارتين كان
  // يفتح هذه اللوحة فيرى نصف فريقه: أهل الإدارة التي يجلس فيها حاضرون، وأهل الإدارة الأخرى
  // — وهو مديرهم — غائبون كأنهم ليسوا في المنصة، فلا يرى تأخّرهم ولا ما يعطّلهم.
  if (scope === 'department') {
    // لا انتماء ولا قيادة ⟵ لوحة فارغة لا لوحة قطاع (فشل آمن).
    const deps = departmentScope(user);
    if (!deps.length) return [];
    const inDeps = departmentInSql('emp.department_id', deps);
    where.push(inDeps.clause);
    params.push(...inDeps.params);
  } else if (scope !== 'company') {
    where.push('(t.sector_id = ? OR u.sector_id = ?)');
    params.push(user.sector_id, user.sector_id);
  }
  const today = String(filters.todayDate || nowIso().slice(0, 10)).slice(0, 10);
  if (filters.overdue) { where.push('t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?'); params.push(today); }
  applyTaskFilters(where, params, filters, today);
  const rows = await all(`SELECT t.*, u.name_ar assignee_name, u.username assignee_username,
       p.name_ar project_name, o.title_ar opportunity_name, d.name_ar department_name,
       COALESCE(uc.name_ar, uc.username) creator_name, COALESCE(ua.name_ar, ua.username) approver_name
     FROM task t
     LEFT JOIN app_user u ON u.id = t.assignee_user_id
     LEFT JOIN employee emp ON emp.id = u.employee_id AND emp.deleted_at IS NULL
     LEFT JOIN project p ON p.id = t.project_id AND p.deleted_at IS NULL
     LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
     LEFT JOIN department d ON d.id = t.department_id AND d.deleted_at IS NULL
     LEFT JOIN app_user uc ON uc.id = t.created_by
     LEFT JOIN app_user ua ON ua.id = t.approved_by
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
  // المهمة الشخصية بابها الملكية وحدها: أوسع منحٍ إداري لا يفتحها، وإلا كان الوعد بالخصوصية
  // وعدَ عرضٍ لا وعدَ نظام. و«غير موجودة» لا «خارج نطاقك»: الثانية تؤكّد أن لفلانٍ مهمةً
  // شخصية بهذا المعرّف — إقرارٌ صغير بما وُعد بألّا يُقال.
  if (isPersonalTask(row) && !isOwn) throw notFound('المهمة غير موجودة');
  // ومهمةٌ تنتظر اعتماداً لا يكتب فيها إلا كاتبها: هي غير مقروءة لغيره في كل قائمة، فلولا هذا
  // الشرط لبقيت مكتوبةً بمعرّفها من تغييرٍ جماعي أو من المساعد — كتابةٌ على ما لا يُرى.
  // وكاتبها يصحّحها قبل أن ينظر فيها مديره، وهذا مقصود: الردّ يُصلَّح لا يُعاد من الصفر.
  if (isPendingTask(row) && row.created_by !== user.id) throw notFound('المهمة غير موجودة');
  if (!isOwn && !can(user, 'update', 'task', row)) throw forbidden();
  // نيّة الطلب في الجهة والنوع تُحسب مرة واحدة **من نفس الدالة التي ستكتبها** — لا قاعدةٌ
  // ثانية تُشتقّ هنا فتتباعد عنها لاحقاً — وتُقرأ قبل بوابة الإسناد لا بعدها.
  const parent = normalizeParent({}, data, row);
  const willBePersonal = 'work_kind' in parent ? parent.work_kind === PERSONAL_WORK_KIND : isPersonalTask(row);
  // ومهمةٌ تبقى شخصية لا تُسنَد إلى غيره: لو مرّت لصار صاحبها الأول لا يقرؤها والثاني يقرأ
  // ما لم يُكتب له. والفحص على **ما ستؤول إليه** لا على ما كانت عليه — فمن يحوّلها إلى عمل
  // ويُسنِدها في الحفظة نفسها مسارٌ مشروع لا يُردّ.
  // وموضعُه قبل بوابة الإسناد العامة مقصود: صاحبُ المهمة الشخصية موظفٌ نطاقُه «خاصتي» غالباً،
  // فبوابة الإسناد ترمي «يتطلب صلاحية إدارية على قطاعه» — جوابٌ صحيح عن سؤال آخر يرسله إلى
  // مدير النظام يطلب منحاً لن يصلح شيئاً. أخصُّ سببٍ أولاً.
  if (willBePersonal && 'assignee_user_id' in data && (data.assignee_user_id || null) !== row.assignee_user_id) {
    throw badRequest('المهمة الشخصية تخصّ صاحبها وحده — لإسنادها إلى زميل اجعلها مهمة عمل أولاً');
  }
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
    'start_date', 'estimate_hours', 'blocked_reason', 'assignee_user_id', 'next_step', 'department_id', 'category']) {
    if (k in data) patch[k] = data[k];
  }
  if ('title' in patch) patch.title = titleOf(patch.title);
  if ('due_date' in patch) patch.due_date = dateOrNull(patch.due_date, 'تاريخ الاستحقاق');
  if ('start_date' in patch) patch.start_date = dateOrNull(patch.start_date, 'تاريخ البدء');
  if ('category' in patch) patch.category = normalizeCategory(patch.category);
  if ('next_step' in patch) patch.next_step = blankToNull(patch.next_step);
  if ('blocked_reason' in patch) patch.blocked_reason = blankToNull(patch.blocked_reason);
  if ('progress_pct' in patch) patch.progress_pct = Math.max(0, Math.min(100, Math.round(Number(patch.progress_pct) || 0)));
  // الجهة والنوع تُكتب **بعد** قائمة الحقول المسموحة لا قبلها: الشخصية تُسقط القطاع والإدارة،
  // فلو سبقتها القائمة لأعادت كتابة الإدارة من الطلب فوقها.
  Object.assign(patch, parent);
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

// ── حذف مهمة: من كتبها يمحوها، ومن فوقه صلاحيةٌ إدارية على قطاعها كذلك ──────────────────────
// حذفٌ ناعم كقاعدة المنصة كلها (notes.js نموذجه): الصف يبقى وتاريخ إخفائه مكتوب، والأثر في
// سجل التدقيق باسم المهمة لا بمعرّفها وحده.
//
// الملكية هنا **كتابةُ المهمة** لا استلامُها: من أُسنِدت إليه مهمةٌ كتبها غيره لا يمحو ما
// كتبه غيره — يُغلقها أو يعيدها لكاتبها. والاستثناء الوحيد المهمة الشخصية: صاحبها هو
// المُسنَد إليه بحكم تعريفها، فبابها الملكية بوجهَيها.
//
// و«غير موجودة» لا «ليست لك» في بابين — نفس قرار updateTask حرفياً وللسبب نفسه:
//   • الشخصية لغير صاحبها: تأكيد وجودها إقرارٌ صغير بما وُعد بألّا يُقال.
//   • والمعلَّقة لغير كاتبها: هي غير مقروءة له في كل قائمة، فلا يُكشف وجودُها من باب الحذف.
//     (ومدير النظام خارج هذا الحجب — يرى كل شيء أصلاً، فحجبُها عنه تمثيلٌ لا حماية.)
export async function deleteTask(ctx, taskId) {
  const user = ctx.user;
  const row = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [taskId]);
  if (!row) throw notFound('المهمة غير موجودة');
  const isOwn = row.created_by === user.id || (isPersonalTask(row) && row.assignee_user_id === user.id);
  if (isPersonalTask(row) && !isOwn) throw notFound('المهمة غير موجودة');
  if (isPendingTask(row) && row.created_by !== user.id && user.role_id !== 'admin') throw notFound('المهمة غير موجودة');
  if (!isOwn && !can(user, 'delete', 'task', row)) {
    throw forbidden('حذف المهمة لمن أنشأها أو لصاحب صلاحية إدارية على قطاعها');
  }
  const now = nowIso();
  // كتابةٌ واحدة لا تتجزأ: مهمةٌ تُمحى ويبقى طلبُ اعتمادها معلَّقاً يُبقي في طابور المدير
  // قراراً على عدم — يعتمد ما حُذف فيُكتب في التدقيق اعتمادُ ما لا وجود له.
  await tx(async () => {
    await update('task', row.id, { deleted_at: now, updated_at: now, updated_by: user.id });
    if (isPendingTask(row)) {
      await run(`UPDATE approval_request SET status = 'CANCELLED', closed_at = ?
        WHERE resource = 'task' AND resource_id = ? AND status = 'PENDING'`, [now, row.id]);
    }
    await audit(ctx, { action: 'delete', resource: 'task', resourceId: row.id,
      sectorId: row.sector_id || null, detail: `حذف مهمة «${row.title}»` });
  });
  return { ok: true };
}

// ───────────────────── حِمل الفريق: من يعمل على ماذا، مرتَّباً بإدارته ─────────────────────
//
// «مهام فريقي» كانت تجيب نصف السؤال: كم مهمة على كل شخص. والنصف الآخر — **ما المشاريع
// والفرص التي يعمل عليها** — لم يكن في الشاشة إطلاقاً (كتلة الفرص محجوزة لعدسة «مهامي»
// وحدها)، فيرى المدير موظفاً بلا مهام ويحسبه فارغاً وهو يقود ثلاث فرص.
//
// والتجميع بالإدارة لا بالقائمة المسطّحة: المدير يدير إدارةً، وأول سؤال في اجتماعه اليومي
// «ما حال هذه الإدارة» لا «من أكثر الناس تأخّراً في الشركة».
//
// النطاق يُبنى داخل الاستعلام (لا تصفية بعد القراءة) بنفس قاعدة teamTasks حرفياً — مصدر
// واحد للقرار فلا تتباعد الشاشتان.
export async function teamWorkload(user, filters = {}) {
  const { scope } = teamTasksAccess(user);
  if (!scope) throw forbidden('عرض عمل الفريق يتطلب صلاحية قراءة مهام إدارة أو قطاع — اطلب تفعيلها من مدير النظام');
  const year = Number(filters.year) || new Date().getUTCFullYear();
  const today = String(filters.todayDate || nowIso().slice(0, 10)).slice(0, 10);

  // الأشخاص أولاً: الحسابات النشطة داخل النطاق، ومعها إدارتها من سجل الموظف (الجسر
  // app_user.employee_id ⟵ employee.department_id — الإدارة تسكن الموظف لا الحساب).
  const pWhere = ['u.deleted_at IS NULL', 'u.active = 1'];
  const pParams = [];
  // مجموعة إداراته لا إدارته: التجميع أدناه يفرز الناس إلى إداراتهم، فمن يقود اثنتين يقرأ
  // لوحتين متجاورتين في شاشة واحدة — وهو ما يقوله مسمّاه الوظيفي أصلاً. وكان يقرأ واحدة.
  if (scope === 'department') {
    const deps = departmentScope(user);
    if (!deps.length) return { departments: [], scope, year, orphans: { unassigned: 0, inactive: 0, overdue: 0, total: 0, people: [] } };
    const inDeps = departmentInSql('emp.department_id', deps);
    pWhere.push(inDeps.clause);
    pParams.push(...inDeps.params);
  } else if (scope !== 'company') {
    pWhere.push('u.sector_id = ?');
    pParams.push(user.sector_id);
  }
  const people = await all(`SELECT u.id, u.name_ar, u.username, u.role_id, u.sector_id,
       emp.id employee_id, emp.job_title, emp.department_id, d.name_ar department_name
     FROM app_user u
     LEFT JOIN employee emp ON emp.id = u.employee_id AND emp.deleted_at IS NULL
     LEFT JOIN department d ON d.id = emp.department_id AND d.deleted_at IS NULL
     WHERE ${pWhere.join(' AND ')}
     ORDER BY d.name_ar, u.name_ar
     LIMIT 400`, pParams);
  if (!people.length) return { departments: [], scope, year, orphans: { unassigned: 0, inactive: 0, overdue: 0, total: 0, people: [] } };

  const userIds = people.map((p) => p.id);
  const empIds = people.map((p) => p.employee_id).filter(Boolean);
  const marks = (n) => new Array(n).fill('?').join(',');

  // مهام مفتوحة لكل شخص — عدٌّ في القاعدة لا تحميلُ صفوف ثم عدّها في الذاكرة.
  // والشخصية خارج العدّ أيضاً — وإلا لقال الرقمُ عن الرجل ما لا يستطيع المدير رؤيته ولا سؤاله
  // عنه: «عليه سبع مهام» وفي اللوحة أربع. رقمٌ لا يُفتح مصدره أسوأ من لا رقم.
  const taskRows = await all(`SELECT t.assignee_user_id uid,
       COUNT(*) total,
       SUM(CASE WHEN t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ? THEN 1 ELSE 0 END) overdue,
       SUM(CASE WHEN t.status = 'BLOCKED' OR (t.blocked_reason IS NOT NULL AND t.blocked_reason <> '') THEN 1 ELSE 0 END) blocked,
       SUM(CASE WHEN t.next_step IS NULL OR t.next_step = '' THEN 1 ELSE 0 END) no_step
     FROM task t
     WHERE t.deleted_at IS NULL AND t.status NOT IN ('DONE','CANCELLED')
       AND ${notPersonalSql('t.')} AND ${approvedTaskSql('t.')}
       AND t.assignee_user_id IN (${marks(userIds.length)})
     GROUP BY t.assignee_user_id`, [today, ...userIds]);

  // ── وأسماء المهام، لا عددها وحده ────────────────────────────────────────────
  // «في مهامي لما يطلع مثلاً سجى عندها مهمة، أنا كمدير مو عارف ولا باين» — بلسان المالك.
  // وكانت المهام **الشيء الوحيد** على بطاقة الشخص يُعرض رقماً مجرَّداً: المشاريع بأسمائها،
  // والفرص بأسمائها (بطلب المالك نفسه قبل أسابيع)، والمهام «١». فيقرأ المدير رقماً لا يقول
  // على ماذا يعمل الرجل ولا ما الذي يعطّله، ولا سبيل إلى معرفته إلا بترك اللوحة كلها.
  // والترتيب بالإلحاح لا بالأبجدية: ما يُقصّ حين لا تسع البطاقة هو الأقلّ إلحاحاً لا الأهمّ.
  const taskNameRows = await all(`SELECT t.assignee_user_id uid, t.id, t.title, t.due_date, t.status,
       t.blocked_reason, t.next_step
     FROM task t
     WHERE t.deleted_at IS NULL AND t.status NOT IN ('DONE','CANCELLED')
       AND ${notPersonalSql('t.')} AND ${approvedTaskSql('t.')}
       AND t.assignee_user_id IN (${marks(userIds.length)})
     ORDER BY ${prioritySql('t')}, t.due_date
     LIMIT 400`, userIds);
  const byUidTN = new Map();
  for (const r of taskNameRows) {
    if (!byUidTN.has(r.uid)) byUidTN.set(r.uid, []);
    byUidTN.get(r.uid).push({
      id: r.id, title: r.title,
      late: !!(r.due_date && String(r.due_date).slice(0, 10) < today),
      blocked: r.status === 'BLOCKED' || !!String(r.blocked_reason || '').trim(),
    });
  }

  // الفرص المفتوحة التي يملكها كل شخص — المرحلة تحدّد «مفتوحة» (لا فوز ولا خسارة).
  // ونطاق القارئ يقصّ الصفوف: منذ v5.2 لا يقرأ أحدٌ على لوحة الفريق صفقات زملاءٍ
  // لا تصله من قائمة الفرص نفسها — مصدرُ حقيقةٍ واحد لا بابٌ خلفي.
  const readerOppScope = scopeFilter(user, 'opportunity', 'read', {
    sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id',
    deptCol: 'o.department_id', grantCol: 'o.department_id', memberCol: 'o.id',
  });
  const oppRows = await all(`SELECT o.owner_user_id uid, COUNT(*) total,
       SUM(COALESCE(o.value_halalas,0)) value_halalas
     FROM opportunity o
     LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND COALESCE(s.is_won,0) = 0 AND COALESCE(s.is_lost,0) = 0
       AND o.owner_user_id IN (${marks(userIds.length)})
       AND (${readerOppScope.clause})
     GROUP BY o.owner_user_id`, [...userIds, ...readerOppScope.params]);

  // وأسماؤها — بطلب المالك حرفياً: «مو المبالغ اللي شغال عليها من فرص انما اسماء الفرص».
  // «فرصتان بمليون ونصف» تقول حجماً ولا تقول **على ماذا** يعمل الرجل، والمدير يسأل الثاني.
  // الترتيب بالقيمة تنازلياً كي تُقصَّ الأصغر لا الأهمّ حين يتجاوز العدد ما تسعه البطاقة.
  const oppNameRows = await all(`SELECT o.owner_user_id uid, o.id, o.title_ar
     FROM opportunity o
     LEFT JOIN stage s ON s.id = o.stage_id
     WHERE o.deleted_at IS NULL AND COALESCE(s.is_won,0) = 0 AND COALESCE(s.is_lost,0) = 0
       AND o.owner_user_id IN (${marks(userIds.length)})
       AND (${readerOppScope.clause})
     ORDER BY o.value_halalas DESC, o.title_ar
     LIMIT 400`, [...userIds, ...readerOppScope.params]);
  const byUidON = new Map();
  for (const r of oppNameRows) {
    if (!byUidON.has(r.uid)) byUidON.set(r.uid, []);
    byUidON.get(r.uid).push({ id: r.id, name: r.title_ar });
  }

  // المشاريع المسكَّن عليها هذا العام — بالاسم لا بالعدد وحده: المدير يريد أن يعرف أين هو.
  // ونطاقُ القارئ يقصّ الصفوف كما يقصّ الفرص أعلاه (v5.9): مدير الإدارة يرى أسماء مشاريع إدارته
  // + أيتام قطاعه لا القطاع كله — فمشروعُ إدارةٍ أخرى يعمل عليه أحد رجاله لا يُطبع اسمُه.
  const readerProjectScope = scopeFilter(user, 'project', 'read', {
    deptCol: 'p.department_id', sectorCol: 'p.sector_id', ownerCol: 'p.owner_user_id', projectCol: 'p.id',
  });
  const projRows = empIds.length ? await all(`SELECT a.employee_id eid, p.id project_id, p.name_ar project_name
     FROM allocation a
     JOIN project p ON p.id = a.project_id AND p.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.year = ? AND a.employee_id IN (${marks(empIds.length)})
       AND ${readerProjectScope.clause}
     GROUP BY a.employee_id, p.id, p.name_ar
     ORDER BY p.name_ar`, [year, ...empIds, ...readerProjectScope.params]) : [];

  const byUidT = new Map(taskRows.map((r) => [r.uid, r]));
  const byUidO = new Map(oppRows.map((r) => [r.uid, r]));
  const byEidP = new Map();
  for (const r of projRows) {
    if (!byEidP.has(r.eid)) byEidP.set(r.eid, []);
    byEidP.get(r.eid).push({ id: r.project_id, name: r.project_name });
  }

  const NO_DEP = '—';
  const groups = new Map();
  for (const p of people) {
    const t = byUidT.get(p.id) || {};
    const o = byUidO.get(p.id) || {};
    const projects = byEidP.get(p.employee_id) || [];
    const person = {
      userId: p.id,
      name: p.name_ar || p.username,
      jobTitle: p.job_title || null,
      roleId: p.role_id,
      linked: !!p.employee_id,      // حسابٌ غير مربوط بموظف لا تُعرف إدارته ولا تسكينه
      tasks: {
        open: Number(t.total || 0), overdue: Number(t.overdue || 0),
        blocked: Number(t.blocked || 0), noStep: Number(t.no_step || 0),
        list: byUidTN.get(p.id) || [],
      },
      opportunities: {
        open: Number(o.total || 0), valueHalalas: Number(o.value_halalas || 0),
        list: byUidON.get(p.id) || [],
      },
      projects,
    };
    // «فارغ» ليس صفر مهام: قد يقود فرصاً أو يكون مسكَّناً على مشاريع. الخلوّ الحقيقي أن
    // لا شيء من الثلاثة — وهذا ما يستحق نظر المدير، لا عدد المهام وحده.
    person.idle = !person.tasks.open && !person.opportunities.open && !projects.length;
    person.attention = person.tasks.overdue + person.tasks.blocked;

    const key = p.department_id || NO_DEP;
    if (!groups.has(key)) {
      groups.set(key, {
        id: p.department_id || null,
        name: p.department_name || (p.department_id ? 'إدارة غير معروفة' : 'بلا إدارة'),
        people: [], attention: 0, tasks: 0, opps: 0, idle: 0,
      });
    }
    const g = groups.get(key);
    g.people.push(person);
    g.attention += person.attention;
    g.tasks += person.tasks.open;
    g.opps += person.opportunities.open;
    if (person.idle) g.idle++;
  }

  // ── عملٌ بلا صاحب ──
  // اللوحة تُبنى من **الأشخاص**، فما لا شخص له لا يظهر فيها إطلاقاً. وهذه حالتان تقعان فعلاً:
  //   • مهمةٌ بلا مُسنَد إليه — أُنشئت ولم تُسنَد قط.
  //   • مهمةٌ على حسابٍ **معطَّل** — الموظف غادر ولم يغادر عمله معه.
  // كلتاهما كانت تختفي من اللوحة بينما تظهر في القائمة تحتها في الشاشة نفسها: قِيس على بيانات
  // مصنوعة فظهرت اللوحة «شخصٌ واحد عليه مهمة» والقائمة ثلاث مهام، اثنتان منها متأخرتان بأعلى
  // أولوية. وهذا أسوأ اتجاه للخطأ: **أشدّ العمل إلحاحاً هو أقلّه ظهوراً**، ومديرٌ يقيّم فريقه
  // على لوحةٍ تُخفي العمل المهمَل يقيّم على نصف الصورة.
  //
  // ولا تُعرَض كأشخاص وهميين: هي حالةُ إسنادٍ ناقصة يعالجها المدير بإعادة إسناد، لا شخصٌ يُقيَّم.
  // ونطاقها من عمود المهمة نفسها (قطاعها/إدارتها) لأن المهمة بلا صاحبٍ لا وصلة لها بشخص.
  // والشخصية ليست «عملاً بلا صاحب» ولو غادر صاحبها: هي دفترُه، ولا يُعاد إسناد دفتر أحد.
  // والمعلَّقة ليست «عملاً بلا صاحب» بل عملاً لم يُضَف: صاحبها معروف ومديره ينظر فيها الآن.
  const oWhere = ["t.deleted_at IS NULL", "t.status NOT IN ('DONE','CANCELLED')", notPersonalSql('t.'), approvedTaskSql('t.'),
    '(t.assignee_user_id IS NULL OR au.id IS NULL OR au.active = 0 OR au.deleted_at IS NOT NULL)'];
  const oParams = [];
  // والعمل المهمَل يتبع المجموعة نفسها: لو قُصّ على إدارة الانتماء وحدها لبقيت مهام الإدارة
  // الثانية بلا صاحبٍ **وبلا من يراها** — وهي أشدّ ما يحتاج نظر مديرها.
  if (scope === 'department') {
    const inDeps = departmentInSql('t.department_id', departmentScope(user));
    oWhere.push(inDeps.clause);
    oParams.push(...inDeps.params);
  } else if (scope !== 'company') { oWhere.push('t.sector_id = ?'); oParams.push(user.sector_id); }
  const orphanRows = await all(`SELECT t.id, t.assignee_user_id uid, t.due_date, t.status,
       au.name_ar owner_name, au.username owner_username, au.active owner_active
     FROM task t
     LEFT JOIN app_user au ON au.id = t.assignee_user_id
     WHERE ${oWhere.join(' AND ')}
     LIMIT 300`, oParams);
  const orphans = { unassigned: 0, inactive: 0, overdue: 0, total: orphanRows.length, people: [] };
  const inactiveBy = new Map();
  for (const r of orphanRows) {
    if (!r.uid) orphans.unassigned++;
    else {
      orphans.inactive++;
      const nm = r.owner_name || r.owner_username || 'حساب محذوف';
      inactiveBy.set(nm, (inactiveBy.get(nm) || 0) + 1);
    }
    if (r.due_date && String(r.due_date).slice(0, 10) < today) orphans.overdue++;
  }
  orphans.people = [...inactiveBy.entries()].map(([name, n]) => ({ name, open: n }))
    .sort((a, b) => b.open - a.open);

  // الأكثر احتياجاً للنظر أولاً — داخل الإدارة وبين الإدارات. و«بلا إدارة» في القاع دائماً
  // لأنها ليست إدارةً بل نقصٌ في الإسناد.
  const departments = [...groups.values()].sort((a, b) => {
    if (!a.id !== !b.id) return a.id ? -1 : 1;
    return (b.attention - a.attention) || (b.tasks - a.tasks) || String(a.name).localeCompare(String(b.name), 'ar');
  });
  for (const d of departments) {
    d.people.sort((a, b) => (b.attention - a.attention) || (b.tasks.open - a.tasks.open)
      || String(a.name).localeCompare(String(b.name), 'ar'));
  }
  return { departments, scope, year, orphans };
}

// ═══ ملف الشخص ═══════════════════════════════════════════════════════════════════════════════
// «ما اقدر اشوف او اضغط على الموظف يطلعلي تفاصيله وصفحته» — بلسان المالك. كانت لوحة الفريق
// تعرض الأسماء وتربطها بمُرشِّحٍ يعيد لوحة المهام مرشَّحة، لا بصفحةٍ للشخص. فسؤال المدير
// «ما الذي يعمل عليه فلان» يُجاب برقمٍ لا بصورة، والاسم يبدو قابلاً للنقر ولا يفتح شيئاً.
//
// البوابة نفسها بوابة لوحة الفريق حرفياً (teamTasksAccess) — لا بوابة موازية تتباعد عنها —
// **زائداً** أن كل أحد يفتح ملفه هو. ولا يُقرأ من هو خارج النطاق: الرفض قبل أي استعلام بيانات.
export async function personDossier(reader, personUserId) {
  const uid = String(personUserId || '').trim();
  if (!uid) throw notFound('لا يوجد شخص بهذا الرابط');
  const self = uid === reader.id;
  const { scope, canWrite } = teamTasksAccess(reader);
  if (!self && !scope) throw forbidden('عرض ملف شخصٍ آخر يتطلب صلاحية قراءة مهام إدارة أو قطاع — اطلب تفعيلها من مدير النظام');

  const p = await get(`SELECT u.id, u.username, u.name_ar, u.role_id, u.sector_id, u.active, u.last_login_at,
       emp.id employee_id, emp.job_title, emp.department_id, emp.sector_id emp_sector_id,
       d.name_ar department_name, s.name_ar sector_name
     FROM app_user u
     LEFT JOIN employee emp ON emp.id = u.employee_id AND emp.deleted_at IS NULL
     LEFT JOIN department d ON d.id = emp.department_id AND d.deleted_at IS NULL
     LEFT JOIN sector s ON s.id = COALESCE(emp.sector_id, u.sector_id) AND s.deleted_at IS NULL
     WHERE u.id = ? AND u.deleted_at IS NULL`, [uid]);
  if (!p) throw notFound('لا يوجد شخص بهذا الرابط — قد يكون حسابه حُذف');

  // النطاق يُطبَّق على **الشخص** قبل قراءة عمله: من هو خارج إداراتي أو قطاعي لا يُفتح ملفه.
  // و«إداراتي» جمعٌ لا مفرد: كانت المقارنة مساواةً بإدارة الانتماء، فمديرٌ يقود إدارتين يضغط
  // على اسم موظفٍ يقوده في الإدارة الأخرى فيُقال له «هذا الشخص خارج إدارتك» — رسالةٌ صحيحة
  // الصياغة كاذبة المعنى، وهي الشكوى التي رفعها المالك بعينها.
  // وقارئٌ بنطاق «إدارة» بلا انتماءٍ ولا قيادة لا يرى أحداً — فشلٌ آمن.
  if (!self) {
    if (scope === 'department') {
      if (!inDepartmentScope(reader, p.department_id)) {
        throw forbidden('هذا الشخص خارج إدارتك — لا يُفتح ملفه من حسابك');
      }
    } else if (scope !== 'company' && p.sector_id !== reader.sector_id) {
      throw forbidden('هذا الشخص خارج قطاعك — لا يُفتح ملفه من حسابك');
    }
  }

  const today = nowIso().slice(0, 10);
  const year = new Date().getUTCFullYear();
  // ملفُ المرء يعرض دفتره له، ويعرض عملَه لمديره. فالشرط على **من يقرأ** لا على من يُقرأ:
  // صاحب الصفحة يرى مهامه الشخصية بين مهامه (هي على طاولته فعلاً)، ومن يفتح ملف غيره لا
  // يراها ولا تدخل عدّاداته. لو حُذف هذا السطر لصارت أسهلَ طريقٍ لقراءة دفتر أي زميل:
  // رابطٌ واحد باسمه.
  const tasks = await all(`SELECT t.id, t.title, t.status, t.priority, t.due_date, t.next_step,
       t.blocked_reason, t.progress_pct, t.completed_at,
       p2.id project_id, p2.name_ar project_name, o.id opportunity_id, o.title_ar opportunity_name,
       d.name_ar department_name
     FROM task t
     LEFT JOIN project p2 ON p2.id = t.project_id AND p2.deleted_at IS NULL
     LEFT JOIN opportunity o ON o.id = t.opportunity_id AND o.deleted_at IS NULL
     LEFT JOIN department d ON d.id = t.department_id AND d.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.assignee_user_id = ? AND t.status <> 'CANCELLED'
       AND ${approvedTaskSql('t.')}
       ${self ? '' : `AND ${notPersonalSql('t.')}`}
     ORDER BY ${prioritySql('t')}, t.due_date
     LIMIT 200`, [uid]);

  // الفرص بأسمائها لا بعددها: «٣ فرص» لا تقول للمدير أيّها متوقفة ولا أيّها الأكبر.
  //
  // ── ملكيةً **وتسكيناً** ──────────────────────────────────────────────────────
  // كان الشرط `owner_user_id` وحده، فمن سُكِّن على فرصةٍ يقودها غيره يُقرأ في ملفه «لا فرص».
  // وهذا يُبطل نصف ما بُني قبله بأسبوع: «ممكن في فرصة ناس من تطوير الأعمال وناس من إدارات
  // مختلفة تشتغل عليها» — فصار التسكين عبر الإدارات ممكناً، ثم لا يظهر في الشاشة التي بُنيت
  // للسؤال «هذا الشخص شغال على ماذا». والفجوة تتّسع مع كل تسكين جديد، وهي أشدّ ما تُخفيه على
  // من يعمل على فرص غيره لا على فرصه — أي على فريق التسليم بالضبط.
  //
  // والصلة تُقال لا تُخمَّن: «صاحبها» غير «مسكَّن عليها» في قراءة المدير، والفرقُ قرارٌ لا زينة.
  // والتسكين غير المؤكَّد (`PENDING`) يظهر **معلَّماً** ولا يُحتسب في العدّ: إخفاؤه يجعل صاحبه
  // يسأل «أين الفرصة التي أُضفتُ إليها»، وحسابُه يجعل الرقم يعد عملاً لم يؤكّده مديره بعد.
  const oppParams = [uid];
  let mineClause = 'o.owner_user_id = ?';
  if (p.employee_id) {
    mineClause += ` OR EXISTS (SELECT 1 FROM membership m
       WHERE m.group_kind = 'opportunity' AND m.group_id = o.id
         AND m.employee_id = ? AND m.deleted_at IS NULL)`;
    oppParams.push(p.employee_id);
  }
  // نطاق القارئ يقصّ صفوف الفرص هنا أيضاً (v5.2): ملفُّ الشخص يجيب «على ماذا يعمل»
  // لمن يحقّ له قراءةُ تلك الفرص أصلاً — المدير وقائدُ القطاع يريان، والزميلُ ذو
  // النطاق الذاتي لا يقرأ صفقات غيره بقيمها من بابٍ خلفي. وصاحبُ الصفحة يرى صفوفه
  // دوماً: بند «مالكها» وبند «مسكَّن عليها» كلاهما ضمن نطاقه.
  const dossierOppScope = scopeFilter(reader, 'opportunity', 'read', {
    sectorCol: 'o.sector_id', ownerCol: 'o.owner_user_id',
    deptCol: 'o.department_id', grantCol: 'o.department_id', memberCol: 'o.id',
  });
  const oppRows = await all(`SELECT o.id, o.title_ar, o.value_halalas, o.next_action, o.owner_user_id,
       st.name_ar stage_name, st.is_won, st.is_lost, c.name_ar client_name
     FROM opportunity o
     LEFT JOIN stage st ON st.id = o.stage_id
     LEFT JOIN client c ON c.id = o.client_id AND c.deleted_at IS NULL
     WHERE o.deleted_at IS NULL AND (${mineClause}) AND (${dossierOppScope.clause})
     ORDER BY COALESCE(st.is_won,0) + COALESCE(st.is_lost,0), o.value_halalas DESC
     LIMIT 60`, [...oppParams, ...dossierOppScope.params]);
  // حالة التسكين تُقرأ مرةً واحدة بمفتاح الموظف ثم تُوزَّع — لا استعلام لكل صف.
  const memberOf = new Map();
  if (p.employee_id) {
    for (const m of await all(`SELECT group_id, COALESCE(status,'ACTIVE') status, role_in_group
         FROM membership
        WHERE group_kind = 'opportunity' AND employee_id = ? AND deleted_at IS NULL`, [p.employee_id])) {
      memberOf.set(m.group_id, m);
    }
  }
  const opportunities = oppRows.map((o) => {
    const m = memberOf.get(o.id) || null;
    return { ...o,
      relation: o.owner_user_id === uid ? 'owner' : 'member',
      role_in_group: m?.role_in_group || null,
      pending: !!m && m.status === 'PENDING' && o.owner_user_id !== uid };
  });

  // مشاريعُ الشخص المسكَّن عليها تُقصّ على نطاق **القارئ** كما تُقصّ فرصُه أعلاه (v5.9): مديرُ
  // إدارةٍ يفتح ملف موظفه يرى مشاريع إدارته + أيتام قطاعه لا مشاريع إدارةٍ أخرى يعمل فيها الرجل.
  // وصاحبُ الصفحة يرى صفوفه دوماً — ما سُكِّن عليه داخلٌ في نطاقه (projectIds) بحكم التسكين.
  const dossierProjectScope = scopeFilter(reader, 'project', 'read', {
    deptCol: 'p3.department_id', sectorCol: 'p3.sector_id', ownerCol: 'p3.owner_user_id', projectCol: 'p3.id',
  });
  const projects = p.employee_id ? await all(`SELECT p3.id, p3.name_ar, p3.status, a.type, a.year
     FROM allocation a
     JOIN project p3 ON p3.id = a.project_id AND p3.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.employee_id = ? AND a.year = ?
       AND ${dossierProjectScope.clause}
     GROUP BY p3.id, p3.name_ar, p3.status, a.type, a.year
     ORDER BY p3.name_ar
     LIMIT 60`, [p.employee_id, year, ...dossierProjectScope.params]) : [];

  const open = tasks.filter((t) => t.status !== 'DONE');
  const stats = {
    open: open.length,
    overdue: open.filter((t) => t.due_date && String(t.due_date).slice(0, 10) < today).length,
    blocked: open.filter((t) => t.status === 'BLOCKED' || String(t.blocked_reason || '').trim()).length,
    noStep: open.filter((t) => !String(t.next_step || '').trim()).length,
    done: tasks.length - open.length,
    // العدّ للمؤكَّد وحده — تسكينٌ ينتظر تأكيد المدير ليس عملاً قائماً بعد، وإدراجه في الرقم
    // يجعل المدير يقرأ حِملاً لم يوافق عليه. والصفّ نفسه معروضٌ في القائمة معلَّماً.
    openOpportunities: opportunities.filter((o) => !o.is_won && !o.is_lost && !o.pending).length,
    projects: projects.length,
  };
  // ── ما يستطيع القارئ أن **يفعله** بهذا الشخص ────────────────────────────────
  // «لو أبغى أسكّن الموظف، لما أدخل عليه من صفحة الفريق أشوف الفرص تبعه وتسكينه، وأقدر أضيف أو
  // أسوّي أي أكشن أنا كمدير للموظف لما أضغط عليه — حتى في إضافة المهام» — بلسان المالك.
  // فالصفحة لم تعد قراءةً خالصة: صارت لوحةَ المدير على شخصٍ واحد. وكل فعلٍ فيها يمرّ بخدمته
  // وحارسها كما لو نُفِّذ من شاشته الأصلية — لا مسار مختصر، ولا فحص صلاحيةٍ مكرَّر هنا.
  //
  // والقدرات تُحسَب في الخدمة لا في الشاشة: الشاشة تعرض ما يُقبَل فعلاً، فلا زرّ يُضغَط ليُرَدّ.
  const isSelf = self;
  const canAssignTask = !isSelf && !!canWrite && can(reader, 'create', 'task');
  const canStaff = !isSelf && can(reader, 'create', 'allocation');
  // منتقي التسكين يُقصّ على نطاق قراءة القارئ للمشاريع (v5.9) قبل فحص منح التسكين على كل صفّ:
  // مدير الإدارة يسكّن على مشاريع إدارته + أيتام قطاعه لا القطاع كله. الحدّان معاً — لا أحدهما.
  const staffProjScope = scopeFilter(reader, 'project', 'read',
    { deptCol: 'department_id', sectorCol: 'sector_id', ownerCol: 'owner_user_id' });
  const staffProjWhere = ["deleted_at IS NULL", "status IN ('IN_PROGRESS','PLANNED')"];
  const staffProjParams = [];
  if (staffProjScope.clause !== '1=1') { staffProjWhere.push(staffProjScope.clause); staffProjParams.push(...staffProjScope.params); }
  const staffProjects = canStaff && p.employee_id
    ? (await all(`SELECT id, name_ar, sector_id, department_id FROM project
         WHERE ${staffProjWhere.join(' AND ')} ORDER BY name_ar LIMIT 200`, staffProjParams))
      .filter((pr) => can(reader, 'create', 'allocation', pr))
    : [];
  // الصلاحيات الشخصية: تُعرض لمن يرى الكشف، وتُمنَح لمن يملك ما يمنحه (الحدّ في grants.js).
  let grants = []; let grantOptions = [];
  try { grants = await listUserGrants(reader, uid); } catch { grants = []; }
  if (!isSelf) { try { grantOptions = await grantableDepartments(reader); } catch { grantOptions = []; } }

  return {
    self,
    canWrite: !!canWrite || self,
    canAssignTask,
    canStaff: canStaff && !!p.employee_id && staffProjects.length > 0,
    staffProjects,
    grants,
    grantOptions,
    employeeId: p.employee_id || null,
    person: {
      userId: p.id, name: p.name_ar || p.username || 'حساب بلا اسم', username: p.username,
      jobTitle: p.job_title || null, roleId: p.role_id, active: Number(p.active) === 1,
      linked: !!p.employee_id, departmentName: p.department_name || null,
      sectorName: p.sector_name || null, lastLoginAt: p.last_login_at || null,
    },
    tasks, opportunities, projects, stats, today, year,
  };
}
