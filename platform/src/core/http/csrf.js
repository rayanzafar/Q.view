// Double-submit CSRF protection for state-changing WEB form posts.
// (JSON API is additionally protected by SameSite=Lax session cookie.)
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { forbidden } from './errors.js';

export function csrf() {
  return (req, res, next) => {
    let token = req.cookies?.[config.csrfCookie];
    if (!token) {
      token = randomBytes(16).toString('hex');
      res.cookie(config.csrfCookie, token, { httpOnly: false, sameSite: 'lax', secure: config.env === 'production', path: '/' });
    }
    req.csrfToken = token;
    // enforce on unsafe web-form methods that post urlencoded data (not JSON API).
    // Login is exempt (pre-auth; standard) — the cookie is issued on GET /login.
    const isForm = (req.get('content-type') || '').includes('application/x-www-form-urlencoded');
    // مسارات ربط المساعد الثلاثة يناديها برنامجٌ خارجي بجسمٍ مُرمَّز (هذا ما يفرضه البروتوكول
    // القياسي)، ولا تستمد سلطتها من كعكة أبداً: كلٌّ منها يطالب بسرٍّ في الجسم نفسه (رمز الإذن
    // مع مفتاح تحققه، أو رمز التجديد). فطلبٌ يزوّره موقعٌ آخر من متصفّح الموظف لا ينال شيئاً —
    // لا يملك السرّ، وكعكة الموظف لا تُقرأ هنا. أما `/oauth/authorize` فنموذجُ متصفّحٍ حقيقي
    // يمنح إذناً، فيبقى محروساً كبقية النماذج.
    const exempt = req.path === '/auth/login-web'
      || ['/oauth/token', '/oauth/register', '/oauth/revoke'].includes(req.path);
    if (!exempt && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && isForm) {
      const sent = req.body?._csrf || req.get('x-csrf-token');
      if (!sent || sent !== token) return next(forbidden('رمز الحماية غير صالح (CSRF)'));
    }
    next();
  };
}
