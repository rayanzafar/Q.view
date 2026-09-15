// ── رؤية الفرص بعد قلب القاعدة (قرار المالك ٢٠٢٦-٠٨) ─────────────────────────
//
// «BD يرى فرصه، ومدير الإدارة يرى فرص أهل إدارته، وقائد القطاع قطاعه». كانت فرص القطاع كلها
// مفتوحةً لكل مدير تطوير أعمالٍ فيه — يقرأ فرص زملائه ويقلّب أرقامها ويعدّلها، والفرصة قبل
// ترسيتها سرُّ صاحبها. فانقلبت الرؤية على ثلاث درجات، ولكل درجةٍ حدّها المحروس هنا:
//   • مدير تطوير الأعمال: فرصه هو (ملكاً أو تسكيناً) — والإنشاء في قطاعه يبقى مفتوحاً.
//   • مدير الإدارة (بالدور أو بالقيادة المكتوبة في `department.manager_user_id`): فرص
//     إداراته — المسؤولة والمشارِكة — قراءةً **وتعديلاً** (ADR-0006)، لا حذفاً ولا إنشاءً.
//   • قائد القطاع فما فوق: كما كانوا، لم يمسّهم شيء.
//
// والفحوص تُبنى بجلساتٍ حقيقية (`resolveUser`) لا بكائنات مركّبة باليد: المجموعات التي يقوم
// عليها القرار (إداراته، ما يقوده، فرص تسكينه) تُحلّ عند الجلسة، وفحصٌ يركّبها بيده يفحص
// افتراضَه هو لا المنتج.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppvis-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, G, resolveUser, can;
const T = '2026-08-05T09:00:00Z';
const YEAR = 2026;

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const listedIds = async (uid) => (await opps.listOpportunities(await sess(uid))).map((o) => o.id).sort();

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  can = rbac.can;
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  opps = await import('../../src/modules/crm/opportunities.js');
  G = await import('../../src/modules/identity/grants.js');

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

  await mkUser('u_bd', 'bd_manager', 'own');        // مدير تطوير أعمال
  await mkUser('u_bd2', 'bd_manager', 'own');       // زميله في نفس القطاع
  await mkUser('u_bdlead', 'bd_manager', 'own');    // مدير تطوير أعمال **يقود** إدارةً
  await mkUser('u_dm', 'department_manager', 'sector'); // مديرة إدارة D_A
  await mkUser('u_lead', 'sector_lead', 'sector');  // قائد القطاع — يجب ألّا يمسّه شيء

  // الإدارات: D_BD لأهل تطوير الأعمال، D_A لمديرة الإدارة، D_B وD_C إدارتان أخريان،
  // وD_M الإدارة التي **يقودها** u_bdlead (قيادةً لا انتماءً).
  await db.insert('department', { id: 'D_BD', sector_id: 'SOL', name_ar: 'إدارة تطوير الأعمال', active: 1, created_at: T });
  await db.insert('department', { id: 'D_A', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_B', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('department', { id: 'D_C', sector_id: 'SOL', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_M', sector_id: 'SOL', name_ar: 'إدارة يقودها تطوير الأعمال', manager_user_id: 'u_bdlead', active: 1, created_at: T });

  await mkEmp('e_bd', 'u_bd', 'D_BD');
  await mkEmp('e_bd2', 'u_bd2', 'D_BD');
  await mkEmp('e_bdlead', 'u_bdlead', 'D_BD');
  await mkEmp('e_dm', 'u_dm', 'D_A');
  await mkEmp('e_lead', 'u_lead', null);

  const mkOpp = (id, title, dept, owner) => db.insert('opportunity', {
    id, title_ar: title, sector_id: 'SOL', department_id: dept, stage_id: 'LEAD', client_id: 'CL',
    value_halalas: 1000000, owner_user_id: owner, year: YEAR, stage_changed_at: T, created_at: T });

  await mkOpp('O_BD1', 'فرصته هو', 'D_BD', 'u_bd');
  await mkOpp('O_BD2', 'فرصة زميله', 'D_BD', 'u_bd2');
  await mkOpp('O_A1', 'فرصة إدارة الابتكار', 'D_A', 'u_lead');
  // المشارَكة الموجبة: مسؤولتها D_B وتشارك فيها D_A — تظهر لمديرة D_A وتُفتح لها.
  await mkOpp('O_PART', 'فرصة تشارك فيها الابتكار', 'D_B', 'u_lead');
  await db.insert('opportunity_department', { opportunity_id: 'O_PART', department_id: 'D_A', created_at: T });
  // المشارَكة **السالبة**: مسؤولتها D_B وتشارك فيها D_C — لا صلة لمديرة D_A بها إطلاقاً.
  // هذه هي مصيدة عمود EXISTS غير المؤهَّل: ربطٌ خاطئ في الاستعلام الفرعي يجعل كل فرصةٍ لها
  // أي صف مشاركة «مشتركة مع الجميع» — فتتسرب هذه بالذات.
  await mkOpp('O_PARTNEG', 'فرصة تشارك فيها البيانات', 'D_B', 'u_lead');
  await db.insert('opportunity_department', { opportunity_id: 'O_PARTNEG', department_id: 'D_C', created_at: T });
  // وفرص الإدارة التي يقودها u_bdlead — يملكها غيره.
  await mkOpp('O_M1', 'فرصة الإدارة المُقادة', 'D_M', 'u_lead');
  // ومشاركةٌ للإدارة المُقادة: المسؤولة D_B، وD_M (التي يقودها u_bdlead) شريكة عبر الجدول —
  // القائمة تعرضها له عبر صف المشاركة، فيجب أن يفتحها صفّياً كذلك.
  await mkOpp('O_MPART', 'فرصة تشارك فيها الإدارة المُقادة', 'D_B', 'u_lead');
  await db.insert('opportunity_department', { opportunity_id: 'O_MPART', department_id: 'D_M', created_at: T });

  // ── الأيتام: فرصةٌ بلا إدارة (بورتفوليو الفوز التاريخي المستورد بلا مالكٍ ولا إدارة) ──
  // تظهر لمدير الإدارة في قطاعه هو كما تُفتح صفّياً، ولا تظهر لدورٍ «خاصتي» (BD ولو قاد إدارة)،
  // ولا تعبر القطاع. قطاعٌ ثانٍ لإثبات عدم العبور.
  await db.insert('sector', { id: 'SOL2', name_ar: 'قطاع آخر', kind: 'delivery', active: 1, created_at: T });
  await mkOpp('O_ORPHAN', 'يتيمةٌ في القطاع', null, 'u_lead');
  await db.insert('opportunity', {
    id: 'O_ORPHAN2', title_ar: 'يتيمةٌ في قطاعٍ آخر', sector_id: 'SOL2', department_id: null,
    stage_id: 'LEAD', client_id: 'CL', value_halalas: 1000000, owner_user_id: 'u_lead',
    year: YEAR, stage_changed_at: T, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── مدير تطوير الأعمال: فرصه هو ──────────────────────────────────────────────
test('BD يرى فرصه وحدها — لا فرص قطاعه', async () => {
  assert.deepEqual(await listedIds('u_bd'), ['O_BD1'], 'قائمة BD ليست فرصَه المملوكة وحدها');
});

test('وفرصة زميله في قطاعه نفسه: لا في القائمة ولا بالعنوان المباشر ولا بالقلم', async () => {
  const bd = await sess('u_bd');
  assert.ok(!(await listedIds('u_bd')).includes('O_BD2'), 'فرصة الزميل ظهرت في القائمة');
  await assert.rejects(() => opps.getOpportunity(bd, 'O_BD2'), (e) => e.status === 403,
    'القائمة أخفتها والعنوان المباشر فتحها — تسريب من الباب الخلفي');
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', ['O_BD2']);
  assert.equal(can(bd, 'update', 'opportunity', row), false, 'قرأها ممنوعاً وعدّلها مسموحاً');
});

test('وينشئ فرصةً فتُنسب لإدارته آلياً وتعود إليه مقروءةً كاملة', async () => {
  const created = await opps.createOpportunity(await ctxOf('u_bd'), { title_ar: 'فرصة جديدة من BD' });
  assert.equal(created.movedOutOfReach, undefined, 'أُنشئت ثم رُدّت قراءتها على منشئها');
  assert.equal(created.department_id, 'D_BD', 'النسبة الآلية لإدارة المنشئ لم تقع');
  assert.ok((await listedIds('u_bd')).includes(created.id), 'أنشأها ولا يجدها في قائمته');
  await db.run('UPDATE opportunity SET deleted_at = ? WHERE id = ?', [T, created.id]); // لا تلوّث بقية الفحوص
});

// ── القيادة صفةُ شخصٍ لا دور: BD يقود إدارةً يرى فرص أهلها — ولا يكتب عليها ──
test('BD يقود إدارةً: يجدها في قائمته ويفتح صفَّها ويعدّلها — والحذف يبقى مرفوعاً', async () => {
  const ids = await listedIds('u_bdlead');
  assert.ok(ids.includes('O_M1'), 'فرص الإدارة التي يقودها غائبة عن قائمته');
  assert.ok(!ids.includes('O_BD2') && !ids.includes('O_A1'), 'القيادة على إدارةٍ فتحت غيرها');
  const bdlead = await sess('u_bdlead');
  const one = await opps.getOpportunity(bdlead, 'O_M1');
  assert.equal(one.id, 'O_M1', 'تُعرض له وتُفتح');
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', ['O_M1']);
  // قرار المالك (2026-08-11، ADR-0006): قيادةُ الإدارة تفتح التعديل كما تفتح القراءة —
  // والحذف والإنشاء يبقيان للمنح الصريح (قائمة السماح read|update).
  assert.equal(can(bdlead, 'update', 'opportunity', row), true, 'القيادة لا تفتح التعديل (ADR-0006)');
  assert.equal(can(bdlead, 'delete', 'opportunity', row), false, 'القيادة فتحت الحذف — وهو للمنح الصريح');
});

// كانت القائمة تعرضها (departmentReachClause يقرأ ما يقوده في جدول المشاركة) وفتحُ الصفّ
// يردّها — فرع القيادة في المحرّك كان يفحص عمود الإدارة المسؤولة وحده. الآن يقرأ
// `partner_department_ids` التي يحمّلها opp-access.js، والتعديل يتبع القراءة (ADR-0006).
test('وفرصةٌ تشارك فيها إدارتُه المُقادة: تُعرض وتُفتح وتُعدَّل — والحذف مرفوع', async () => {
  const ids = await listedIds('u_bdlead');
  assert.ok(ids.includes('O_MPART'), 'فرصة تشارك فيها الإدارة التي يقودها غائبة عن قائمته');
  const bdlead = await sess('u_bdlead');
  const one = await opps.getOpportunity(bdlead, 'O_MPART');
  assert.equal(one.id, 'O_MPART', 'تُعرض له وتُفتح');
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', ['O_MPART']);
  assert.equal(can(bdlead, 'update', 'opportunity', { ...row, partner_department_ids: ['D_M'] }), true,
    'مشاركةُ إدارةٍ يقودها لا تفتح التعديل (ADR-0006)');
  assert.equal(can(bdlead, 'delete', 'opportunity', { ...row, partner_department_ids: ['D_M'] }), false,
    'المشاركة فتحت الحذف — وهو للمسؤولة');
});

// ── مديرة الإدارة: المسؤولة والمشارِكة، وكل معروضٍ يُفتح ─────────────────────
test('مديرة الإدارة ترى فرص إدارتها — المسؤولة والمشارِكة والأيتام — وكلُّ صفٍّ معروضٍ يُفتح', async () => {
  const ids = await listedIds('u_dm');
  // فرص إدارتها (O_A1) + ما تشارك فيه (O_PART) + اليتيمة في قطاعها (O_ORPHAN)
  assert.deepEqual(ids, ['O_A1', 'O_ORPHAN', 'O_PART'], 'قائمتها ليست: فرص إدارتها + ما تشارك فيه + أيتام قطاعها');
  const dm = await sess('u_dm');
  for (const id of ids) {
    await assert.doesNotReject(() => opps.getOpportunity(dm, id),
      `«${id}» تُعرض في قائمتها ولا تُفتح`);
  }
});

// ── الأيتام: القائمة تُحاذي الصفّ ────────────────────────────────────────────
// انحدار الشكوى الحيّة (ريان ظفر بعد v5.2): «مشاريع كانت WIN اختفت». الفرصة بلا إدارةٍ في
// قطاع مدير الإدارة كان الصفُّ يفتحها والقائمةُ تُخفيها — فتُفتح بالعنوان ولا تظهر. الآن تُعرض
// وتُفتح معاً، ولا تعبر القطاع.
test('اليتيمة في قطاع مديرة الإدارة: تُعرض في قائمتها **وتُفتح** (القائمة تُحاذي الصفَّ)', async () => {
  const dm = await sess('u_dm');
  assert.ok((await listedIds('u_dm')).includes('O_ORPHAN'), 'اليتيمة غائبة عن قائمة مديرة الإدارة');
  const one = await opps.getOpportunity(dm, 'O_ORPHAN');
  assert.equal(one.id, 'O_ORPHAN', 'تُعرض في القائمة ولا تُفتح — عين التناقض المعكوس');
  // ملاحظة الحدود: الصفُّ بلا إدارةٍ في القطاع نفسه داخلٌ في مدى مدير الإدارة **قراءةً وكتابةً**
  // منذ v5.2 (scopeReaches، «ما لا يُحسم» — وهو مقصودٌ كي لا يُحرَم من كتابة المهام بلا إدارة).
  // إصلاحُنا يخصّ القائمة (القراءة) وحدها ليُحاذيها بالصفّ؛ سلوكُ الكتابة على الأيتام سابقٌ له
  // ولا يمسّه هذا الفحص — فلا يُدّعى هنا منعُ قلمٍ لم يكن ممنوعاً.
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', ['O_ORPHAN']);
  assert.equal(can(dm, 'read', 'opportunity', row), true, 'الصفّ لا يُفتح قراءةً — القائمة والصفّ افترقا');
});

test('واليتيمة في قطاعٍ آخر لا تُعرض ولا تُفتح لمديرة إدارةٍ في قطاعٍ غيره', async () => {
  const dm = await sess('u_dm');
  assert.ok(!(await listedIds('u_dm')).includes('O_ORPHAN2'), 'يتيمةُ قطاعٍ آخر ظهرت في قائمتها');
  await assert.rejects(() => opps.getOpportunity(dm, 'O_ORPHAN2'), (e) => e.status === 403,
    'يتيمةُ قطاعٍ آخر فُتحت بالعنوان المباشر');
});

test('ودورُ «خاصتي» لا ينال الأيتام: BD — ولو قاد إدارةً — لا يرى اليتيمة (وإلا عاد التناقض معكوساً)', async () => {
  // الشرط roleIsDept (لا managedDepartmentIds): u_bdlead يقود D_M لكن دوره «خاصتي» — صفُّه لا
  // يفتح اليتيمة (managedDepartmentReaches يلزمه معرّف إدارةٍ مطابق)، فإدراجُها في قائمته يفرّق
  // القائمةَ والصفَّ. غيابها من قائمته هو الدليل.
  assert.ok(!(await listedIds('u_bd')).includes('O_ORPHAN'), 'BD نقيّ رأى اليتيمة');
  assert.ok(!(await listedIds('u_bdlead')).includes('O_ORPHAN'), 'BD يقود إدارةً رأى اليتيمة — تناقضٌ معكوس');
  const bdlead = await sess('u_bdlead');
  await assert.rejects(() => opps.getOpportunity(bdlead, 'O_ORPHAN'), (e) => e.status === 403,
    'وفُتحت له بالعنوان المباشر — القائمة والصفّ افترقا');
});

// ── منحٌ شخصيٌّ على إدارةٍ لا يديرها (سيناريو ريان/المدن الذكية) ──────────────
// «أعطِه المدن الذكية كذلك» — عبر المنح الشخصي لا بتبديل مدير الإدارة. المنح يوسّع القائمة
// والصفَّ معاً بالآلية نفسها التي بُنيت في v5.2 (personalDeptClause + personalGrantReaches).
test('منحٌ شخصيّ على إدارةٍ أخرى يُظهر فرصها لمديرة الإدارة — قائمةً وفتحاً', async () => {
  // قبل المنح: O_PARTNEG (مسؤولتها D_B) خارج نطاق u_dm
  assert.ok(!(await listedIds('u_dm')).includes('O_PARTNEG'), 'ظهرت قبل المنح');
  await db.insert('user_department_grant', {
    id: 'g_dm_db', user_id: 'u_dm', resource: 'opportunity', action: 'read',
    department_id: 'D_B', note: 'رؤية مؤقتة', granted_by: 'u_lead', created_at: T });
  // بعد المنح: كل فرص D_B تظهر لها وتُفتح
  const ids = await listedIds('u_dm');
  assert.ok(ids.includes('O_PARTNEG'), 'المنح لم يوسّع القائمة');
  const dm = await sess('u_dm');
  await assert.doesNotReject(() => opps.getOpportunity(dm, 'O_PARTNEG'), 'المنح وسّع القائمة ولم يفتح الصفّ');
  // تنظيف: هذا الصفّ آخر ما يلمس u_dm
  await db.run('UPDATE user_department_grant SET deleted_at = ? WHERE id = ?', [T, 'g_dm_db']);
});

test('والمشاركة السالبة لا تتسرب: فرصةٌ شريكتها إدارةٌ **أخرى** لا تُعرض ولا تُفتح', async () => {
  // لو رُبط الاستعلام الفرعي للمشاركة ربطاً خاطئاً (عمود خارجي غير مؤهَّل) لطابق كلَّ صفّ
  // مشاركة في الجدول — فظهرت هذه الفرصة بالذات. غيابها هو الدليل على صحة الربط.
  assert.ok(!(await listedIds('u_dm')).includes('O_PARTNEG'), 'فرصة شريكتها إدارةٌ أخرى ظهرت في قائمتها');
  const dm = await sess('u_dm');
  await assert.rejects(() => opps.getOpportunity(dm, 'O_PARTNEG'), (e) => e.status === 403,
    'وفُتحت بالعنوان المباشر');
});

// ── المجموع يقرأ صفوف القائمة نفسها ─────────────────────────────────────────
test('pipelineSummary = القائمة نفسها عدّاً — لمدير تطوير الأعمال ولمديرة الإدارة', async () => {
  for (const uid of ['u_bd', 'u_dm']) {
    const u = await sess(uid);
    const listed = await opps.listOpportunities(u);
    const total = (await opps.pipelineSummary(u)).reduce((a, s) => a + s.count, 0);
    assert.equal(total, listed.length,
      `مجموع اللوحة (${total}) لا يساوي قائمة ${uid} (${listed.length}) — رقمان لنفس الشاشة`);
  }
});

// ── المنح الشخصية تبقى توسعةً فوق الأساس الجديد ─────────────────────────────
test('«سجى ترى كل فرص إدارة كذا» ما زالت تعمل: منحٌ شخصي يوسّع قائمة BD وصفَّها', async () => {
  await G.grantDepartment(await ctxOf('u_lead'), { user_id: 'u_bd', department_id: 'D_B', note: 'متابعة خط المدن' });
  const ids = await listedIds('u_bd');
  assert.ok(ids.includes('O_PART') && ids.includes('O_PARTNEG'), 'المنح الشخصي لم يوسّع القائمة بفرص الإدارة الممنوحة');
  assert.ok(!ids.includes('O_A1'), 'المنح على إدارةٍ وسّع غيرها');
  const bd = await sess('u_bd');
  const one = await opps.getOpportunity(bd, 'O_PARTNEG');
  assert.equal(one.id, 'O_PARTNEG', 'المنح وسّع القائمة دون الصفّ — يُعرض ولا يُفتح');
});

// ── وقائد القطاع كما كان: القرار ضيّق غيره ولم يمسّه ─────────────────────────
test('قائد القطاع يرى فرص قطاعه كلها — لم يتحرك شيء فوق مستوى الإدارة', async () => {
  const ids = await listedIds('u_lead');
  for (const id of ['O_BD1', 'O_BD2', 'O_A1', 'O_PART', 'O_PARTNEG', 'O_M1']) {
    assert.ok(ids.includes(id), `قائد القطاع فقد «${id}» من قائمته`);
  }
});
