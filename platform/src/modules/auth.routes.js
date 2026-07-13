import { Router } from 'express';
import { login, logout, changePassword } from '../core/auth/service.js';
import { config } from '../core/config.js';
import { badRequest, unauthorized } from '../core/http/errors.js';

export const authRouter = Router();

function setSessionCookie(res, sid) {
  res.cookie(config.sessionCookie, sid, {
    httpOnly: true, sameSite: 'lax', secure: config.env === 'production',
    maxAge: config.sessionTtlHours * 3600000, path: '/',
  });
}

authRouter.post('/login', (req, res, next) => {
  const { username, password } = req.body || {};
  if (!username || !password) return next(badRequest('اسم المستخدم وكلمة المرور مطلوبان'));
  const r = login({ username, password, ip: req.ip, userAgent: req.get('user-agent') });
  if (!r.ok) {
    const msg = r.reason === 'locked' ? 'الحساب مقفل مؤقتًا بعد محاولات فاشلة'
      : r.reason === 'inactive' ? 'الحساب معطّل' : 'بيانات الدخول غير صحيحة';
    return res.status(401).json({ error: { code: 'auth_failed', message: msg } });
  }
  setSessionCookie(res, r.sessionId);
  res.json({ ok: true, mustChangePassword: r.mustChangePassword,
    user: { id: r.user.id, username: r.user.username, name_ar: r.user.name_ar, role_id: r.user.role_id } });
});

authRouter.post('/logout', (req, res) => {
  logout(req.cookies?.[config.sessionCookie]);
  res.clearCookie(config.sessionCookie, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', (req, res, next) => {
  if (!req.ctx?.user) return next(unauthorized());
  const u = req.ctx.user;
  res.json({ user: { id: u.id, username: u.username, name_ar: u.name_ar, name_en: u.name_en,
    role_id: u.role_id, sector_id: u.sector_id, scope: u.scope } });
});

authRouter.post('/change-password', (req, res, next) => {
  if (!req.ctx?.user) return next(unauthorized());
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) return next(badRequest('كلمة المرور يجب أن تكون 8 أحرف على الأقل'));
  changePassword(req.ctx.user.id, newPassword);
  res.json({ ok: true });
});
