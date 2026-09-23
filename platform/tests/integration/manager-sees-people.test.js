// «وبرضو تأكّد الأركتكشر والهيكلة — الانترفيس والباك إند وكل تبع المهام خلاص تمام، وكل مدير
// يقدر يشوف موظفينه، ولو ضغط على كل موظف يطلع شغال على شي» — بلسان المالك.
//
// السؤال سؤالُ سلسلة لا سؤالُ دالة: **يرى** ⟵ **يضغط** ⟵ **يطلع شغال على شي**. وانقطاعُ أي
// حلقة يجعل الحلقتين الأخريين بلا قيمة — فهذا الملف يمشي السلسلة كاملةً لكل دورٍ يحمل كلمة
// «مدير»، على بيانات فيها ما يكسر الافتراضات الساذجة:
//   • مديرٌ يقود **إدارتين** (والقديم كان يريه واحدة).
//   • موظفٌ **بلا مهمة واحدة** وعليه فرصة (والقديم كان يعدّه فارغاً).
//   • موظفٌ في **إدارة أخرى** — يجب ألا يُرى ولا يُفتح ملفه.
//   • حسابٌ **بلا سجل موظف** — لا إدارة له، فيُستبعَد من لوحة الإدارة (فشلٌ آمن).
//
// وأخصّ ما يحرسه: **«مدير تطوير الأعمال»** كان الدور الوحيد الذي يسقط على السؤال — يسكّن الناس
// على فرصه ولا يرى كشفهم ولا يفتح ملف أحدهم. والفحص يسقط لو أُعيدت منحه إلى ما كانت.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-mgr-people-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, T, P, resolveUser;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
// كل دورٍ يحمل مسؤولية أشخاص. `hr` ليست هنا عمداً: تُدير الكشف ولا تقرأ مهام أحد (قرار قائم،
// موثَّق في matrix.js) — ولو أُدرجت لصار الفحص يطالب بتوسعةٍ لم يقرّرها أحد.
const MANAGERS = ['admin', 'ceo_office', 'sector_lead', 'department_manager', 'line_manager',
  'project_manager', 'bd_manager', 'bd_head', 'operations'];

// جلسةٌ لكل حساب، وتُعاد نفسها إن طُلبت مرتين — الفحوص تتشارك الحسابات ولا تتشارك ترتيباً.
const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: NOW, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  T = await import('../../src/modules/pmo/tasks.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: NOW });
  const mkUser = (id, role) => db.insert('app_user', {
    id, username: id, name_ar: 'حساب ' + id, role_id: role, sector_id: 'S1',
    scope: role === 'admin' || role === 'ceo_office' || role === 'bd_head' ? 'company' : 'own',
    active: 1, created_at: NOW,
  });
  const mkEmp = async (id, userId, deptId) => {
    await db.insert('employee', { id, user_id: userId, name_ar: 'موظف ' + id, sector_id: 'S1',
      department_id: deptId, job_title: 'استشاري', active: 1, created_at: NOW });
    await db.update('app_user', userId, { employee_id: id });
  };
  for (const r of MANAGERS) await mkUser('m_' + r, r);

  // إدارتان يقودهما مدير واحد، وثالثة لا يقودها
  await db.insert('department', { id: 'D1', sector_id: 'S1', name_ar: 'إدارة الابتكار', manager_user_id: 'm_department_manager', active: 1, created_at: NOW });
  await db.insert('department', { id: 'D2', sector_id: 'S1', name_ar: 'إدارة الذكاء', manager_user_id: 'm_department_manager', active: 1, created_at: NOW });
  await db.insert('department', { id: 'D3', sector_id: 'S1', name_ar: 'إدارة ثالثة', manager_user_id: 'm_line_manager', active: 1, created_at: NOW });
  await mkEmp('e_dm', 'm_department_manager', 'D1');
  await mkEmp('e_lm', 'm_line_manager', 'D3');
  await mkEmp('e_bdm', 'm_bd_manager', 'D1');

  for (const [u, e, d] of [['u_a', 'e_a', 'D1'], ['u_b', 'e_b', 'D1'], ['u_c', 'e_c', 'D2'], ['u_d', 'e_d', 'D3']]) {
    await mkUser(u, 'employee'); await mkEmp(e, u, d);
  }
  await mkUser('u_orphan', 'employee');           // بلا سجل موظف ⟵ بلا إدارة

  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'جهة حكومية', created_at: NOW });
  let n = 0;
  const mkTask = (assignee, dept) => db.insert('task', {
    id: 't' + (++n), title: 'مهمة ' + assignee, status: 'TODO', priority: 'P1',
    assignee_user_id: assignee, sector_id: 'S1', department_id: dept, due_date: TODAY,
    work_kind: 'internal', created_at: NOW,
  });
  await mkTask('u_a', 'D1'); await mkTask('u_c', 'D2'); await mkTask('u_d', 'D3');
  // فرصة على من لا مهمة له: «شغال على شي» ولو خلت قائمة مهامه
  await db.insert('opportunity', {
    id: 'O1', title_ar: 'فرصة منصة المدن', sector_id: 'S1', department_id: 'D1', stage_id: 'LEAD',
    client_id: 'CL', value_halalas: 100000, owner_user_id: 'u_b', year: Number(TODAY.slice(0, 4)),
    stage_changed_at: NOW, created_at: NOW,
  });
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── الحلقة الأولى: يرى ──────────────────────────────────────────────────────
test('كل دورٍ مسؤولٍ عن أشخاص يفتح لوحة فريقه — لا دور واحد يُردّ', async () => {
  const denied = [];
  for (const r of MANAGERS) {
    const u = await sess('m_' + r);
    if (!T.teamTasksAccess(u).canRead) denied.push(r);
  }
  assert.deepEqual(denied, [], `أدوارٌ مسؤولة عن أشخاص بلا لوحة فريق: ${denied.join(', ')}`);
});

