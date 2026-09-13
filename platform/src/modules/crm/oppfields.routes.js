// الحقول الحرّة على الفرصة (الترحيلة 048، ADR-0024). رقيق: تحليلٌ ⟵ خدمة ⟵ JSON.
// يُركَّب تحت /api في api.routes.js؛ requireAuth يعمل عند التركيب فـreq.ctx.user حاضر دائماً.
// الصلاحية والتدقيق في الخدمة وحدها، لا هنا.
import { Router } from 'express';
import * as oppfields from './oppfields.js';

export const oppfieldsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

oppfieldsRouter.get('/opportunities/:id/fields', h((req) => oppfields.opportunityFields(req.ctx.user, req.params.id)));
// كتابةٌ بالاسم (قائمٌ يُحدَّث وجديدٌ يُضاف) أو بالمعرّف إن أُرسل في الحمولة (تسميةٌ أو تعديل).
oppfieldsRouter.post('/opportunities/:id/fields', h((req) => oppfields.setOpportunityField(req.ctx, req.params.id, req.body || {})));
oppfieldsRouter.delete('/opportunities/fields/:fieldId', h((req) => oppfields.removeOpportunityField(req.ctx, req.params.fieldId)));
