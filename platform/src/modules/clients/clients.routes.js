// Clients + activities API — contracts §2. Thin handlers → clients service (authz + audit live
// there). Mounted inside apiRouter (one line by the integration session), AFTER requireAuth().
import { Router } from 'express';
import * as clients from './clients.js';

export const clientsRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// ── العملاء ──
clientsRouter.get('/clients', h((req) => clients.listClients(req.ctx.user, req.query)));
clientsRouter.post('/clients', h((req) => clients.createClient(req.ctx, req.body || {})));
clientsRouter.get('/clients/:id/360', h((req) => clients.clientOverview(req.ctx.user, req.params.id)));
clientsRouter.patch('/clients/:id', h((req) => clients.updateClient(req.ctx, req.params.id, req.body || {})));

// ── هوية الجهة: كشف التكرار ودمجه وفكّه ──
// القراءة مفتوحة لمن يقرأ الجهات؛ والدمج داخل الخدمة يشترط تعديلاً وحذفاً معاً.
clientsRouter.get('/clients/duplicates', h(async (req) => ({ pairs: await clients.likelyDuplicateClients(req.ctx.user) })));
clientsRouter.get('/clients/name-review', h((req) => clients.clientNameReview(req.ctx.user)));
clientsRouter.post('/clients/:id/confirm-name', h((req) => clients.confirmClientName(req.ctx, req.params.id, req.body || {})));
clientsRouter.post('/clients/merge', h((req) => clients.mergeClients(req.ctx, req.body || {})));
clientsRouter.post('/clients/:id/unmerge', h((req) => clients.unmergeClient(req.ctx, req.params.id)));

// ── جهات الاتصال ──
clientsRouter.post('/clients/:id/contacts', h((req) => clients.addContact(req.ctx, req.params.id, req.body || {})));
clientsRouter.patch('/contacts/:id', h((req) => clients.updateContact(req.ctx, req.params.id, req.body || {})));
clientsRouter.delete('/contacts/:id', h((req) => clients.deleteContact(req.ctx, req.params.id)));

// ── المستندات (بيانات وصفية بالرابط — امتداد إضافي للعقود، لا تعارض) ──
clientsRouter.post('/clients/:id/documents', h((req) => clients.addDocument(req.ctx, req.params.id, req.body || {})));

// ── الأنشطة (سجل التواصل) ──
clientsRouter.get('/activities', h((req) => clients.listActivities(req.ctx.user, req.query)));
clientsRouter.post('/activities', h((req) => clients.logActivity(req.ctx, req.body || {})));
