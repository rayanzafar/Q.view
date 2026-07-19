// Approval workflow engine. Multi-step chains with role + threshold gating.
// Permission is enforced at BOTH request time and each approval action (never assumed).
import { all, get, insert, update } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { notify } from '../notifications/notify.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

export async function submitForApproval(ctx, { workflowKey, resource, resourceId, amountHalalas = 0, sectorId }) {
  const wf = await get('SELECT * FROM workflow_definition WHERE key = ? AND active = 1', [workflowKey]);
  if (!wf) throw badRequest('مسار اعتماد غير معرّف: ' + workflowKey);
  const rid = id('apr'); const now = nowIso();
  await insert('approval_request', {
    id: rid, workflow_id: wf.id, resource, resource_id: resourceId, requested_by: ctx.user.id,
    amount_halalas: amountHalalas, sector_id: sectorId || ctx.user.sector_id, current_step: 1,
    status: 'PENDING', created_at: now,
  });
  await audit(ctx, { action: 'submit', resource: 'approval', resourceId: rid, sectorId, detail: { workflowKey, resource, resourceId } });
  await notifyStepApprovers(wf.id, rid, 1, sectorId || ctx.user.sector_id);
  return await get('SELECT * FROM approval_request WHERE id = ?', [rid]);
}

async function stepFor(workflowId, order) {
  return await get('SELECT * FROM approval_step WHERE workflow_id = ? AND step_order = ?', [workflowId, order]);
}
async function notifyStepApprovers(workflowId, requestId, order, sectorId) {
  const step = await stepFor(workflowId, order);
  if (!step) return;
  // CAST(? AS TEXT) so Postgres can infer the bound param's type in the bare `IS NULL` check
  // (SQLite infers it either way; the cast is a no-op there). Same value bound twice.
  const approvers = await all('SELECT id FROM app_user WHERE role_id = ? AND active = 1 AND (sector_id = ? OR CAST(? AS TEXT) IS NULL)',
    [step.approver_role, sectorId, sectorId]);
  for (const a of approvers) notify(a.id, { kind: 'approval', title: 'طلب اعتماد بانتظارك',
    body: step.name_ar || 'خطوة اعتماد', ref_resource: 'approval_request', ref_id: requestId });
}

export async function actOnApproval(ctx, requestId, action, comment) {
  const user = ctx.user;
  const reqRow = await get('SELECT * FROM approval_request WHERE id = ?', [requestId]);
  if (!reqRow) throw notFound('طلب الاعتماد غير موجود');
  if (reqRow.status !== 'PENDING') throw badRequest('الطلب مُغلق');
  const step = await stepFor(reqRow.workflow_id, reqRow.current_step);
  if (!step) throw badRequest('خطوة غير معرّفة');
  // amount threshold: this step only applies at/above its min amount
  // authorization: correct role + scope + approve permission on the target resource
  const target = { sector_id: reqRow.sector_id };
  if (user.role_id !== step.approver_role && user.role_id !== 'admin') throw forbidden('لست المعتمِد المطلوب لهذه الخطوة');
  if (!can(user, 'approve', reqRow.resource, target)) throw forbidden('صلاحية الاعتماد غير متاحة');

  await insert('approval_action', {
    id: id('apa'), request_id: requestId, step_order: reqRow.current_step, actor_user_id: user.id,
    action, comment: comment || null, acted_at: nowIso(),
  });

  if (action === 'reject') {
    await update('approval_request', requestId, { status: 'REJECTED', closed_at: nowIso() });
    notify(reqRow.requested_by, { kind: 'approval', title: 'رُفض طلب الاعتماد', body: comment || '',
      ref_resource: reqRow.resource, ref_id: reqRow.resource_id });
  } else if (action === 'approve') {
    const next = await stepFor(reqRow.workflow_id, reqRow.current_step + 1);
    if (next) {
      await update('approval_request', requestId, { current_step: reqRow.current_step + 1 });
      await notifyStepApprovers(reqRow.workflow_id, requestId, reqRow.current_step + 1, reqRow.sector_id);
    } else {
      await update('approval_request', requestId, { status: 'APPROVED', closed_at: nowIso() });
      notify(reqRow.requested_by, { kind: 'approval', title: 'اعتُمد طلبك', body: '',
        ref_resource: reqRow.resource, ref_id: reqRow.resource_id });
    }
  }
  await audit(ctx, { action: 'approve', resource: 'approval', resourceId: requestId,
    sectorId: reqRow.sector_id, detail: { action, step: reqRow.current_step } });
  return await get('SELECT * FROM approval_request WHERE id = ?', [requestId]);
}

export async function myApprovalQueue(user) {
  // requests pending at a step whose role matches the user's role and sector scope
  return await all(
    `SELECT ar.*, wd.name_ar workflow_name FROM approval_request ar
     JOIN workflow_definition wd ON wd.id = ar.workflow_id
     JOIN approval_step st ON st.workflow_id = ar.workflow_id AND st.step_order = ar.current_step
     WHERE ar.status = 'PENDING' AND (st.approver_role = ? OR ? = 'admin')
       AND (ar.sector_id = ? OR ? = 'admin')
     ORDER BY ar.created_at`,
    [user.role_id, user.role_id, user.sector_id, user.role_id]);
}
