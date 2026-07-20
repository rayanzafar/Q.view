// Project-governance REST router (risks/issues/decisions/changes/milestones).
// Mounted by ONE line in api.routes.js (integration session): apiRouter.use(governanceRouter);
// — it must sit under the authenticated /api router (requireAuth runs there).
import { Router } from 'express';
import * as gov from './governance.js';

export const governanceRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// plural route segment → kind key in the service
const PLURALS = { risks: 'risk', issues: 'issue', decisions: 'decision', changes: 'change', milestones: 'milestone' };

// Composite payload (all five registers + canEdit) for page hydration.
governanceRouter.get('/projects/:id/governance', h((req) => gov.projectGovernance(req.ctx.user, req.params.id)));

for (const [plural, kind] of Object.entries(PLURALS)) {
  governanceRouter.get(`/projects/:id/${plural}`, h((req) => gov.listItems(req.ctx.user, req.params.id, kind)));
  governanceRouter.post(`/projects/:id/${plural}`, h((req) => gov.createItem(req.ctx, req.params.id, kind, req.body || {})));
}
for (const kind of Object.values(PLURALS)) {
  governanceRouter.patch(`/pmo/${kind}/:id`, h((req) => gov.updateItem(req.ctx, kind, req.params.id, req.body || {})));
  governanceRouter.delete(`/pmo/${kind}/:id`, h((req) => gov.deleteItem(req.ctx, kind, req.params.id)));
}
