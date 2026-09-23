// ── تقوية التحكّم في الوصول — الدفعة أ ───────────────────────────────────────
//
// أبوابٌ خلفية تقرأ صفوف الفرص/المشاريع بغير نطاقها، وجدها تدقيقٌ سابق (ملف:سطر):
//   • G3   — المساعد يحلّ مشروع إدارةٍ شقيقة بالمعرّف المباشر لأن استعلامه أسقط `department_id`
//            فتساهل فحصُ الصفّ (scopeReaches، فرع «الإدارة» بلا إدارة على الهدف).
//   • P1/P2 — الكشف العام (staffingRoster) ولوحة الطاقة (capacity) يعرضان **عناوين** فرصٍ عابرةٍ
//            للقطاع وللإدارة لأن استعلام العناوين بلا نطاق فرصٍ إطلاقاً.
//   • H1/H2 — فرصةٌ بلا قطاع تُفتح بالمعرّف لقارئٍ ذي قطاع (تساهلٌ فارغ)، ويتيمُ القطاع نفسه
//            (فرصةٌ بلا إدارة داخل قطاع القارئ) يبقى مفتوحاً كما يجب — list==row محفوظ.
//   • G13  — نطاق المشروع يمرّ فارغاً على هدفٍ لا يحمل معرّفاً — يجب أن يفشل مغلقاً.
//
// الفحوص تُبنى بجلساتٍ حقيقية (`resolveUser`) لا بكائناتٍ مركّبةٍ باليد — كما في
// tests/security/opportunity-visibility.test.js و dossier-and-activities-scope.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-hardenA-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, resolveUser, scopeReaches, opps, org, capacity, assistant;
const T = '2026-08-05T09:00:00Z';
const YEAR = 2026;

