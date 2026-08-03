// Timesheets — time entries with validation, live timer, submit/approve.
import { all, get, insert, update, run } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';
import { isPersonalTask } from '../pmo/tasks.js';

const MAX_HOURS_PER_DAY = 16;

export async function myEntries(user, { from, to } = {}) {
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  const params = [user.id];
  if (from) { where.push('entry_date >= ?'); params.push(from); }
  if (to) { where.push('entry_date <= ?'); params.push(to); }
  return await all(`SELECT * FROM time_entry WHERE ${where.join(' AND ')} ORDER BY entry_date DESC, created_at DESC`, params);
}

// تسجيل ساعات. كان بلا أي فحص صلاحية: القاعدة القديمة «كل مستخدم مسجَّل يملك وقته» كُتبت حين
// كان كل مستخدم موظفاً، وحساب البوابة الخارجية (عميل، لا موظف) كسر الافتراض — كان يسجّل ساعاته
// في دفاتر الشركة ويدخل بها تقارير الإشغال.
// الفحص يحمل هدفاً: `{ user_id }` — القيد يُكتب باسم صاحبه، ونطاق «خاصتي» لا يُقاس إلا على هدف.
// (فحصٌ بلا هدف يمرّ لمجرد وجود المنح مهما كان نطاقه — core/rbac/index.js).
// الترتيب مقصود: التحقّق من المدخلات أولاً (حساب صرف بلا أي قراءة من القاعدة)، ثم الصلاحية
// **قبل** أي قراءة أو كتابة — كما في «مهامي» (quickAddTask)، فالبابان يشتركان في القاعدة نفسها.
export async function addEntry(ctx, data) {
  const user = ctx.user;
  const hours = Number(data.hours);
  if (!(hours > 0) || hours > MAX_HOURS_PER_DAY) throw badRequest(`الساعات يجب أن تكون بين 0 و${MAX_HOURS_PER_DAY}`);
  if (!data.entry_date) throw badRequest('التاريخ مطلوب');
  // التاريخ عمود يُقارَن بمدى (الفترة، الإشغال، سقف اليوم) — نصٌّ حرّ فيه يكسر الحساب بصمت،
  // ويُطبع كما هو في جدول «سجل الوقت».
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.entry_date))) throw badRequest('اكتب التاريخ بصيغة سنة-شهر-يوم');
  if (!can(user, 'create', 'timesheet', { user_id: user.id }))
    throw forbidden('تسجيل الوقت غير متاح لحسابك. راجع مدير النظام إن كان عملك يتطلب تسجيل ساعات.');
  // الساعات تُرحَّل إلى المهمة — وهي كتابة على صفّ قد يكون لمشروع أو قطاع آخر. كانت تُنفَّذ على
  // أي معرّف مهمة يُرسَل بلا فحص: أي مستخدم يرفع «الساعات الفعلية» لأي مهمة في الشركة.
  let task = null;
  if (data.task_id) {
    task = await get('SELECT id, project_id, sector_id, work_kind, assignee_user_id, created_by FROM task WHERE id = ? AND deleted_at IS NULL',
      [data.task_id]);
    if (!task) throw notFound('المهمة غير موجودة');
    // ومهمة غيره الشخصية ليست «خارج عمله» بل خارج وجوده: `can` الإدارية تفتحها وهي دفتر صاحبها.
    // الأثر هنا كتابةٌ على صفّها (الساعات الفعلية) لا قراءةٌ منه، لكنه يخرق التعهّد نفسه —
    // ونفس صياغة `updateTask`: «غير موجودة» لا «خارج عملك»، فالثانية تُقرّ بوجودها.
    if (isPersonalTask(task) && task.assignee_user_id !== user.id && task.created_by !== user.id) {
      throw notFound('المهمة غير موجودة');
    }
    if (!can(user, 'update', 'task', task)) throw forbidden('لا يمكنك تسجيل وقت على مهمة خارج عملك');
  }
  // prevent unrealistic daily total
  const dayTotal = (await get('SELECT COALESCE(SUM(hours),0) t FROM time_entry WHERE user_id = ? AND entry_date = ? AND deleted_at IS NULL',
    [user.id, data.entry_date])).t;
  if (dayTotal + hours > MAX_HOURS_PER_DAY) throw badRequest(`إجمالي ساعات اليوم سيتجاوز ${MAX_HOURS_PER_DAY}`);
  const eid = id('te'); const now = nowIso();
  await insert('time_entry', {
    id: eid, user_id: user.id, task_id: data.task_id || null, project_id: data.project_id || null,
    opportunity_id: data.opportunity_id || null, work_kind: data.work_kind || 'project',
    entry_date: data.entry_date, hours, billable: data.billable === false ? 0 : 1, note: data.note || null,
    created_at: now,
  });
  // roll up actual hours to the task (only after the row-level check above passed)
  if (task) await run('UPDATE task SET actual_hours = COALESCE(actual_hours,0) + ? WHERE id = ?', [hours, task.id]);
  await audit(ctx, { action: 'create', resource: 'timesheet', resourceId: eid });
  return await get('SELECT * FROM time_entry WHERE id = ?', [eid]);
}

