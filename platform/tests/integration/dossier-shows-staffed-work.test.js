// «ولو ضغط على كل موظف يطلع شغال على شي» — بلسان المالك.
//
// وملفُ الشخص كان يجيب هذا السؤال بشرطٍ واحد: `owner_user_id`. فمن سُكِّن على فرصةٍ يقودها
// غيره يُقرأ في ملفه «لا فرص» — وهو يعمل عليها. وأثرُ ذلك أوسع من صفٍّ ناقص: قبل هذا بأسبوع
// بُني التسكين عبر الإدارات على طلب المالك («ممكن في فرصة ناس من تطوير الأعمال وناس من إدارات
// مختلفة تشتغل عليها»)، فصار ممكناً ثم لا يظهر في الشاشة التي بُنيت لسؤال «شغال على ماذا».
// والفجوة تُخفي بالضبط من يعمل على فرص غيره — أي فريق التسليم.
//
// وما يُحرَس هنا ثلاثة، والثالث هو الذي يمنع الرقم من الكذب:
//   • المسكَّن ترد فرصته في ملفه، ويُقال إنه **مسكَّن** لا صاحبها.
//   • المالك يبقى مالكاً، ولا يُزاحمه التسكين على صفته.
//   • التسكين **غير المؤكَّد** يظهر معلَّماً ولا يُحتسب — فالعدّ للعمل المؤكَّد وحده.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dossier-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, T2, team, P, resolveUser;
const T = new Date().toISOString();
const TODAY = T.slice(0, 10);
const YEAR = Number(TODAY.slice(0, 4));

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
  T2 = await import('../../src/modules/pmo/tasks.js');
  team = await import('../../src/modules/crm/oppteam.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });

  const mkUser = (id, role, scope = 'own') => db.insert('app_user', { id, username: id, name_ar: 'حساب ' + id,
    role_id: role, sector_id: 'SOL', scope, active: 1, created_at: T });
  const mkEmp = async (id, uid, dept) => {
    await db.insert('employee', { id, user_id: uid, name_ar: 'موظف ' + id, sector_id: 'SOL',
      department_id: dept, job_title: 'استشاري', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: id });
  };

  await mkUser('u_admin', 'admin', 'company');
  await mkUser('u_mgr', 'department_manager');      // مدير إدارة المسكَّن — إليه يذهب التأكيد
  await mkUser('u_owner', 'bd_head', 'company');    // صاحب الفرصة، من إدارة أخرى
  await mkUser('u_worker', 'consultant');           // المسكَّن: لا يملك فرصةً واحدة
  // مسكِّنٌ **لا يملك الموظف**: نطاق حسابه «خاصتي» ولا يقود إدارته، ومنحه على الفرص بنطاق
  // قطاعه — فيسكّن ويُعلَّق تسكينه إلى أن يؤكّده مدير الموظف. وهذا شكل حساب تطوير الأعمال
  // المبذور حرفياً (scripts/seed.js).
  await mkUser('u_bd', 'bd_manager');

  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة الابتكار',
    manager_user_id: 'u_mgr', active: 1, created_at: T });
  await db.insert('department', { id: 'D2', sector_id: 'SOL', name_ar: 'تطوير الأعمال', active: 1, created_at: T });
  await mkEmp('e_mgr', 'u_mgr', 'D1');
  await mkEmp('e_worker', 'u_worker', 'D1');
  await mkEmp('e_owner', 'u_owner', 'D2');

  // الفرصتان **يملكهما رئيس تطوير الأعمال** — فمن يظهر في ملفه مسكَّناً ليس صاحبها.
  // و«الابتكار» على الأولى عمداً: التسكين بوابته `update opportunity`، ومدير الإدارة يملكها
  // على فرص إدارته لا على كل فرصة. فهذه هي الحالة الحيّة: مديرٌ يضمّ أحد رجاله إلى فرصةٍ في
  // إدارته يقودها تطوير الأعمال. والثانية في «تطوير الأعمال» فيسكِّن عليها مديرُ تطوير
  // الأعمال — وهو لا يملك الموظف، فيلزم تأكيد مديره: مسار التعليق.
  for (const [id, title, dept] of [
    ['O_TEAM', 'منصة الاركاب الذكي', 'D1'],
    ['O_PEND', 'مكتب البيانات ومركز ذكاء الأعمال', 'D2'],
  ]) {
    await db.insert('opportunity', { id, title_ar: title, sector_id: 'SOL', department_id: dept,
      stage_id: 'LEAD', client_id: 'CL', value_halalas: 10000000, owner_user_id: 'u_owner',
      year: YEAR, stage_changed_at: T, created_at: T });
  }
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('قبل التسكين: ملف المسكَّن خالٍ من الفرص — نقطة البدء مثبَّتة', async () => {
  const worker = await sess('u_worker');
  const d = await T2.personDossier(worker, 'u_worker');
  assert.equal(d.opportunities.length, 0, 'العيّنة ليست خاليةً أصلاً — الفحص لا يقيس شيئاً');
});

