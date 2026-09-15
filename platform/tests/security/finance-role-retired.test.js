// دورٌ مُلغى لا يعود إلا بقرار — لا بسهو.
//
// قرار مالك: «الإدارة المالية ما لها علاقة من المنصة، احذفهم» — الإدارة المالية على مستوى
// **الشركة**، لا مالية المشروع (تلك تبقى لمدير المشروع ومن فوقه، ويحرسها ملفٌ آخر).
//
// وما يحرسه هذا الملف ليس الحذف نفسه — الحذف سطرٌ في `matrix.js` يراه أي قارئ — بل ثلاث فجوات
// تُعيد العطل بلا أن يقرّره أحد:
//   ١) **البذرة تُنشئ ما في الخريطة**: `seed-rbac.js` تُدرج كل مفتاح غائب عن جدول الأدوار. فإعادة
//      `finance` إلى `ROLE_GRANTS` — ولو مؤقتاً في تجربة — تُعيد الدور بمنحه إلى قاعدة الإنتاج
//      عند أول تشغيل. فالفحص يقرأ **القاعدة بعد البذرة** لا الخريطة وحدها.
//   ٢) **الثقب**: الدور كان يحمل وحده — مع المصفوفة الشاملة عند مدير النظام — تسجيلَ التحصيل
//      واعتمادَ المصروف والفاتورة. وحذفُه بلا نقلِ سلطته يُنتج منصةً لا يسجّل فيها أحدٌ ريالاً
//      وصل إلا مدير النظام، وهو وظيفة تقنية لا وظيفة عمل. فالفحص يثبّت الوارث بالاسم.
//   ٣) **خطوةٌ تنتظر عدماً**: مسار الاعتماد كان يوجّه خطوته الثانية إلى `approver_role='finance'`.
//      فبلا نقلها يسكن الطلب في «معلَّق» بلا معتمِدٍ ولا رسالة — صمتٌ في مسارٍ يُظنّ أنه يسير.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-finrole-'));
process.env.SANAD_DB = join(dir, 'f.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}
const db = await import('../../src/core/db/index.js');
const { initRbac, can } = await import('../../src/core/rbac/index.js');
const { ROLE_GRANTS, ROLE_LABELS } = await import('../../src/core/rbac/matrix.js');
const { PAGE_ACCESS } = await import('../../src/core/policy/pages.js');

const PRJ = { id: 'P1', project_id: 'P1', sector_id: 'S1' };
const U = (role, scope, sector = 'S1') => ({ id: 'u_' + role, role_id: role, sector_id: sector, scope,
  projectIds: new Set(['P1']), teamIds: new Set() });

before(async () => { await initRbac(); });

test('لا دورَ «مالية» في الخريطة ولا في وسمها', () => {
  assert.equal('finance' in ROLE_GRANTS, false, 'إعادته إلى الخريطة تُعيده إلى القاعدة عند أول بذرة');
  assert.equal('finance' in ROLE_LABELS, false, 'ووسمٌ بلا دور يظهر مسمّىً لا يحمله أحد');
});

test('ولا في قاعدة البيانات بعد الترحيلة والبذرة — ولا منحٌ واحد باقٍ', async () => {
  assert.equal(await db.get('SELECT id FROM role WHERE id = ?', ['finance']), undefined);
  const grants = await db.all('SELECT * FROM role_permission WHERE role_id = ?', ['finance']);
  assert.deepEqual(grants, [], 'منحٌ بلا دورٍ يحمله سلطةٌ سارية لا يراها أحد');
});

test('ولا حسابَ يحمله — والترحيلة تنقل من كان يحمله إلى «مشاهدة فقط»', async () => {
  const holders = await db.all('SELECT username FROM app_user WHERE role_id = ?', ['finance']);
  assert.deepEqual(holders, [], 'المفتاح الأجنبي يرفض الحذف قبل النقل، والفحص يثبّت أن النقل وقع');
});

test('من يحمل الدور المُلغى لا يفتح شيئاً بحكمه', () => {
  // حساب يحمل الاسم رغم زواله (طلبُ دخولٍ قديم، أو صفٌّ استُعيد من نسخة احتياطية) — فحصُه
  // يجب أن يسقط في كل موضع لا أن يمرّ بالافتراض.
  const ghost = U('finance', 'company', null);
  for (const [action, res] of [['read', 'invoice'], ['create', 'collection'], ['approve', 'expense'],
    ['read', 'contract'], ['read', 'margin'], ['read', 'cost'], ['read', 'project']]) {
    assert.equal(can(ghost, action, res, PRJ), false, `${action} ${res}`);
  }
  assert.equal(PAGE_ACCESS.finance(ghost), false, 'ولا شاشة مالية الشركة');
  assert.equal(PAGE_ACCESS.approvals(ghost), false, 'ولا شاشة الاعتمادات');
});

// ── والوارث بالاسم: حذفٌ بلا وارثٍ يُوقف المال، لا يُنظّفه ────────────────────
test('مالية الشركة صعدت إلى مكتب الرئيس التنفيذي — يفوتر ويحصّل ويعتمد', () => {
  const ceo = U('ceo_office', 'company', null);
  for (const [action, res] of [['create', 'invoice'], ['update', 'invoice'], ['approve', 'invoice'],
    ['create', 'collection'], ['create', 'contract'], ['update', 'contract'],
    ['approve', 'expense'], ['read', 'expense'], ['create', 'revenue_line']]) {
    assert.equal(can(ceo, action, res, PRJ), true, `${action} ${res}`);
  }
  // الشاشة نفسها أُلغيت لاحقاً بقرار المالك («موضوع الفواتير والمالية خلاص ألغِه») — والمنح
  // أعلاه باقية عمداً: البيانات لم تُمحَ، والإخفاء قرارُ واجهة يُعاد بسطر. فيُثبَّت الأمران
  // معاً كي لا يُظَنّ أن إلغاء الشاشة ألغى السلطة، ولا أن بقاء السلطة يعيد الشاشة.
  assert.equal(PAGE_ACCESS.finance(ceo), false, 'شاشة المالية مُزالة — ولا تُفتح لأحد');
  assert.equal(PAGE_ACCESS.approvals(ceo), true, 'وشاشة الاعتمادات — إليها تُوجَّه خطوة المالية الآن');
});

test('والتحصيل في القطاع لقائد القطاع — كان محصوراً على الدور المُلغى وحده', () => {
  const lead = U('sector_lead', 'sector');
  assert.equal(can(lead, 'create', 'collection', PRJ), true, 'يفوتر عقود قطاعه، فيسجّل ما حُصِّل منها');
  assert.equal(can(lead, 'update', 'collection', PRJ), true);
});

test('ولم يُنقل التحصيل إلى مدير المشروع — قرار مالك: «التحصيل تبع المالية»', () => {
  assert.equal(can(U('project_manager', 'project'), 'create', 'collection', PRJ), false);
});

test('والراتب يبقى مختوماً — لم يُفتح لوارثٍ ولا لغيره', () => {
  for (const r of ['ceo_office', 'sector_lead', 'project_manager', 'viewer']) {
    assert.equal(can(U(r, 'company', null), 'read', 'salary'), false, r);
  }
});

// ── والترحيلة نفسها، مُشغَّلةً على الحالة التي ستجدها في الإنتاج ─────────────────
// الفحوص أعلاه تقرأ **النتيجة**؛ وهذا يقرأ **الفعل**. نُعيد بناء الحالة السابقة للترحيلة على
// القاعدة نفسها — دورٌ قائم بمنحه، وحسابٌ يحمله، وحسابُ عرضٍ نشط، وخطوةُ اعتمادٍ تشير إليه —
// ثم نمحو الترحيلة من سجلّ التطبيق ونُشغّل `migrate.js` الحقيقي، فنقيس ما فعلته لا ما نويناه.
// وهذه هي الحالة التي تصل إليها بالضبط: قاعدةٌ عاشت شهوراً بالدور قبل أن يُلغى.
test('الترحيلة ٠١٨ مُشغَّلةً على حالةٍ ما قبلها: تنقل الحامل والخطوة، وتختم حساب العرض، وتحذف الدور ومنحه', async () => {
  const { nowIso, id } = await import('../../src/core/util/ids.js');
  const now = nowIso();
  await db.run('INSERT INTO role (id, name_ar, name_en, is_system, created_at) VALUES (?,?,?,1,?)',
    ['finance', 'المالية', 'Finance', now]);
  for (const g of [['invoice', 'create'], ['collection', 'create'], ['expense', 'approve']]) {
    await db.run('INSERT INTO role_permission (role_id, resource, action, scope) VALUES (?,?,?,?)',
      ['finance', g[0], g[1], 'company']);
  }
  await db.insert('app_user', { id: 'u_realfin', username: 'real.finance', name_ar: 'موظف مالية حقيقي',
    role_id: 'finance', scope: 'company', password_hash: 'x', active: 1, created_at: now });
  await db.insert('app_user', { id: 'u_demofin', username: 'demo.finance', name_ar: 'المالية (تجريبي)',
    role_id: 'finance', scope: 'company', password_hash: 'x', active: 1, created_at: now });
  await db.insert('workflow_definition', { id: 'WF_RET', key: 'ret_test', name_ar: 'مسار قديم',
    target_resource: 'expense', active: 1, created_at: now });
  const stepId = id('stp');
  await db.insert('approval_step', { id: stepId, workflow_id: 'WF_RET', step_order: 1,
    approver_role: 'finance', approver_scope: 'sector', min_amount_halalas: 0, name_ar: 'اعتماد المالية' });
  await db.run('DELETE FROM schema_migration WHERE version = ?', ['018_retire_finance_role.sql']);
  await db.close();

  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')],
    { env: process.env, stdio: 'ignore' });

  assert.equal(await db.get('SELECT id FROM role WHERE id = ?', ['finance']), undefined, 'الدور محذوف');
  assert.deepEqual(await db.all('SELECT * FROM role_permission WHERE role_id = ?', ['finance']), [],
    'ومنحُه معه — صراحةً لا اعتماداً على تعاقبٍ ضمني يختلف بين المحرّكَين');
  // الموظف الحقيقي: بابُه مفتوح وسلطتُه ساقطة. لا يُحذف حسابه ولا يُرفَع إلى سلطةٍ لم يقرّرها أحد.
  const real = await db.get('SELECT role_id, active, deactivated_at FROM app_user WHERE id = ?', ['u_realfin']);
  assert.equal(real.role_id, 'viewer');
  assert.equal(Number(real.active), 1, 'إغلاق باب إنسانٍ عن عمله لا يكون أثراً جانبياً لترحيلة');
  assert.equal(real.deactivated_at, null);
  // وحسابُ العرض وحده يُختَم: يمثّل إدارةً لم تعد موجودة.
  const demo = await db.get('SELECT role_id, active, deactivated_at FROM app_user WHERE id = ?', ['u_demofin']);
  assert.equal(demo.role_id, 'viewer');
  assert.equal(Number(demo.active), 0);
  assert.ok(demo.deactivated_at, 'وختمُه صريح لا مُستنتَجٌ من غياب');
  // والخطوة صارت إلى وارثٍ موجود، فلا طلبَ يسكن في «معلَّق» بلا معتمِد.
  const step = await db.get('SELECT approver_role FROM approval_step WHERE id = ?', [stepId]);
  assert.equal(step.approver_role, 'ceo_office');
  const orphans = await db.all(
    'SELECT s.id FROM approval_step s LEFT JOIN role r ON r.id = s.approver_role WHERE s.approver_role IS NOT NULL AND r.id IS NULL');
  assert.deepEqual(orphans, [], 'خطوةٌ بمعتمِدٍ غير موجود تبتلع الطلب صامتةً');
});
