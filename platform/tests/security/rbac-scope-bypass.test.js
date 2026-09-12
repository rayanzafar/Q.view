// انحياز أمني حرج اكتُشف بتدقيق مستقل: scopeReaches() كان يمرّر فحص نطاق «المشروع» دائماً لأن
// صف المشروع نفسه لا يحمل عمود project_id (فقط id)، فيسمح لأي project_manager/consultant/employee
// بقراءة وتعديل أي مشروع خارج تسكينه (IDOR على مستوى الشركة). نفس الشكل يتكرر مع نطاق «الفريق»
// (بلا أي بيانات عضوية فريق حقيقية في أي مكان بالمنصة) ومع اعتماد كشوف الدوام حسب الإدارة (كانت
// department_id غير محلولة إطلاقاً لا في المستخدم ولا في الهدف). ثلاثتها أُصلحت هنا وتُختبر معاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-rbacbug-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac, scopeReaches } = await import('../../src/core/rbac/index.js');
await initRbac();
const { resolveUser } = await import('../../src/core/http/context.js');
const { getProject, updateProject } = await import('../../src/modules/pmo/projects.js');
const { approvePeriod } = await import('../../src/modules/timesheets/timesheets.js');
const { companyOverview } = await import('../../src/core/reports/metrics.js');

