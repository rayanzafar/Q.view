// موجّه الفعاليات — رقيق: قراءة الطلب ⟵ نداء الخدمة ⟵ ردّ.
// مركَّب تحت /api من api.routes.js، و`requireAuth` يعمل عند نقطة التركيب فـ`req.ctx.user`
// حاضرٌ دائماً هنا. الصلاحيات والملكية والتدقيق داخل الخدمة وحدها — لا فحص في هذا الملف
// إطلاقاً، كي لا يوجد بابان للحكم على البطاقة نفسها.
//
// ترتيب المسارات مقصود: الحرفية («contacts/…»، «partners/…»، «parse-card») قبل «:id» —
// فلا يُقرأ «contacts» يوماً على أنه معرّف فعالية.
import { Router } from 'express';
import * as ev from './events.js';

export const eventsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

// قراءة بطاقة من نصّ — محلياً، بلا حفظ.
eventsRouter.post('/events/parse-card', h((req) => ev.parseCard(req.ctx.user, req.body || {})));

// الفعاليات
eventsRouter.get('/events', h((req) => ev.listEvents(req.ctx.user, req.query || {})));
eventsRouter.post('/events', h((req) => ev.createEvent(req.ctx, req.body || {})));

// البطاقة الواحدة
eventsRouter.get('/events/contacts/:cid', h((req) => ev.getContact(req.ctx.user, req.params.cid)));
eventsRouter.patch('/events/contacts/:cid', h((req) => ev.updateContact(req.ctx, req.params.cid, req.body || {})));
eventsRouter.post('/events/contacts/:cid/outcome', h((req) => ev.setOutcome(req.ctx, req.params.cid, req.body || {})));
eventsRouter.delete('/events/contacts/:cid', h((req) => ev.deleteContact(req.ctx, req.params.cid)));

// الشراكة الواحدة
eventsRouter.patch('/events/partners/:pid', h((req) => ev.updatePartner(req.ctx, req.params.pid, req.body || {})));
eventsRouter.delete('/events/partners/:pid', h((req) => ev.deletePartner(req.ctx, req.params.pid)));

// الفعالية الواحدة
eventsRouter.get('/events/:id', h(async (req) => ({
  event: await ev.getEvent(req.ctx.user, req.params.id),
  summary: await ev.eventSummary(req.ctx.user, req.params.id),
})));
eventsRouter.patch('/events/:id', h((req) => ev.updateEvent(req.ctx, req.params.id, req.body || {})));
eventsRouter.post('/events/:id/close', h((req) => ev.closeEvent(req.ctx, req.params.id, req.body || {})));
eventsRouter.delete('/events/:id', h((req) => ev.deleteEvent(req.ctx, req.params.id)));

// بطاقات الفعالية
eventsRouter.get('/events/:id/contacts', h((req) => ev.listContacts(req.ctx.user, req.params.id, req.query || {})));
eventsRouter.get('/events/:id/contacts/recent', h((req) => ev.recentContacts(req.ctx.user, req.params.id, req.query || {})));
eventsRouter.post('/events/:id/contacts', h((req) => ev.createContact(req.ctx, req.params.id, req.body || {})));

// شراكات الفعالية
eventsRouter.get('/events/:id/partners', h((req) => ev.listPartners(req.ctx.user, req.params.id)));
eventsRouter.post('/events/:id/partners', h((req) => ev.createPartner(req.ctx, req.params.id, req.body || {})));
