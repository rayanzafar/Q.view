// مسار النسخة الاحتياطية — سطح حسّاس عمداً، ومحكوم بثلاث بوابات مستقلة:
//   (١) مُطفأ افتراضياً: بلا متغيّر البيئة SANAD_BACKUP_TOKEN لا وجود للمسار أصلاً (404).
//   (٢) جلسة مدير نظام فعلية — لا يكفي الرمز وحده.
//   (٣) رمز سرّي في ترويسة الطلب — لا تكفي الجلسة وحدها.
// وكل محاولة تُسجَّل في سجل التدقيق: الناجحة والفاشلة على السواء.
//
// النسخة تحوي كل الصفوف بما فيها الرواتب — لذلك بوابة مدير النظام هنا هي البوابة نفسها التي
// تحكم رؤية الراتب في المنصة، فلا تفتح هذه القناة ما لا يفتحه صاحبها أصلاً من الواجهة.
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { dumpLines, tableCounts } from '../core/backup/dump.js';
import { audit } from '../core/audit/index.js';
import { notFound, forbidden } from '../core/http/errors.js';

export const backupRouter = Router();

const secret = () => process.env.SANAD_BACKUP_TOKEN || '';

// مقارنة ثابتة الزمن: المقارنة النصية العادية تسرّب طول البادئة الصحيحة عبر توقيت الرد.
function tokenOk(sent) {
  const want = secret();
  if (!want || !sent) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function guard(req) {
  if (!secret()) throw notFound();                       // الميزة مُطفأة ⟵ لا نكشف وجودها
  const u = req.ctx?.user;
  if (!u || u.role_id !== 'admin') throw forbidden('النسخة الاحتياطية لمدير النظام فقط');
  if (!tokenOk(req.get('x-backup-token'))) throw forbidden('رمز النسخة الاحتياطية غير صحيح');
}

// عدّ الصفوف لكل جدول — للتحقق قبل/بعد الترحيل بلا تنزيل النسخة كاملة.
backupRouter.get('/backup/counts', async (req, res, next) => {
  try {
    guard(req);
    const counts = await tableCounts();
    await audit(req.ctx, { action: 'read', resource: 'backup', resourceId: 'counts' });
    res.json({ at: new Date().toISOString(), counts });
  } catch (e) { next(e); }
});

// النسخة نفسها — تُبَث سطراً سطراً فلا تُحمَّل قاعدة كاملة في الذاكرة.
backupRouter.get('/backup/dump', async (req, res, next) => {
  try {
    guard(req);
    await audit(req.ctx, { action: 'export', resource: 'backup', resourceId: 'dump' });
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for await (const line of dumpLines()) {
      if (!res.write(line + '\n')) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch (e) {
    if (res.headersSent) res.destroy(); else next(e);    // لا نُلحق خطأً بنسخة نصفية
  }
});
