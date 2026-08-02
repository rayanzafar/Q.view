// Opportunity-documents router (contracts §2). Thin: parse → service → JSON.
// Mounted under /api by api.routes.js; requireAuth runs at the /api mount so req.ctx.user
// is always present here. Authorization and audit live in the service, never here.
import { Router } from 'express';
import * as oppdocs from './oppdocs.js';

export const oppdocsRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

oppdocsRouter.get('/opportunities/:id/documents', h((req) => oppdocs.opportunityDocuments(req.ctx.user, req.params.id)));
oppdocsRouter.post('/opportunities/:id/documents', h((req) => oppdocs.addOpportunityDocument(req.ctx, req.params.id, req.body || {})));
oppdocsRouter.delete('/opportunities/documents/:docId', h((req) => oppdocs.deleteOpportunityDocument(req.ctx, req.params.docId)));