test('ومدير تطوير الأعمال منهم — كان يسكّن من لا يراه', async () => {
  const bd = await sess("m_bd_manager");
  const a = T.teamTasksAccess(bd);
  assert.equal(a.canRead, true, 'مدير تطوير الأعمال بلا منح قراءة مهام — لا لوحة ولا ملف شخص');
  assert.equal(a.scope, 'sector', 'اتساعه قطاعه لا الشركة');
  assert.equal(a.canWrite, false, 'رؤيةٌ فقط — الكتابة على الناس ليست له');
  const wl = await T.teamWorkload(bd, { year: Number(TODAY.slice(0, 4)), todayDate: TODAY });
  assert.ok(wl.departments.flatMap((d) => d.people).length > 0, 'لوحته فارغة رغم المنح');
});

test('ومن يقود إدارتين يرى أهلهما معاً — لا نصف فريقه', async () => {
  const dm = await sess('m_department_manager');
  const wl = await T.teamWorkload(dm, { year: Number(TODAY.slice(0, 4)), todayDate: TODAY });
  const ids = wl.departments.flatMap((d) => d.people).map((p) => p.userId);
  assert.ok(ids.includes('u_a'), 'غاب أحد أهل إدارته الأولى');
  assert.ok(ids.includes('u_c'), 'غاب أهل الإدارة الثانية التي يقودها');
  assert.ok(!ids.includes('u_d'), 'ظهر شخصٌ من إدارةٍ لا يقودها');
  assert.ok(!ids.includes('u_orphan'), 'حسابٌ بلا إدارة أُدرج في لوحة إدارة');
});

test('ومن لا مهمة عليه يظهر أيضاً — الغياب من اللوحة يُقرأ «لا أحد» لا «لا مهام»', async () => {
  const dm = await sess("m_department_manager");
  const wl = await T.teamWorkload(dm, { year: Number(TODAY.slice(0, 4)), todayDate: TODAY });
  const b = wl.departments.flatMap((d) => d.people).find((p) => p.userId === 'u_b');
  assert.ok(b, 'موظفٌ بلا مهمة سقط من لوحة مديره');
  assert.equal(b.tasks.open, 0);
  assert.ok(b.opportunities.open >= 1, 'وفرصته لا تظهر — فيُقرأ فارغاً وهو يقود فرصة');
});

