// «مثلاً سجى أبغى أعطيها صلاحية تضيف فرص لأنها شغالة في تطوير الأعمال لقطاع الابتكار… كيف ممكن
// ندير الصلاحيات والفيتشرز لكل موظف بطريقة سهلة» — بلسان المالك (١٥ سبتمبر ٢٠٢٦)، والقرار:
// «مدير الإدارة يمديه يمنح ومدير القطاع والأدمن حسب الصلاحية عند كل واحد» (ADR-0025، الترحيلة 049).
//
// وهذا الملف يحرس الحدّ قبل الميزة، كما حرس سلفُه (personal-department-grants) حدَّ الإدارة:
//   ① الأثر: حزمة «تطوير الأعمال» على قطاعٍ كامل تفتح فرص كل إداراته **وأيتامه** — لا قطاعاً غيره،
//      قراءةً وإضافةً وتعديلاً؛ و«الفعاليات» على الشركة تفتح بابها.
//   ② الحدّ: مدير الإدارة لا يبلغ القطاع ولا إدارةً غير إدارته؛ قائد القطاع قطاعَه وحده؛ لا أحد نفسَه.
//   ③ المدة: آخر يوم يسري، وما بعده يسقط من الطلب التالي بلا مهمة ليلية؛ والتاريخ الماضي يُردّ.
//   ④ الرفع يرفع الحزمة كلها بنقرة، وبحدّ المنح نفسه — والأثر مكتوب.
//   ⑤ البطاقة تعرض ما يُقبل: المنح لمن يملكه، وتغيير الدور لمدير النظام، ولا منح للنفس.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-grant-levels-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, G, opps, P, rbac, resolveUser;
const T = new Date().toISOString();
const YEAR = Number(T.slice(0, 4));
const dayShift = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const sess = async (uid) => {
  const sid = 's_' + uid;
  if (!await db.get('SELECT id FROM session WHERE id = ?', [sid])) {
    await db.insert('session', { id: sid, user_id: uid, created_at: T, expires_at: new Date(Date.now() + 864e5).toISOString() });
  }
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });
const idsFor = async (uid) => (await opps.listOpportunities(await sess(uid))).map((o) => o.id).sort();

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  G = await import('../../src/modules/identity/grants.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  P = await import('../../src/web/pages.js');

  for (const [id2, name, order] of [['SOL', 'قطاع الحلول', 1], ['CONS', 'قطاع الاستشارات', 2]]) {
    await db.insert('sector', { id: id2, name_ar: name, kind: 'delivery', active: 1, sort_order: order, created_at: T });
  }
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });

  const mkUser = (id2, role, sector = 'SOL', scope = 'own') => db.insert('app_user', {
    id: id2, username: id2, name_ar: 'حساب ' + id2, role_id: role, sector_id: sector, scope, active: 1, created_at: T });
  const mkEmp = async (id2, uid, dept, sector = 'SOL') => {
    await db.insert('employee', { id: id2, user_id: uid, name_ar: 'موظف ' + id2, sector_id: sector,
      department_id: dept, job_title: 'استشاري', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: id2 });
  };
  await mkUser('u_admin', 'admin', 'SOL', 'company');
  await mkUser('u_lead', 'sector_lead', 'SOL', 'sector');
  await mkUser('u_cons_lead', 'sector_lead', 'CONS', 'sector');
  await mkUser('u_dm', 'department_manager');
  await mkUser('u_saja', 'consultant');
  await mkUser('u_hadi', 'consultant');
  await mkUser('u_cons_emp', 'consultant', 'CONS');

  await db.insert('department', { id: 'D_INNOV', sector_id: 'SOL', name_ar: 'إدارة الابتكار', manager_user_id: 'u_dm', active: 1, created_at: T });
  await db.insert('department', { id: 'D_AI', sector_id: 'SOL', name_ar: 'إدارة الذكاء', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CONS', sector_id: 'CONS', name_ar: 'إدارة الاستشارات', active: 1, created_at: T });
  await mkEmp('e_dm', 'u_dm', 'D_INNOV');
  await mkEmp('e_saja', 'u_saja', 'D_INNOV');
  await mkEmp('e_hadi', 'u_hadi', 'D_INNOV');
  await mkEmp('e_cons', 'u_cons_emp', 'D_CONS', 'CONS');

  const mkOpp = (id2, title, dept, sector = 'SOL', owner = 'u_lead') => db.insert('opportunity', {
    id: id2, title_ar: title, sector_id: sector, department_id: dept, stage_id: 'LEAD',
    client_id: 'CL', value_halalas: 5000000, owner_user_id: owner, year: YEAR, stage_changed_at: T, created_at: T });
  await mkOpp('O_IN1', 'منصة الاركاب الذكي', 'D_INNOV', 'SOL', 'u_dm');
  await mkOpp('O_AI1', 'تطوير ودعم منصة البيانات', 'D_AI');
  await mkOpp('O_ORPHAN', 'فرصة بلا إدارة في الحلول', null);
  await mkOpp('O_CONS', 'حوكمة الاستشارات', 'D_CONS', 'CONS', 'u_cons_lead');
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

let sajaBundle = null;

// ── ① الأثر ─────────────────────────────────────────────────────────────────
test('قبل المنح: سجى لا ترى فرصةً واحدة — نقطة البدء مثبَّتة', async () => {
  assert.deepEqual(await idsFor('u_saja'), []);
});

test('قائد القطاع يمنح «تطوير الأعمال» على قطاعه كله: كل إدارات القطاع وأيتامه، ولا قطاع غيره — قراءةً وإضافةً وتعديلاً', async () => {
  const r = await G.grantBundle(await ctxOf('u_lead'), { user_id: 'u_saja', bundle: 'bd', level: 'sector', sector_id: 'SOL', note: 'تطوير أعمال القطاع' });
  assert.equal(r.ok, true); assert.equal(r.created, 3); assert.equal(r.already, 0);
  assert.equal(r.level, 'sector'); assert.equal(r.target_name, 'قطاع الحلول كله');
  sajaBundle = r.bundle_id;
  assert.deepEqual(await idsFor('u_saja'), ['O_AI1', 'O_IN1', 'O_ORPHAN'], 'المنح على القطاع لم يفتح إداراته كلها وأيتامه بالضبط');

  const ctx = await ctxOf('u_saja');
  const created = await opps.createOpportunity(ctx, { title_ar: 'فرصة سجّلتها سجى', client_id: 'CL', sector_id: 'SOL', department_id: 'D_AI' });
  assert.ok(created.id, 'حاملة «تطوير الأعمال» على القطاع لم تستطع تسجيل فرصة لإدارةٍ في قطاعها');
  await assert.rejects(() => opps.createOpportunity(ctx, { title_ar: 'خارج القطاع', client_id: 'CL', sector_id: 'CONS', department_id: 'D_CONS' }),
    /ممنوحةٌ لك على إدارتك|خارج نطاق قطاعك|صلاحيتك/, 'سجّلت فرصةً في قطاعٍ لم يُمنح لها');
  const upd = await opps.updateOpportunity(ctx, 'O_AI1', { next_action: 'اتصال بالجهة' });
  assert.equal(upd.next_action, 'اتصال بالجهة', 'التعديل على فرصة إدارةٍ أخرى في القطاع الممنوح مردود');
  await assert.rejects(() => opps.updateOpportunity(ctx, 'O_CONS', { next_action: 'لا' }), (e) => e.status === 403 || e.status === 404, 'عدّلت فرصةَ قطاعٍ آخر');
});

test('الكشفُ يجمع الحزمة سطراً واحداً، وحكمُ رفعها لكل قارئ من الخدمة لا من الشاشة', async () => {
  const forAdmin = await G.listUserGrantGroups(await sess('u_admin'), 'u_saja');
  assert.equal(forAdmin.length, 1);
  const g = forAdmin[0];
  assert.equal(g.bundle_key, 'bd'); assert.equal(g.level, 'sector'); assert.equal(g.pairs.length, 3);
  assert.equal(g.label, 'تطوير الأعمال'); assert.equal(g.target_name, 'قطاع الحلول كله');
  assert.equal(g.revocable, true, 'مدير النظام لا يرفع');
  assert.equal((await G.listUserGrantGroups(await sess('u_lead'), 'u_saja'))[0].revocable, true, 'مانحها لا يرفعها');
  assert.equal((await G.listUserGrantGroups(await sess('u_dm'), 'u_saja'))[0].revocable, false, 'مدير الإدارة يرفع حزمةً على القطاع وهو لا يبلغه');
  assert.equal((await G.listUserGrantGroups(await sess('u_saja'), 'u_saja'))[0].revocable, false, 'صاحبها يرفع عن نفسه');
});

// ── ② الحدّ ─────────────────────────────────────────────────────────────────
test('مدير الإدارة يمنح إدارته وحدها: لا القطاع، ولا إدارة غيره — والقائمة المعروضة له هي ما يُقبل', async () => {
  const dm = await ctxOf('u_dm');
  await assert.rejects(() => G.grantBundle(dm, { user_id: 'u_hadi', bundle: 'bd', level: 'sector', sector_id: 'SOL' }), /لا تملك رؤية/);
  await assert.rejects(() => G.grantBundle(dm, { user_id: 'u_hadi', bundle: 'bd', level: 'department', department_id: 'D_AI' }), /لا تملك رؤية/);
  const r = await G.grantBundle(dm, { user_id: 'u_hadi', bundle: 'bd', level: 'department', department_id: 'D_INNOV', note: 'إدارته' });
  assert.equal(r.created, 3);
  assert.deepEqual(await idsFor('u_hadi'), ['O_IN1']);
  const options = await G.grantableBundleOptions(dm.user);
  const bd = options.find((b) => b.key === 'bd');
  assert.deepEqual(bd.targets.map((t) => `${t.level}:${t.id}`), ['department:D_INNOV'], 'القائمة تعد بما يُرَدّ');
  assert.ok(!options.some((b) => b.key === 'events'), 'مدير الإدارة يُعرض له منح الفعاليات وهو لا يملكها');
});

test('قائد قطاعٍ آخر لا يبلغ قطاع الحلول ولا أهله — ويمنح قطاعه لأهله', async () => {
  const cl = await ctxOf('u_cons_lead');
  await assert.rejects(() => G.grantBundle(cl, { user_id: 'u_saja', bundle: 'opp_read', level: 'sector', sector_id: 'SOL' }), /لا تملك رؤية|خارج من تديرهم/);
  await assert.rejects(() => G.grantBundle(cl, { user_id: 'u_cons_emp', bundle: 'opp_read', level: 'sector', sector_id: 'SOL' }), /لا تملك رؤية/);
  const r = await G.grantBundle(cl, { user_id: 'u_cons_emp', bundle: 'opp_read', level: 'sector', sector_id: 'CONS' });
  assert.equal(r.created, 1);
  assert.deepEqual(await idsFor('u_cons_emp'), ['O_CONS']);
});

test('«إدارة الفعاليات» تُمنَح على الشركة وحدها: مدير النظام يفتحها، ولا تُكتب على إدارة، ومدير الإدارة لا يملكها', async () => {
  const admin = await ctxOf('u_admin');
  await assert.rejects(() => G.grantBundle(admin, { user_id: 'u_hadi', bundle: 'events', level: 'department', department_id: 'D_INNOV' }), /تُمنَح على الشركة كلها/);
  const r = await G.grantBundle(admin, { user_id: 'u_hadi', bundle: 'events', level: 'company' });
  assert.equal(r.created, 2); assert.equal(r.target_name, 'الشركة كلها');
  const hadi = await sess('u_hadi');
  assert.equal(rbac.can(hadi, 'create', 'event'), true, 'حزمة الفعاليات لم تفتح الإنشاء');
  assert.equal(rbac.can(hadi, 'delete', 'event'), false, 'فتحت ما ليس فيها');
  const dm = await ctxOf('u_dm');
  await assert.rejects(() => G.grantBundle(dm, { user_id: 'u_saja', bundle: 'events', level: 'company' }), /لا تملك رؤية/);
});

test('ولا يمنح أحدٌ نفسه — ولا مدير النظام', async () => {
  const lead = await ctxOf('u_lead'); const admin = await ctxOf('u_admin');
  await assert.rejects(() => G.grantBundle(lead, { user_id: 'u_lead', bundle: 'opp_read', level: 'sector', sector_id: 'SOL' }), /لا يمنح أحدٌ نفسه/);
  await assert.rejects(() => G.grantBundle(admin, { user_id: 'u_admin', bundle: 'events', level: 'company' }), /لا يمنح أحدٌ نفسه/);
});

// ── ③ المدة ─────────────────────────────────────────────────────────────────
test('المدة: آخر يوم يسري، وما بعده يسقط من الطلب التالي — والماضي والصيغة الخاطئة يُردّان قبل الحفظ', async () => {
  const lead = await ctxOf('u_lead');
  await assert.rejects(() => G.grantBundle(lead, { user_id: 'u_hadi', bundle: 'opp_read', level: 'sector', sector_id: 'SOL', expires_on: dayShift(-1) }), /مضى/);
  await assert.rejects(() => G.grantBundle(lead, { user_id: 'u_hadi', bundle: 'opp_read', level: 'sector', sector_id: 'SOL', expires_on: '31/12/2026' }), /سنة-شهر-يوم/);
  const r = await G.grantBundle(lead, { user_id: 'u_hadi', bundle: 'opp_read', level: 'sector', sector_id: 'SOL', expires_on: dayShift(0) });
  assert.equal(r.created, 1); assert.equal(r.expires_at, dayShift(0));
  // (الفرصة التي سجّلتها سجى في الذكاء تدخل القطاع أيضاً — تُستبعد ليبقى العدّ على العيّنة الثابتة)
  const fixed = async () => (await idsFor('u_hadi')).filter((id) => !id.startsWith('opp_'));
  assert.deepEqual(await fixed(), ['O_AI1', 'O_IN1', 'O_ORPHAN'], 'الصلاحية في يومها الأخير لا تسري');
  // ينقضي يومها: الصفّ يبقى أثراً، والأثر يسقط بلا مهمة ليلية
  await db.run('UPDATE user_department_grant SET expires_at = ? WHERE bundle_id = ?', [dayShift(-1), r.bundle_id]);
  assert.deepEqual(await fixed(), ['O_IN1'], 'صلاحيةٌ انتهت ما زالت تفتح');
  const groups = await G.listUserGrantGroups(await sess('u_admin'), 'u_hadi');
  const gone = groups.find((g) => g.bundle_id === r.bundle_id);
  assert.ok(gone && gone.expired === true, 'المنتهية لا تُعرض منتهيةً في الكشف');
  assert.ok(!(await sess('u_hadi')).departmentGrants.some((g) => g.level === 'sector' && g.resource === 'opportunity'), 'المنتهية تُحمَّل مع الطلب');
});

// ── ④ الرفع ─────────────────────────────────────────────────────────────────
test('الرفع يرفع الحزمة كلها بحدّ المنح نفسه — والأثر مكتوب منحاً ورفعاً', async () => {
  const dm = await ctxOf('u_dm'); const lead = await ctxOf('u_lead');
  await assert.rejects(() => G.revokeBundle(dm, sajaBundle), /لا تملك رؤية/, 'مدير الإدارة رفع حزمةً على القطاع');
  const r = await G.revokeBundle(lead, sajaBundle);
  assert.equal(r.revoked, 3); assert.equal(r.label, 'تطوير الأعمال');
  // تعود إلى ما تملكه وحده: الفرصة التي سجّلتها هي (مالكتها) لا غير
  const afterIds = await idsFor('u_saja');
  assert.ok(afterIds.length === 1 && afterIds[0].startsWith('opp_'), 'الرفع لم يُعد سجى إلى ما تملكه وحده');
  await assert.rejects(() => G.revokeBundle(lead, sajaBundle), /رُفعت مسبقاً/);
  const trail = await db.all("SELECT action FROM audit_log WHERE resource = 'user_grant' ORDER BY at");
  assert.ok(trail.some((x) => x.action === 'create') && trail.some((x) => x.action === 'delete'), 'المنح أو الرفع بلا أثر');
  // وتُعاد لبقية الفحوص
  sajaBundle = (await G.grantBundle(await ctxOf('u_lead'), { user_id: 'u_saja', bundle: 'bd', level: 'sector', sector_id: 'SOL' })).bundle_id;
});

// ── ⑥ القدرات بأي مجموعة (v5.97) ──────────────────────────────────────────────
// «احسب كل الخيارات الموجودة الممكنة وخلّه اختياراً متعدداً — اطّلاع وتعديل وإضافة، أو اطّلاع…».
test('القدرات تُمنَح بأي مجموعة: اطّلاع وتعديل بلا إضافة — والاسم يُشتقّ منها، والخلط بين مستويين يُردّ قبل الكتابة', async () => {
  const lead = await ctxOf('u_lead');
  const r = await G.grantSelection(lead, { user_id: 'u_hadi', pairs: ['opportunity:read', 'opportunity:update'], level: 'department', department_id: 'D_AI', note: 'اطّلاع وتعديل فقط' });
  assert.equal(r.created, 2); assert.equal(r.bundle, 'custom'); assert.equal(r.label, 'الفرص: اطّلاع · تعديل');
  const hadi = await ctxOf('u_hadi');
  const upd = await opps.updateOpportunity(hadi, 'O_AI1', { next_action: 'من هادي' });
  assert.equal(upd.next_action, 'من هادي', 'التعديل الممنوح مردود');
  await assert.rejects(() => opps.createOpportunity(hadi, { title_ar: 'لا إضافة', client_id: 'CL', sector_id: 'SOL', department_id: 'D_AI' }),
    /ممنوحةٌ لك على إدارتك|خارج نطاق قطاعك|صلاحيتك/, 'أضاف فرصةً في الذكاء وهو ممنوحٌ الاطّلاع والتعديل فقط');
  const g = (await G.listUserGrantGroups(await sess('u_admin'), 'u_hadi')).find((x) => x.bundle_id === r.bundle_id);
  assert.equal(g.label, 'الفرص: اطّلاع · تعديل'); assert.equal(g.custom, true); assert.equal(g.pairs.length, 2);
  // مجموعةٌ تطابق حزمةً جاهزة تحمل اسمها ومفتاحها
  const r2 = await G.grantSelection(lead, { user_id: 'u_hadi', pairs: ['project:read', 'project:create', 'project:update'], level: 'sector', sector_id: 'SOL' });
  assert.equal(r2.bundle, 'pm'); assert.equal(r2.label, 'إدارة المشاريع');
  // الفعاليات على الشركة وحدها: خلطُها بالفرص على إدارةٍ يُردّ بتسمية الزوج — ولا يُكتب نصفُ المجموعة
  const before = Number((await db.get('SELECT COUNT(*) n FROM user_department_grant WHERE user_id = ? AND deleted_at IS NULL', ['u_hadi'])).n);
  const admin = await ctxOf('u_admin');
  await assert.rejects(() => G.grantSelection(admin, { user_id: 'u_hadi', pairs: ['opportunity:read', 'event:create'], level: 'department', department_id: 'D_INNOV' }), /الفعاليات: إنشاء.*تُمنَح على الشركة كلها/);
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM user_department_grant WHERE user_id = ? AND deleted_at IS NULL', ['u_hadi'])).n), before, 'كُتب نصفُ المجموعة');
  await assert.rejects(() => G.grantSelection(lead, { user_id: 'u_hadi', pairs: ['opportunity:fly'], level: 'sector', sector_id: 'SOL' }), /ليست من القائمة/);
  await assert.rejects(() => G.grantSelection(lead, { user_id: 'u_hadi', pairs: [], level: 'sector', sector_id: 'SOL' }), /اختر قدرةً|حزمةً/);
  // خيارات القدرات لمدير الإدارة: الفرص والمشاريع على إدارته، ولا فعاليات — والحِزم الجاهزة ما يملك أزواجها كلها
  const po = await G.grantablePairOptions((await ctxOf('u_dm')).user);
  assert.deepEqual(po.pairs.map((c) => c.key).sort(), ['opportunity:create', 'opportunity:read', 'opportunity:update', 'project:read', 'project:update']);
  assert.ok(po.pairs.every((c) => c.targets.length === 1 && c.targets[0].id === 'D_INNOV'), 'هدفٌ لا يبلغه مدير الإدارة في خياراته');
  assert.deepEqual(po.presets.map((b) => b.key).sort(), ['bd', 'opp_read', 'project_read']);
});

// ── ⑤ البطاقة ────────────────────────────────────────────────────────────────
test('بطاقة «صلاحياته» تعرض ما يُقبل: المنح لمن يملكه، وتغيير الدور لمدير النظام، ولا منحَ للنفس', async () => {
  const forLead = await P.personPage(await sess('u_lead'), 'u_saja');
  for (const s of ['صلاحياته', 'امنحها', 'تطوير الأعمال', 'قطاع الحلول كله', 'ارفعها', 'قطاع كامل']) assert.ok(forLead.includes(s), `قائد القطاع لا يجد «${s}»`);
  assert.ok(!forLead.includes('غيّر الدور'), 'قائد القطاع يُعرض له تغيير الدور');
  // الاختيار المتعدد (v5.97): خانةٌ لكل قدرة يملكها، وأزرار الحِزم الجاهزة
  for (const s of ['pp-cap-box', 'value="opportunity:read"', 'value="project:update"', 'value="event:create"', 'data-action="pp-preset"', 'الفعاليات:']) assert.ok(forLead.includes(s), `قائد القطاع لا يجد «${s}»`);
  const forDm0 = await P.personPage(await sess('u_dm'), 'u_saja');
  assert.ok(forDm0.includes('value="opportunity:create"') && !forDm0.includes('value="project:create"') && !forDm0.includes('value="event:create"'), 'مدير الإدارة يُعرض له ما لا يملكه أو يُحجب ما يملكه');
  const forAdmin = await P.personPage(await sess('u_admin'), 'u_saja');
  assert.ok(forAdmin.includes('غيّر الدور') && forAdmin.includes('احفظ الدور') && forAdmin.includes('id="pp-role-form"'), 'مدير النظام بلا نموذج الدور');
  const forDm = await P.personPage(await sess('u_dm'), 'u_saja');
  assert.ok(forDm.includes('امنحها'), 'مدير الإدارة لا يمنح من البطاقة');
  assert.ok(!forDm.includes('ارفعها'), 'مدير الإدارة يُعرض له رفعُ حزمةٍ على القطاع');
  const own = await P.personPage(await sess('u_saja'), 'u_saja');
  assert.ok(own.includes('صلاحياتك') && own.includes('تطوير الأعمال'), 'صاحب الحساب لا يرى صلاحياته');
  assert.ok(!own.includes('امنحها') && !own.includes('ارفعها') && !own.includes('غيّر الدور'), 'صاحب الحساب يمنح أو يرفع أو يغيّر دوره من صفحته');
});
