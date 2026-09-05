// REST API aggregator. Thin handlers → services (which enforce authz + audit).
import { Router } from 'express';
import { requireAuth } from '../core/http/context.js';
import { forbidden } from '../core/http/errors.js';
import { seesCompanyPerformance } from '../core/policy/pages.js';
import * as opps from './crm/opportunities.js';
import * as projects from './pmo/projects.js';
import * as tasks from './pmo/tasks.js';
import * as capacity from './pmo/capacity.js';
import * as progress from './pmo/progress.js';
import * as ts from './timesheets/timesheets.js';
import * as wf from './workflow/engine.js';
import { pendingApprovalsFor } from './workflow/inbox.js';
import { setApprovalMailPolicy } from './workflow/approval-notify.js';
import { sendChannelTest } from '../core/mail/selftest.js';
import { muteFaultFor } from '../core/obs/admin.js';
import * as notif from './notifications/notify.js';
import * as org from './org/org.js';
import * as finance from './finance/finance.js';
import * as metrics from '../core/reports/metrics.js';
import * as intake from './intake/intake.js';
import { oppteamRouter } from './crm/oppteam.routes.js';
import { oppdocsRouter } from './crm/oppdocs.routes.js';
import { viewsRouter } from './views/views.routes.js';
import { clientsRouter } from './clients/clients.routes.js';
import { governanceRouter } from './pmo/governance.routes.js';
import { notesRouter } from './pmo/notes.routes.js';
import { ioRouter } from './io/io.routes.js';
import { employeesRouter } from './org/employees.routes.js';
import * as remove from '../core/lifecycle/remove.js';
import { orgRouter } from './org/org.routes.js';
import { attributionRouter } from './org/attribution.routes.js';
import { backupRouter } from './backup.routes.js';
import { guideRouter } from './guide/guide.routes.js';
import { searchRouter } from './search/search.routes.js';
import { reportsRouter } from './reports.routes.js';
import { moneyRouter } from './finance/money.routes.js';
import { identityRouter } from './identity/identity.routes.js';
import { eventsRouter } from './events/events.routes.js';
// وحدة الفريق والموارد (ADR-0016) — خمسة موجّهات تحت `/team/...`
import { teamResourcesRouter } from './team/team-resources.routes.js';
import { teamAllocationsRouter } from './team/team-allocations.routes.js';
import { teamNeedsRouter } from './team/team-needs.routes.js';
import { teamAnalysisRouter } from './team/team-analysis.routes.js';
import { teamCloseRouter } from './team/team-close.routes.js';

