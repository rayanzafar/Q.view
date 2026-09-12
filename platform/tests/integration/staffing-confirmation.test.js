// «مو إعارة، إنما تسكين — وعشان المدير يأكّد أن الموظف شغّال على هذا الشي، مو أي أحد يسكّن أي
// أحد في أي مكان. هذا بس، مدير القطاع ما يحتاج» — بلسان المالك.
//
// فالسؤال ليس «هل يُسمح لك» بل «هل يعلم مديرُه». والضمّ مفتوحٌ لمن يدير الفرصة (وهو ما طُلب
// وبُني قبل هذه الموجة)، لكن من ضمّ زميلاً من إدارةٍ أخرى لا يعرف ما الذي يشغله هناك — فيصل
// الطلب إلى مديره فيؤكّد أو يردّ. **خطوةٌ واحدة، ولا ثانيةَ فوقها.**
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-confirm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, oppteam, engine, depts, capacity, P;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
let DM_INNO, DM_AI;

const memberOf = (oppId, empId) => db.get(
  "SELECT * FROM membership WHERE group_kind='opportunity' AND group_id=? AND employee_id=? AND deleted_at IS NULL",
  [oppId, empId]);

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  oppteam = await import('../../src/modules/crm/oppteam.js');
  engine = await import('../../src/modules/workflow/engine.js');
  depts = await import('../../src/core/rbac/departments.js');
  capacity = await import('../../src/modules/pmo/capacity.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_inno', username: 'inno', name_ar: 'مدير الابتكار', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ai', username: 'ai', name_ar: 'مدير الذكاء', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'عمار الرجوب', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INNO', name_ar: 'إدارة الابتكار', sector_id: 'SOL', manager_user_id: 'u_inno', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء', sector_id: 'SOL', manager_user_id: 'u_ai', active: 1, created_at: T });

  await db.insert('employee', { id: 'e_mine', name_ar: 'سجى لشكر', sector_id: 'SOL', department_id: 'D_INNO', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_theirs', name_ar: 'عمار الرجوب', sector_id: 'SOL', department_id: 'D_AI', user_id: 'u_emp', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_orphan', name_ar: 'موظف بلا إدارة', sector_id: 'SOL', active: 1, created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('opportunity', { id: 'OPP', title_ar: 'منصة تحليلات', sector_id: 'SOL', department_id: 'D_INNO',
    stage_id: 'PROPOSAL', value_halalas: 100000, owner_user_id: 'u_inno', created_at: T });

  const mk = async (uid) => ({
    id: uid, username: uid, role_id: 'department_manager', scope: 'department', sector_id: 'SOL',
    department_id: null, departmentIds: await depts.readerDepartmentIds(uid, null),
  });
  DM_INNO = await mk('u_inno');
  DM_AI = await mk('u_ai');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── من يملك أمر الموظف يُسكّن مباشرةً ────────────────────────────────────────
test('مدير الإدارة يُسكّن موظفَ إدارته بلا تأكيد — فلا يستأذن نفسه', async () => {
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_mine', role_in_group: 'member' });
  const m = await memberOf('OPP', 'e_mine');
  assert.equal(m.status, 'ACTIVE', 'عُلّق تسكينُ موظفٍ يملك أمره');
  const pending = await db.all("SELECT * FROM approval_request WHERE status='PENDING'");
  assert.equal(pending.length, 0, 'رُفع طلبٌ بلا حاجة');
});

// ── ومن لا يملكه: يُسكّن معلَّقاً ويصل الطلب إلى مديره ────────────────────────
test('ويضمّ موظفَ إدارةٍ أخرى فيُعلَّق حتى يؤكّد مديره — ويصل الطلب إليه هو', async () => {
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_theirs', role_in_group: 'member', allocation_pct: 40 });
  const m = await memberOf('OPP', 'e_theirs');
  assert.equal(m.status, 'PENDING', 'كُتب نشطاً بلا تأكيد — «مو أي أحد يسكّن أي أحد»');
  const q = await engine.myDirectApprovals(DM_AI);
  assert.equal(q.length, 1, 'الطلب لم يصل إلى مدير الموظف');
  assert.equal(q[0].resource_id, m.id);
  // ولا يصل إلى مديرٍ آخر ولا إلى قائد القطاع — «مدير القطاع ما يحتاج».
  assert.equal((await engine.myDirectApprovals(DM_INNO)).length, 0, 'الطلب ظهر لمن رفعه');
});

test('والمعلَّق لا يُحتسب في تحميل الموظف قبل التأكيد', async () => {
  const r = await capacity.staffingCandidates(ADMIN, null, {}).catch(() => null);
  // نقيس مباشرةً: مجموع الحمل من العضويات المعلَّقة يجب أن يكون صفراً
  const rows = await db.all(
    `SELECT COALESCE(SUM(m.allocation_pct),0) v FROM membership m
      WHERE m.group_kind='opportunity' AND m.deleted_at IS NULL AND COALESCE(m.status,'ACTIVE')='PENDING'`);
  assert.ok(Number(rows[0].v) > 0, 'العيّنة بلا عضويةٍ معلَّقة — الفحص لا يقيس شيئاً');
  const org = await import('../../src/modules/org/org.js');
  const roster = await org.staffingRoster(ADMIN, { sector: 'SOL' });
  const him = (roster.roster || []).find((x) => x.id === 'e_theirs');
  assert.ok(him, 'الموظف غائب عن الكشف أصلاً');
  assert.equal(Number(him.currentUtil || 0), 0, 'حُسب تسكينٌ لم يُؤكَّد بعد في تحميله');
});

test('والشاشة تقول إنه بانتظار تأكيد مديره — لا تعرضه عضواً كامل العضوية', async () => {
  const html = await P.opportunityDetailPage(ADMIN, 'OPP');
  assert.ok(html.includes('بانتظار تأكيد مديره'), 'العضوية المعلَّقة تظهر كأنها مؤكَّدة');
});

// ── التأكيد يُفعّل ────────────────────────────────────────────────────────────
test('فإذا أكّد مديره صار عضواً فعلياً', async () => {
  const q = await engine.myDirectApprovals(DM_AI);
  await engine.actOnApproval({ user: DM_AI, ip: '1' }, q[0].id, 'approve', 'نعم يعمل عليها');
  const m = await memberOf('OPP', 'e_theirs');
  assert.equal(m.status, 'ACTIVE', 'التأكيد لم يُفعّل العضوية');
  const req = await db.get('SELECT status FROM approval_request WHERE id = ?', [q[0].id]);
  assert.equal(req.status, 'APPROVED');
});

test('وإن ردّه أُزيلت العضوية ولم تبقَ معلَّقة إلى الأبد', async () => {
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_orphan', role_in_group: 'member' })
    .catch(() => null); // بلا إدارة → بلا تأكيد؛ نستعمل موظفاً آخر أدناه
  await db.insert('employee', { id: 'e_x', name_ar: 'زميل آخر', sector_id: 'SOL', department_id: 'D_AI', active: 1, created_at: T });
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_x', role_in_group: 'member' });
  const q = await engine.myDirectApprovals(DM_AI);
  const mine = q.find((x) => x.detail_json ? true : true);
  await engine.actOnApproval({ user: DM_AI, ip: '1' }, mine.id, 'reject', 'مشغول بمشروع آخر');
  assert.equal(await memberOf('OPP', 'e_x'), undefined, 'بقيت عضويةٌ مردودة على الفرصة');
});

// ── الحدود ───────────────────────────────────────────────────────────────────
test('ولا يؤكّد الطلبَ إلا مدير الموظف نفسه', async () => {
  await db.insert('employee', { id: 'e_y', name_ar: 'زميل ثالث', sector_id: 'SOL', department_id: 'D_AI', active: 1, created_at: T });
  await oppteam.addMember({ user: DM_INNO, ip: '1' }, 'OPP', { employee_id: 'e_y', role_in_group: 'member' });
  const q = await engine.myDirectApprovals(DM_AI);
  const r = q[q.length - 1];
  const stranger = { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own', sector_id: 'SOL' };
  await assert.rejects(() => engine.actOnApproval({ user: stranger, ip: '1' }, r.id, 'approve'),
    (e) => /موجَّه إلى مدير الموظف/.test(e.message));
  // ورافعُ الطلب لا يؤكّده لنفسه — فصلُ المهام قائمٌ كما هو.
  await assert.rejects(() => engine.actOnApproval({ user: DM_INNO, ip: '1' }, r.id, 'approve'),
    (e) => /رفعتَه بنفسك/.test(e.message));
});

test('وموظفٌ بلا مديرٍ مسجَّل يُسكَّن مباشرةً — فلا طلبٌ معلَّق لا يقرؤه أحد', async () => {
  const m = await memberOf('OPP', 'e_orphan');
  assert.ok(m, 'الموظف بلا إدارة لم يُضمّ إطلاقاً');
  assert.equal(m.status, 'ACTIVE', 'عُلّق طلبٌ لا معتمِد له — ينتظر إلى الأبد');
});

test('والطلب يظهر في صندوق الاعتمادات نفسه لا في صندوقٍ ثانٍ', async () => {
  const html = await P.approvalsPage(DM_AI, {});
  assert.ok(html.includes('تأكيد تسكين موظف') || html.includes('زميل ثالث'),
    'طلب التأكيد غائب عن شاشة الاعتمادات');
});
