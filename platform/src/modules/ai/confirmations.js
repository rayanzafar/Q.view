// تأكيدُ تغييرات المساعد داخل سند — الضغطةُ التي تكتب.
//
// الحارسُ في `runTool` يوقف كلَّ تغييرٍ قادمٍ من مساعدٍ خارجي ويُسجّله طلباً ينتظر. وهذا الملف
// هو الطرفُ الآخر: صاحبُ الحساب يفتح صفحته، يقرأ قبل/بعد بتفصيله، فيؤكّد أو يرفض.
//
// وقرارُ التصميم الذي يجعل هذا آمناً: **التأكيد والكتابة معاملةٌ واحدة**. فلو ردّت الخدمةُ
// الكتابةَ لسببٍ مشروع — وأشهرُه أن السجل تحرّك بعد المعاينة فبصمتُه لم تعد تطابقها — رجع
// الطلبُ إلى قائمة الانتظار كما كان، ولم يبقَ «مؤكَّداً» وقد كُتب لا شيء. الرسالةُ تصل صاحبَه
// بنصّها، والقرارُ يبقى بيده: يطلب معاينةً جديدة، أو يرفض هذا الطلب ويمضي.
//
// ولا تُنادى أداةُ التنفيذ هنا بمسارٍ خاص: تُنادى بـ`runTool` نفسها التي ينادي بها المساعد،
// بلا `mcpClient` هذه المرة — فتمرّ بالبوابة نفسها وتكتب في السجل نفسه وتخرج برسائل الخدمة
// نفسها. المسارُ واحدٌ والفرقُ من ضغط الزرّ.
import { tx } from '../../core/db/index.js';
import { audit } from '../../core/audit/index.js';
import { badRequest } from '../../core/http/errors.js';
import { confirmPending, rejectPending, listAwaiting, countAwaiting } from '../../core/ai/store.js';
import { runTool } from './team-tools.js';

const DECIDE_MESSAGE = {
  missing: 'لا أجد هذا الطلب — لعلّه بُتَّ فيه من نافذة أخرى. حدّث الصفحة لترى ما ينتظرك الآن.',
  applied: 'هذا الطلب نُفِّذ من قبل. افتح السجل للاطّلاع على ما تغيّر.',
  rejected: 'هذا الطلب مرفوض من قبل، فلم يُكتب شيء.',
  expired: 'انتهت مهلةُ هذا الطلب قبل أن تبتّ فيه، فلم يُكتب شيء. اطلب من مساعدك عرضه من جديد إن كنت ما تزال تريده.',
};

export { listAwaiting, countAwaiting };

/** «أؤكّد التنفيذ»: يُفرَج عن الطلب ثم يُنفَّذ بأداته — وفشلُ الكتابة يُرجعه إلى الانتظار. */
export async function confirmChange(ctx, token) {
  if (!token) throw badRequest('لا طلب لتأكيده — حدّث الصفحة لترى ما ينتظرك.');
  return await tx(async () => {
    const c = await confirmPending(ctx.user, token);
    if (!c.ok) throw badRequest(DECIDE_MESSAGE[c.reason] || DECIDE_MESSAGE.missing);
    if (!c.applyTool) throw badRequest('هذا الطلب بلا أداة تنفيذ معروفة — اطلب من مساعدك عرضه من جديد.');
    // العلامتان معاً: `mcpClient` يبقي نسبةَ الطلب إلى مساعده في أثر التدقيق، و`humanConfirmed`
    // يقول إن الضغطة وقعت — فيمرّ الحارس، ويستهلك المزلاجُ الذرّي داخل الأداة المعاينةَ كالمعتاد.
    const out = await runTool(
      { user: ctx.user, ip: ctx.ip, mcpClient: c.client || null, humanConfirmed: true },
      c.applyTool, { previewToken: token });
    await audit(ctx, {
      action: 'confirm', resource: 'ai_change', resourceId: token,
      sectorId: ctx.user?.sector_id || null,
      detail: { via: 'صفحة تغييرات تنتظر تأكيدك', tool: c.applyTool, summary: c.preview?.summary || null },
    });
    return { ok: true, summary: c.preview?.summary || null, result: out };
  });
}

/** «أرفض»: قرارٌ مؤرَّخ باسمه، والرمزُ يُحرق فلا يبقى له طريقٌ إلى الكتابة. */
export async function rejectChange(ctx, token) {
  if (!token) throw badRequest('لا طلب لرفضه — حدّث الصفحة لترى ما ينتظرك.');
  const r = await rejectPending(ctx.user, token);
  if (!r.ok) throw badRequest(DECIDE_MESSAGE[r.reason] || DECIDE_MESSAGE.missing);
  await audit(ctx, {
    action: 'reject', resource: 'ai_change', resourceId: token,
    sectorId: ctx.user?.sector_id || null, detail: { via: 'صفحة تغييرات تنتظر تأكيدك' },
  });
  return { ok: true };
}