export const apiRouter = Router();
apiRouter.use(requireAuth());
apiRouter.use(oppteamRouter);
apiRouter.use(oppdocsRouter);
apiRouter.use(viewsRouter);
apiRouter.use(clientsRouter);
apiRouter.use(governanceRouter);
apiRouter.use(notesRouter);
apiRouter.use(ioRouter);
apiRouter.use(employeesRouter);
apiRouter.use(orgRouter);
apiRouter.use(attributionRouter);
apiRouter.use(backupRouter);
apiRouter.use(guideRouter);
apiRouter.use(searchRouter);
apiRouter.use(reportsRouter);
apiRouter.use(moneyRouter);
apiRouter.use(identityRouter);
apiRouter.use(eventsRouter);
apiRouter.use(teamResourcesRouter);
apiRouter.use(teamAllocationsRouter);
apiRouter.use(teamNeedsRouter);
apiRouter.use(teamAnalysisRouter);
apiRouter.use(teamCloseRouter);
const h = (fn) => async (req, res, next) => { try { const r = await fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

// ── Opportunities / CRM ──
apiRouter.get('/opportunities', h((req) => opps.listOpportunities(req.ctx.user, req.query)));
apiRouter.post('/opportunities', h((req) => opps.createOpportunity(req.ctx, req.body)));
apiRouter.get('/opportunities/:id', h((req) => opps.getOpportunity(req.ctx.user, req.params.id)));
apiRouter.get('/opportunities/:id/detail', h((req) => opps.opportunityDetail(req.ctx.user, req.params.id)));
apiRouter.patch('/opportunities/:id', h((req) => opps.updateOpportunity(req.ctx, req.params.id, req.body)));
apiRouter.post('/opportunities/:id/stage', h((req) => opps.moveStage(req.ctx, req.params.id, req.body.stage, req.body.note)));
apiRouter.post('/opportunities/:id/sector', h((req) => opps.moveSector(req.ctx, req.params.id, req.body.sector, req.body.note)));
apiRouter.get('/pipeline', h((req) => opps.pipelineSummary(req.ctx.user)));

// ── Projects ──
apiRouter.get('/projects', h((req) => projects.listProjects(req.ctx.user, req.query)));
apiRouter.post('/projects', h((req) => projects.createProject(req.ctx, req.body)));
apiRouter.get('/projects/:id', h((req) => projects.getProject(req.ctx.user, req.params.id)));
apiRouter.patch('/projects/:id', h((req) => projects.updateProject(req.ctx, req.params.id, req.body)));
apiRouter.post('/intake/parse', h(async (req) => intake.parseContract(req.ctx.user, req.body || {})));
apiRouter.post('/intake/create', h((req) => intake.createFromIntake(req.ctx, req.body || {})));
// مخرجات مشروعٍ قائم: قراءةٌ ثم كتابة بنداءين — الاستخراج يُراجَع قبل أن يُحفظ.
apiRouter.post('/projects/:id/deliverables/parse', h((req) => intake.parseDeliverables(req.ctx.user, req.params.id, req.body || {})));
apiRouter.post('/projects/:id/deliverables/bulk', h((req) => intake.addDeliverables(req.ctx, req.params.id, (req.body || {}).deliverables)));
apiRouter.get('/projects/:id/staffing', h((req) => projects.projectStaffing(req.ctx.user, req.params.id, req.query)));
// الطاقة والضغط: «من المتاح» و«ما حال فريق المشروع» — مصدر واحد للشاشتين معاً.
apiRouter.get('/projects/:id/candidates', h((req) => capacity.staffingCandidates(req.ctx.user, req.params.id, req.query)));
apiRouter.get('/projects/:id/team-load', h((req) => capacity.projectTeamLoad(req.ctx.user, req.params.id, req.query)));
// النسب الأربع من مصدرها الواحد — لا تُعاد حسبتها في أي شاشة.
apiRouter.get('/projects/:id/progress', h(async (req) => {
  await projects.getProject(req.ctx.user, req.params.id); // الحارس قبل الحساب
  return progress.projectProgress(req.params.id);
}));
apiRouter.get('/projects/:id/documents', h((req) => projects.projectDocuments(req.ctx.user, req.params.id)));
apiRouter.post('/projects/:id/documents', h((req) => projects.addProjectDocument(req.ctx, req.params.id, req.body || {})));
apiRouter.delete('/projects/documents/:docId', h((req) => projects.deleteProjectDocument(req.ctx, req.params.docId)));
apiRouter.get('/projects/:id/updates', h((req) => projects.projectUpdates(req.ctx.user, req.params.id, req.query.limit)));
apiRouter.post('/projects/:id/staff', h((req) => projects.assignEmployee(req.ctx, req.params.id, req.body)));
// تسكينٌ على عمل داخلي — بلا مشروع، فلا مسار تحت `/projects`: حارسه مِلكُ أمر الموظف لا المشروع.
apiRouter.post('/staffing/internal', h((req) => projects.assignInternalWork(req.ctx, req.body || {})));
// دفعة تسكين ذرّية (v5.26): معاينة الشاشة ثم تطبيقٌ واحد — التفويض والتدقيق داخل كل عملية.
apiRouter.post('/staffing/bulk', h((req) => projects.bulkStaffing(req.ctx, req.body || {})));
// ── الحذف المحروس: المشروع والفرصة ──
// لم يكن في المنتج حذفٌ لأيٍّ منهما، فبياناتٌ مستوردة لا سبيل إلى تنظيفها إلا بفتح القاعدة
// يدوياً — خارج التدقيق وخارج الصلاحيات. والحراسة في مكانٍ واحد (core/lifecycle/remove.js):
// المال يمنع الحذف دائماً، والتابع يُحذف مع أصله، والرفض يُشرح بعدده واسمه.
// فحص الحذف صار معاينةً كاملة (removalPreview): الموانع كما كانت، ومعها **ما سيُسحب تبعاً
// بعدده** — فالشاشة تقول «سيُسحب معها: مستندان ومهمة» قبل التأكيد لا بعده. المفتاحان
// القديمان (blockers/removable) باقيان كما هما لمن يقرؤهما.
apiRouter.get('/projects/:id/removal-check', h(async (req) => {
  await projects.getProject(req.ctx.user, req.params.id); // الحارس قبل كشف موانع الحذف
  return remove.removalPreview('project', req.params.id, req.ctx);
}));
apiRouter.delete('/projects/:id', h((req) => remove.removeRecord(req.ctx, 'project', req.params.id, { reason: (req.body || {}).reason })));
apiRouter.get('/opportunities/:id/removal-check', h(async (req) => {
  await opps.getOpportunity(req.ctx.user, req.params.id); // الحارس قبل كشف موانع الحذف
  return remove.removalPreview('opportunity', req.params.id, req.ctx);
}));
apiRouter.delete('/opportunities/:id', h((req) => remove.removeRecord(req.ctx, 'opportunity', req.params.id, { reason: (req.body || {}).reason })));
apiRouter.delete('/projects/staff/:allocId', h((req) => projects.unassignEmployee(req.ctx, req.params.allocId)));
apiRouter.patch('/projects/staff/:allocId', h((req) => projects.setAllocation(req.ctx, req.params.allocId, req.body)));
apiRouter.get('/projects/:id/tasks', h((req) => tasks.projectTasks(req.ctx.user, req.params.id)));
apiRouter.get('/projects/:id/kpis', h(async (req) => {
  await projects.getProject(req.ctx.user, req.params.id); // الحارس قبل الحساب
  return metrics.projectKpis(req.params.id);
}));

// ── Tasks ──
apiRouter.get('/tasks/mine', h((req) => tasks.myTasks(req.ctx.user, req.query)));
apiRouter.post('/tasks/quick', h((req) => tasks.quickAddTask(req.ctx, req.body)));
apiRouter.get('/tasks/team', h((req) => tasks.teamTasks(req.ctx.user, { ...req.query })));
apiRouter.patch('/tasks/bulk', h((req) => tasks.bulkUpdateTasks(req.ctx, (req.body || {}).ids, (req.body || {}).patch || {})));
apiRouter.patch('/tasks/:id', h((req) => tasks.updateTask(req.ctx, req.params.id, req.body)));
apiRouter.delete('/tasks/:id', h((req) => tasks.deleteTask(req.ctx, req.params.id)));

// ── Timesheets ──
apiRouter.get('/timesheets/mine', h((req) => ts.myEntries(req.ctx.user, req.query)));
apiRouter.post('/timesheets', h((req) => ts.addEntry(req.ctx, req.body)));
apiRouter.post('/timesheets/submit', h((req) => ts.submitPeriod(req.ctx, req.body)));
apiRouter.post('/timesheets/:id/approve', h((req) => ts.approvePeriod(req.ctx, req.params.id, req.body.approve !== false)));

// ── Approvals ──
apiRouter.get('/approvals/queue', h((req) => wf.myApprovalQueue(req.ctx.user)));
// عدّاد الجرس: كم طلباً ينتظر قرار صاحب الجلسة — بدوره وبعينه معاً. عدٌّ ذاتي النطاق
// (لا يقرأ إلا ما وُجِّه إليه) وذاتي الانطفاء: يهبط بمجرد الحسم، بلا «تعليم كمقروء».
apiRouter.get('/approvals/pending-count', h(async (req) => ({ n: (await pendingApprovalsFor(req.ctx.user)).length })));
// سياسة بريد الاعتمادات — الحارس والتدقيق داخل الخدمة (مدير النظام وحده).
apiRouter.post('/mail/approval-policy', h((req) => setApprovalMailPolicy(req.ctx, req.body || {})));
// رسالة تجربة لقناةٍ بعينها — إلى عنوان صاحب الطلب وحده (لا مستقبِل في الجسم)، ولمدير النظام.
apiRouter.post('/mail/test', h((req) => sendChannelTest(req.ctx, req.body || {})));
// إسكاتُ عطلٍ في «صحة المنصة» — لمدير النظام وحده (الحارس في الخدمة).
apiRouter.post('/ops/fault/:fp/mute', h((req) => muteFaultFor(req.ctx, req.params.fp, req.body?.muted)));
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
apiRouter.patch('/org/departments/:id', h((req) => org.updateDepartment(req.ctx, req.params.id, req.body)));
apiRouter.delete('/org/departments/:id', h((req) => org.deleteDepartment(req.ctx, req.params.id)));
apiRouter.post('/org/units', h((req) => org.createUnit(req.ctx, req.body)));
apiRouter.get('/org/roster', h((req) => org.staffingRoster(req.ctx.user, { sector: req.query.sector, year: req.query.year, department: req.query.department })));
apiRouter.post('/org/employees', h((req) => org.createEmployee(req.ctx, req.body)));
apiRouter.patch('/org/employees/:id', h((req) => org.updateEmployee(req.ctx, req.params.id, req.body)));
apiRouter.patch('/org/employees/:id/move', h((req) => org.moveEmployee(req.ctx, req.params.id, req.body)));
// نقل دفعة واحدة — كل موظف فيها يمرّ بفحص النقل نفسه، والدفعة كلها في معاملة واحدة.
apiRouter.post('/org/employees/move', h((req) => org.moveEmployees(req.ctx, req.body)));

// ── Finance (contracts / invoices / progress claims / collections) ──
apiRouter.get('/finance/summary', h((req) => finance.financeSummary(req.ctx.user, Number(req.query.year) || undefined)));
apiRouter.get('/finance/by-pm', h((req) => finance.financeByPM(req.ctx.user, Number(req.query.year) || undefined)));
apiRouter.get('/finance/by-contract', h((req) => finance.financeByContract(req.ctx.user)));
apiRouter.get('/finance/contracts/:id', h((req) => finance.contractDetail(req.ctx.user, req.params.id)));
apiRouter.post('/finance/progress-claim', h((req) => finance.createProgressClaim(req.ctx, req.body)));
apiRouter.post('/finance/collections', h((req) => finance.recordCollection(req.ctx, req.body)));

// ── Metrics / dashboards ──
// QH-2: مقاييس الشركة/القطاع أرقام قيادية — ليست لكل مستخدم مسجَّل
// وسؤال «من هو قياديّ؟» يُسأل من مصدر واحد يشترك فيه هذا المسار وشاشة لوحة القيادة ومحفظة
// المشاريع والقائمة الجانبية والدليل والبحث: `seesCompanyPerformance` في سياسة الصفحات.
// كان السؤال هنا نسخةً محلية تقرأ عمود اتساع نافذة البيانات (`scope`) وتترجمه رتبةً قيادية،
// فكانت المشتريات — نافذتها شركية بحكم أن الموردين وأوامر الشراء عبر الشركة كلها — تستقبل
// إيراد كل قطاع ومبيعاته ومستهدفاته بلا منح تقرير أو مؤشر واحد. الشرط الآن من المنح،
// وموضعه واحد: لا يمكن أن تفتح الشاشة ويُغلق مصدر أرقامها، ولا العكس.
apiRouter.get('/metrics/company', h((req) => {
  if (!seesCompanyPerformance(req.ctx.user)) {
    throw forbidden('أرقام أداء الشركة الكاملة تحتاج صلاحية قراءة تقارير الشركة ومؤشراتها، وهي ليست ضمن دورك. اطلب من مدير النظام إضافتها إن كان عملك يحتاجها.');
  }
  return metrics.companyOverview(req.ctx.user, { year: req.query.year });
}));
apiRouter.get('/metrics/sector/:id', h((req) => {
  const u = req.ctx.user;
  if (u.scope !== 'company' && u.sector_id !== req.params.id) throw forbidden('مقاييس هذا القطاع خارج نطاقك');
  return metrics.sectorDashboard(u, req.params.id, { year: req.query.year });
}));
