// Employee (team) management API — full CRUD for the team page («الفريق»). Thin handlers →
// org service, which enforces authz (can 'create'|'update'|'delete' employee) + writes audit.
// Mounted inside apiRouter (one line by the integration session), AFTER requireAuth().
import { Router } from 'express';
import * as org from './org.js';

export const employeesRouter = Router();
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// ── الموظفون (الفريق) ──
employeesRouter.post('/employees', h((req) => org.createEmployee(req.ctx, req.body || {})));
employeesRouter.patch('/employees/:id', h((req) => org.updateEmployee(req.ctx, req.params.id, req.body || {})));
employeesRouter.delete('/employees/:id', h((req) => org.softDeleteEmployee(req.ctx, req.params.id)));
