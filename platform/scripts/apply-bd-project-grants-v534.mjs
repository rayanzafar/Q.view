// One-off: owner decision 2026-08-19 — مشاعل + أشواق get PERSONAL project grants
// (read/create/update) over the 3 CONSULTING departments, via the audited service path
// (grantDepartment, ADR-0009). The bd_manager ROLE stays read-only per the reference doc.
// Runs against live staging via DATABASE_URL. Not committed — the person-page UI is the
// natural path for future grants; this is remote execution like apply-hme-team.mjs.
import { get, all, close } from '/home/zunix/Q.view/platform/src/core/db/index.js';
import { initRbac } from '/home/zunix/Q.view/platform/src/core/rbac/index.js';
import { grantDepartment } from '/home/zunix/Q.view/platform/src/modules/identity/grants.js';

await initRbac();

const admin = await all(
  "SELECT id, username, name_ar, role_id, scope, sector_id FROM app_user WHERE username LIKE 'sysadmin%' AND role_id = 'admin' AND deleted_at IS NULL AND active = 1");
if (admin.length !== 1) { console.error('sysadmin ambiguous/missing:', admin.map(a => a.username)); process.exit(1); }
const ctx = { user: { ...admin[0], projectIds: new Set(), teamIds: new Set() }, ip: '127.0.0.1' };

const people = await all(
  "SELECT id, username, name_ar FROM app_user WHERE username IN ('mashael.alkhamshi','ashwag.alawoor') AND deleted_at IS NULL AND active = 1");
if (people.length !== 2) { console.error('expected 2 people, got:', people.map(p => p.username)); process.exit(1); }

const depts = await all(
  "SELECT id, name_ar FROM department WHERE sector_id = 'CONSULTING' AND deleted_at IS NULL AND active = 1 ORDER BY name_ar");
if (!depts.length) { console.error('no CONSULTING departments'); process.exit(1); }
console.log('departments:', depts.map(d => d.name_ar).join(' | '));

const PAIRS = [['project', 'read'], ['project', 'create'], ['project', 'update']];
const NOTE = 'قرار المالك 2026-08-19: يدير مشاريع قطاع الاستشارات كاملةً — منحاً شخصية، والدور قراءة كما في الوثيقة المرجعية';

for (const p of people) {
  let created = 0, already = 0;
  for (const d of depts) {
    for (const [resource, action] of PAIRS) {
      const r = await grantDepartment(ctx, {
        user_id: p.id, department_id: d.id, resource, action, note: NOTE });
      r.already ? already++ : created++;
    }
  }
  console.log(`${p.name_ar}: created ${created}, already ${already}`);
}

const check = await all(
  `SELECT u.username, g.resource, g.action, d.name_ar dept
     FROM user_department_grant g
     JOIN app_user u ON u.id = g.user_id
     JOIN department d ON d.id = g.department_id
    WHERE g.deleted_at IS NULL AND g.resource = 'project'
      AND u.username IN ('mashael.alkhamshi','ashwag.alawoor')
    ORDER BY u.username, d.name_ar, g.action`);
console.log('project grants now live:', check.length);
for (const c of check) console.log(` ${c.username} ${c.action} @${c.dept}`);
await close();
