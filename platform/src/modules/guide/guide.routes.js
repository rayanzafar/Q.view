// «دليلي» — معالجات رفيعة تنادي خدمة الدليل ولا تقرّر شيئاً بنفسها.
// التفويض كله داخل الخدمة: المحتوى نفسه مشتقّ من صلاحيات القارئ، فلا يوجد ما «يُحرَس» هنا.
// لا سطر تدقيق في هذا الموجّه عن قصد: كلا المسارين قراءة صرفة لا تغيّر صفاً واحداً،
// وسجل التدقيق مخصَّص للأفعال التي تغيّر البيانات لا لكل فتح شاشة.
// يُركَّب داخل apiRouter بسطر واحد من جلسة التكامل، بعد requireAuth().
import { Router } from 'express';
import * as guide from './guide.js';
import { notFound } from '../../core/http/errors.js';

export const guideRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// ── دليل صاحب الحساب: شاشاته هو، بترتيب رحلته، ومصطلحاته وحدوده ──
guideRouter.get('/guide', h((req) => guide.guideFor(req.ctx.user)));

// ── جولة شاشة واحدة: خطوات على عناصر حقيقية في الصفحة نفسها ──
// غياب الجولة وغياب الصلاحية يعطيان الرد نفسه — حتى لا يكشف الرد وجود شاشة لا يملكها القارئ.
guideRouter.get('/guide/tour/:page', h((req) => {
  const tour = guide.tourFor(req.ctx.user, req.params.page);
  if (!tour) throw notFound('لا توجد جولة إرشادية لهذه الشاشة ضمن دليلك. افتح «دليلي» لترى الشاشات المتاحة لك وجولاتها.');
  return tour;
}));
