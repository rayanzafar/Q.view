// كعكةُ الجلسة — تعريفٌ واحد بدل ثلاث نسخ متطابقة.
//
// كانت خياراتُ الكعكة مكتوبةً حرفياً في ثلاثة مواضع (دخول الرمز، دخول كلمة المرور، واجهة
// الدخول البرمجية). ومع التدحرج صار لها موضعٌ رابع يُنادى مع كل طلب تقريباً — وأربع نسخٍ
// لخيارات أمانٍ واحدة تعني أن نسيان `httpOnly` في واحدةٍ منها لا يُكتشف إلا بمراجعة.
import { config } from '../config.js';

// `maxAge` يساوي نافذة الخمول لا السقف المطلق: المتصفّح شريكٌ في المهلة، وكعكةٌ تعيش شهراً
// بينما صفُّها ينتهي بعد اثنتي عشرة ساعة تُرسِل رمزاً ميّتاً في كل طلب — والقاعدة هي الحَكَم.
// ومع كل تمديدٍ للصفّ تُجدَّد الكعكة بنفس الطول، فيتحرّك الطرفان معاً.
export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.env === 'production',
  maxAge: config.sessionTtlHours * 3600000,
  path: '/',
});

export function setSessionCookie(res, sid) {
  res.cookie(config.sessionCookie, sid, sessionCookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookie, { path: '/' });
}