// عناوينُ مميّزةٌ نبحث عنها في مخرجات الكشف/الطاقة: حضورُ العابر = تسريب، غيابُ المشروعة = إفراط.
const O_A_TITLE = 'فرصة إدارة الابتكار المفتوحة';
const O_X_TITLE = 'صفقة سرية عابرة للقطاع';

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  scopeReaches = rbac.scopeReaches;
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  opps = await import('../../src/modules/crm/opportunities.js');
  org = await import('../../src/modules/org/org.js');
  capacity = await import('../../src/modules/pmo/capacity.js');
  assistant = await import('../../src/core/ai/assistant.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'SOL2', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة التخطيط', created_at: T });

  const mkUser = (id, role, scope, sector = 'SOL') => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  const mkEmp = async (id, uid, dept, sector = 'SOL') => {
    await db.insert('employee', { id, user_id: uid, name_ar: 'موظف ' + id, sector_id: sector,
      department_id: dept, job_title: 'مستشار', active: 1, created_at: T });
    if (uid) await db.update('app_user', uid, { employee_id: id });
  };

  await mkUser('u_dm', 'department_manager', 'sector'); // مديرة إدارة D_A (قطاع الحلول)
  await mkUser('u_lead', 'sector_lead', 'sector');      // قائد قطاع الحلول — لفحص فرع القطاع

  // الإدارات: D_A تُقادها u_dm، D_B إدارةٌ شقيقة في القطاع نفسه، D_X إدارةٌ في قطاعٍ آخر.
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('department', { id: 'D_X', sector_id: 'SOL2', name_ar: 'إدارة قطاعٍ آخر', active: 1, created_at: T });

  await mkEmp('e_dm', 'u_dm', 'D_A');
  // موظفٌ في إدارة القارئ: يظهر في كشفه وفي مرشّحي مشروعه — وهو المسكَّن على الفرصتين.
  await mkEmp('e_worker', null, 'D_A');

  const mkProject = (id, dept, sector, owner) => db.insert('project', {
    id, name_ar: 'مشروع ' + id, sector_id: sector, department_id: dept, status: 'IN_PROGRESS',
    owner_user_id: owner, created_at: T });

  await mkProject('prj_INSCOPE', 'D_A', 'SOL', 'u_lead'); // مشروع إدارة القارئ — يُحلّ بالمعرّف
  await mkProject('prj_SIBLING', 'D_B', 'SOL', 'u_lead'); // مشروع إدارةٍ شقيقة — يجب ألّا يُحلّ (G3)
  await mkProject('prj_CAPTEAM', 'D_A', 'SOL', 'u_lead'); // مشروع لفحص لوحة الطاقة (المرشّحون)

  const mkOpp = (id, title, dept, sector, owner) => db.insert('opportunity', {
    id, title_ar: title, sector_id: sector, department_id: dept, stage_id: 'LEAD', client_id: 'CL',
    value_halalas: 1000000, owner_user_id: owner, year: YEAR, stage_changed_at: T, created_at: T });

  await mkOpp('O_A', O_A_TITLE, 'D_A', 'SOL', 'u_lead');   // فرصة إدارة القارئ — مشروعة
  await mkOpp('O_X', O_X_TITLE, 'D_X', 'SOL2', 'u_lead');  // عابرة للقطاع وللإدارة — يجب ألّا يتسرّب عنوانها
  await mkOpp('O_ORPHAN', 'يتيمةٌ في قطاع القارئ', null, 'SOL', 'u_lead'); // يتيمٌ في قطاعه — يُفتح (H2)
  // فرصةٌ بلا قطاعٍ أصلاً — لا تنتمي لقطاع أحد، فلا تُفتح بالمعرّف لقارئٍ قطاعيّ (H1)
  await db.insert('opportunity', {
    id: 'O_NOSECTOR', title_ar: 'فرصةٌ بلا قطاع', sector_id: null, department_id: null,
    stage_id: 'LEAD', client_id: 'CL', value_halalas: 1000000, owner_user_id: 'u_lead',
    year: YEAR, stage_changed_at: T, created_at: T });

  // تسكينُ الموظف على الفرصتين المفتوحتين (نسبة > 0، غير معلّقة) — هما مصدرُ العناوين في الكشف/الطاقة.
  await db.insert('membership', { id: 'm_a', group_kind: 'opportunity', group_id: 'O_A',
    employee_id: 'e_worker', role_in_group: 'member', status: 'ACTIVE', allocation_pct: 30, created_at: T });
  await db.insert('membership', { id: 'm_x', group_kind: 'opportunity', group_id: 'O_X',
    employee_id: 'e_worker', role_in_group: 'member', status: 'ACTIVE', allocation_pct: 40, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── G3: المساعد لا يحلّ مشروع إدارةٍ شقيقة بالمعرّف المباشر ───────────────────
test('(G3) المساعد يحلّ مشروع إدارة القارئ بالمعرّف، ويردّ مشروع الإدارة الشقيقة', async () => {
  const dm = await sess('u_dm');
  const mine = await assistant.resolveRef(dm, 'project', 'prj_INSCOPE');
  assert.equal(mine.total, 1, 'مشروع إدارته لم يُحلّ بالمعرّف — إفراطٌ في التضييق');
  const sibling = await assistant.resolveRef(dm, 'project', 'prj_SIBLING');
  assert.equal(sibling.total, 0, 'مشروع إدارةٍ شقيقة انفتح بالمعرّف عبر المساعد — تسريبٌ من الباب الخلفي');
});

// ── P1: الكشف العام لا يعرض عنوان فرصةٍ عابرةٍ للقطاع وللإدارة ─────────────────
test('(P1) staffingRoster لا يُظهر عنوان فرصةٍ عابرةٍ للقطاع لمديرة إدارة — ويُبقي فرصة إدارتها', async () => {
  const dm = await sess('u_dm');
  const roster = await org.staffingRoster(dm, { year: YEAR, month: 8 });
  const flat = JSON.stringify(roster);
  assert.ok(!flat.includes(O_X_TITLE), 'عنوان فرصةٍ عابرةٍ للقطاع تسرّب في الكشف');
  assert.ok(flat.includes(O_A_TITLE), 'فرصة الإدارة المشروعة اختفت من الكشف — إفراطٌ في التضييق');
});

// ── P2: لوحة الطاقة لا تعرض عنوان فرصةٍ عابرةٍ للقطاع وللإدارة ─────────────────
test('(P2) capacity.staffingCandidates لا يُسرّب عنوان فرصةٍ عابرةٍ للقطاع — ويُبقي فرصة الإدارة', async () => {
  const dm = await sess('u_dm');
  const cap = await capacity.staffingCandidates(dm, 'prj_CAPTEAM', { year: YEAR, month: 8 });
  const worker = cap.candidates.find((c) => c.id === 'e_worker');
  assert.ok(worker, 'الموظف غائبٌ عن قائمة المرشّحين — تعذّر إثبات الفحص');
  const names = worker.opportunities.map((o) => o.name);
  assert.ok(!names.includes(O_X_TITLE), 'عنوان فرصةٍ عابرةٍ للقطاع تسرّب في لوحة الطاقة');
  assert.ok(names.includes(O_A_TITLE), 'فرصة الإدارة المشروعة اختفت من لوحة الطاقة — إفراطٌ في التضييق');
});

// ── H1/H2: فرصةٌ بلا قطاع لا تُفتح، ويتيمُ القطاع نفسه يُفتح ───────────────────
test('(H2) مديرة الإدارة تفتح يتيمَ قطاعها (فرصةٌ بلا إدارة في قطاعها) — list==row محفوظ', async () => {
  const dm = await sess('u_dm');
  const orphan = await opps.getOpportunity(dm, 'O_ORPHAN');
  assert.equal(orphan.id, 'O_ORPHAN', 'يتيمُ القطاع نفسه لم يُفتح — كُسر السلوك المشروع');
});

test('(H1) فرصةٌ بلا قطاع لا تُفتح بالمعرّف لمديرة إدارةٍ ذات قطاع', async () => {
  const dm = await sess('u_dm');
  await assert.rejects(() => opps.getOpportunity(dm, 'O_NOSECTOR'), (e) => e.status === 403,
    'فرصةٌ بلا قطاعٍ انفتحت بالمعرّف — تساهلٌ فارغ في فرع «الإدارة»');
});

test('(H1) وفرصةٌ بلا قطاع لا تُفتح بالمعرّف لقائد قطاعٍ كذلك (فرع القطاع)', async () => {
  const lead = await sess('u_lead');
  await assert.rejects(() => opps.getOpportunity(lead, 'O_NOSECTOR'), (e) => e.status === 403,
    'فرصةٌ بلا قطاعٍ انفتحت بالمعرّف لقارئٍ نطاقُه قطاع — تساهلٌ فارغ في فرع «القطاع»');
});

// ── G13: نطاق المشروع يفشل مغلقاً على هدفٍ بلا معرّف ──────────────────────────
test('(G13) نطاق «المشروع» يفشل مغلقاً على هدفٍ لا يحمل project_id ولا id', () => {
  const u = { id: 'u_x', projectIds: new Set(['prj_MINE']) };
  assert.equal(scopeReaches(u, 'project', { sector_id: 'SOL' }, 'read', 'project'), false,
    'هدفٌ بلا معرّفٍ مرّ فارغاً على نطاق المشروع');
  assert.equal(scopeReaches(u, 'project', { id: 'prj_MINE' }, 'read', 'project'), true,
    'عضوية المشروع لم تفتح صفَّه — إفراطٌ في الإغلاق');
  assert.equal(scopeReaches(u, 'project', { id: 'prj_OTHER' }, 'read', 'project'), false,
    'مشروعٌ ليس عضواً فيه انفتح');
});
