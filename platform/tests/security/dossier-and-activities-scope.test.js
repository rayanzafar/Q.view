// ── ملف الشخص ولوحة الفريق والنشاط: نطاق الفرص واحد لا بابَ خلفيّاً له ────────
//
// بعد قلب الرؤية (v5.2) بقي بابان جانبيّان يقرآن صفوف الفرص بغير نطاقها:
//   • ملفُّ الشخص ولوحةُ الفريق يُفتحان بنطاق **المهام** (قراءة قطاع لمدير تطوير الأعمال)،
//     فكانا يعرضان لزميلٍ ذي نطاقٍ ذاتي أسماءَ صفقات زملائه **وقيمَها** — عينُ ما أُغلق.
//   • ونشاط الفرصة (تسجيلاً وترشيحاً) كان يفحص الصفَّ عارياً من مشاركاته، فيَرُدّ مديرةَ
//     إدارةٍ مشارِكةٍ تفتح قائمتُها وصفحةُ الفرصة نفسها بابَها — «يُعرَض ولا يُفتح» مقلوباً.
//
// فالحكم هنا: صفوف الفرص على أيّ شاشةٍ تُقصّ بنطاق قراءة الفرص لقارئها، وصاحبُ الصفحة
// يرى صفوفه دوماً، وقادةُ النطاق لم يمسّهم شيء.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dossier-scope-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, clients, resolveUser;
const T = '2026-08-05T09:00:00Z';

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
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  tasks = await import('../../src/modules/pmo/tasks.js');
  clients = await import('../../src/modules/clients/clients.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', default_win_pct: 10, sort_order: 1, is_won: 0, is_lost: 0 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة التخطيط', created_at: T });

  const mkUser = (id, role, scope) => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: 'SOL', scope, active: 1, created_at: T });
  const mkEmp = async (id, uid, dept) => {
    await db.insert('employee', { id, user_id: uid, name_ar: 'موظف ' + id, sector_id: 'SOL',
      department_id: dept, job_title: 'مستشار', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: id });
  };

  await mkUser('u_bd', 'bd_manager', 'own');
  await mkUser('u_bd2', 'bd_manager', 'own');
  await mkUser('u_dm', 'department_manager', 'sector');
  await mkUser('u_lead', 'sector_lead', 'sector');
  await mkUser('u_emp', 'employee', 'own');

  await db.insert('department', { id: 'D_BD', sector_id: 'SOL', name_ar: 'إدارة تطوير الأعمال', active: 1, created_at: T });
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await mkEmp('e_bd', 'u_bd', 'D_BD');
  await mkEmp('e_bd2', 'u_bd2', 'D_BD');
  await mkEmp('e_dm', 'u_dm', 'D_A');
  await mkEmp('e_emp', 'u_emp', 'D_A');

  const mkOpp = (id, owner, dept, value) => db.insert('opportunity', {
    id, title_ar: 'فرصة ' + id, sector_id: 'SOL', department_id: dept, stage_id: 'LEAD',
    client_id: 'CL', owner_user_id: owner, value_halalas: value, win_pct: 10,
    created_at: T, created_by: owner });

  await mkOpp('O_MINE', 'u_bd', 'D_BD', 100_000);      // فرصة القارئ نفسه
  await mkOpp('O_PEER', 'u_bd2', 'D_BD', 555_000);     // صفقة الزميل — سرُّه قبل الترسية
  await mkOpp('O_DEPT', 'u_dm', 'D_A', 200_000);       // فرصة إدارة D_A
  // فرصة زميلٍ يشارك فيها موظفُ D_A تسكيناً — لصفحة الموظف عن نفسه
  await mkOpp('O_STAFFED', 'u_bd2', 'D_BD', 300_000);
  await db.insert('membership', { id: 'm1', group_kind: 'opportunity', group_id: 'O_STAFFED',
    employee_id: 'e_emp', role_in_group: 'member', status: 'ACTIVE', created_at: T });
  // فرصة D_BD تشارك فيها إدارةُ D_A — لباب النشاط
  await mkOpp('O_PART', 'u_bd2', 'D_BD', 400_000);
  await db.insert('opportunity_department', { opportunity_id: 'O_PART', department_id: 'D_A', created_at: T, created_by: 'u_bd2' });
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ── لوحة الفريق ──────────────────────────────────────────────────────────────
test('لوحة الفريق: ذو النطاق الذاتي لا يقرأ أسماء صفقات زملائه ولا قيمها', async () => {
  const w = await tasks.teamWorkload(await sess('u_bd'));
  const flat = JSON.stringify(w);
  assert.ok(!flat.includes('فرصة O_PEER'), 'اسم صفقة الزميل ظهر على لوحة الفريق');
  assert.ok(!flat.includes('555000'), 'قيمة صفقة الزميل ظهرت على لوحة الفريق');
  assert.ok(flat.includes('فرصة O_MINE'), 'فرصة القارئ نفسه اختفت من لوحته');
});

test('لوحة الفريق: قائد القطاع كما كان — يرى صفقات قطاعه كلها', async () => {
  const w = await tasks.teamWorkload(await sess('u_lead'));
  const flat = JSON.stringify(w);
  assert.ok(flat.includes('فرصة O_PEER') && flat.includes('فرصة O_MINE'));
});

// ── ملف الشخص ────────────────────────────────────────────────────────────────
test('ملف الشخص: زميلٌ ذو نطاقٍ ذاتي يفتح الصفحة ولا يقرأ فيها صفقات صاحبها', async () => {
  const d = await tasks.personDossier(await sess('u_bd'), 'u_bd2');
  const titles = (d.opportunities || []).map((o) => o.title_ar);
  assert.deepEqual(titles, [], 'صفقات الزميل ظهرت لقارئٍ نطاقُه فرصُه هو');
});

test('ملف الشخص: قائد القطاع يقرأ صفوف الفرص كاملةً كما كانت', async () => {
  const d = await tasks.personDossier(await sess('u_lead'), 'u_bd2');
  const titles = (d.opportunities || []).map((o) => o.title_ar).sort();
  assert.ok(titles.includes('فرصة O_PEER') && titles.includes('فرصة O_STAFFED'));
});

test('ملف الشخص عن نفسه: الموظف يرى الفرصة المسكَّن عليها وإن ضاق دوره عن غيرها', async () => {
  const d = await tasks.personDossier(await sess('u_emp'), 'u_emp');
  const titles = (d.opportunities || []).map((o) => o.title_ar);
  assert.ok(titles.includes('فرصة O_STAFFED'), 'تسكينُ صاحب الصفحة اختفى من صفحته');
});

// ── نشاط الفرصة: باب القراءة الواحد ─────────────────────────────────────────
test('مديرة الإدارة المشارِكة تسجِّل نشاطاً على الفرصة وترشِّح سجلَّه — كان يُرَدّ ٤٠٣', async () => {
  const created = await clients.logActivity({ user: await sess('u_dm'), ip: '1' },
    { kind: 'note', title: 'محضر اجتماع', opportunity_id: 'O_PART' });
  assert.ok(created.id);
  const list = await clients.listActivities(await sess('u_dm'), { opportunity_id: 'O_PART' });
  assert.ok(list.some((a) => a.id === created.id));
});

test('ومن لا نطاق له على الفرصة يُرَدّ عن نشاطها كما كان', async () => {
  await assert.rejects(
    clients.logActivity({ user: await sess('u_bd'), ip: '1' },
      { kind: 'note', title: 'محاولة', opportunity_id: 'O_DEPT' }),
    /403|صلاحيت|نطاق/);
});
