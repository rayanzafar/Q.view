// تصدير منطقي كامل لقاعدة البيانات إلى JSON على stdout — يعمل على SQLite وPostgres.
// الاستخدام الأساسي: أخذ نسخة من قاعدة staging من داخل حاوية Railway (حيث الشبكة الداخلية متاحة):
//   railway ssh -s <app> "node scripts/db-export.js" > data/backups/staging-<date>.json
// stdout = JSON فقط؛ كل الرسائل التشخيصية على stderr.
import { all, close } from '../src/core/db/index.js';

const TABLES = [
  'schema_migration', 'role', 'role_permission', 'app_user', 'sector', 'department', 'org_unit', 'team',
  'position', 'employee', 'membership', 'client', 'contact', 'stage', 'opportunity', 'opportunity_sector',
  'opportunity_stage_history', 'proposal', 'pricing_line', 'portfolio', 'program', 'project', 'workstream',
  'milestone', 'deliverable', 'task', 'dependency', 'risk', 'issue', 'decision', 'change_request',
  'action_item', 'lesson_learned', 'timesheet_period', 'time_entry', 'workflow_definition', 'approval_step',
  'approval_request', 'approval_action', 'supplier', 'service', 'service_package', 'contract',
  'contract_payment', 'invoice', 'invoice_line', 'collection', 'expense', 'cost_line', 'revenue_line',
  'purchase_order', 'budget', 'allocation', 'report_definition', 'recipient_group', 'recipient',
  'report_schedule', 'email_template', 'email_queue', 'email_log', 'report_snapshot', 'kpi_definition',
  'audit_log', 'ai_activity_log', 'notification', 'crm_activity', 'import_run', 'import_row',
  'saved_view', 'document',
];

const out = { exported_at: new Date().toISOString(), tables: {} };
let rows = 0;
for (const t of TABLES) {
  try {
    out.tables[t] = await all(`SELECT * FROM ${t}`);
    rows += out.tables[t].length;
  } catch (e) {
    out.tables[t] = null;
    process.stderr.write(`skip ${t}: ${e.message}\n`);
  }
}
process.stderr.write(`✓ exported ${TABLES.length} tables, ${rows} rows\n`);
process.stdout.write(JSON.stringify(out));
await close();
