// PMO — Tasks service with Quick Add. Employees manage own tasks; managers see team/project scope.
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
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

export async function projectTasks(user, projectId) {
  const p = await get('SELECT * FROM project WHERE id = ?', [projectId]);
  if (!p) throw notFound('المشروع غير موجود');
  if (!can(user, 'read', 'project', p)) throw forbidden();
  return await all('SELECT * FROM task WHERE project_id = ? AND deleted_at IS NULL ORDER BY status, due_date', [projectId]);
}

// Quick Add — minimal fields, instant. Defaults assignee to self.
export async function quickAddTask(ctx, data) {
  const user = ctx.user;
  if (!data.title || !String(data.title).trim()) throw badRequest('عنوان المهمة مطلوب');
  const assignee = data.assignee_user_id || user.id;
  // creating a task for someone else requires manage rights on the target project/sector
  if (assignee !== user.id && !can(user, 'update', 'task', { assignee_user_id: assignee })) throw forbidden();
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

export async function updateTask(ctx, taskId, data) {
  const user = ctx.user;
  const row = await get('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL', [taskId]);
  if (!row) throw notFound('المهمة غير موجودة');
  // own task, or manager with scope
  const isOwn = row.assignee_user_id === user.id || row.created_by === user.id;
  if (!isOwn && !can(user, 'update', 'task', row)) throw forbidden();
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
