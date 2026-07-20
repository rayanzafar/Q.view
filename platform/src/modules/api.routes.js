// REST API aggregator. Thin handlers → services (which enforce authz + audit).
import { Router } from 'express';
import { requireAuth } from '../core/http/context.js';
import * as opps from './crm/opportunities.js';
import * as projects from './pmo/projects.js';
import * as tasks from './pmo/tasks.js';
import * as ts from './timesheets/timesheets.js';
import * as wf from './workflow/engine.js';
import * as notif from './notifications/notify.js';
import * as org from './org/org.js';
import * as finance from './finance/finance.js';
import * as metrics from '../core/reports/metrics.js';
import * as intake from './intake/intake.js';

export const apiRouter = Router();
apiRouter.use(requireAuth());
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// ── Opportunities / CRM ──
apiRouter.get('/opportunities', h((req) => opps.listOpportunities(req.ctx.user, req.query)));
apiRouter.post('/opportunities', h((req) => opps.createOpportunity(req.ctx, req.body)));
apiRouter.get('/opportunities/:id', h((req) => opps.getOpportunity(req.ctx.user, req.params.id)));
apiRouter.get('/opportunities/:id/detail', h((req) => opps.opportunityDetail(req.ctx.user, req.params.id)));
apiRouter.patch('/opportunities/:id', h((req) => opps.updateOpportunity(req.ctx, req.params.id, req.body)));
apiRouter.post('/opportunities/:id/stage', h((req) => opps.moveStage(req.ctx, req.params.id, req.body.stage, req.body.note)));
apiRouter.get('/pipeline', h((req) => opps.pipelineSummary(req.ctx.user)));

// ── Projects ──
apiRouter.get('/projects', h((req) => projects.listProjects(req.ctx.user, req.query)));
apiRouter.post('/projects', h((req) => projects.createProject(req.ctx, req.body)));
apiRouter.get('/projects/:id', h((req) => projects.getProject(req.ctx.user, req.params.id)));
apiRouter.patch('/projects/:id', h((req) => projects.updateProject(req.ctx, req.params.id, req.body)));
apiRouter.post('/intake/parse', h(async (req) => intake.parseContract(req.ctx.user, req.body || {})));
apiRouter.post('/intake/create', h((req) => intake.createFromIntake(req.ctx, req.body || {})));
apiRouter.get('/projects/:id/staffing', h((req) => projects.projectStaffing(req.ctx.user, req.params.id)));
apiRouter.post('/projects/:id/staff', h((req) => projects.assignEmployee(req.ctx, req.params.id, req.body)));
apiRouter.delete('/projects/staff/:allocId', h((req) => projects.unassignEmployee(req.ctx, req.params.allocId)));
apiRouter.patch('/projects/staff/:allocId', h((req) => projects.setAllocation(req.ctx, req.params.allocId, req.body)));
apiRouter.get('/projects/:id/tasks', h((req) => tasks.projectTasks(req.ctx.user, req.params.id)));
apiRouter.get('/projects/:id/kpis', h((req) => metrics.projectKpis(req.params.id)));

// ── Tasks ──
apiRouter.get('/tasks/mine', h((req) => tasks.myTasks(req.ctx.user, req.query)));
apiRouter.post('/tasks/quick', h((req) => tasks.quickAddTask(req.ctx, req.body)));
apiRouter.patch('/tasks/:id', h((req) => tasks.updateTask(req.ctx, req.params.id, req.body)));

// ── Timesheets ──
apiRouter.get('/timesheets/mine', h((req) => ts.myEntries(req.ctx.user, req.query)));
apiRouter.post('/timesheets', h((req) => ts.addEntry(req.ctx, req.body)));
apiRouter.post('/timesheets/submit', h((req) => ts.submitPeriod(req.ctx, req.body)));
apiRouter.post('/timesheets/:id/approve', h((req) => ts.approvePeriod(req.ctx, req.params.id, req.body.approve !== false)));

// ── Approvals ──
apiRouter.get('/approvals/queue', h((req) => wf.myApprovalQueue(req.ctx.user)));
apiRouter.post('/approvals', h((req) => wf.submitForApproval(req.ctx, req.body)));
apiRouter.post('/approvals/:id/act', h((req) => wf.actOnApproval(req.ctx, req.params.id, req.body.action, req.body.comment)));

// ── Notifications ──
apiRouter.get('/notifications', h((req) => notif.myNotifications(req.ctx.user, req.query.unread === '1')));
apiRouter.post('/notifications/:id/read', h(async (req) => { await notif.markRead(req.ctx.user, req.params.id); return { ok: true }; }));

// ── Organization (flexible hierarchy, editable) ──
apiRouter.get('/org/tree', h((req) => org.orgTree(req.ctx.user)));
apiRouter.post('/org/sectors', h((req) => org.createSector(req.ctx, req.body)));
apiRouter.patch('/org/sectors/:id', h((req) => org.updateSector(req.ctx, req.params.id, req.body)));
apiRouter.post('/org/departments', h((req) => org.createDepartment(req.ctx, req.body)));
apiRouter.post('/org/units', h((req) => org.createUnit(req.ctx, req.body)));
apiRouter.get('/org/roster', h((req) => org.staffingRoster(req.ctx.user, { sector: req.query.sector, year: req.query.year })));
apiRouter.post('/org/employees', h((req) => org.createEmployee(req.ctx, req.body)));
apiRouter.patch('/org/employees/:id', h((req) => org.updateEmployee(req.ctx, req.params.id, req.body)));
apiRouter.patch('/org/employees/:id/move', h((req) => org.moveEmployee(req.ctx, req.params.id, req.body)));

// ── Finance (contracts / invoices / progress claims / collections) ──
apiRouter.get('/finance/summary', h((req) => finance.financeSummary(req.ctx.user, Number(req.query.year) || undefined)));
apiRouter.get('/finance/by-pm', h((req) => finance.financeByPM(req.ctx.user, Number(req.query.year) || undefined)));
apiRouter.get('/finance/by-contract', h((req) => finance.financeByContract(req.ctx.user)));
apiRouter.get('/finance/contracts/:id', h((req) => finance.contractDetail(req.ctx.user, req.params.id)));
apiRouter.post('/finance/progress-claim', h((req) => finance.createProgressClaim(req.ctx, req.body)));
apiRouter.post('/finance/collections', h((req) => finance.recordCollection(req.ctx, req.body)));

// ── Metrics / dashboards ──
apiRouter.get('/metrics/company', h((req) => metrics.companyOverview(req.ctx.user, { year: req.query.year })));
apiRouter.get('/metrics/sector/:id', h((req) => metrics.sectorDashboard(req.ctx.user, req.params.id, { year: req.query.year })));
