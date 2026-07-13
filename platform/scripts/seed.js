// Seed system config (workflows, report/kpi definitions, a demo schedule) + demo accounts per role.
import { run, get, insert } from '../src/core/db/index.js';
import { hashPassword } from '../src/core/auth/password.js';
import { id, nowIso } from '../src/core/util/ids.js';

const DEMO_PW = 'Sanad@2026';

const WORKFLOWS = [
  { key: 'opportunity_go_nogo', name: 'قرار المشاركة (Go/No-Go)', resource: 'opportunity',
    steps: [{ role: 'sector_lead', name: 'اعتماد قائد القطاع' }] },
  { key: 'proposal_approval', name: 'اعتماد العرض والتسعير', resource: 'proposal',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }, { role: 'finance', name: 'اعتماد المالية', min: 5000000 }] },
  { key: 'expense_approval', name: 'اعتماد المصروف', resource: 'expense',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }, { role: 'finance', name: 'اعتماد المالية', min: 2000000 }] },
  { key: 'timesheet_approval', name: 'اعتماد سجل الوقت', resource: 'timesheet',
    steps: [{ role: 'line_manager', name: 'اعتماد المدير المباشر' }] },
  { key: 'deliverable_acceptance', name: 'اعتماد المخرج', resource: 'deliverable',
    steps: [{ role: 'sector_lead', name: 'اعتماد القطاع' }] },
];

const REPORTS = [
  { key: 'weekly_exec_brief', name: 'الموجز التنفيذي الأسبوعي', level: 'company' },
  { key: 'sector_weekly_status', name: 'حالة القطاع الأسبوعية', level: 'sector' },
  { key: 'monthly_sector_performance', name: 'أداء القطاع الشهري', level: 'sector' },
  { key: 'project_status_report', name: 'تقرير حالة المشروع (RAG)', level: 'project' },
  { key: 'workforce_utilization', name: 'تقرير القوى العاملة والإشغال', level: 'sector' },
  { key: 'opportunity_pipeline', name: 'تقرير خط الفرص', level: 'sector' },
];

const KPIS = [
  { key: 'on_time_completion', name_ar: 'الإنجاز في الوقت', level: 'project', unit: '%', dir: 'higher_better', amber: 80, red: 60 },
  { key: 'deliverable_acceptance', name_ar: 'قبول المخرجات', level: 'project', unit: '%', dir: 'higher_better', amber: 85, red: 70 },
  { key: 'utilization', name_ar: 'إشغال الموارد', level: 'team', unit: '%', dir: 'higher_better', amber: 65, red: 50 },
  { key: 'timesheet_compliance', name_ar: 'الالتزام بتسجيل الوقت', level: 'team', unit: '%', dir: 'higher_better', amber: 90, red: 75 },
  { key: 'win_rate', name_ar: 'معدل الفوز', level: 'sector', unit: '%', dir: 'higher_better', amber: 30, red: 20 },
  { key: 'pipeline_coverage', name_ar: 'تغطية خط الأنابيب', level: 'sector', unit: 'x', dir: 'higher_better', amber: 3, red: 2 },
  { key: 'ar_aging', name_ar: 'أعمار الذمم', level: 'company', unit: 'يوم', dir: 'lower_better', amber: 60, red: 90 },
];

const DEMO_USERS = [
  { u: 'demo.admin', role: 'admin', scope: 'company', name: 'مسؤول النظام (تجريبي)', sector: null },
  { u: 'demo.ceo', role: 'ceo_office', scope: 'company', name: 'مكتب الرئيس التنفيذي (تجريبي)', sector: null },
  { u: 'demo.sectorlead', role: 'sector_lead', scope: 'sector', name: 'قائد قطاع الحلول (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.bd', role: 'bd_manager', scope: 'own', name: 'مدير تطوير الأعمال (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.pm', role: 'project_manager', scope: 'own', name: 'مدير مشروع (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.finance', role: 'finance', scope: 'company', name: 'المالية (تجريبي)', sector: null },
  { u: 'demo.hr', role: 'hr', scope: 'company', name: 'الموارد البشرية (تجريبي)', sector: null },
  { u: 'demo.consultant', role: 'consultant', scope: 'own', name: 'استشاري (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.employee', role: 'employee', scope: 'own', name: 'موظف (تجريبي)', sector: 'SOLUTIONS' },
  { u: 'demo.viewer', role: 'viewer', scope: 'sector', name: 'مشاهد (تجريبي)', sector: 'SOLUTIONS' },
];