test('ومن يُسكَّن على فرصة يقودها غيره تظهر في ملفه — معلَّمةً بأنه مسكَّن لا صاحبها', async () => {
  // المسكِّن هنا **مدير الموظف نفسه**، فلا يحتاج تأكيداً من أحد: التسكين قائم فوراً.
  const mgr = await sess('u_mgr');
  await team.addMember({ user: mgr, ip: '1' }, 'O_TEAM', { employee_id: 'e_worker', role_in_group: 'member' });

  const worker = await sess('u_worker');
  const d = await T2.personDossier(worker, 'u_worker');
  const o = d.opportunities.find((x) => x.id === 'O_TEAM');
  assert.ok(o, 'الفرصة المسكَّن عليها غائبة عن ملفه — «شغال على شي» تُقرأ لا شيء');
  assert.equal(o.relation, 'member', 'يُقرأ صاحبها وهو مسكَّن عليها');
  assert.equal(o.pending, false, 'تسكينٌ من مدير الموظف نفسه لا ينتظر تأكيداً');
  assert.equal(d.stats.openOpportunities, 1, 'العدّ لم يشمل ما هو مسكَّن عليه فعلاً');
});

test('ويراها مديره حين يفتح ملفه — وهو السؤال الذي بُنيت له الصفحة', async () => {
  const mgr = await sess('u_mgr');
  const d = await T2.personDossier(mgr, 'u_worker');
  assert.ok(d.opportunities.some((x) => x.id === 'O_TEAM'), 'المدير يفتح ملف موظفه فلا يرى عمله');
  const html = await P.personPage(mgr, 'u_worker');
  assert.ok(html.includes('منصة الاركاب الذكي'), 'الاسم لا يُطبع في الصفحة نفسها');
  assert.ok(html.includes('مسكَّن'), 'الصفحة لا تقول ما صلته بالفرصة');
});

test('وصاحب الفرصة يبقى صاحبها — التسكين لا يُزاحم الملكية على صفتها', async () => {
  const owner = await sess('u_owner');
  const d = await T2.personDossier(owner, 'u_owner');
  const o = d.opportunities.find((x) => x.id === 'O_TEAM');
  assert.ok(o, 'صاحب الفرصة لا يراها في ملفه');
  assert.equal(o.relation, 'owner');
  assert.equal(o.pending, false);
});

test('وتسكينٌ ينتظر تأكيد المدير يظهر معلَّماً ولا يُحتسب — فلا يعدّ الرقم عملاً لم يُقَرّ', async () => {
  // المسكِّن هنا مدير تطوير الأعمال: يملك تعديل فرص قطاعه ولا يملك الموظف — فيلزم تأكيد مديره.
  // (ولا يصلح مدير النظام هنا: هو يملك الجميع، فتسكينه لا يُعلَّق أصلاً — وهو المقصود.)
  const bd = await sess('u_bd');
  await team.addMember({ user: bd, ip: '1' }, 'O_PEND', { employee_id: 'e_worker', role_in_group: 'member' });
  const row = await db.get(
    "SELECT COALESCE(status,'ACTIVE') status FROM membership WHERE group_id = ? AND employee_id = ?",
    ['O_PEND', 'e_worker']);
  assert.equal(row.status, 'PENDING', 'العيّنة ليست معلَّقة أصلاً — الفحص لا يقيس شيئاً');

  const worker = await sess('u_worker');
  const d = await T2.personDossier(worker, 'u_worker');
  const o = d.opportunities.find((x) => x.id === 'O_PEND');
  assert.ok(o, 'المعلَّق أُخفي كلياً — فيسأل صاحبه أين الفرصة التي أُضيف إليها');
  assert.equal(o.pending, true, 'المعلَّق يُقرأ مؤكَّداً');
  assert.equal(d.stats.openOpportunities, 1, 'العدّ حسب تسكيناً لم يؤكّده مديره بعد');

  const html = await P.personPage(worker, 'u_worker');
  assert.ok(html.includes('بانتظار تأكيد مديره'), 'الصفحة لا تقول إن هذا التسكين غير مؤكَّد');
});

test('وحسابٌ بلا سجل موظف لا ينكسر ملفه — لا تسكين له أصلاً', async () => {
  await db.insert('app_user', { id: 'u_bare', username: 'u_bare', name_ar: 'حساب بلا موظف',
    role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  const bare = await sess('u_bare');
  const d = await T2.personDossier(bare, 'u_bare');
  assert.deepEqual(d.opportunities, []);
  assert.equal(d.stats.openOpportunities, 0);
});
