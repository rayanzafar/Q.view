// ── منح الكتابة على إدارة (v5.33، ADR-0009) ──────────────────────────────────
//
// «اعطي صلاحيه لـم. يعقوب وم. اسحاق في اضافه فرص وتعديل الفرص، تعديل واضافه على المشاريع
// التابعه لقطاع البيانات والذكاء الاصطناعي» — بلسان المالك (٢٠٢٦-٠٨-١٦).
//
// أدقّ ما يُحرَس هنا ثلاثة:
//   ① المنحة تفتح **إدارتها وحدها**: الإنشاء يُحكَم بإدارة الصفّ المولود، والتعديل بإدارة
//      الصفّ القائم — وإدارةُ غيرها تُرَدّ بقولٍ عربي.
//   ② والمنحة تبلغ ما تبلغه الإدارة: المسؤولةَ والمشارِكة معاً — قائمةً وصفّاً (مشروعا
//      الحافلات اللذان عناهما المالك إدارتُه فيهما مشارِكة لا مسؤولة). وحقول النسبة في
//      المشترك تبقى للإدارة المسؤولة (عقد ADR-0008 لا يُخترق بالمنحة).
//   ③ وسكربت أمر المالك يكتب الستَّ لكلٍّ منهما مرةً واحدة، ولا يخمّن اسماً غير محسوم.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-wgrants-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, G, opps, projects, access, P, resolveUser;
const T = '2026-06-01T00:00:00Z';
const sess = async (uid) => {
  const sid = 's_' + uid + '_' + Math.random().toString(36).slice(2, 8);
  await db.insert('session', { id: sid, user_id: uid, created_at: T,
    expires_at: new Date(Date.now() + 864e5).toISOString() });
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  G = await import('../../src/modules/identity/grants.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  projects = await import('../../src/modules/pmo/projects.js');
  access = await import('../../src/modules/pmo/project-access.js');
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', is_won: 1, is_lost: 0, sort_order: 9 });
  await db.insert('client', { id: 'CL', name_ar: 'الهيئة الملكية', created_at: T });

  await db.insert('app_user', { id: 'u_admin', username: 'u_admin', name_ar: 'مدير النظام',
    role_id: 'admin', sector_id: 'SOL', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_jacob', username: 'jacob.sayid', name_ar: 'م. يعقوب سيد',
    role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_ishaq', username: 'isaac.sayid', name_ar: 'م. إسحاق سيد',
    role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });

  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL',
    name_ar: 'إدارة الذكاء الاصطناعي والبيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CITY', sector_id: 'SOL',
    name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });

  for (const [eid, uid, name] of [['e_jacob', 'u_jacob', 'يعقوب سيد اكرام'], ['e_ishaq', 'u_ishaq', 'إسحاق سيد اكرام']]) {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: name, sector_id: 'SOL',
      department_id: 'D_DATA', job_title: 'استشاري', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: eid });
  }

  const mkOpp = (id2, title, dept) => db.insert('opportunity', {
    id: id2, title_ar: title, sector_id: 'SOL', department_id: dept, stage_id: 'LEAD',
    client_id: 'CL', value_halalas: 5000000, owner_user_id: 'u_admin', year: 2026,
    stage_changed_at: T, created_at: T });
  await mkOpp('O_DATA', 'فرصة منصة البيانات', 'D_DATA');
  await mkOpp('O_CITY', 'فرصة المدن الذكية', 'D_CITY');

  const mkPrj = (id2, name, dept) => db.insert('project', {
    id: id2, name_ar: name, sector_id: 'SOL', department_id: dept, status: 'IN_PROGRESS',
    rag: 'GREEN', start_date: '2026-01-01', owner_user_id: 'u_admin', created_at: T });
  await mkPrj('P_DATA', 'منصة البيانات السعودية', 'D_DATA');
  await mkPrj('P_SHARED', 'منظومة رصد الحافلات', 'D_CITY');       // عين مشروعَي المالك: مسؤولةٌ غيرُها
  await db.insert('project_department', { project_id: 'P_SHARED', department_id: 'D_DATA', created_at: T });
  await mkPrj('P_CITY', 'مشروع مدنيّ خالص', 'D_CITY');
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── نقطة البدء مثبَّتة: بلا منحٍ لا يرى ولا يكتب ─────────────────────────────
test('قبل المنح: يعقوب لا يرى فرص إدارته ولا مشاريعها، ولا يملك إنشاءً ولا تعديلاً', async () => {
  const jacob = await sess('u_jacob');
  assert.deepEqual((await opps.listOpportunities(jacob)).map((o) => o.id), [], 'العيّنة ليست ضيّقة أصلاً');
  assert.deepEqual((await projects.listProjects(jacob)).map((p) => p.id), []);
  await assert.rejects(() => opps.createOpportunity({ user: jacob, ip: '1' },
    { title_ar: 'فرصة قبل المنح', sector_id: 'SOL' }), /صلاحيتك لا تسمح|خارج نطاق/);
  await assert.rejects(() => projects.createProject({ user: jacob, ip: '1' },
    { name_ar: 'مشروع قبل المنح', sector_id: 'SOL' }), /صلاحيتك لا تسمح/);
  await assert.rejects(() => opps.updateOpportunity({ user: jacob, ip: '1' }, 'O_DATA', { notes: 'لا' }),
    /صلاحيتك لا تسمح/);
  assert.equal(await access.projectActionAllowed(jacob, 'update', await db.get(
    `SELECT * FROM project WHERE id = 'P_DATA'`)), false);
});

