// خطّافُ المهام — الطرفُ الذي تناديه `pmo/tasks.js` بعد كل تعديل مهمة.
//
// ثلاث خصائص مقصودة في هذا الملف، وهي سببُ وجوده منفصلاً عن `task-sync.js`:
//
//   ① **يعود فوراً في الحال العادية.** أكثرُ مهام المنصة لا علاقة لها بمركز التطوير، والخطّاف
//      يقع على **كل** تعديل مهمة في المنتج كله. فأولُ سطرٍ فيه قراءةٌ واحدة مفهرسة على
//      `product_item_task(task_id)` تنتهي بلا شيء — لا استيرادَ ثقيلاً ولا حسابَ حالة.
//
//   ② **لا يرمي إلى مناديه أبداً.** المُنادي هو `updateTask`، وقد كتب تعديلَه وأثرَه بالفعل.
//      فخطأٌ هنا يجب أن يُسجَّل ولا يقلب عملية المستخدم التي نجحت — «تعذّر تحديث بلاغه»
//      ليست سبباً لردّ «تعذّر تعديل مهمتك».
//
//   ③ **يصمت حين يكون هو مصدرَ التغيير.** `ctx.productSync` تُوضع في `task-sync.js` على
//      السياق الذاهب إلى `updateTask`، فتصل إلى هنا مع السياق نفسه — وهي الحارسُ الأول من
//      حارسَي الحلقة (الثاني رمزُ `SILENT` في الاتجاه المقابل). والاتجاهُ الآخر لا يمرّ من
//      `updateTask` أصلاً بعد v5.75 فلا يوقظ هذا الخطّاف، وتبقى هذه القراءة حارساً احتياطياً.

import { logError } from '../../core/obs/log.js';
import { linkForTask, pushTaskStatusToItem, itemStatusForTask } from './task-sync.js';

export async function onTaskStatusChanged(ctx, taskId, fromStatus, toStatus) {
  // ① التغيير من عندنا — لا نُعيده إلينا.
  if (ctx?.productSync) return null;
  // ② لا حالة تغيّرت أصلاً، أو تغيّرت إلى ما لا يعني مركز التطوير.
  if (!taskId || !toStatus || toStatus === fromStatus) return null;
  if (!itemStatusForTask(toStatus)) return null;
  try {
    // ③ القراءة الواحدة التي تنتهي بلا شيء في الحال العادية.
    const link = await linkForTask(taskId);
    if (!link) return null;
    return await pushTaskStatusToItem(ctx, link, toStatus);
  } catch (e) {
    logError('product_task_hook', {
      task_id: taskId, to: toStatus, err_msg: String(e?.message || e).slice(0, 200),
    });
    return null;
  }
}
