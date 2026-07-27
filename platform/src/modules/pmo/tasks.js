// PMO — Tasks service with Quick Add. Employees manage own tasks; managers see team/project scope.
import { all, get, insert, update } from '../../core/db/index.js';
import { can, effectiveScope } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

// "My tasks" — always own; managers can pass a projectId they can access.
export async function myTasks(user, filters = {}) {
  const where = ['deleted_at IS NULL', 'assignee_user_id = ?'];
  const params = [user.id];
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.today) { where.push('(due_date IS NULL OR substr(due_date,1,10) <= ?)'); params.push(nowIso().slice(0, 10)); }
  return await all(`SELECT * FROM task WHERE ${where.join(' AND ')} ORDER BY
    CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, due_date`, params);
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

// Quick Add — minimal fields, instant. Defaults assignee to self.
export async function quickAddTask(ctx, data) {
  const user = ctx.user;
  if (!data.title || !String(data.title).trim()) throw badRequest('عنوان المهمة مطلوب');
  const assignee = data.assignee_user_id || user.id;
  await assertMayAssign(user, assignee); // الفحص يحمل قطاع المُسنَد إليه لا معرّفه وحده
  const tid = id('tsk'); const now = nowIso();
  await insert('task', {
    id: tid, title: String(data.title).trim(), description: data.description || null,
    work_kind: data.work_kind || 'project', project_id: data.project_id || null,
    opportunity_id: data.opportunity_id || null, sector_id: data.sector_id || user.sector_id,
    assignee_user_id: assignee, priority: data.priority || 'P2', status: 'TODO',
    start_date: data.start_date || null, due_date: data.due_date || null,
    estimate_hours: data.estimate_hours ?? null, recurring: data.recurring || null,
    created_at: now, created_by: user.id,
  });
  await audit(ctx, { action: 'create', resource: 'task', resourceId: tid, sectorId: data.sector_id || user.sector_id });
  return await get('SELECT * FROM task WHERE id = ?', [tid]);
}

// «مهام فريقي» — أول رؤية للمدير لمن يعمل على ماذا. لم تكن موجودة إطلاقاً: كل مستخدم يرى
// مهامه وحده. النطاق يُبنى من الاستعلام نفسه (لا تصفية بعد القراءة) فلا يُقرأ ما لا يُسمح به.
export async function teamTasks(user, filters = {}) {
  // ملاحظة دقيقة: can(...) بلا هدف يعيد «صحيح» لمجرد وجود المنح مهما كان نطاقه — فالموظف
  // العادي (نطاق «خاصتي») كان يمرّ. السؤال هنا نطاقي لا وجودي: هل يتجاوز نطاقه نفسه؟
  const scope = effectiveScope(user, 'update', 'task');
  if (!scope || scope === 'own') throw forbidden('عرض مهام الفريق يتطلب صلاحية إدارية على فريق أو قطاع');
  const where = ['t.deleted_at IS NULL', "t.status != 'DONE'"];
  const params = [];
  // نطاق شركي ⟵ الجميع؛ غير ذلك ⟵ قطاع المستخدم حصراً (من قطاع المهمة أو قطاع المُسنَد إليه).
  if (user.scope !== 'company') {
    where.push('(t.sector_id = ? OR u.sector_id = ?)');
    params.push(user.sector_id, user.sector_id);
  }
  if (filters.assignee) { where.push('t.assignee_user_id = ?'); params.push(filters.assignee); }
  const today = nowIso().slice(0, 10);
  if (filters.overdue) { where.push('t.due_date IS NOT NULL AND substr(t.due_date,1,10) < ?'); params.push(today); }
  const rows = await all(`SELECT t.*, u.name_ar assignee_name, u.username assignee_username, p.name_ar project_name
     FROM task t
     LEFT JOIN app_user u ON u.id = t.assignee_user_id
     LEFT JOIN project p ON p.id = t.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
              t.due_date`, params);
  // تجميع حسب الشخص: هذا سؤال المدير الحقيقي «من يعمل على ماذا» لا قائمة مسطّحة.
  const byPerson = new Map();
  for (const r of rows) {
    const key = r.assignee_user_id || '—';
    if (!byPerson.has(key)) {
      byPerson.set(key, { userId: r.assignee_user_id, name: r.assignee_name || r.assignee_username || 'غير مُسنَدة', tasks: [], overdue: 0, blocked: 0 });
    }
    const b = byPerson.get(key);
    b.tasks.push(r);
    if (r.due_date && String(r.due_date).slice(0, 10) < today) b.overdue++;
    if (r.blocked_reason) b.blocked++;
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
  for (const k of ['status', 'priority', 'due_date', 'assignee_user_id']) if (k in data) allowed[k] = data[k];
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
  const patch = {};
  for (const k of ['title', 'description', 'status', 'priority', 'progress_pct', 'due_date',
    'start_date', 'estimate_hours', 'blocked_reason', 'assignee_user_id']) {
    if (k in data) patch[k] = data[k];
  }
  if (data.status === 'DONE' && row.status !== 'DONE') { patch.completed_at = nowIso(); patch.progress_pct = 100; }
  patch.updated_at = nowIso(); patch.updated_by = user.id;
  await update('task', taskId, patch);
  await audit(ctx, { action: 'update', resource: 'task', resourceId: taskId, detail: { status: patch.status } });
  return await get('SELECT * FROM task WHERE id = ?', [taskId]);
}
