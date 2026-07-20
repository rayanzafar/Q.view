// Deterministic demo-business fixture for the quality harness (tests + e2e + evidence).
//
// The committed repo carries NO business data (seed/*.demo.json is gitignored), so a freshly
// migrated+seeded DB has demo ACCOUNTS but empty sectors/pipeline/projects. This fixture layers a
// small, fixed business dataset on top so pages render real branches (kanban cards, rosters with
// salaries, finance bridge, approval queue) and the permissions matrix can assert content, not
// just statuses. Fixed ids (FX-…), fixed dates — no wall-clock dependence except `year` fields
// pinned to the app's fiscal year (2026).
//
// Usage (module):  process.env.SANAD_DB = <tmp>; await (await import('./seed-fixture.mjs')).seedFixture();
// Usage (CLI):     SANAD_DB=<tmp> node --experimental-sqlite scripts/lib/seed-fixture.mjs
// Idempotent: re-running on the same DB is a no-op (keyed on sector FX check).
import { get, run, insert, close } from '../../src/core/db/index.js';
import { nowIso } from '../../src/core/util/ids.js';

const YEAR = 2026;
const T = '2026-01-15T08:00:00.000Z'; // fixed created_at for determinism

const uid = async (username) => (await get('SELECT id FROM app_user WHERE username = ?', [username]))?.id || null;

