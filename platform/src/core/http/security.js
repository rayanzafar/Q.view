// ترويسات الأمان + مُقيّد معدل الطلبات — بلا اعتماديات خارجية.
// CSP بوضع Report-Only أولاً (الصفحات القائمة تستخدم onclick داخلياً)؛ التحويل إلى
// enforcing قرار إصدار لاحق بعد اكتمال الانتقال إلى data-action (انظر docs/SECURITY-REPORT.md).
import { config } from '../config.js';

// مسارا معاينة داخليان فقط يُضمَّنان فعلياً بـ<iframe> من نفس المنصة (معاينة التقرير في صفحة
// التقارير، ومعاينة رسالة من صندوق المعاينة في مركز البريد) — كلاهما خلف تسجيل الدخول
// (requireWeb) أصلاً. الحجب الافتراضي DENY يمنعهما تماماً حتى من نفس الأصل فتظهر المعاينة
// فارغة بصمت؛ الإصلاح تضييق الاستثناء لهذين المسارين فقط (SAMEORIGIN)، لا رفع الحماية عالمياً.
const FRAMEABLE_SAMEORIGIN = [/^\/app\/reports\/preview\//, /^\/app\/mail\/preview\//];

export function securityHeaders() {
  const csp = (allowSelfFrame) => [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    allowSelfFrame ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return (req, res, next) => {
    const frameableSameOrigin = FRAMEABLE_SAMEORIGIN.some((re) => re.test(req.path));
    res.setHeader('X-Frame-Options', frameableSameOrigin ? 'SAMEORIGIN' : 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy-Report-Only', csp(frameableSameOrigin));
    if (config.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

// دلو رموز بسيط في الذاكرة لكل (مفتاح) — يكفي لعملية واحدة؛ العنقدة الأفقية عائق خارجي موثق.
function bucketLimiter({ capacity, refillPerSec, keyFn, redirectTo = null }) {
  const buckets = new Map();
  setInterval(() => { // تنظيف دوري كي لا تنمو الخريطة بلا حد
    const now = Date.now();
    for (const [k, b] of buckets) if (now - b.last > 15 * 60 * 1000) buckets.delete(k);
  }, 60 * 1000).unref();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, last: now }; buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      res.setHeader('Retry-After', Math.ceil(1 / refillPerSec));
      // نموذجُ الدخول صفحةٌ لا واجهة برمجية: من يرسله متصفّحٌ ينتظر صفحة. وردُّ الحمولة الخام
      // كان يعرض للموظف نصاً تقنياً بين أقواس معقوفة مكان صفحة الدخول — والتفعيل لكل الموظفين
      // يجعل تعثّر كلمة المرور في أول يوم أمراً متوقَّعاً لا نادراً. فيُعاد إلى صفحته برسالته.
      const dest = typeof redirectTo === 'function' ? redirectTo(req) : redirectTo;
      if (dest) return res.redirect(dest);
      return res.status(429).json({ error: 'محاولات كثيرة خلال وقت قصير — انتظر قليلاً ثم أعد المحاولة' });
    }
    b.tokens -= 1;
    next();
  };
}

// تسجيل الدخول: 10 محاولات ثم قطرة كل 6 ثوانٍ لكل IP (فوق قفل الحساب الموجود أصلاً)
// دلوٌ **واحد** يخدم المسارين معاً: لو أُنشئ لكلٍّ دلوُه لصار المسموح عشرين محاولة لا عشراً،
// ولانفتح الباب بالتبديل بينهما. والفرق في الردّ لا في العدّ: المتصفّح يُعاد إلى صفحة الدخول
// برسالتها، والواجهة البرمجية تأخذ ٤٢٩.
export const loginLimiter = bucketLimiter({ capacity: 10, refillPerSec: 1 / 6, keyFn: (req) => `L:${req.ip}`,
  redirectTo: (req) => (req.baseUrl === '/auth/login-web' ? '/login?e=2' : null) });
// واجهات JSON: سقف مريح يمنع الإغراق فقط (300 طلب ثم 20/ثانية لكل مستخدم/IP)
export const apiLimiter = bucketLimiter({ capacity: 300, refillPerSec: 20, keyFn: (req) => `A:${req.ctx?.user?.id || req.ip}` });

// طلب رمز الدخول — دلوان لا دلوٌ واحد، لأن لكلٍّ منهما إساءةً مختلفة:
//  · بالعنوان: يمنع من يطلب رموزاً لمئة بريد من مكان واحد كي يستكشف من له حساب.
//  · بالبريد: يمنع إغراق صندوق موظفٍ بعينه من عناوين متفرقة — وهو أذى لا يحتاج اختراقاً.
// خمسةٌ ثم قطرة كل دقيقة: يكفي لمن أخطأ وأعاد، ولا يكفي لمن يُغرق.
const otpKeyEmail = (req) => `O:${String(req.body?.email || req.cookies?.sanad_otp_to || '').trim().toLowerCase() || req.ip}`;
export const otpEmailLimiter = bucketLimiter({ capacity: 5, refillPerSec: 1 / 60, keyFn: otpKeyEmail, redirectTo: '/login?e=2' });
export const otpIpLimiter = bucketLimiter({ capacity: 15, refillPerSec: 1 / 20, keyFn: (req) => `OI:${req.ip}`, redirectTo: '/login?e=2' });

// التحقق من الرمز: دلوٌ خاص به لا `loginLimiter`. سببان:
//  · تحويلة loginLimiter مشروطة بأن يكون المسار /auth/login-web؛ فعلى أي مسار آخر تُرجع null
//    فيسقط الطلب إلى ٤٢٩ بحمولة خام — وهو بالضبط العيب الذي يحذّر منه تعليق ذلك الدلو: متصفّحٌ
//    ينتظر صفحةً فيرى نصاً تقنياً بين أقواس معقوفة.
//  · وخلطُ دلوَي كلمة المرور والرمز يجعل محاولات إحداهما تستنفد الأخرى، فيُمنع من يدخل بالرمز
//    بسبب محاولات كلمة مرورٍ لا يستعملها أصلاً.
// والحدّ هنا طبقةٌ ثانية فوق سقف المحاولات الخمس المحفور في الرمز نفسه (ذاك يحرق الرمز، وهذا
// يبطّئ من يجرّب رموزاً متتالية) — فيسعُه أن يكون أوسع دون أن يُضعِف الحماية.
export const otpVerifyLimiter = bucketLimiter({ capacity: 20, refillPerSec: 1 / 3, keyFn: (req) => `OV:${req.ip}`, redirectTo: '/login?e=2' });