export async function submitPeriod(ctx, { periodStart, periodEnd }) {
  const user = ctx.user;
  if (!periodStart || !periodEnd) throw badRequest('حدود الفترة مطلوبة');
  // نفس بوابة تسجيل الساعات: من لا يملك ساعات في المنصة لا يفتح فترةً ولا يرفعها للاعتماد.
  if (!can(user, 'create', 'timesheet', { user_id: user.id }))
    throw forbidden('تقديم سجل الوقت غير متاح لحسابك. راجع مدير النظام إن كان عملك يتطلب تسجيل ساعات.');
  const pid = id('tsp'); const now = nowIso();
  await insert('timesheet_period', {
    id: pid, user_id: user.id, period_start: periodStart, period_end: periodEnd,
    status: 'SUBMITTED', submitted_at: now, created_at: now,
  });
  await run('UPDATE time_entry SET period_id = ? WHERE user_id = ? AND entry_date BETWEEN ? AND ? AND period_id IS NULL',
    [pid, user.id, periodStart, periodEnd]);
  await audit(ctx, { action: 'update', resource: 'timesheet', resourceId: pid, detail: { event: 'submit' } });
  return await get('SELECT * FROM timesheet_period WHERE id = ?', [pid]);
}

export async function approvePeriod(ctx, periodId, approve = true) {
  const user = ctx.user;
  const period = await get('SELECT * FROM timesheet_period WHERE id = ?', [periodId]);
  if (!period) throw notFound('الفترة غير موجودة');
  // department_id lives on `employee`, not `app_user` — join it so department_manager's scope
  // check is actually evaluated instead of vacuously passing (see core/rbac/index.js scopeReaches).
  const target = await get(
    'SELECT u.sector_id, e.department_id FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id WHERE u.id = ?',
    [period.user_id]
  ) || {};
  if (!can(user, 'approve', 'timesheet', { sector_id: target.sector_id, department_id: target.department_id, user_id: period.user_id })) throw forbidden();
  await update('timesheet_period', periodId, {
    status: approve ? 'APPROVED' : 'REJECTED', approved_by: user.id, approved_at: nowIso(),
  });
  await audit(ctx, { action: 'approve', resource: 'timesheet', resourceId: periodId, detail: { approve } });
  return await get('SELECT * FROM timesheet_period WHERE id = ?', [periodId]);
}

// Utilization for a user over a date range (billable / total).
export async function utilization(user, targetUserId, { from, to }) {
  if (targetUserId !== user.id) {
    // الهدف يحمل قطاع الموظف وإدارته لا معرّفه وحده: بمعرّف وحده يمرّ نطاق «الإدارة» و«القطاع»
    // فارغاً على أي موظف في الشركة (core/rbac/index.js: هدف بلا قطاع ولا إدارة لا يُنفى) —
    // نفس عطل اعتماد الفترة أعلاه، والعلاج نفسه: الإدارة تعيش على `employee` لا على الحساب.
    const t = await get(
      'SELECT u.sector_id, e.department_id FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id WHERE u.id = ?',
      [targetUserId]
    ) || {};
    if (!can(user, 'read', 'timesheet', { sector_id: t.sector_id, department_id: t.department_id, user_id: targetUserId }))
      throw forbidden('سجل وقت هذا الموظف خارج نطاقك');
  }
  const row = await get(`SELECT COALESCE(SUM(hours),0) total,
      COALESCE(SUM(CASE WHEN billable=1 THEN hours ELSE 0 END),0) billable
      FROM time_entry WHERE user_id = ? AND entry_date BETWEEN ? AND ? AND deleted_at IS NULL`,
    [targetUserId, from, to]);
  return { total: row.total, billable: row.billable, pct: row.total ? Math.round((row.billable / row.total) * 100) : 0 };
}