// ── المنح الستّ عبر خدمة المنح نفسها (القائمة المغلقة قبلت الأزواج الجديدة) ──
test('مدير النظام يمنح يعقوب الستَّ على إدارة البيانات — والقائمة المغلقة ما زالت تردّ الغريب', async () => {
  const ctx = await ctxOf('u_admin');
  for (const [resource, action] of [['opportunity', 'read'], ['opportunity', 'create'], ['opportunity', 'update'],
    ['project', 'read'], ['project', 'create'], ['project', 'update']]) {
    const r = await G.grantDepartment(ctx, { user_id: 'u_jacob', department_id: 'D_DATA', resource, action,
      note: 'قرار المالك 2026-08-16' });
    assert.equal(r.ok, true, `${resource}:${action} رُفض وهو في القائمة`);
  }
  await assert.rejects(() => G.grantDepartment(ctx,
    { user_id: 'u_jacob', department_id: 'D_DATA', resource: 'project', action: 'delete' }),
  /غير متاحة للمنح/, 'الحذف تسرّب إلى القائمة المغلقة');
});

// ── ② المنحة تبلغ المسؤولةَ والمشارِكة — قائمةً وصفّاً ────────────────────────
test('بعد المنح: القائمتان تعرضان إدارتَه — ومشروعُ الشراكة معها، ولا شيء من غيرها', async () => {
  const jacob = await sess('u_jacob');
  assert.deepEqual((await opps.listOpportunities(jacob)).map((o) => o.id).sort(), ['O_DATA'],
    'فرص الإدارة الممنوحة غائبة أو تسرّب غيرها');
  const prj = (await projects.listProjects(jacob)).map((p) => p.id).sort();
  assert.deepEqual(prj, ['P_DATA', 'P_SHARED'],
    'قائمة المشاريع لا تطابق المنحة: المسؤولة والمشارِكة معاً لا غير (عين مشروعَي الحافلات)');
  const row = await db.get(`SELECT * FROM project WHERE id = 'P_SHARED'`);
  assert.equal(await access.projectActionAllowed(jacob, 'update', row), true,
    'صفّ مشروع الشراكة لا يفتح تعديلاً — والقائمة تعرضه: عين التناقض المحروس');
  assert.equal(await access.projectActionAllowed(jacob, 'delete', row), false,
    'المنحة فتحت حذفاً لم يُمنَح');
  // ولا يُفتح مشروعُ إدارةٍ لم تُمنَح ولا تشارك فيها إدارتُه
  await assert.rejects(() => access.loadReadableProject(jacob, 'P_CITY', 'read'), /صلاحيتك لا تسمح/);
});

test('و«فرصي» لا تتحرّك بالمنح — تبقى شخصية كما هي', async () => {
  const jacob = await sess('u_jacob');
  const html = await P.myOpportunitiesPage(jacob, {});
  assert.ok(!html.includes('فرصة منصة البيانات'), 'فرص الإدارة الممنوحة تسرّبت إلى «فرصي»');
});

// ── ① الإنشاء يُحكَم بإدارة الصفّ المولود ────────────────────────────────────
test('يعقوب يسجّل فرصةً فتُنسب إلى إدارته الممنوحة — ولإدارةِ غيرها يُرَدّ بقولٍ يسمّي العلاج', async () => {
  const ctx = { user: await sess('u_jacob'), ip: '1' };
  const r = await opps.createOpportunity(ctx, { title_ar: 'فرصة جديدة من يعقوب', sector_id: 'SOL' });
  assert.equal(r.department_id, 'D_DATA', 'الفرصة لم تُنسب إلى إدارته تلقائياً');
  await assert.rejects(() => opps.createOpportunity(ctx,
    { title_ar: 'فرصة لإدارة غيره', sector_id: 'SOL', department_id: 'D_CITY' }),
  /إدارتك الممنوحة/);
});

