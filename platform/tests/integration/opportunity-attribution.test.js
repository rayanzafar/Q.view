// ── التسكين على باب الإنشاء والاستدراك الرجعي ────────────────────────────────
// «عشان نهاية السنة نعرف كل إدارة كم دخّلت» — وكل فرصةٍ تُولَد «بلا إدارة» ثم تُصنَّف لاحقاً
// تُنسى، فيظهر آخر السنة فرقٌ بين مجموع الإدارات ومجموع القطاع لا سبب له إلا النسيان.
// يُحرس هنا بابان:
//   • باب الإنشاء: الاختيار الصريح يسبق، فإن غاب نُسبت الفرصة إلى إدارة منشئها إن كانت قائمةً
//     ومن قطاع الفرصة نفسه — وإلا تُركت بلا إدارة بصمت لا بخطأ.
//   • حارس القراءة بعد الإنشاء: من كُتب له الصفّ ثم خرج من نطاقه لحظة ولادته يُعاد له تأكيدٌ
//     مختصر لا رسالة «صلاحيتك لا تسمح» على عملٍ تمّ فعلاً.
// ثم الاستدراك الرجعي: ما وُلد قبل الباب الجديد يُنسب من مالكه أو منشئه، ومرآةُ المشروع تُكتب
// من طرفيها معاً وإلا محت المزامنةُ الاستدراكَ عند أول تعديل.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-attrib-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, backfill;
const T = '2026-03-01T00:00:00Z';
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
// مدير تطوير أعمال في قطاع الحلول، منتمٍ إلى إدارةٍ من قطاعه — الحالة السويّة للاشتقاق.
const BD = { id: 'u_bd', username: 'bd', role_id: 'bd_manager', scope: 'sector', sector_id: 'SOL', department_id: 'D_SOL' };
// نفس الدور لكن إدارة انتمائه من قطاعٍ آخر — الاشتقاق يجب أن يمتنع بصمت لا أن يُخطئ.
const BD_X = { id: 'u_bdx', username: 'bdx', role_id: 'bd_manager', scope: 'sector', sector_id: 'SOL', department_id: 'D_INN' };
// وإدارة انتمائه محذوفة — لا تُورَّث إدارةٌ ميتة.
const BD_DEAD = { id: 'u_bdd', username: 'bdd', role_id: 'bd_manager', scope: 'sector', sector_id: 'SOL', department_id: 'D_DEAD' };
// دور اختبار: يُنشئ في قطاعه ولا تبلغ قراءتُه أي صف (نطاق «الفريق» يفشل مغلقاً) — به يُختبر
// حارس القراءة بعد الإنشاء دون افتراضٍ عن أدوار المصفوفة.
const BLIND = { id: 'u_blind', username: 'blind', role_id: 'blind_creator', scope: 'sector', sector_id: 'SOL', teamIds: new Set() };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  opps = await import('../../src/modules/crm/opportunities.js');
  backfill = await import('../../scripts/backfill-opportunity-departments.js');

  await db.insert('role', { id: 'blind_creator', name_ar: 'منشئ محدود القراءة', name_en: 'blind creator', is_system: 0, created_at: T });
  await db.insert('role_permission', { role_id: 'blind_creator', resource: 'opportunity', action: 'create', scope: 'sector' });
  await db.insert('role_permission', { role_id: 'blind_creator', resource: 'opportunity', action: 'read', scope: 'team' });
  await rbac.initRbac();

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'INN', name_ar: 'قطاع الابتكار', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SOL', name_ar: 'إدارة الحلول الرقمية', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SOL2', name_ar: 'إدارة المدن الذكية', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INN', name_ar: 'إدارة الابتكار', sector_id: 'INN', active: 1, created_at: T });
  await db.insert('department', { id: 'D_DEAD', name_ar: 'إدارة ملغاة', sector_id: 'SOL', active: 0, created_at: T, deleted_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });

  for (const u of [ADMIN, BD, BD_X, BD_DEAD, BLIND]) {
    await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, scope: u.scope, sector_id: u.sector_id, active: 1, created_at: T });
  }
  // أصحاب الفرص القديمة (للاستدراك): مالكٌ له موظفٌ بإدارة من قطاعه، ومنشئٌ كذلك، ومالكٌ إدارتُه
  // من قطاعٍ آخر، ومالكٌ بلا موظف أصلاً.
  await db.insert('employee', { id: 'e_own', name_ar: 'مالك الفرصة', department_id: 'D_SOL', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_cr', name_ar: 'منشئ الفرصة', department_id: 'D_SOL2', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_mis', name_ar: 'موظف من قطاع آخر', department_id: 'D_INN', sector_id: 'INN', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_own', username: 'own', role_id: 'employee', scope: 'own', employee_id: 'e_own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_cr', username: 'cr', role_id: 'employee', scope: 'own', employee_id: 'e_cr', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mis', username: 'mis', role_id: 'employee', scope: 'own', employee_id: 'e_mis', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_noemp', username: 'noemp', role_id: 'employee', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_other', username: 'other', role_id: 'employee', scope: 'own', active: 1, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── باب الإنشاء ──────────────────────────────────────────────────────────────
test('الاختيار الصريح للإدارة يسبق إدارة المنشئ', async () => {
  const o = await opps.createOpportunity({ user: BD, ip: '1' },
    { title_ar: 'فرصة باختيار صريح', sector_id: 'SOL', department_id: 'D_SOL2' });
  assert.equal(o.department_id, 'D_SOL2', 'إدارة المنشئ طغت على اختياره الصريح');
});

test('بلا اختيار: تُنسب الفرصة إلى إدارة منشئها إن كانت من قطاعها', async () => {
  const o = await opps.createOpportunity({ user: BD, ip: '1' },
    { title_ar: 'فرصة بلا اختيار', sector_id: 'SOL' });
  assert.equal(o.department_id, 'D_SOL', 'لم تُشتقّ إدارة المنشئ — وُلدت الفرصة «بلا إدارة» كما قبل الإصلاح');
  const row = await db.get('SELECT department_id FROM opportunity WHERE id = ?', [o.id]);
  assert.equal(row.department_id, 'D_SOL', 'المُعاد غير المكتوب');
});

test('منشئٌ إدارتُه من قطاعٍ آخر: تُترك بلا إدارة بصمت — لا خطأ يوقف الإنشاء', async () => {
  const o = await opps.createOpportunity({ user: BD_X, ip: '1' },
    { title_ar: 'فرصة منشئها من قطاع آخر', sector_id: 'SOL' });
  assert.equal(o.department_id, null, 'وُرّثت إدارةٌ من غير قطاع الفرصة — تكسر الجمع من طرفيه');
});

test('وإدارةُ منشئٍ محذوفة لا تُورَّث', async () => {
  const o = await opps.createOpportunity({ user: BD_DEAD, ip: '1' },
    { title_ar: 'فرصة منشئها من إدارة ملغاة', sector_id: 'SOL' });
  assert.equal(o.department_id, null, 'نُسبت الفرصة إلى إدارةٍ محذوفة');
});

test('والاختيار الصريح من قطاعٍ آخر يبقى مردوداً — الاشتقاق لم يُرخِ الحارس القائم', async () => {
  await assert.rejects(() => opps.createOpportunity({ user: BD, ip: '1' },
    { title_ar: 'فرصة بإدارة غريبة', sector_id: 'SOL', department_id: 'D_INN' }), /قطاعاً آخر/);
});

// ── حارس القراءة بعد الإنشاء ─────────────────────────────────────────────────
test('من لا تبلغ قراءتُه الصفّ المكتوب يعود له تأكيدٌ مختصر — لا «صلاحيتك لا تسمح» على عملٍ تمّ', async () => {
  const res = await opps.createOpportunity({ user: BLIND, ip: '1' },
    { title_ar: 'فرصة تُكتب لغير منشئها', sector_id: 'SOL', owner_user_id: 'u_other' });
  assert.equal(res.ok, true, 'رُدّ الإنشاء وقد تمّ فعلاً');
  assert.equal(res.movedOutOfReach, true, 'لا إشارة إلى أن الصفّ خرج من نطاق منشئه');
  assert.ok(res.id, 'التأكيد بلا معرّفٍ يُفتح به الصف');
  const row = await db.get('SELECT owner_user_id, created_by FROM opportunity WHERE id = ?', [res.id]);
  assert.equal(row.owner_user_id, 'u_other', 'المسؤول المطلوب لم يُكتب');
  assert.equal(row.created_by, 'u_blind', 'المنشئ لم يُسجَّل');
});

// ── الاستدراك الرجعي ─────────────────────────────────────────────────────────
test('الاستدراك: عبر المالك، ثم المنشئ، ويُترك ما لا يُحسم — والمرآة تُكتب من طرفيها', async () => {
  const mk = (id, extra) => db.insert('opportunity', {
    id, title_ar: 'قديمة ' + id, sector_id: 'SOL', stage_id: 'LEAD',
    value_halalas: 100000, year: 2026, created_at: T, ...extra,
  });
  await mk('O_OWN', { owner_user_id: 'u_own' });                          // مالكه يُحسم
  await mk('O_CR', { owner_user_id: 'u_noemp', created_by: 'u_cr' });     // المالك بلا موظف ⟵ المنشئ
  await mk('O_MIS', { owner_user_id: 'u_mis' });                          // إدارة مالكه من قطاعٍ آخر ⟵ تُترك
  await mk('O_MIR', { owner_user_id: 'u_own', source: 'project' });       // مرآة مشروع
  await mk('O_SET', { owner_user_id: 'u_own', department_id: 'D_SOL2' }); // له إدارة — لا يُمَسّ
  await db.insert('project', { id: 'P_MIR', name_ar: 'مشروع المرآة', sector_id: 'SOL',
    source_opp_id: 'O_MIR', status: 'IN_PROGRESS', created_at: T });

  const r = await backfill.backfillOpportunityDepartments({});
  assert.equal(r.skipped, false);
  assert.ok(r.viaOwner.some((x) => x.opportunity === 'قديمة O_OWN' && x.department === 'إدارة الحلول الرقمية'), 'لم يُنسب عبر المالك');
  assert.ok(r.viaCreator.some((x) => x.opportunity === 'قديمة O_CR' && x.department === 'إدارة المدن الذكية'), 'لم يُنسب عبر المنشئ');
  assert.ok(r.left.some((x) => x.opportunity === 'قديمة O_MIS'), 'إدارةٌ من قطاعٍ آخر لم تُترك — كُتب ما يكسر الجمع');

  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_OWN'])).department_id, 'D_SOL');
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_CR'])).department_id, 'D_SOL2');
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_MIS'])).department_id, null);
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_SET'])).department_id, 'D_SOL2', 'مُسّت فرصةٌ لها إدارتها');

  // المرآة: الطرفان معاً — وإلا محت المزامنة الاستدراكَ عند أول تعديلٍ على المشروع.
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_MIR'])).department_id, 'D_SOL');
  assert.equal((await db.get('SELECT department_id FROM project WHERE id = ?', ['P_MIR'])).department_id, 'D_SOL',
    'كُتبت الفرصة وحدها — المشروع المرآة بقي بلا إدارة فتمحوها المزامنة');
  assert.equal(r.mirrored.length, 1, 'عدد أزواج المرآة المكتوبة ليس واحداً');
});

test('والاستدراك لا يُعاد بلا إلزام — طابعه في سجلّ «ما جرى مرةً واحدة»', async () => {
  await db.insert('opportunity', { id: 'O_LATE', title_ar: 'قديمة O_LATE', sector_id: 'SOL',
    stage_id: 'LEAD', owner_user_id: 'u_own', year: 2026, created_at: T });
  const again = await backfill.backfillOpportunityDepartments({});
  assert.equal(again.skipped, true, 'أُعيد التشغيل فأُعيدت كتابة ما قد يكون المالك صحّحه بيده');
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_LATE'])).department_id, null,
    'كُتب صفٌّ رغم الطابع');
});

test('و‏«أعد رغم الطابع» يعالج ما استجدّ — للتشغيل اليدوي المقصود وحده', async () => {
  const r = await backfill.backfillOpportunityDepartments({ force: true });
  assert.equal(r.skipped, false);
  assert.equal((await db.get('SELECT department_id FROM opportunity WHERE id = ?', ['O_LATE'])).department_id, 'D_SOL');
});