const T = '2026-07-01T00:00:00Z';
const FAR_FUTURE = '2099-01-01T00:00:00Z';
const session = async (id, userId) => insert('session', { id, user_id: userId, created_at: T, expires_at: FAR_FUTURE });

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('project', { id: 'P_MINE', name_ar: 'مشروعي', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', contract_value_halalas: 1000, created_at: T });
  await insert('project', { id: 'P_OTHER', name_ar: 'مشروع آخر لا أنتمي له', sector_id: 'S1', status: 'IN_PROGRESS', rag: 'GREEN', contract_value_halalas: 2000, created_at: T });

  await insert('employee', { id: 'e_pm', name_ar: 'مدير مشروع الاختبار', sector_id: 'S1', created_at: T });
  await insert('app_user', { id: 'u_pm', username: 'test.pm', role_id: 'project_manager', scope: 'own', sector_id: 'S1', employee_id: 'e_pm', active: 1, created_at: T });
  await insert('membership', { id: 'm1', employee_id: 'e_pm', group_kind: 'project', group_id: 'P_MINE', created_at: T });
  await session('sess_pm', 'u_pm');

  // إدارتان (D1/D2) لاختبار اعتماد كشف الدوام حسب الإدارة
  await insert('department', { id: 'D1', sector_id: 'S1', name_ar: 'إدارة 1', active: 1, created_at: T });
  await insert('department', { id: 'D2', sector_id: 'S1', name_ar: 'إدارة 2', active: 1, created_at: T });
  await insert('employee', { id: 'e_mgr', name_ar: 'مدير إدارة 1', sector_id: 'S1', department_id: 'D1', created_at: T });
  await insert('app_user', { id: 'u_deptmgr', username: 'test.deptmgr', role_id: 'department_manager', scope: 'own', sector_id: 'S1', employee_id: 'e_mgr', active: 1, created_at: T });
  await session('sess_deptmgr', 'u_deptmgr');
  await insert('employee', { id: 'e_in', name_ar: 'موظف داخل إدارة 1', sector_id: 'S1', department_id: 'D1', created_at: T });
  await insert('app_user', { id: 'u_in', username: 'test.in', role_id: 'employee', scope: 'own', sector_id: 'S1', employee_id: 'e_in', active: 1, created_at: T });
  await insert('employee', { id: 'e_out', name_ar: 'موظف خارج إدارة 1', sector_id: 'S1', department_id: 'D2', created_at: T });
  await insert('app_user', { id: 'u_out', username: 'test.out', role_id: 'employee', scope: 'own', sector_id: 'S1', employee_id: 'e_out', active: 1, created_at: T });
  await insert('timesheet_period', { id: 'tsp_in', user_id: 'u_in', period_start: '2026-07-01', period_end: '2026-07-07', status: 'SUBMITTED', created_at: T });
  await insert('timesheet_period', { id: 'tsp_out', user_id: 'u_out', period_start: '2026-07-01', period_end: '2026-07-07', status: 'SUBMITTED', created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── scopeReaches: الوحدة الأساسية ──
test('scopeReaches: project — صف المشروع (target.id لا target.project_id) يُفحص فعلياً لا يُمرَّر دائماً', () => {
  const user = { projectIds: new Set(['P_MINE']) };
  assert.equal(scopeReaches(user, 'project', { id: 'P_MINE' }), true, 'مسموح للمشروع المُسنَد فعلياً');
  assert.equal(scopeReaches(user, 'project', { id: 'P_OTHER' }), false, 'ممنوع لمشروع خارج العضوية — كان يمرّ دائماً قبل الإصلاح');
});

test('scopeReaches: team — رفض افتراضي (لا توجد بيانات عضوية فريق حقيقية بأي مكان بعد)', () => {
  assert.equal(scopeReaches({ teamIds: new Set() }, 'team', { team_id: 'T1' }), false);
  assert.equal(scopeReaches({ teamIds: new Set() }, 'team', {}), false, 'بلا team_id كان يمرّ دائماً قبل الإصلاح');
});

const isDenied = (err) => err.code === 'forbidden' || err.code === 'not_found';

// ── IDOR حقيقي كان مؤكَّداً: project_manager يقرأ/يعدّل مشروعاً خارج تسكينه ──
test('getProject: project_manager يرى مشروعه المُسنَد فقط، ويُمنع من مشروع آخر بنفس القطاع', async () => {
  const user = await resolveUser('sess_pm');
  assert.ok(await getProject(user, 'P_MINE'), 'يجب أن يرى مشروعه');
  await assert.rejects(() => getProject(user, 'P_OTHER'), isDenied, 'كان يرى مشروعاً لا ينتمي له (IDOR)');
});

test('updateProject: project_manager يُمنع من تعديل مشروع خارج تسكينه', async () => {
  const user = await resolveUser('sess_pm');
  await assert.rejects(() => updateProject({ user, ip: '127.0.0.1' }, 'P_OTHER', { status: 'CANCELLED' }),
    isDenied, 'كان يستطيع تعديل مشروع لا ينتمي له (كتابة IDOR)');
});

// ── اعتماد كشف الدوام حسب الإدارة: كان يمرّ لأي إدارة قبل الإصلاح ──
test('approvePeriod: مدير الإدارة يعتمد كشف موظف إدارته، ويُمنع من كشف إدارة أخرى', async () => {
  const mgr = await resolveUser('sess_deptmgr');
  assert.equal(mgr.department_id, 'D1', 'يجب أن تُحسَب إدارة المستخدم فعلياً من ربط الموظف — كانت null دائماً قبل الإصلاح');
  const ok = await approvePeriod({ user: mgr, ip: '127.0.0.1' }, 'tsp_in', true);
  assert.equal(ok.status, 'APPROVED');
  await assert.rejects(() => approvePeriod({ user: mgr, ip: '127.0.0.1' }, 'tsp_out', true),
    isDenied, 'كان يعتمد كشف موظف من إدارة أخرى تماماً (تجاوز نطاق حرج)');
});

// ── تقرير الشركة الكامل: كان بلا أي فحص صلاحية إطلاقاً ──
test('companyOverview: يُرفض لغير مستخدمي النطاق الشركي (كان بلا فحص إطلاقاً)', async () => {
  await assert.rejects(() => companyOverview({ id: 'x', role_id: 'consultant', scope: 'own' }),
    isDenied, 'كان أي مستخدم مسجَّل دخول يرى إيراد/مبيعات/خط فرص الشركة كاملة');
});

test('companyOverview: يعمل طبيعياً لمستخدم النطاق الشركي', async () => {
  const ov = await companyOverview({ id: 'ceo', role_id: 'ceo_office', scope: 'company' });
  assert.ok(ov.totals, 'يجب أن يرجع البيانات كاملة لمن يملك النطاق الصحيح');
});
