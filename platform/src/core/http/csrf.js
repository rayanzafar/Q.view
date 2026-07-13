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
    const exempt = req.path === '/auth/login-web';
    if (!exempt && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && isForm) {
      const sent = req.body?._csrf || req.get('x-csrf-token');
      if (!sent || sent !== token) return next(forbidden('رمز الحماية غير صالح (CSRF)'));
    }
    next();
  };
}