// ── الحلقة الثانية: يضغط ────────────────────────────────────────────────────
test('واسم كل شخصٍ في لوحة الفريق رابطٌ إلى ملفه', async () => {
  const dm = await sess("m_department_manager");
  const html = await P.tasksPage(dm, { who: 'team' });
  for (const uid of ['u_a', 'u_b', 'u_c']) {
    assert.ok(html.includes(`/app/person/${uid}`), `لا رابط لملف ${uid} في لوحة الفريق`);
  }
  assert.ok(!html.includes('/app/person/u_d'), 'رابطٌ لشخصٍ خارج إداراته');
});

test('وشاشة «الفريق» نفسها تُنقر — وهي أول ما يفتحه من يسأل «من عندي»', async () => {
  const dm = await sess("m_department_manager");
  const html = await P.teamPage(dm, {});
  assert.ok(html.includes('/app/person/u_a'), 'الاسم في جدول الفريق نصٌّ جامد لا يفتح ملفاً');
  assert.ok(html.includes('/app/person/u_b'));
});

test('ولا يُعرض الرابط لمن لا يفتح الملف — لا بابَ مفتوحاً على غرفةٍ مغلقة', async () => {
  await db.insert('app_user', { id: 'm_hr', username: 'm_hr', name_ar: 'موارد بشرية',
    role_id: 'hr', sector_id: 'S1', scope: 'company', active: 1, created_at: NOW });
  const hr = await sess('m_hr');
  assert.equal(T.teamTasksAccess(hr).canRead, false, 'تغيّرت منح الموارد البشرية — راجع الفحص');
  const html = await P.teamPage(hr, {});
  assert.ok(html.includes('موظف e_a'), 'الكشف نفسه غائب — الفحص لا يقيس شيئاً');
  assert.ok(!html.includes('/app/person/'), 'عُرض رابطُ ملفٍ لمن يُردّ عنه');
});

// ── الحلقة الثالثة: يطلع شغال على شي ────────────────────────────────────────
test('وملف كل واحدٍ منهم يُفتح فعلاً ويقول على ماذا يعمل', async () => {
  const dm = await sess("m_department_manager");
  const a = await T.personDossier(dm, 'u_a');
  assert.equal(a.person.departmentName, 'إدارة الابتكار');
  assert.ok(a.tasks.length >= 1, 'ملفٌ بلا عمل لمن عليه مهمة');

  const b = await T.personDossier(dm, 'u_b');
  assert.ok(b.opportunities.length >= 1, 'من لا مهمة له يُقرأ فارغاً — وهو يقود فرصة');
  assert.equal(b.stats.openOpportunities, 1);
});

test('ومن خارج إداراته يُردّ بعبارةٍ تقول السبب لا برقم', async () => {
  const dm = await sess("m_department_manager");
  await assert.rejects(() => T.personDossier(dm, 'u_d'), /خارج إدارتك/);
});

test('وكل مديرٍ يفتح ملف كل من تعرضه لوحته — بلا استثناء واحد', async () => {
  const broken = [];
  for (const r of MANAGERS) {
    const u = await sess("m_" + r);
    const wl = await T.teamWorkload(u, { year: Number(TODAY.slice(0, 4)), todayDate: TODAY });
    for (const p of wl.departments.flatMap((d) => d.people)) {
      try { await T.personDossier(u, p.userId); }
      catch (e) { broken.push(`${r} ⟵ ${p.userId}: ${e.message}`); }
    }
  }
  assert.deepEqual(broken, [], `اسمٌ معروضٌ في لوحةٍ ولا يُفتح ملفه:\n${broken.join('\n')}`);
});

test('وكلٌّ يفتح ملفه هو بلا أي منح إداري', async () => {
  const u = await sess('u_a');
  const d = await T.personDossier(u, 'u_a');
  assert.equal(d.self, true);
  assert.equal(T.teamTasksAccess(u).canRead, false, 'الموظف نال نطاقاً إدارياً — الفحص لا يقيس «ملفه هو»');
});
