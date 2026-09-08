// «مركز التطوير» ⇄ المهام — الجسرُ ذو الاتجاهين.
//
// «الاعتماد يُولّد مهمة» قرارُ مالك، وأثرُه أن للبلاغ حياتين: حياةً في مركز التطوير يقرؤها
// من أبلغ، وحياةً في المهام يعمل فيها المطوِّر. وحياتان لا تتزامنان أسوأ من حياةٍ واحدة:
// مهمةٌ تُنجَز ويبقى البلاغ مفتوحاً تجعل من أبلغ ينتظر ما وصل، وبلاغٌ يُغلَق وتبقى مهمتُه
// مفتوحة يُبقي عملاً في قائمة أحدهم بلا سبب.
//
// ── والحلقةُ تُكسر بحارسين لا بواحد ─────────────────────────────────────────────────────
// «المهمة أُنجزت ⇒ البلاغ حُلّ» و«البلاغ حُلّ ⇒ المهمة أُنجزت» قاعدتان تستدعي كلٌّ منهما
// الأخرى إلى ما لا نهاية إن تُركتا. فالحارسان:
//   ① **بنيويّ**: اتجاهُ «البلاغ ⇒ المهمة» يكتب صفَّ المهمة مباشرةً ولا يمرّ من `updateTask`
//      (السبب الكامل عند `pushItemStatusToTask`)، وخطّافُ المهام لا يُنادى إلا من هناك —
//      فلا صدى يعود أصلاً، بلا رايةٍ تُوضع وتُنسى. و`ctx.productSync` يبقى مقروءاً في
//      الخطّاف حارساً احتياطياً لمن يستدعي `updateTask` من داخلنا يوماً.
//   ② `{ [SILENT]: true }` — يمنع `setStatus` من الدفع إلى المهمة حين يكون هو المدفوعَ إليه.
// وكلاهما يُختبر بعدّ صفوف الأثر بالضبط: حلقةٌ تنشأ تظهر عدداً مختلفاً لا تعليقاً بلا نهاية.

