// Approval workflow engine. Multi-step chains with role + threshold gating.
// Permission is enforced at BOTH request time and each approval action (never assumed).
import { all, get, insert, update, run, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { notify } from '../notifications/notify.js';
import { settleStaffing } from '../org/staffing-settle.js';
import { id, nowIso } from '../../core/util/ids.js';
import { forbidden, notFound, badRequest } from '../../core/http/errors.js';

// ما الذي يُرفع للاعتماد، ومن أين يُقرأ صفّه.
//
// المفتاح هو `target_resource` المكتوب في تعريف المسار نفسه — وهو اسم مورد موجود في مصفوفة
// الصلاحيات (core/rbac/matrix.js)، فيصير فحص `can(...)` على **الصف** ممكناً بلا مفردات جديدة.
// اسم الجدول لا يأتي من الطلب إطلاقاً: استعلام ثابت مختار بمفتاح من هذه الخريطة، والمعرّف وحده
// مربوط بـ ? — فلا مدخل مستخدم يدخل نص الاستعلام.
//
// الصف يُطبَّع إلى ما تقرأه دالة النطاق (القطاع/المشروع/المالك): العرض مثلاً لا يحمل عموداً
// للقطاع، فيُستعار قطاعه من فرصته — وإلا مرّ فحص «نطاق القطاع» فارغاً على كل عرض في الشركة.
// وفترة الوقت تُنسب إلى قطاع صاحبها. `SELECT` صريح لا `*`: نأخذ ما يُفحص فقط.
const APPROVABLE = {
  opportunity: `SELECT o.id, o.sector_id, o.owner_user_id, o.created_by,
                       o.value_halalas AS amount_halalas, o.deleted_at
                  FROM opportunity o WHERE o.id = ?`,
  proposal: `SELECT p.id, o.sector_id, o.owner_user_id, p.created_by,
                    p.value_halalas AS amount_halalas, p.deleted_at
               FROM proposal p LEFT JOIN opportunity o ON o.id = p.opportunity_id WHERE p.id = ?`,
  expense: `SELECT e.id, e.sector_id, e.project_id, e.requested_by, e.amount_halalas, e.deleted_at
              FROM expense e WHERE e.id = ?`,
  deliverable: `SELECT d.id, d.sector_id, d.project_id, d.amount_halalas, d.deleted_at
                  FROM deliverable d WHERE d.id = ?`,
  timesheet: `SELECT t.id, t.user_id, u.sector_id FROM timesheet_period t
                LEFT JOIN app_user u ON u.id = t.user_id WHERE t.id = ?`,
};

// رفع طلب اعتماد. كان بلا أي فحص: أي حساب مسجَّل — بما فيه حساب البوابة الخارجية (عميل) —
// يفتح مساراً داخلياً على أي معرّف يكتبه، فيصل الطلب إلى شاشة قائد القطاع وإلى تنبيهاته.
// القاعدة المطبَّقة هنا شرطان على **الصف نفسه** لا على وجود المنح:
//   ① يرى ما يرفعه: `can(read, <مورد المسار>, الصف)`.
//   ② ويملك تغييره: `can(create|update, …)` — فطلب الاعتماد إجراء حوكمة على عمل قائم، ومن
//      يقرأ فقط (مشاهد، أو عميل يرى مشروعه) لا يفتح مساراً على عمل الشركة. هذا الشرط هو ما
//      يُبقي الحسابات غير الموظفة خارج المسارات الداخلية كلها، اليوم ومع أي مسار يُضاف غداً،
//      بلا قائمة أدوار محفوظة في الخدمة.
export async function submitForApproval(ctx, { workflowKey, resource, resourceId } = {}) {
  const user = ctx.user;
  // لا يُدرَج ما أرسله المستخدم في نص الرسالة: قيمة غائبة كانت تُطبع حرفيةً داخل جملة عربية
  // يقرأها صاحب العمل. الرسالة تقول ما نقص وما العمل، لا ما وصل.
  if (!workflowKey) throw badRequest('حدّد مسار الاعتماد المطلوب قبل الإرسال');
  const wf = await get('SELECT * FROM workflow_definition WHERE key = ? AND active = 1', [workflowKey]);
  if (!wf) throw badRequest('مسار الاعتماد المطلوب غير متاح. اختر مساراً من المسارات المفعّلة.');
  // نوع العمل يُقرأ من تعريف المسار لا من الطلب: من يختار النوع بنفسه يختار الفحص الذي يُطبَّق
  // عليه (مسار الوقت مع معرّف فرصة مثلاً)، فيهرب من فحص المورد الحقيقي.
  const kind = wf.target_resource;
  if (resource && resource !== kind) throw badRequest('نوع العنصر لا يطابق مسار الاعتماد المختار. اختر المسار المناسب للعنصر.');
  if (!resourceId) throw badRequest('حدّد العنصر المطلوب رفعه للاعتماد');
  // hasOwn لا الوصول المباشر: مفتاح موروث ('constructor' مثلاً) يعيد دالة لا استعلاماً.
  const sql = Object.hasOwn(APPROVABLE, kind) ? APPROVABLE[kind] : null;
  if (!sql) throw badRequest('هذا المسار غير مهيأ للاستخدام بعد. تواصل مع مدير النظام.');
  const row = await get(sql, [resourceId]);
  if (!row || row.deleted_at) throw notFound('العنصر المطلوب رفعه للاعتماد غير موجود');
  if (!can(user, 'read', kind, row)) throw forbidden('هذا العنصر خارج نطاقك، فلا يمكنك رفعه للاعتماد');
  if (!can(user, 'create', kind, row) && !can(user, 'update', kind, row))
    throw forbidden('رفع هذا العمل للاعتماد خارج صلاحيتك. اطلب من المسؤول عنه رفعه.');

  // القطاع والمبلغ يُشتقّان من الصف لا من الطلب: القطاع هو ما يوجّه الطلب إلى معتمِديه وما
  // يُفحص عليه نطاقهم لاحقاً في actOnApproval، والمبلغ هو ما يُبنى عليه سقف الخطوة — فتركهما
  // بيد الرافع يجعله هو من يختار من يعتمد طلبه وبأي سقف.
  const sectorId = row.sector_id || user.sector_id || null;
  const amountHalalas = Number(row.amount_halalas) || 0;
  const rid = id('apr'); const now = nowIso();
  // أول خطوة **منطبقة** لا أول خطوة مطلقاً: طلبٌ دون كل السقوف لا يعلَّق على خطوة لا تخصّه.
  const first = await nextApplicableStep(wf.id, 1, amountHalalas);
  const noStepApplies = !first;
  await insert('approval_request', {
    id: rid, workflow_id: wf.id, resource: kind, resource_id: resourceId, requested_by: user.id,
    amount_halalas: amountHalalas, sector_id: sectorId, current_step: first ? first.step_order : 1,
    // مسارٌ لا تنطبق أيٌّ من خطواته على هذا المبلغ لا يبقى معلَّقاً إلى الأبد بانتظار معتمِد
    // لا يخصّه — يُغلَق معتمَداً في حينه، ويقول التدقيق لماذا.
    status: noStepApplies ? 'APPROVED' : 'PENDING',
    closed_at: noStepApplies ? now : null, created_at: now,
  });
  await audit(ctx, { action: 'submit', resource: 'approval', resourceId: rid, sectorId,
    detail: { workflowKey, resource: kind, resourceId, amount_halalas: amountHalalas,
      first_step: first ? first.step_order : null,
      auto_approved: noStepApplies || undefined,
      reason_ar: noStepApplies ? 'المبلغ دون سقف كل خطوات هذا المسار' : undefined } });
  if (first) await notifyStepApprovers(wf.id, rid, first.step_order, sectorId);
  return await get('SELECT * FROM approval_request WHERE id = ?', [rid]);
}

async function stepFor(workflowId, order) {
  return await get('SELECT * FROM approval_step WHERE workflow_id = ? AND step_order = ?', [workflowId, order]);
}

// سقف الخطوة (`min_amount_halalas`) كان مخزَّناً ولا يُطبَّق: كل خطوة تسري مهما صغُر المبلغ.
// وأثره ليس تجميلياً — عمودٌ يَعِد بحوكمة غير قائمة: من يضبط «توقيع الرئيس التنفيذي فوق
// مليون» يظنّ أن ما دون المليون يمرّ بخطوة واحدة، والواقع أن كل مصروف بمئة ريال ينتظر
// توقيعه. فالنتيجة عكس المقصود تماماً: حوكمة تُبطئ الصغير ولا تُميّز الكبير.
//
// الدلالة المطبَّقة: الخطوة تسري إذا كان مبلغ الطلب **يبلغ سقفها فأكثر**، والخطوة بلا سقف
// (أو بصفر) تسري دائماً. والبحث يتخطّى غير المنطبقة بدل أن يقف عندها.
export async function nextApplicableStep(workflowId, fromOrder, amountHalalas) {
  const amount = Number(amountHalalas) || 0;
  const steps = await all(
    'SELECT * FROM approval_step WHERE workflow_id = ? AND step_order >= ? ORDER BY step_order',
    [workflowId, fromOrder]);
  for (const s of steps) if (amount >= (Number(s.min_amount_halalas) || 0)) return s;
  return null;
}
async function notifyStepApprovers(workflowId, requestId, order, sectorId) {
  const step = await stepFor(workflowId, order);
  if (!step) return;
  // CAST(? AS TEXT) so Postgres can infer the bound param's type in the bare `IS NULL` check
  // (SQLite infers it either way; the cast is a no-op there). Same value bound twice.
  const approvers = await all('SELECT id FROM app_user WHERE role_id = ? AND active = 1 AND (sector_id = ? OR CAST(? AS TEXT) IS NULL)',
    [step.approver_role, sectorId, sectorId]);
  for (const a of approvers) await notify(a.id, { kind: 'approval', title: 'طلب اعتماد بانتظارك',
    body: step.name_ar || 'خطوة اعتماد', ref_resource: 'approval_request', ref_id: requestId });
}

export async function actOnApproval(ctx, requestId, action, comment) {
  const user = ctx.user;
  const reqRow = await get('SELECT * FROM approval_request WHERE id = ?', [requestId]);
  if (!reqRow) throw notFound('طلب الاعتماد غير موجود');
  if (reqRow.status !== 'PENDING') throw badRequest('الطلب مُغلق');
  // طلبٌ موجَّه إلى شخص لا خطوةَ دورٍ له: المعتمِد هو الشخص نفسه، والفحص عليه لا على دوره.
  const direct = !!reqRow.assignee_user_id;
  const step = direct ? null : await stepFor(reqRow.workflow_id, reqRow.current_step);
  if (!direct && !step) throw badRequest('خطوة غير معرّفة');
  // القرار قرارٌ واحد من اثنين. أي كلمة أخرى كانت تُسجَّل إجراءً على الطلب ثم تتركه معلَّقاً
  // كما هو، ويُكتب في سجل التدقيق أنه «اعتماد».
  if (action !== 'approve' && action !== 'reject') throw badRequest('حدّد القرار: اعتماد أو رفض');
  // فصل المهام: من رفع الطلب لا يعتمده — ولو كان يحمل دور المعتمِد نفسه (قائد قطاع يرفع فرصة
  // ثم يعتمدها بنفسه، فتمرّ بلا عين ثانية). القرار يخرج من يد صاحب الطلب دائماً.
  if (reqRow.requested_by === user.id) throw forbidden('لا تعتمد طلباً رفعتَه بنفسك. أحِله إلى معتمِد آخر.');
  // authorization: correct role + scope + approve permission on the target resource.
  // `sector_id` هنا مشتقٌّ من الصف المرفوع لا من جسم الطلب (submitForApproval) — وإلا اختار
  // الرافعُ القطاعَ الذي يُفحص عليه نطاق المعتمِد.
  const target = { sector_id: reqRow.sector_id };
  if (direct) {
    // الموجَّه إليه وحده — ومدير النظام. ولا يُفحص منح «اعتماد» على المورد: التأكيد هنا شهادةٌ
    // على موظفه («هل يعمل على هذا»)، لا سلطةٌ على العنصر المُسكَّن عليه. واشتراطُ منحٍ إضافي
    // يُسكت مديراً عن موظفه لأنه لا يملك الفرصة — وهو عكس الغرض تماماً.
    if (reqRow.assignee_user_id !== user.id && user.role_id !== 'admin') {
      throw forbidden('هذا التأكيد موجَّه إلى مدير الموظف، لا إليك');
    }
  } else {
    if (user.role_id !== step.approver_role && user.role_id !== 'admin') throw forbidden('لست المعتمِد المطلوب لهذه الخطوة');
    if (!can(user, 'approve', reqRow.resource, target)) throw forbidden('صلاحية الاعتماد غير متاحة');
  }

  // سطرُ الإجراء + تسويةُ التسكين + قلبُ حالة الطلب + إخطاره + التدقيق: كتابةٌ واحدة لا تتجزّأ.
  // بلا معاملةٍ كان عطبٌ بين السطر والحالة يترك طلباً «عُمل عليه» وهو باقٍ معلَّقاً، أو عضويةً
  // فُعّلت لطلبٍ لم يُغلَق. والإخطارات تُنتظَر داخل المعاملة كي لا يصل خبرٌ عن تغييرٍ تراجَع.
  await tx(async () => {
    await insert('approval_action', {
      id: id('apa'), request_id: requestId, step_order: reqRow.current_step, actor_user_id: user.id,
      action, comment: comment || null, acted_at: nowIso(),
    });

    // أثرُ القرار على ما طُلب تأكيده. يُستدعى للطلبات الموجَّهة وحدها، ولا يعرف المحرّكُ تفصيله:
    // الوحدة صاحبة العضوية هي التي تُفعّلها أو تُلغيها — فلا يتسرّب علمُ التسكين إلى محرّك عام.
    if (direct) await settleStaffing(reqRow, action === 'approve');
    if (action === 'reject') {
      await update('approval_request', requestId, { status: 'REJECTED', closed_at: nowIso() });
      await notify(reqRow.requested_by, { kind: 'approval', title: 'رُفض طلب الاعتماد', body: comment || '',
        ref_resource: reqRow.resource, ref_id: reqRow.resource_id });
    } else if (action === 'approve') {
      // الخطوة التالية **المنطبقة**: تُتخطّى كل خطوة سقفُها فوق مبلغ هذا الطلب بدل أن يقف
      // عندها الطلب بانتظار معتمِد لا يعنيه المبلغ.
      const next = await nextApplicableStep(reqRow.workflow_id, reqRow.current_step + 1, reqRow.amount_halalas);
      if (next) {
        await update('approval_request', requestId, { current_step: next.step_order });
        await notifyStepApprovers(reqRow.workflow_id, requestId, next.step_order, reqRow.sector_id);
      } else {
        await update('approval_request', requestId, { status: 'APPROVED', closed_at: nowIso() });
        await notify(reqRow.requested_by, { kind: 'approval', title: 'اعتُمد طلبك', body: '',
          ref_resource: reqRow.resource, ref_id: reqRow.resource_id });
      }
    }
    await audit(ctx, { action: 'approve', resource: 'approval', resourceId: requestId,
      sectorId: reqRow.sector_id, detail: { action, step: reqRow.current_step } });
  });
  return await get('SELECT * FROM approval_request WHERE id = ?', [requestId]);
}

export async function myApprovalQueue(user) {
  // requests pending at a step whose role matches the user's role and sector scope.
  // وطلبات المستخدم نفسه تخرج من الطابور: عنوانه «بانتظار اعتمادك» وهو لا يعتمد ما رفعه
  // (فصل المهام في actOnApproval) — فبقاؤها يعني زرّاً يَعِد بما يردّه الخادم.
  return await all(
    `SELECT ar.*, wd.name_ar workflow_name FROM approval_request ar
     JOIN workflow_definition wd ON wd.id = ar.workflow_id
     JOIN approval_step st ON st.workflow_id = ar.workflow_id AND st.step_order = ar.current_step
     WHERE ar.status = 'PENDING' AND (st.approver_role = ? OR ? = 'admin')
       AND (ar.sector_id = ? OR ? = 'admin')
       AND ar.requested_by <> ?
     ORDER BY ar.created_at`,
    [user.role_id, user.role_id, user.sector_id, user.role_id, user.id]);
}

// ═══ اعتمادٌ موجَّهٌ إلى شخصٍ بعينه ═════════════════════════════════════════════
//
// «عشان المدير يأكّد أن الموظف شغّال على هذا الشي» — والمعتمِد هنا ليس دوراً بل إنساناً:
// **مدير هذا الموظف**. أما `submitForApproval` أعلاه فيوجّه بالدور والنطاق، وهو الصحيح
// للاعتمادات المالية («أي قائد قطاع» يعتمد) وغير الصحيح هنا.
//
// ولماذا مسارٌ ثانٍ للرفع لا توسيعُ الأول: `submitForApproval` يشترط على الرافع صلاحية تعديل
// العنصر المرفوع — والرافع هنا بالضبط **من لا يملك أمر ذلك الموظف**، وهو سبب الطلب لا مانعه.
// وليّ ذلك الشرط ليقبل الحالتين يُضعف الحارس على المسار المالي بلا مقابل.
//
// والصندوق واحد رغم البابين: نفس `approval_request` ونفس `approval_action` ونفس الطابور —
// فمن يفتح «الاعتمادات» يرى ما ينتظره كلَّه في مكانٍ واحد.
export const STAFFING_WORKFLOW_KEY = 'staffing_confirmation';

// تعريفُ المسار يُنشأ عند أول حاجة: الترحيلة تصف المخطط لا البيانات، والبذر لا يُعاد على
// قاعدةٍ ممتلئة. `ON CONFLICT DO NOTHING` يجعل النداء آمناً للتكرار وللتزامن معاً.
async function ensureStaffingWorkflow() {
  const found = await get('SELECT * FROM workflow_definition WHERE key = ?', [STAFFING_WORKFLOW_KEY]);
  if (found) return found;
  await run(
    `INSERT INTO workflow_definition (id, key, name_ar, target_resource, active, created_at)
     VALUES (?,?,?,?,1,?) ON CONFLICT DO NOTHING`,
    [id('wfd'), STAFFING_WORKFLOW_KEY, 'تأكيد تسكين موظف', 'membership', nowIso()]);
  return await get('SELECT * FROM workflow_definition WHERE key = ?', [STAFFING_WORKFLOW_KEY]);
}

/**
 * يرفع طلباً موجَّهاً إلى شخصٍ بعينه. بلا خطوات دور — الشخص هو الخطوة.
 * @returns {Promise<object>} صفّ الطلب
 */
export async function raiseDirectApproval(ctx, { resource, resourceId, assigneeUserId, sectorId, detail } = {}) {
  const user = ctx.user;
  if (!resourceId || !assigneeUserId) throw badRequest('طلب التأكيد يحتاج العنصر والمعتمِد');
  const wf = await ensureStaffingWorkflow();
  const rid = id('apr'); const now = nowIso();
  await insert('approval_request', {
    id: rid, workflow_id: wf.id, resource: resource || 'membership', resource_id: resourceId,
    requested_by: user.id, amount_halalas: 0, sector_id: sectorId || user.sector_id || null,
    current_step: 1, status: 'PENDING', assignee_user_id: assigneeUserId, created_at: now,
  });
  await audit(ctx, { action: 'submit', resource: 'approval', resourceId: rid, sectorId: sectorId || null,
    detail: { workflowKey: STAFFING_WORKFLOW_KEY, resource: resource || 'membership', resourceId, assignee: assigneeUserId, ...(detail || {}) } });
  return await get('SELECT * FROM approval_request WHERE id = ?', [rid]);
}

/** الطلبات الموجَّهة إليّ بعينـي — تُدمج مع طابور الأدوار في الشاشة. */
export async function myDirectApprovals(user) {
  if (!user) return [];
  return await all(
    `SELECT ar.*, wd.name_ar workflow_name FROM approval_request ar
      JOIN workflow_definition wd ON wd.id = ar.workflow_id
      WHERE ar.status = 'PENDING' AND ar.assignee_user_id = ? AND ar.requested_by <> ?
      ORDER BY ar.created_at`, [user.id, user.id]);
}