test('ويسجّل مشروعاً فيُنسب إلى إدارته ويقرؤه فوراً — ولإدارةِ غيرها يُرَدّ', async () => {
  const ctx = { user: await sess('u_jacob'), ip: '1' };
  const r = await projects.createProject(ctx, { name_ar: 'مشروع جديد من يعقوب', sector_id: 'SOL' });
  assert.ok(r.id && !r.movedOutOfReach, 'أُنشئ ثم حُجب عن منشئه — عملٌ تمّ ورسالة منع');
  assert.equal(r.department_id, 'D_DATA', 'المشروع وُلد بلا إدارته');
  await assert.rejects(() => projects.createProject(ctx,
    { name_ar: 'مشروع لإدارة غيره', sector_id: 'SOL', department_id: 'D_CITY' }),
  /إدارتك الممنوحة/);
});

// ── التعديل: مفتوحٌ على إدارته، وحقول النسبة في المشترك محجوزة (ADR-0008) ────
test('التعديل يفتح فرص إدارته ومشاريعها — وفي مشروع الشراكة تبقى النسبة للمسؤولة', async () => {
  const ctx = { user: await sess('u_jacob'), ip: '1' };
  const o = await opps.updateOpportunity(ctx, 'O_DATA', { notes: 'ملاحظة من يعقوب' });
  assert.equal(o.notes, 'ملاحظة من يعقوب');
  await assert.rejects(() => opps.updateOpportunity(ctx, 'O_CITY', { notes: 'لا' }), /صلاحيتك لا تسمح/);
  const p = await projects.updateProject(ctx, 'P_SHARED', { pm_name: 'يعقوب سيد' });
  assert.equal(p.pm_name, 'يعقوب سيد', 'الحقول المفتوحة رُدّت عن محرِّر الشراكة');
  await assert.rejects(() => projects.updateProject(ctx, 'P_SHARED', { department_id: 'D_DATA' }),
    /قرارُ الإدارة المسؤولة/, 'منحةُ الشراكة فتحت حقول النسبة');
  // وعلى مشروع إدارته المسؤولة النسبةُ مفتوحة كما هي لكل محرِّري المسؤولة
  const own = await projects.updateProject(ctx, 'P_DATA', { partner_department_ids: ['D_CITY'] });
  assert.ok((own.id || own.ok), 'نسبة مشروع الإدارة المسؤولة رُدّت عن الممنوح عليها');
});

// ── ③ سكربت أمر المالك: الستّ لكلٍّ منهما، مرةً واحدة، ولا يخمّن ─────────────
test('سكربت v5.33 يمنح إسحاق ستَّه ويقول عن يعقوب «ممنوحة مسبقاً» — ثم لا يعيد نفسه', async () => {
  const { applyOwnerGrantsV533 } = await import('../../scripts/apply-owner-grants-v533.js');
  const r = await applyOwnerGrantsV533();
  assert.equal(r.skipped, false);
  assert.ok(r.granted.some((g) => g.includes('إسحاق')), 'إسحاق لم يُمنَح');
  assert.ok(r.notes.some((n) => n.includes('يعقوب') && n.includes('مسبقاً')),
    'الممنوح يدوياً لم يُقرأ قائماً');
  const cnt = await db.get(`SELECT COUNT(*) c FROM user_department_grant
    WHERE user_id = 'u_ishaq' AND department_id = 'D_DATA' AND deleted_at IS NULL`);
  assert.equal(Number(cnt.c), 6, 'ستّ الصلاحيات لم تُكتب كاملة');
  const ishaq = await sess('u_ishaq');
  assert.deepEqual((await projects.listProjects(ishaq)).map((p) => p.id).sort().slice(0, 2), ['P_DATA', 'P_SHARED'],
    'منحُ السكربت بلا أثرٍ حي');
  const again = await applyOwnerGrantsV533();
  assert.equal(again.skipped, true, 'يُعاد مع كل إقلاع — فيعيد منحَ ما قد يرفعه المالك بيده');
});

test('والاسم غير المحسوم يُترك ويُقال سببه — لا يخمّن السكربت شخصاً', async () => {
  const { applyOwnerGrantsV533 } = await import('../../scripts/apply-owner-grants-v533.js');
  await db.insert('app_user', { id: 'u_jacob2', username: 'jacob2', name_ar: 'يعقوب آخر',
    role_id: 'consultant', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_jacob2', user_id: 'u_jacob2', name_ar: 'يعقوب القحطاني',
    sector_id: 'SOL', department_id: 'D_CITY', active: 1, created_at: T });
  const r = await applyOwnerGrantsV533({ force: true });
  assert.ok(r.notes.some((n) => n.includes('يعقوب') && n.includes('أكثر من شخص')),
    'الاسم المكرّر مرّ بصمت بدل أن يُقال سببه');
  const cnt = await db.get(`SELECT COUNT(*) c FROM user_department_grant
    WHERE user_id = 'u_jacob2' AND deleted_at IS NULL`);
  assert.equal(Number(cnt.c), 0, 'مُنح شخصٌ لم يُقصَد');
});
