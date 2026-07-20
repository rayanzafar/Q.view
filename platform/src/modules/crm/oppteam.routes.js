// Opportunity-team router (contracts §2). Thin: parse → service → JSON.
// Mounted under /api by api.routes.js (integration session adds the single mount line);
// requireAuth runs at the /api mount so req.ctx.user is always present here.
import { Router } from 'express';
import * as oppteam from './oppteam.js';

export const oppteamRouter = Router();
const h = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e); } };

oppteamRouter.get('/opportunities/:id/team', h((req) => oppteam.getTeam(req.ctx.user, req.params.id)));
oppteamRouter.post('/opportunities/:id/team', h((req) => oppteam.addMember(req.ctx, req.params.id, req.body || {})));
oppteamRouter.delete('/opportunities/team/:membershipId', h((req) => oppteam.removeMember(req.ctx, req.params.membershipId)));