export async function seedFixture() {
  if (await get("SELECT id FROM sector WHERE id = 'SOLUTIONS'")) return false; // already seeded

  // ── sectors ──
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', name_en: 'Solutions', color: '#2563eb',
    target_sales_halalas: 800_000_000, target_revenue_halalas: 600_000_000, target_margin_pct: 25,
    active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', name_en: 'Consulting', color: '#7c3aed',
    target_sales_halalas: 500_000_000, target_revenue_halalas: 400_000_000, target_margin_pct: 30,
    active: 1, sort_order: 2, created_at: T });

  // ── pipeline stages ──
  const stages = [
    ['LEAD', 'ترشيح', 10, 1, '#94a3b8', 0, 0], ['QUALIFIED', 'مؤهلة', 25, 2, '#0891b2', 0, 0],
    ['PROPOSAL', 'عرض مقدم', 50, 3, '#2563eb', 0, 0], ['NEGOTIATION', 'تفاوض', 75, 4, '#d97706', 0, 0],
    ['WON', 'مكسوبة', 100, 5, '#059669', 1, 0], ['LOST', 'مفقودة', 0, 6, '#dc2626', 0, 1],
  ];
  for (const [id, ar, pct, ord, color, won, lost] of stages) {
    if (!(await get('SELECT id FROM stage WHERE id = ?', [id])))
      await insert('stage', { id, name_ar: ar, default_win_pct: pct, sort_order: ord, color, is_won: won, is_lost: lost });
  }

  // ── clients ──
  await insert('client', { id: 'FX-CL-1', name_ar: 'أمانة العاصمة المقدسة', type: 'حكومي', active: 1, created_at: T });
  await insert('client', { id: 'FX-CL-2', name_ar: 'هيئة تطوير المنطقة', type: 'شبه حكومي', active: 1, created_at: T });

  // ── demo persona user ids (created by scripts/seed.js which runs before this fixture) ──
  const bd = await uid('demo.bd'), lead = await uid('demo.sectorlead'), pm = await uid('demo.pm'),
    emp = await uid('demo.employee'), cons = await uid('demo.consultant');
  if (lead) await run('UPDATE sector SET lead_user_id = ? WHERE id = ?', [lead, 'SOLUTIONS']);

  // ── opportunities: SOLUTIONS book for demo.bd (kanban + فرصي), one CONSULTING row (IDOR probe) ──
  const opps = [
    ['FX-OPP-1', 'منصة خدمات الزوار الرقمية', 'LEAD', 120_000_000, 'FX-CL-1', bd],
    ['FX-OPP-2', 'دراسة تطوير المشاعر المقدسة', 'QUALIFIED', 80_000_000, 'FX-CL-2', bd],
    ['FX-OPP-3', 'برنامج التحول المؤسسي', 'PROPOSAL', 150_000_000, 'FX-CL-1', bd],
    ['FX-OPP-4', 'تشغيل مركز البيانات الموحد', 'NEGOTIATION', 200_000_000, 'FX-CL-2', bd],
    ['FX-OPP-5', 'عقد الدعم السنوي الشامل', 'WON', 90_000_000, 'FX-CL-1', bd],
    ['FX-OPP-6', 'مبادرة الخدمات الميدانية', 'LOST', 40_000_000, 'FX-CL-2', bd],
    ['FX-OPP-7', 'تطوير تجربة المستفيد', 'LEAD', 60_000_000, 'FX-CL-1', lead],
  ];
  for (const [id, title, stage, val, client, owner] of opps) {
    const pct = stages.find((s) => s[0] === stage)[2];
    await insert('opportunity', { id, title_ar: title, client_id: client, sector_id: 'SOLUTIONS',
      owner_user_id: owner, stage_id: stage, win_pct: pct, value_halalas: val, priority: 'P1', year: YEAR,
      source: 'fixture', next_action: stage === 'WON' || stage === 'LOST' ? null : 'متابعة العرض مع العميل',
      stage_changed_at: T, created_at: T });
  }
  await insert('opportunity', { id: 'FX-OPP-CONS', title_ar: 'استشارة الحوكمة المؤسسية', client_id: 'FX-CL-2',
    sector_id: 'CONSULTING', owner_user_id: null, stage_id: 'PROPOSAL', win_pct: 50, value_halalas: 70_000_000,
    priority: 'P2', year: YEAR, source: 'fixture', stage_changed_at: T, created_at: T });

  // ── employees (salary_halalas is the SENSITIVE field the matrix asserts on) ──
  const emps = [
    ['FX-EMP-1', 'سارة الحربي', 'SOLUTIONS', 'مديرة مشاريع', 2_400_000],
    ['FX-EMP-2', 'خالد العتيبي', 'SOLUTIONS', 'مستشار أول', 1_950_000],
    ['FX-EMP-3', 'نورة القحطاني', 'SOLUTIONS', 'محللة أعمال', 1_500_000],
    ['FX-EMP-4', 'فهد الشمري', 'CONSULTING', 'مستشار استراتيجي', 2_100_000],
  ];
  for (const [id, name, sector, title, salary] of emps) {
    await insert('employee', { id, name_ar: name, sector_id: sector, job_title: title,
      salary_halalas: salary, employment_type: 'أساسي', status: 'نشط', active: 1, created_at: T });
  }

  // ── project (owned by demo.pm → gives the PM persona project scope) + tasks + allocation ──
  await insert('project', { id: 'FX-PRJ-1', code: 'SOL-26-01', name_ar: 'مشروع منصة الخدمات الموحدة',
    client_id: 'FX-CL-1', sector_id: 'SOLUTIONS', owner_user_id: pm, status: 'IN_PROGRESS', rag: 'GREEN',
    budget_halalas: 300_000_000, actual_spend_halalas: 90_000_000, contract_value_halalas: 350_000_000,
    margin_pct: 24, progress_pct: 35, start_date: '2026-01-01', end_date: '2026-12-31', created_at: T });
  await insert('project', { id: 'FX-PRJ-2', code: 'SOL-26-02', name_ar: 'مشروع تطوير القدرات الرقمية',
    client_id: 'FX-CL-2', sector_id: 'SOLUTIONS', owner_user_id: pm, status: 'IN_PROGRESS', rag: 'AMBER',
    budget_halalas: 120_000_000, actual_spend_halalas: 70_000_000, contract_value_halalas: 140_000_000,
    margin_pct: 18, progress_pct: 55, start_date: '2026-02-01', end_date: '2026-10-31', created_at: T });
  const tasks = [
    ['FX-TSK-1', 'إعداد وثيقة المتطلبات التفصيلية', emp, 'IN_PROGRESS', 'P1', '2026-08-10'],
    ['FX-TSK-2', 'مراجعة مخرجات المرحلة الأولى', emp, 'TODO', 'P2', '2026-08-20'],
    ['FX-TSK-3', 'ورشة عمل مع فريق العميل', cons, 'TODO', 'P1', '2026-08-05'],
    ['FX-TSK-4', 'تحديث خطة المشروع', pm, 'DONE', 'P2', '2026-07-01'],
  ];
  for (const [id, title, assignee, status, priority, due] of tasks) {
    await insert('task', { id, project_id: 'FX-PRJ-1', sector_id: 'SOLUTIONS', work_kind: 'project',
      title, assignee_user_id: assignee, priority, status, due_date: due, created_at: T,
      ...(status === 'DONE' ? { completed_at: T } : {}) });
  }
  await insert('allocation', { id: 'FX-ALL-1', employee_id: 'FX-EMP-1', project_id: 'FX-PRJ-1',
    sector_id: 'SOLUTIONS', year: YEAR, type: 'member',
    monthly_json: JSON.stringify({ 1: 0.5, 2: 0.5, 3: 0.8, 4: 0.8, 5: 0.8, 6: 0.8, 7: 1, 8: 1, 9: 0.6 }), created_at: T });

  // ── timesheet entries for the personal timesheet page ──
  if (emp) {
    await insert('time_entry', { id: 'FX-TE-1', user_id: emp, task_id: 'FX-TSK-1', project_id: 'FX-PRJ-1',
      work_kind: 'project', entry_date: '2026-07-14', hours: 6, billable: 1, created_at: T });
    await insert('time_entry', { id: 'FX-TE-2', user_id: emp, project_id: 'FX-PRJ-1',
      work_kind: 'internal', entry_date: '2026-07-15', hours: 2, billable: 0, created_at: T });
  }

  // ── finance: contract + invoices + collection + revenue lines (bridge/AR/DSO non-zero) ──
  await insert('contract', { id: 'FX-CON-1', code: 'C-26-011', client_id: 'FX-CL-1', project_id: 'FX-PRJ-1',
    sector_id: 'SOLUTIONS', value_halalas: 350_000_000, start_date: '2026-01-15', end_date: '2026-12-31',
    status: 'ACTIVE', signed_at: '2026-01-15', created_at: T });
  await insert('invoice', { id: 'FX-INV-1', code: 'INV-26-001', contract_id: 'FX-CON-1', project_id: 'FX-PRJ-1',
    client_id: 'FX-CL-1', sector_id: 'SOLUTIONS', amount_halalas: 100_000_000, issue_date: '2026-03-15',
    due_date: '2026-04-14', status: 'PAID', created_at: T });
  await insert('collection', { id: 'FX-COL-1', invoice_id: 'FX-INV-1', amount_halalas: 100_000_000,
    collected_at: '2026-04-01', method: 'تحويل', created_at: T });
  await insert('invoice', { id: 'FX-INV-2', code: 'INV-26-002', contract_id: 'FX-CON-1', project_id: 'FX-PRJ-1',
    client_id: 'FX-CL-1', sector_id: 'SOLUTIONS', amount_halalas: 80_000_000, issue_date: '2026-05-20',
    due_date: '2026-06-19', status: 'ISSUED', created_at: T });
  const rev = [['FX-REV-1', 3, 60_000_000], ['FX-REV-2', 4, 45_000_000], ['FX-REV-3', 5, 55_000_000]];
  for (const [id, month, amt] of rev) {
    await insert('revenue_line', { id, project_id: 'FX-PRJ-1', sector_id: 'SOLUTIONS',
      amount_halalas: amt, month, year: YEAR, label: 'إيراد مرحلي', auto: 0, created_at: T });
  }

  // ── one pending approval at the sector_lead step (queue non-empty for demo.sectorlead/admin,
  //    empty for demo.employee — the designed empty-state case in states.spec) ──
  const wf = await get("SELECT id FROM workflow_definition WHERE key = 'opportunity_go_nogo'");
  if (wf && bd) {
    await insert('approval_request', { id: 'FX-APR-1', workflow_id: wf.id, resource: 'opportunity',
      resource_id: 'FX-OPP-4', requested_by: bd, amount_halalas: 200_000_000, sector_id: 'SOLUTIONS',
      current_step: 1, status: 'PENDING', created_at: nowIso() });
  }
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFixture()
    .then((created) => { console.log(created ? '✓ demo fixture seeded' : '✓ demo fixture already present'); return close(); })
    .catch((e) => { console.error('seed-fixture failed:', e); process.exit(1); });
}
