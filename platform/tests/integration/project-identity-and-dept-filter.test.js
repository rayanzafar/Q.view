// «كل شي متعلق بالمشروع يقدر يتحكم فيه من الواجهة عشان نستعمل المنصة بلا تدخّل من خلف الشاشة»
// و«ممكن أفلتر بالإدارات اللي تحت قطاع الحلول… عشان نهاية السنة نعرف كل إدارة كم دخّلت».
//
// ثلاثة حقول على المشروع كانت تُكتب مرة عند الإنشاء ثم لا يمسّها شيء في المنتج كله: **مديره**
// و**إدارته** و**جهته**. وأثقلها الأول، لأن العطل فيه ليس حقلاً ناقصاً بل دوراً معطَّلاً: نطاق
// «مشروع» في محرّك الصلاحيات يُشتقّ من `owner_user_id` نفسه، فمديرُ مشروعٍ لم يُسجَّل مالكاً
// لا يملك مشروعه في نظر النظام — ومنحُه الكامل يبقى معلَّقاً بلا مشروعٍ واحد يسري عليه.
//
// ومُرشِّح الإدارة على الفرص: العمود موجود منذ موجة الإسناد ولم يكن يقرؤه أحد، فالإدارة تُنسب
// إليها الأرقام آخر السنة ولا سبيل إلى رؤية فرصها وحدها.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-projid-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let projects, opps, db, rbac;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'a', role_id: 'admin', scope: 'company' };
const ctx = { user: ADMIN, ip: '127.0.0.1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  rbac = await import('../../src/core/rbac/index.js');
  projects = await import('../../src/modules/pmo/projects.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  await rbac.initRbac();

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', active: 1, created_at: T });
  await db.insert('sector', { id: 'CONS', name_ar: 'قطاع الاستشارات', active: 1, created_at: T });
  await db.insert('department', { id: 'd_ai', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي والبيانات', active: 1, created_at: T });
  await db.insert('department', { id: 'd_inv', sector_id: 'SOL', name_ar: 'إدارة الابتكار', active: 1, created_at: T });
  await db.insert('department', { id: 'd_other', sector_id: 'CONS', name_ar: 'إدارة من قطاع آخر', active: 1, created_at: T });
  await db.insert('client', { id: 'c1', name_ar: 'جهة أولى', created_at: T });
  await db.insert('client', { id: 'c2', name_ar: 'جهة ثانية', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'a', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_pm', username: 'pm', name_ar: 'مدير المشروع', role_id: 'project_manager', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_off', username: 'off', role_id: 'project_manager', scope: 'own', active: 0, created_at: T });
  await db.insert('project', { id: 'p1', name_ar: 'مشروع بلا مدير', sector_id: 'SOL', status: 'IN_PROGRESS', created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  const opp = (id, title, sector, dept) => db.insert('opportunity',
    { id, title_ar: title, client_id: 'c1', sector_id: sector, department_id: dept, stage_id: 'PROPOSAL', value_halalas: 100000, created_at: T });
  await opp('o_ai1', 'فرصة الذكاء الأولى', 'SOL', 'd_ai');
  await opp('o_ai2', 'فرصة الذكاء الثانية', 'SOL', 'd_ai');
  await opp('o_inv', 'فرصة الابتكار', 'SOL', 'd_inv');
  await opp('o_bare', 'فرصة بلا إدارة', 'SOL', null);
  await opp('o_cons', 'فرصة الاستشارات', 'CONS', 'd_other');
});

after(() => rmSync(dir, { recursive: true, force: true }));

// الكود المالي: كانت شاشة الإقفال ترفض التصحيح بـ«سجّل كوده المالي في صفحة المشروع» ولا حقل يكتبه.
test('الكود المالي للمشروع يُكتب من مسار التعديل والإنشاء: يُشذَّب ويُتحقق منه ويُنزع بالفراغ، وبأثر', async () => {
  await projects.updateProject(ctx, 'p1', { financial_code: '  SOL-2026-017 ' });
  assert.equal((await db.get('SELECT financial_code FROM project WHERE id = ?', ['p1'])).financial_code, 'SOL-2026-017');
  await assert.rejects(() => projects.updateProject(ctx, 'p1', { financial_code: 'x; drop' }), /حروفاً وأرقاماً/);
  assert.equal((await db.get('SELECT financial_code FROM project WHERE id = ?', ['p1'])).financial_code, 'SOL-2026-017', 'الرفض لا يمسّ القيمة');
  const audits = await db.all("SELECT detail_json FROM audit_log WHERE action='update' AND resource='project' AND resource_id='p1'");
  assert.ok(audits.some((a) => String(a.detail_json || '').includes('financial_code')), 'الكتابة بأثر يذكر الحقل');
  await projects.updateProject(ctx, 'p1', { financial_code: '' });
  assert.equal((await db.get('SELECT financial_code FROM project WHERE id = ?', ['p1'])).financial_code, null);
  const created = await projects.createProject(ctx, { name_ar: 'مشروع بكود مالي', sector_id: 'SOL', financial_code: ' CONS-9 ' });
  assert.equal((await db.get('SELECT financial_code FROM project WHERE id = ?', [created.id])).financial_code, 'CONS-9');
});

// ── مدير المشروع: الحقل الذي يُفعِّل الدور ──
test('تعيين مدير المشروع من الواجهة — وهو ما لم يكن في المنتج طريقٌ إليه', async () => {
  const before = await db.get("SELECT owner_user_id FROM project WHERE id='p1'");
  assert.equal(before.owner_user_id, null, 'المشروع بدأ بلا مالك — وهو حال الفحص');

  await projects.updateProject(ctx, 'p1', { owner_user_id: 'u_pm' });
  const after = await db.get("SELECT owner_user_id FROM project WHERE id='p1'");
  assert.equal(after.owner_user_id, 'u_pm', 'لم يُسجَّل مدير المشروع');

  // وهذا هو الأثر الحقيقي: نطاق «مشروع» يُبنى من هذا العمود، فالمدير صار يملك مشروعه فعلاً.
  const owned = await db.all('SELECT id FROM project WHERE owner_user_id = ?', ['u_pm']);
  assert.deepEqual(owned.map((r) => r.id), ['p1'], 'المشروع لا يظهر ضمن مشاريع مديره');
  const pm = { id: 'u_pm', role_id: 'project_manager', scope: 'own', sector_id: 'SOL', projectIds: new Set(owned.map((r) => r.id)) };
  assert.equal(rbac.can(pm, 'update', 'project', { id: 'p1', sector_id: 'SOL' }), true,
    'منح مدير المشروع بقي معلَّقاً — نطاقه لا يبلغ مشروعه');
});

test('وحسابٌ موقوف يُرَدّ برسالة عربية — لا يُسنَد مشروعٌ إلى باب مغلق', async () => {
  await assert.rejects(() => projects.updateProject(ctx, 'p1', { owner_user_id: 'u_off' }), /موقوف|غير موجود/);
  await assert.rejects(() => projects.updateProject(ctx, 'p1', { owner_user_id: 'u_ghost' }), /غير موجود|موقوف/);
  assert.equal((await db.get("SELECT owner_user_id FROM project WHERE id='p1'")).owner_user_id, 'u_pm', 'تغيّر المالك رغم الرفض');
});

test('ونزع المدير ممكن صراحةً — الفراغ قرارٌ لا سهو', async () => {
  await projects.updateProject(ctx, 'p1', { owner_user_id: '' });
  assert.equal((await db.get("SELECT owner_user_id FROM project WHERE id='p1'")).owner_user_id, null);
  await projects.updateProject(ctx, 'p1', { owner_user_id: 'u_pm' });      // إعادةٌ لبقية الفحوص
});

// ── إدارة المشروع: عليها يقوم توزيع الإيراد آخر السنة ──
test('إسناد المشروع إلى إدارة — والإدارة من قطاعٍ آخر تُردّ', async () => {
  await projects.updateProject(ctx, 'p1', { department_id: 'd_ai' });
  assert.equal((await db.get("SELECT department_id FROM project WHERE id='p1'")).department_id, 'd_ai');

  await assert.rejects(() => projects.updateProject(ctx, 'p1', { department_id: 'd_other' }), /قطاعاً آخر/,
    'قُبلت إدارةٌ من قطاعٍ آخر — فيُحسب المشروع حيث لا يعمل ويغيب عن قطاعه');
  assert.equal((await db.get("SELECT department_id FROM project WHERE id='p1'")).department_id, 'd_ai', 'تغيّرت الإدارة رغم الرفض');

  await assert.rejects(() => projects.updateProject(ctx, 'p1', { department_id: 'd_nope' }), /غير موجودة/);
});

test('وتغيير جهة المشروع — والجهة المجهولة تُردّ', async () => {
  await projects.updateProject(ctx, 'p1', { client_id: 'c2' });
  assert.equal((await db.get("SELECT client_id FROM project WHERE id='p1'")).client_id, 'c2');
  await assert.rejects(() => projects.updateProject(ctx, 'p1', { client_id: 'c_nope' }), /غير موجودة/);
});

test('وكل تغييرٍ منها مسجَّل في التدقيق — لا تعديلَ صامت على هوية مشروع', async () => {
  const rows = await db.all("SELECT detail_json FROM audit_log WHERE action='update' AND resource='project' AND resource_id='p1'");
  const blob = rows.map((r) => String(r.detail_json)).join(' ');
  for (const k of ['owner_user_id', 'department_id', 'client_id']) {
    assert.ok(blob.includes(k), `تغيير «${k}» لم يترك أثراً في التدقيق`);
  }
});

// ── مُرشِّح الإدارات على الفرص ──
test('ترشيح الفرص بإدارةٍ واحدة تحت القطاع', async () => {
  const all = await opps.listOpportunities(ADMIN, { sector: 'SOL' });
  assert.equal(all.length, 4, 'فرص القطاع الأربع');

  const ai = await opps.listOpportunities(ADMIN, { sector: 'SOL', department: 'd_ai' });
  assert.deepEqual(ai.map((o) => o.id).sort(), ['o_ai1', 'o_ai2']);
  const inv = await opps.listOpportunities(ADMIN, { sector: 'SOL', department: 'd_inv' });
  assert.deepEqual(inv.map((o) => o.id), ['o_inv']);
  // ولا تتسرّب فرصة قطاعٍ آخر مهما كانت الإدارة
  assert.ok(!ai.concat(inv).some((o) => o.id === 'o_cons'));
});

// «بلا إدارة» ليست غياب مُرشِّح بل قيمةٌ مقصودة: غير المُسنَد هو ما يحتاج العمل، وإخفاؤه يجعل
// مجموع الإدارات أقلّ من مجموع القطاع بلا تفسير.
test('و«بلا إدارة» مُرشِّحٌ صريح — فغير المُسنَد يُرى ليُسنَد', async () => {
  const bare = await opps.listOpportunities(ADMIN, { sector: 'SOL', department: opps.NO_DEPARTMENT });
  assert.deepEqual(bare.map((o) => o.id), ['o_bare']);
  // والمجموع يقفل: إدارتان + بلا إدارة = كل فرص القطاع، فلا فرصة تختفي بين العدسات
  const byDept = ['d_ai', 'd_inv', opps.NO_DEPARTMENT];
  let n = 0;
  for (const d of byDept) n += (await opps.listOpportunities(ADMIN, { sector: 'SOL', department: d })).length;
  assert.equal(n, 4, 'مجموع الإدارات لا يساوي مجموع القطاع — فرصةٌ خارج كل عدسة');
});
