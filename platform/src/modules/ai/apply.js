// تطبيق تغييرات المساعد — **عبر خدمات المنتج نفسها، لا مساراً موازياً**.
//
// كان التطبيق يكتب في جدول الفرص مباشرةً (`update('opportunity', …)`) من داخل `core/ai`. ومعنى
// ذلك أنه كان يتخطّى `moveStage` وكل ما فيها دفعةً واحدة: شرط السبب المكتوب عند التراجع عن
// الفوز، ورفض التراجع إن كان الفوز قد أنتج مشروعاً، وترشيح المحذوف ناعماً، ورفض المرحلة
// المجهولة، ونسبة الفوز الافتراضية للمرحلة. أي أن أضعف باب في المنصة كان باب المساعد.
//
// موضع هذا الملف قرار طبقات: `core` لا يستورد `modules` (فيبقى قابلاً للاستعمال من كل طبقة)،
// و`modules` يستورد `modules` بلا حرج. فبُني هنا، ومهمته الوحيدة: افتح المعاينة، نادِ الخدمة
// الصحيحة، ولا تبتلع رسالتها. رسائل الخدمات هي المنتج نفسه — «اكتب سبب التراجع قبل الحفظ»
// جملةٌ تعلّم المستخدم قاعدة العمل، فلا تُستبدَل برسالة عامة.
//
// الذرّية: المزلاج والكتابة في معاملة واحدة. فطلبان متزامنان لا يفوزان معاً (المزلاج تحديث
// مشروط يُحصى)، ورفضُ الخدمة يُرجع المزلاج فتبقى المعاينة قابلة للتصحيح بدل أن تُحرق بلا كتابة.
// (`quickAddTask` و`updateTask` و`moveStage` لا تفتح معاملة خاصة بها، فالتداخل آمن.)
import { tx } from '../../core/db/index.js';
import { claimPreview } from '../../core/ai/store.js';
import { audit } from '../../core/audit/index.js';
import { badRequest } from '../../core/http/errors.js';
import { moveStage } from '../crm/opportunities.js';
import { quickAddTask, updateTask } from '../pmo/tasks.js';

const CLAIM_MESSAGE = {
  missing: 'لا أجد هذه المعاينة — اطلب معاينة جديدة ثم أكّدها.',
  applied: 'هذه المعاينة طُبِّقت من قبل. افتح السجل للاطّلاع، أو اطلب معاينة جديدة إن أردت تغييراً آخر.',
  expired: 'انتهت صلاحية المعاينة (خمس عشرة دقيقة). اطلبها من جديد لتراها على البيانات الحالية ثم أكّدها.',
};

export async function applyChange(ctx, token) {
  const user = ctx.user;
  if (!token) throw badRequest('لا توجد معاينة لتأكيدها — اطلب المعاينة أولاً ثم أكّدها.');
  return await tx(async () => {
    const claim = await claimPreview(user, token);
    if (!claim.ok) throw badRequest(CLAIM_MESSAGE[claim.reason] || CLAIM_MESSAGE.missing);
    const p = claim.preview;
    const done = await performChange(ctx, p);          // رسائل الخدمة تصعد كما هي
    // أثر إضافي يقول **من أين جاء التغيير**: سطر الخدمة يقول ماذا تغيّر، وهذا يقول أن مصدره
    // المساعد وبتأكيد صاحبه. بلا مورد جديد في السجل كي تبقى الشاشة مقروءة بمسمّياتها العربية.
    await audit(ctx, { action: done.action, resource: done.resource, resourceId: done.resourceId,
      sectorId: claim.sectorId || done.sectorId || null,
      detail: { via: 'ai', kind: p.type, confirmed_by: user.id } });
    return { reply: `تم تطبيق التغيير ✓ — ${p.summary}`, applied: true,
      resource: done.resource, resourceId: done.resourceId };
  });
}

async function performChange(ctx, p) {
  if (p.type === 'opp_stage') {
    const row = await moveStage(ctx, p.oppId, p.to, p.note || null);
    return { action: 'update', resource: 'opportunity', resourceId: p.oppId, sectorId: row?.sector_id || null };
  }
  if (p.type === 'task_create') {
    const row = await quickAddTask(ctx, {
      title: p.title, project_id: p.projectId || null, priority: p.priority || 'P2',
      due_date: p.dueDate || null,
    });
    return { action: 'create', resource: 'task', resourceId: row?.id || null, sectorId: row?.sector_id || null };
  }
  if (p.type === 'task_status') {
    const patch = { status: p.to };
    if (p.blockedReason) patch.blocked_reason = p.blockedReason;
    const row = await updateTask(ctx, p.taskId, patch);
    return { action: 'update', resource: 'task', resourceId: p.taskId, sectorId: row?.sector_id || null };
  }
  throw badRequest('نوع التغيير غير مدعوم — اختر عملاً من بطاقات المساعد.');
}
