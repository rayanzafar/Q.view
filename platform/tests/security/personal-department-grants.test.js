// «ممكن أنا أحطّ على سجى إنها تشوف كل فرص إدارة الابتكار مو بس المسكَّنة عليها، ودايناميكاً في
// الفرص ما يطلعها غير فرص الابتكار، وفي فرصي يطلع لها اللي هي شغالة عليه… ومدير القطاع يقدر
// يعطي صلاحيات كعينه، ومدير الإدارة يقدر يعطي صلاحيات» — بلسان المالك.
//
// وهذا الملف يحرس الحدّ قبل الميزة. فالتفويض بلا حدٍّ يعني أن أي مدير إدارة يمنح نفسه — أو من
// يشاء — رؤيةَ الشركة كلها بخطوتين، فينهار محرّك الصلاحيات من فوق بينما تبدو الشاشة تعمل.
// فالفحوص هنا ثلاث طبقات:
//   ① الأثر المطلوب يقع فعلاً: تُوسَّع «الفرص» بإدارةٍ بعينها، و«فرصي» لا تتحرّك.
//   ② الحدّ يمنع: لا يمنح أحدٌ ما لا يملكه، ولا يمنح نفسه، ولا يمنح خارج من يديرهم.
//   ③ الرفع يرفع فعلاً — صلاحيةٌ تُمنَح ولا تُرفَع أسوأ من ألّا تُمنَح.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-grants-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, G, opps, P, team, resolveUser;
const T = new Date().toISOString();
const YEAR = Number(T.slice(0, 4));

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  G = await import('../../src/modules/identity/grants.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  team = await import('../../src/modules/crm/oppteam.js');
  P = await import('../../src/web/pages.js');

  for (const [id2, name] of [['SOL', 'قطاع الحلول'], ['CONS', 'قطاع الاستشارات']]) {
    await db.insert('sector', { id: id2, name_ar: name, kind: 'delivery', active: 1, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });

  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector,
    scope, active: 1, created_at: T });
  const mkEmp = async (id2, uid, dept, sector = 'SOL') => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: 'موظف ' + id2, sector_id: sector,
      department_id: dept, job_title: 'استشاري', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: id2 });
  };

  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');       // قائد قطاع الحلول
  await mkUser('u_dm', 'department_manager');                    // مدير الابتكار
  await mkUser('u_dm2', 'department_manager');                   // مدير إدارةٍ أخرى
  await mkUser('u_saja', 'consultant');                          // «سجى» — نطاقها «خاصتي»
  await mkUser('u_hadi', 'consultant');                          // «هادي»
  await mkUser('u_cons_lead', 'sector_lead', 'CONS', 'sector');  // قائد قطاعٍ آخر

  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار',
    manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء',
    manager_user_id: 'u_dm2', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات',
    active: 1, created_at: T });

  await mkEmp('e_dm', 'u_dm', 'D_INNOV');
  await mkEmp('e_dm2', 'u_dm2', 'D_AI');
  await mkEmp('e_saja', 'u_saja', 'D_INNOV');
  await mkEmp('e_hadi', 'u_hadi', 'D_INNOV');

  // فرصٌ في ثلاث إدارات، ولا تملك سجى واحدةً منها
  const mkOpp = (id2, title, dept, sector = 'SOL', owner = 'u_dm') => db.insert('opportunity', {
    id: id2, title_ar: title, sector_id: sector, department_id: dept, stage_id: 'LEAD',
    client_id: 'CL', value_halalas: 5000000, owner_user_id: owner, year: YEAR,
    stage_changed_at: T, created_at: T });
  await mkOpp('O_IN1', 'منصة الاركاب الذكي', 'D_INNOV');
  await mkOpp('O_IN2', 'مكتب البيانات ومركز ذكاء الأعمال', 'D_INNOV');
  await mkOpp('O_AI1', 'تطوير ودعم منصة البيانات', 'D_AI', 'SOL', 'u_dm2');
  await mkOpp('O_CONS', 'حوكمة الاستشارات', 'D_CONS', 'CONS', 'u_cons_lead');
  await mkOpp('O_OWN', 'فرصة تملكها سجى', 'D_INNOV', 'SOL', 'u_saja');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── ① الأثر المطلوب ─────────────────────────────────────────────────────────
test('قبل المنح: سجى ترى ما تملكه وحده — نقطة البدء مثبَّتة', async () => {
  const saja = await sess('u_saja');
  const rows = await opps.listOpportunities(saja);
  assert.deepEqual(rows.map((o) => o.id).sort(), ['O_OWN'], 'العيّنة ليست ضيّقة أصلاً');
});

test('وبعد المنح ترى **كل** فرص الابتكار — ولا فرصةً من إدارةٍ أخرى', async () => {
  await G.grantDepartment(await ctxOf('u_dm'),
    { user_id: 'u_saja', department_id: 'D_INNOV', note: 'تتابع خطّ الابتكار' });
  const saja = await sess('u_saja');
  const ids = (await opps.listOpportunities(saja)).map((o) => o.id).sort();
  assert.deepEqual(ids, ['O_IN1', 'O_IN2', 'O_OWN'], 'المنح لم يوسّع بالضبط ما مُنح');
  assert.ok(!ids.includes('O_AI1') && !ids.includes('O_CONS'), 'تسرَّبت إدارةٌ لم تُمنَح');
});

