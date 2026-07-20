// مسارات مركز البيانات (استيراد/تصدير) — Router مستقل يُركَّب بسطر واحد في api.routes.js
// (جلسة التكامل): apiRouter.use(ioRouter). المصادقة يوفرها apiRouter (requireAuth)،
// والصلاحيات تُفحص داخل المحرك لكل نوع ولكل صف.
import { Router } from 'express';
import express from 'express';
import * as engine from './engine.js';

export const ioRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// الأنواع المتاحة للمستخدم الحالي (تصديراً واستيراداً) مع أعمدتها
ioRouter.get('/io/types', h((req) => engine.listTypes(req.ctx.user)));

// تصدير ملف (format=xlsx|csv) أو قالب فارغ بصف مثال (template=1) — اسم الملف عربي مرمّز
ioRouter.get('/io/export/:type', async (req, res, next) => {
  try {
    const { buffer, mime, ext, fileName } = await engine.exportType(req.ctx, req.params.type, req.query);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="export.${ext}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (e) { next(e); }
});

// رفع الملف: جسم خام حتى 15MB + اسم الملف في ترويسة x-file-name
ioRouter.post('/io/import/:type/upload', express.raw({ type: '*/*', limit: '15mb' }),
  h((req) => engine.upload(req.ctx, req.params.type, req.body, decodeFileName(req.get('x-file-name')))));

// معاينة قبل التنفيذ: {runId, mapping, mode:add|upsert|replace, keyField?}
ioRouter.post('/io/import/:type/preview', h((req) => engine.preview(req.ctx, req.params.type, req.body || {})));

// التنفيذ: {runId, confirmToken} — الرمز يُصدر من آخر معاينة فقط
ioRouter.post('/io/import/:type/apply', h((req) => engine.apply(req.ctx, req.params.type, req.body || {})));

// سجل العمليات
ioRouter.get('/io/runs', h((req) => engine.listRuns(req.ctx.user, { type: req.query.type })));
ioRouter.get('/io/runs/:id', h((req) => engine.getRun(req.ctx.user, req.params.id)));
ioRouter.post('/io/runs/:id/undo', h((req) => engine.undo(req.ctx, req.params.id)));

// أسماء الملفات العربية تصل مرمّزة بـ encodeURIComponent من المتصفح (الترويسات ASCII فقط)
function decodeFileName(v) {
  if (!v) return '';
  try { return decodeURIComponent(v); } catch { return String(v); }
}