import { get, insert, run, update, tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { logError } from '../../core/obs/log.js';
import { id, nowIso } from '../../core/util/ids.js';
import { quickAddTask } from '../pmo/tasks.js';
import { timeline } from './access.js';

/** الجسرُ القائم لمهمةٍ ما — الخطّاف يقرؤه أولاً ويعود فوراً إن لم يجد شيئاً. */
export const linkForTask = (taskId) => get(
  'SELECT * FROM product_item_task WHERE task_id = ? AND unlinked_at IS NULL', [taskId]);

/**
 * الجسرُ القائم لبندٍ ما — والأحدثُ هو المقصود دائماً. بندٌ يُرفض ثم يُعاد فتحُه ويُعتمد
 * ثانيةً تُولَد له مهمةٌ ثانية، ولو قُرئ الأقدمُ لذهب أثرُ «تم الحل» إلى مهمةٍ ملغاة وبقيت
 * المهمة الحيّة مفتوحةً في قائمة مطوِّرٍ إلى الأبد.
 */
export const linkForItem = (itemId) => get(
  `SELECT * FROM product_item_task WHERE item_id = ? AND unlinked_at IS NULL
    ORDER BY created_at DESC`, [itemId]);

/**
 * يُنشئ مهمةَ البند عند الاعتماد. يُنادى **داخل معاملة الاعتماد نفسها** فلا يقع أحدهما
 * بلا الآخر، و`tx` معاود الدخول فينضمّ النداء إلى المعاملة القائمة ولا يقسمها.
 *
 * والمشروع يُختار بأخصّ ما يُعرف: مشروعُ الجهة إن كان لها مشروع، وإلا مشروعُ المنتج، وإلا
 * بلا مشروع — والمهمة تقوم بلا مشروع أصلاً (`work_kind = 'product'`).
 */
export async function createTaskForItem(ctx, { product, item }) {
  const tenant = item.tenant_id
    ? await get('SELECT project_id FROM product_tenant WHERE id = ?', [item.tenant_id]) : null;
  const projectId = tenant?.project_id || product.project_id || null;
  // والمهمة تُكتب **بهوية من ستُسنَد إليه** لا بهوية من اعتمد: `assertMayAssign` يحرس دفع
  // مهمةٍ إلى قائمة شخصٍ آخر، ومديرُ المنتج ليس بالضرورة مديراً في الشركة — مستشارٌ يدير
  // منتجاً كان يُردّ «إسناد مهمة لشخص آخر يتطلب صلاحية إدارية على قطاعه» عن قرارٍ يملكه.
  // والإسنادُ إلى النفس مسموحٌ دائماً، فالبابُ يُفتح بلا أن يُوسَّع منحُ أحد. ونسبةُ الإشغال
  // اختياريةٌ هنا (`sizeOptional`) لأن المنصة هي المؤلِّفة لا صاحبُ المهمة: لم يُسأل عنها
  // أحد، ويقدّرها صاحبُها من صفّها.
  const actorCtx = await actingContextFor(ctx, item.assignee_user_id);
  const task = await quickAddTask(actorCtx, {
    // العنوان يبدأ بمفتاح البند: من يفتح قائمة مهامه يعرف أيَّ بلاغٍ يخدم قبل أن يفتح شيئاً،
    // والمفتاح نفسه هو ما يُكتب في البريد وفي التقرير المطبوع — لسانٌ واحد في الثلاثة.
    title: `${item.item_key} — ${item.title}`.slice(0, 200),
    description: item.dev_description || item.description || null,
    assignee_user_id: item.assignee_user_id,
    // ولا يُمرَّر المشروع من هنا — يُكتب بعد الإنشاء، والسبب أسفلُه.
    work_kind: 'product',
    sector_id: item.sector_id || null,
    estimate_hours: item.est_hours ?? null,
    priority: item.priority === 'critical' ? 'P0' : item.priority === 'high' ? 'P1' : 'P2',
  }, { sizeOptional: true });
  const now = nowIso();
  // ── ومشروعُ المهمة يُكتب بعد إنشائها، بقرار المنتج لا بنطاق صاحبها ────────────────────
  // بوابةُ الربط في `quickAddTask` تسأل صاحبَ الطلب «أتصل إلى هذا المشروع؟» — وهي محقّة حين
  // يختار موظفٌ مشروعاً من منتقٍ، وليست معنيّةً هنا: المشروعُ ليس اختياراً في الطلب أصلاً بل
  // مكتوبٌ في إعداد الجهة أو المنتج (يكتبه مديرُ المنتج)، والمهمةُ تُكتب بهوية المُسنَد إليه —
  // ومطوِّرٌ لم يُسكَّن على مشروع الجهة يُردّ عنه، فيسقط الاعتماد كلُّه لسببٍ لا يخصّ قراره.
  // والقطاعُ كذلك: قطاعُ البلاغ لا قطاعُ من ستُسنَد إليه المهمة.
  const sectorId = item.sector_id || ctx?.user?.sector_id || null;
  const parentPatch = {};
  if (projectId && task.project_id !== projectId) { parentPatch.project_id = projectId; parentPatch.work_kind = 'project'; }
  if (sectorId && task.sector_id !== sectorId) parentPatch.sector_id = sectorId;
  if (Object.keys(parentPatch).length) {
    parentPatch.updated_at = now; parentPatch.updated_by = ctx?.user?.id || null;
    await update('task', task.id, parentPatch);
  }
  // ولا يبقى للبند أكثرُ من جسرٍ حيٍّ واحد: ما سبق يُفَكّ قبل أن يُكتب الجديد.
  await run('UPDATE product_item_task SET unlinked_at = ? WHERE item_id = ? AND unlinked_at IS NULL',
    [now, item.id]);
  await insert('product_item_task', {
    id: id('pitk'), item_id: item.id, task_id: task.id,
    created_at: now, created_by: ctx?.user?.id || null,
  });
  // والأثرُ يُنسب إلى **من اعتمد**: الكتابة جرت بهوية المُسنَد إليه لأن الإسناد إلى النفس هو
  // الباب المفتوح، والقرارُ قرارُ المدير. فسطرٌ باسمه يقول لمن أُنشئت — وإلا قرأ المدقّق أن
  // المطوِّر أنشأ مهمةَ نفسه من عدم.
  await audit(ctx, {
    action: 'create', resource: 'task', resourceId: task.id, sectorId: item.sector_id || null,
    detail: { created_for: item.assignee_user_id || null, via: 'dev_center', item_id: item.id },
  });
  await timeline(ctx, item.id, {
    kind: 'task',
    detail: { task_id: task.id, created_for: item.assignee_user_id || null, via: 'dev_center' },
  });
  return task.id;
}

/**
 * سياقُ الفاعل لحسابٍ بعينه — بنفس مُحلِّل الجلسة الذي يبني سياقَ أي طلبٍ عادي، فلا مُحلِّلَ
 * ثانياً يتباعد عنه (مجموعاتُ النطاق: مشاريعُه وإداراتُه ومنحُه). والعنوانُ عنوانُ من اتَّخذ
 * القرار: الطلبُ طلبُه، وإنما نُفِّذت الكتابة بهوية صاحب المهمة. والاستيراد ديناميّ كسراً
 * لدورة الاستيراد (سياق الطلب يعرف عضوية المنتجات).
 */
async function actingContextFor(ctx, userId) {
  if (!userId || userId === ctx?.user?.id) return ctx;
  const { resolveUserFromSession } = await import('../../core/http/context.js');
  const user = await resolveUserFromSession({ user_id: userId });
  if (!user) return ctx;
  return { user, ip: ctx?.ip || null };
}

// خريطةُ الاتجاه الواحد: حالُ البند ⇒ حالُ مهمته. وما ليس هنا لا يمسّ المهمة.
const ITEM_TO_TASK = Object.freeze({ RESOLVED: 'DONE', DECLINED: 'CANCELLED' });

/**
 * البند تحرّك ⇒ ادفع الأثر إلى مهمته. يُنادى من `setStatus` بعد وقوع التغيير، وخارج
 * معاملته: مهمةٌ يتعذّر تحديثها يجب ألّا تُلغي قراراً اتُّخذ في مركز التطوير.
 *
 * ── ولماذا لا يمرّ من `updateTask` ──────────────────────────────────────────────────────
 * لأن حارسَه يسأل «أهذه مهمتُك أم أنت مديرٌ على صاحبها»، ومن يُغلق البلاغ مديرُ **منتج** لا
 * مديرٌ في الشركة: مستشارٌ يدير منتجاً وليس صاحبَ المهمة ولا كاتبَها كان يُردّ ٤٠٣ **بعد**
 * أن يكون البند قد كُتب «تم الحل» في معاملته — فيبقى البلاغ محلولاً ومهمتُه مفتوحة إلى
 * الأبد. وأثرُ البلاغ على مهمته تبعٌ لقرارٍ اتُّخذ في مركز التطوير بصلاحيته، لا قرارٌ جديد
 * في المهام. فالكتابة مباشرةٌ هنا، تُطابق ما يكتبه `updateTask` حرفاً بحرف على «منجزة»
 * و«ملغاة» — ومعها أثرُ تدقيقٍ يقول من أين جاءت.
 *
 * وفائدةٌ ثانية: ما لا يمرّ من `updateTask` لا يوقظ خطّاف المهام أصلاً، فلا صدى ولا حلقة —
 * حارسٌ بنيويّ لا يعتمد على راية تُنسى.
 *
 * ولا يرمي إلى مناديه بحال: البند تحرّك وانتهى، ومهمةٌ تعذّر تحديثها سطرُ سجلٍّ لا انقلابُ
 * قرار — وإلا رأى المستخدم «تعذّر» عن نقلةٍ وقعت فعلاً.
 */
export async function pushItemStatusToTask(ctx, item, to) {
  const want = ITEM_TO_TASK[to];
  if (!want) return null;
  try {
    const link = await linkForItem(item.id);
    if (!link) return null;
    const task = await get(
      'SELECT id, status, blocked_reason FROM task WHERE id = ? AND deleted_at IS NULL', [link.task_id]);
    if (!task || task.status === want) return null;
    const now = nowIso();
    const actor = ctx?.user?.id || null;
    // نفسُ حقول `updateTask` على هذين الانتقالين، لا أقلّ: بلا ختم الإنجاز يسأل التقرير «من
    // أنجزها» بلا جواب، وبلا النسبة تبقى مهمةٌ منجزة عند ٤٠٪ في كل عدّاد.
    const patch = { status: want, updated_at: now, updated_by: actor };
    if (want === 'DONE') { patch.completed_at = now; patch.completed_by = actor; patch.progress_pct = 100; }
    // وإلغاءُ مهمةٍ كانت منجزة يمحو ختمَها كما يمحوه المحرِّر — وإلا بقيت تُعدّ في «أُنجز» وهي ملغاة.
    if (want !== 'DONE' && task.status === 'DONE') { patch.completed_at = null; patch.completed_by = null; }
    // وسببُ التعطيل يزول بزوال التعطيل، فلا يبقى نصٌّ قديم يُقرأ على مهمةٍ ملغاة.
    if (task.status === 'BLOCKED' && task.blocked_reason) patch.blocked_reason = null;
    await update('task', task.id, patch);
    await audit(ctx, {
      action: 'update', resource: 'task', resourceId: task.id,
      detail: { via: 'dev_center', item_id: item.id, status: want },
    });
    await timeline(ctx, item.id, { kind: 'task', detail: { task_id: task.id, task_status: want } });
    // بلاغٌ رُفض مهمتُه ملغاة، والجسرُ إليها يُفَكّ: إن أُعيد فتحُه واعتُمد ثانيةً كانت مهمتُه
    // الجديدة هي وحدها الحيّة، ولا تعود الملغاة تُقرأ ولا تُقلب إلى «منجزة».
    if (to === 'DECLINED') await update('product_item_task', link.id, { unlinked_at: nowIso() });
    return task.id;
  } catch (e) {
    logError('product_item_task_push', {
      item_id: item?.id || null, to, err_msg: String(e?.message || e).slice(0, 200),
    });
    return null;
  }
}

// وخريطةُ الاتجاه المقابل: حالُ المهمة ⇒ حالُ بندها.
const TASK_TO_ITEM = Object.freeze({ DONE: 'RESOLVED', CANCELLED: 'APPROVED' });
export const itemStatusForTask = (taskStatus) => TASK_TO_ITEM[taskStatus] || null;

/**
 * المهمة تحرّكت ⇒ ادفع الأثر إلى بندها. يُنادى من الخطّاف وحده.
 * و«تم الحل» تطلب وسم إصدار: يؤخذ أحدثُ إصدارٍ للمنتج إن وُجد، وإلا أُغلق البند بلا وسم —
 * الوسم حقيقةٌ يكتبها الفريق لاحقاً، وحجزُ الإغلاق عليها يترك من أبلغ ينتظر ما وصله فعلاً.
 */
export async function pushTaskStatusToItem(ctx, link, taskStatus) {
  const want = TASK_TO_ITEM[taskStatus];
  if (!want) return null;
  const item = await get('SELECT * FROM product_item WHERE id = ? AND deleted_at IS NULL', [link.item_id]);
  if (!item || item.status === want) return null;
  const items = await import('./items.js');
  if (!items.canTransition(item.status, want)) return null;
  // `SILENT` يكسر الصدى، و`SYNC` يتخطّى حرّاس الصلاحية: من عدّل المهمة كان مخوَّلاً بها،
  // وقد لا يكون من فريق المنتج (مطوِّرٌ يُلغي مهمة نفسه، أو قائدُ قطاعٍ يُنجزها عنه).
  const opts = { [items.SILENT]: true, [items.SYNC]: true };
  if (want === 'RESOLVED') {
    const v = await get(
      'SELECT id FROM product_version WHERE product_id = ? ORDER BY COALESCE(released_on, created_at) DESC LIMIT 1',
      [item.product_id]);
    if (v) opts.version_id = v.id; else opts[items.ALLOW_NO_VERSION] = true;
  }
  await items.setStatus(ctx, item.id, want, opts);
  return item.id;
}

/** فكُّ الجسر — حالةٌ لا حذف، فيبقى أثرُ أنّ مهمةً كانت لهذا البند. */
export async function unlinkTask(ctx, taskId) {
  const link = await linkForTask(taskId);
  if (!link) return null;
  await tx(async () => {
    await update('product_item_task', link.id, { unlinked_at: nowIso() });
    await timeline(ctx, link.item_id, { kind: 'task', detail: { task_id: taskId, unlinked: true } });
  });
  return link.item_id;
}