test('و«فرصي» لا تتحرّك بالمنح — الشاشتان تبقيان مختلفتين كما طلب المالك', async () => {
  const saja = await sess('u_saja');
  const html = await P.myOpportunitiesPage(saja, {});
  assert.ok(html.includes('فرصة تملكها سجى'), 'ما تملكه غاب عن «فرصي»');
  assert.ok(!html.includes('منصة الاركاب الذكي'), 'فرص الإدارة الممنوحة تسرّبت إلى «فرصي»');
});

test('والتسكين وحده يفتح صفَّه: من سُكِّن على فرصة يراها ويجدها في «فرصي»', async () => {
  // المسكِّن مدير إدارة الفرصة (الذكاء) لا مدير إدارة الشخص — فالتسكين عبر الإدارات هو الحالة.
  // ومنذ v5.24: الضمّ عبر الإدارات يُعلَّق حتى يؤكّد مديرُ الموظف، **ولا وصول قبل التأكيد** —
  // فالباب يُفتح بالعضوية الفعلية لا بالطلب (قاعدة B8.5 وحارسها opportunity-pending-access).
  await team.addMember(await ctxOf('u_dm2'), 'O_AI1', { employee_id: 'e_hadi', role_in_group: 'member' });
  const pendingHadi = await sess('u_hadi');
  assert.ok(!(await opps.listOpportunities(pendingHadi)).some((o) => o.id === 'O_AI1'),
    'المعلَّق يرى الفرصة قبل موافقة مديره — التسريب عاد');
  const engine = await import('../../src/modules/workflow/engine.js');
  const q = await engine.myDirectApprovals(await sess('u_dm'));
  assert.ok(q.length, 'طلب التأكيد لم يصل إلى مدير الموظف');
  await engine.actOnApproval(await ctxOf('u_dm'), q[0].id, 'approve', 'يعمل عليها');
  const hadi = await sess('u_hadi');
  const ids = (await opps.listOpportunities(hadi)).map((o) => o.id);
  assert.ok(ids.includes('O_AI1'), 'المسكَّن لا يرى الفرصة التي ضُمّ إلى فريقها');
  const one = await opps.getOpportunity(hadi, 'O_AI1');
  assert.equal(one.id, 'O_AI1', 'ولا تُفتح له صفحتها');
  const html = await P.myOpportunitiesPage(hadi, {});
  assert.ok(html.includes('تطوير ودعم منصة البيانات'), 'ما يعمل عليه غائب عن «فرصي»');
});

// ── ② الحدّ ─────────────────────────────────────────────────────────────────
test('لا يمنح أحدٌ ما لا يملكه: مدير إدارةٍ لا يمنح إدارة غيره', async () => {
  const ctx = await ctxOf('u_dm2');
  await assert.rejects(
    () => G.grantDepartment(ctx, { user_id: 'u_saja', department_id: 'D_CONS' }),
    /لا تملك رؤية/);
});

test('ولا يمنح أحدٌ نفسه — «فلانٌ منح نفسه» ليست مراجعة', async () => {
  const ctx = await ctxOf('u_lead');
  await assert.rejects(
    () => G.grantDepartment(ctx, { user_id: 'u_lead', department_id: 'D_INNOV' }),
    /لا يمنح أحدٌ نفسه/);
});

test('ولا يمنح إلا من يديرهم: قائد قطاعٍ آخر يُردّ عن أهل الحلول', async () => {
  const ctx = await ctxOf('u_cons_lead');
  await assert.rejects(
    () => G.grantDepartment(ctx, { user_id: 'u_saja', department_id: 'D_CONS' }),
    /خارج من تديرهم|لا تملك رؤية/);
});

test('ومن نطاقه «خاصتي» لا يمنح إدارةً كاملة ولو كان الصفّ صفَّه', async () => {
  const ctx = await ctxOf('u_saja');
  await assert.rejects(
    () => G.grantDepartment(ctx, { user_id: 'u_hadi', department_id: 'D_INNOV' }),
    /لا تملك رؤية/);
});

test('ولا تُمنَح صلاحيةٌ لا تقرؤها شاشة — القائمة مغلقة', async () => {
  const ctx = await ctxOf('u_admin');
  await assert.rejects(
    () => G.grantDepartment(ctx,
      { user_id: 'u_saja', department_id: 'D_AI', resource: 'employee', action: 'delete' }),
    /غير متاحة للمنح/);
});