export function seed() {
  // workflows
  for (const w of WORKFLOWS) {
    let wf = get('SELECT id FROM workflow_definition WHERE key = ?', [w.key]);
    if (!wf) {
      const wid = id('wf');
      insert('workflow_definition', { id: wid, key: w.key, name_ar: w.name, target_resource: w.resource, active: 1, created_at: nowIso() });
      w.steps.forEach((s, i) => insert('approval_step', { id: id('ws'), workflow_id: wid, step_order: i + 1,
        approver_role: s.role, approver_scope: 'sector', min_amount_halalas: s.min ? s.min * 100 : 0, name_ar: s.name }));
    }
  }
  // report definitions
  for (const r of REPORTS) {
    if (!get('SELECT id FROM report_definition WHERE key = ?', [r.key]))
      insert('report_definition', { id: id('rd'), key: r.key, name_ar: r.name, level: r.level, detail_level: 'summary',
        locale: 'ar', template_key: r.key, active: 1, created_at: nowIso() });
  }
  // kpi definitions
  for (const k of KPIS) {
    if (!get('SELECT id FROM kpi_definition WHERE key = ?', [k.key]))
      insert('kpi_definition', { id: id('kpi'), key: k.key, name_ar: k.name_ar, name_en: null, level: k.level,
        unit: k.unit, direction: k.dir, rag_amber: k.amber, rag_red: k.red, active: 1 });
  }
  // demo accounts
  const hash = hashPassword(DEMO_PW);
  for (const d of DEMO_USERS) {
    let uid = get('SELECT id FROM app_user WHERE username = ?', [d.u])?.id;
    if (!uid) uid = id('u');
    run(`INSERT OR REPLACE INTO app_user (id, username, email, name_ar, role_id, sector_id, scope, password_hash, active, must_change_pw, created_at)
         VALUES (?,?,?,?,?,?,?,?,1,0,?)`,
      [uid, d.u, d.u + '@evc.com.sa', d.name, d.role, d.sector, d.scope, hash, nowIso()]);
  }
  // link sector lead + give demo.pm a project via membership (project scope)
  const lead = get("SELECT id FROM app_user WHERE username='demo.sectorlead'");
  if (lead) run('UPDATE sector SET lead_user_id = ? WHERE id = ?', [lead.id, 'SOLUTIONS']);
  const pm = get("SELECT id FROM app_user WHERE username='demo.pm'");
  const someProject = get("SELECT id FROM project WHERE sector_id='SOLUTIONS' AND deleted_at IS NULL LIMIT 1");
  if (pm && someProject) run('UPDATE project SET owner_user_id = ? WHERE id = ?', [pm.id, someProject.id]);

  // a demo weekly schedule (exec brief → a recipient group with demo.ceo)
  if (!get("SELECT id FROM report_schedule LIMIT 1")) {
    const gid = id('rg'); insert('recipient_group', { id: gid, name_ar: 'القيادة التنفيذية', created_at: nowIso() });
    const ceo = get("SELECT id FROM app_user WHERE username='demo.ceo'");
    if (ceo) insert('recipient', { id: id('rc'), group_id: gid, user_id: ceo.id, kind: 'to' });
    const rd = get("SELECT id FROM report_definition WHERE key='weekly_exec_brief'");
    insert('report_schedule', { id: id('rs'), report_id: rd.id, recipient_group_id: gid, frequency: 'weekly',
      day_of_week: 0, send_time: '08:00', active: 1, created_at: nowIso() });
  }
  console.log('✓ seed complete — demo accounts (password: ' + DEMO_PW + '):');
  DEMO_USERS.forEach((d) => console.log(`   ${d.u}  →  ${d.role}`));
}

if (import.meta.url === `file://${process.argv[1]}`) seed();
