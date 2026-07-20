// Saved-views router (contracts §2). Thin: parse → service → JSON.
// Mounted under /api by api.routes.js (integration adds the single mount line).
import { Router } from 'express';
import * as views from './views.js';

export const viewsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

viewsRouter.get('/views', h((req) => views.listViews(req.ctx.user, req.query.page)));
viewsRouter.post('/views', h((req) => views.saveView(req.ctx, req.body || {})));
viewsRouter.delete('/views/:id', h((req) => views.deleteView(req.ctx, req.params.id)));
viewsRouter.post('/views/:id/default', h((req) => views.setDefault(req.ctx, req.params.id)));