test('وقائمة الإدارات المعروضة هي ما يُقبل فعلاً — لا وعدٌ يُخلَف عند الحفظ', async () => {
  // وهذا هو التدرّج الذي وصفه المالك بنصّه: مدير الإدارة يمنح **إدارته**، وقائد القطاع يمنح
  // أي إدارةٍ في قطاعه — وكلٌّ منهما «كعينه» لا أوسع.
  const forDm = (await G.grantableDepartments(await sess('u_dm'))).map((d) => d.id).sort();
  assert.deepEqual(forDm, ['D_INNOV'], 'مدير الإدارة بلغ إدارةً لا يقودها');
  const forLead = (await G.grantableDepartments(await sess('u_lead'))).map((d) => d.id).sort();
  assert.deepEqual(forLead, ['D_AI', 'D_INNOV'], 'قائد القطاع لا يبلغ إدارات قطاعه كلها، أو بلغ قطاعاً غيره');
  const forSaja = await G.grantableDepartments(await sess('u_saja'));
  assert.deepEqual(forSaja, [], 'من لا يملك اتساعاً لا تُعرض له إدارةٌ واحدة');
});

// ── ③ الرفع والأثر المكتوب ──────────────────────────────────────────────────
test('والرفع يرفع فعلاً — الفرص تعود كما كانت في نفس الطلب التالي', async () => {
  const list = await G.listUserGrants(await sess('u_dm'), 'u_saja');
  assert.equal(list.length, 1);
  await G.revokeDepartmentGrant(await ctxOf('u_dm'), list[0].id);
  const saja = await sess('u_saja');
  assert.deepEqual((await opps.listOpportunities(saja)).map((o) => o.id), ['O_OWN'],
    'رُفعت الصلاحية والفرص باقية');
});

test('وكل منحٍ ورفعٍ مكتوبٌ في الأثر بمن فعله', async () => {
  const rows = await db.all(
    "SELECT action, user_id FROM audit_log WHERE resource = 'user_grant' ORDER BY at");
  assert.ok(rows.length >= 2, 'المنح والرفع بلا أثر');
  assert.equal(rows[0].action, 'create');
  assert.ok(rows.some((r) => r.action === 'delete'), 'الرفع غير مسجَّل');
  assert.ok(rows.every((r) => r.user_id), 'أثرٌ بلا فاعل');
});

test('وصفحة الشخص تعرض لوحة المنح لمديره ولا تعرضها لمن لا يمنح', async () => {
  const dm = await sess('u_dm');
  const html = await P.personPage(dm, 'u_saja');
  assert.ok(html.includes('صلاحياته'), 'المدير لا يجد لوحة الصلاحيات');
  assert.ok(html.includes('أضف مهمة'), 'ولا يستطيع أن يضيف له مهمة من صفحته');
  const self = await sess('u_saja');
  const own = await P.personPage(self, 'u_saja');
  assert.ok(!own.includes('امنحها'), 'صاحب الحساب يمنح نفسه من صفحته');
});

// ── تنفيذ أمر المالك من الإقلاع ─────────────────────────────────────────────
// «ونفّذ هذا الشي على سجى وهادي». والمطابقة بالاسم لا بمفتاح، فالحارس الأهمّ هنا **الامتناع**:
// اسمٌ لا يُحسَم لا يُكتب له شيء. منحُ صلاحيةٍ لشخصٍ خطأ عطلٌ لا يشتكي منه أحد — الممنوح لا
// يشتكي، والمقصود يشتكي من «لم يصلني شيء» فيُقرأ في مكانٍ آخر.
test('أمر المالك يُنفَّذ على من يُحسَم اسمه، ويمتنع عمّن لا يُحسَم', async () => {
  const { applyOwnerGrants } = await import('../../scripts/apply-owner-grants.js');
  await db.update('employee', 'e_saja', { name_ar: 'سجى العتيبي' });
  await db.update('employee', 'e_hadi', { name_ar: 'هادي الشهري' });
  // شخصٌ ثانٍ باسم «هادي» يجعل الاسم غير حاسم — فيُترك ولا يُخمَّن أيّهما المقصود.
  await db.insert('app_user', { id: 'u_hadi2', username: 'u_hadi2', name_ar: 'هادي آخر',
    role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_hadi2', user_id: 'u_hadi2', name_ar: 'هادي القحطاني',
    sector_id: 'SOL', department_id: 'D_AI', active: 1, created_at: T });

  const r = await applyOwnerGrants();
  assert.equal(r.skipped, false);
  assert.deepEqual(r.granted, ['سجى العتيبي'], 'مُنح من لا يُحسَم اسمه، أو حُرم من يُحسَم');
  assert.ok(r.notes.some((n) => n.includes('هادي') && n.includes('أكثر من شخص')),
    'الاسم غير الحاسم مرّ بصمت بدل أن يُقال سببه');

  const saja = await sess('u_saja');
  assert.ok((await opps.listOpportunities(saja)).some((o) => o.id === 'O_IN1'),
    'نُفِّذ الأمر ولا أثر له على ما تراه');

  const again = await applyOwnerGrants();
  assert.equal(again.skipped, true, 'يُعاد مع كل إقلاع — فيُعيد منحَ ما رفعه المالك بيده');
});
