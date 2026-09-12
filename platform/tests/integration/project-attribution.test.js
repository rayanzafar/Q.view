// ── الاستدراك الرجعي لإدارات المشاريع ────────────────────────────────────────
// «عشان نهاية السنة نعرف كل إدارة كم دخّلت» — والمشاريع المستوردة وُلدت كلها «بلا إدارة»، فما دامت
// كذلك تبقى قائمةُ مدير الإدارة راجعةً إلى القطاع كله (النصف المؤجَّل من D15). فتُنسَب أولاً ثم يُقصّ
// الوصول. والنسبة تُشتقّ على درجتين، ولكلٍّ شرطُ قطاعٍ لا يُتنازل عنه:
//   • الفرصة المصدر (`source_opp_id`) تسبق: إدارتُها إدارةُ مشروعها إن كانتا في قطاعٍ واحد.
//   • وإلا المالك: المسؤول ⟵ حسابه ⟵ موظفه ⟵ إدارته، إن كانت من قطاع المشروع نفسه.
//   • وما لا يُحسم يُترك «بلا إدارة» (يتيماً يظهر في قطاعه) — لا يخمّن، ولا إدارةَ من قطاعٍ آخر
//     تُكتب فتكسر الجمع من طرفيه (تُحسب في إدارةٍ لا تعمل عليه وتغيب عن إدارات قطاعه).
// ثم الطابع في `schema_migration`: مرةً واحدة، وإلا أُعيدت كتابة ما صحّحه المالك بيده.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-prjattrib-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, backfill;
const T = '2026-03-01T00:00:00Z';
const dept = async (id) => (await db.get('SELECT department_id FROM project WHERE id = ?', [id])).department_id;

before(async () => {
  db = await import('../../src/core/db/index.js');
  backfill = await import('../../scripts/backfill-project-departments.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'INN', name_ar: 'قطاع الابتكار', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SOL', name_ar: 'إدارة الحلول الرقمية', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_SOL2', name_ar: 'إدارة المدن الذكية', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D_INN', name_ar: 'إدارة الابتكار', sector_id: 'INN', active: 1, created_at: T });
  await db.insert('department', { id: 'D_DEAD', name_ar: 'إدارة ملغاة', sector_id: 'SOL', active: 0, created_at: T, deleted_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });

  // أصحاب المشاريع القديمة: مالكٌ له موظفٌ بإدارة من قطاعه، ومالكٌ إدارتُه من قطاعٍ آخر،
  // ومالكٌ بلا موظفٍ أصلاً.
  await db.insert('employee', { id: 'e_own', name_ar: 'مالك المشروع', department_id: 'D_SOL', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_own2', name_ar: 'مالك آخر', department_id: 'D_SOL2', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_mis', name_ar: 'موظف من قطاع آخر', department_id: 'D_INN', sector_id: 'INN', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_own', username: 'own', role_id: 'employee', scope: 'own', employee_id: 'e_own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_own2', username: 'own2', role_id: 'employee', scope: 'own', employee_id: 'e_own2', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mis', username: 'mis', role_id: 'employee', scope: 'own', employee_id: 'e_mis', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_noemp', username: 'noemp', role_id: 'employee', scope: 'own', active: 1, created_at: T });

  // فرصٌ مصدرٌ للمرايا: واحدةٌ بإدارةٍ من قطاع مشروعها، وواحدةٌ بإدارةٍ من قطاعٍ آخر، وواحدةٌ بلا إدارة.
  const mkOpp = (id, extra) => db.insert('opportunity', {
    id, title_ar: 'فرصة ' + id, sector_id: 'SOL', stage_id: 'LEAD', value_halalas: 100000, year: 2026, created_at: T, ...extra });
  await mkOpp('OPP_SOL', { department_id: 'D_SOL' });        // إدارتها من قطاع مشروعها → تُورَّث
  await mkOpp('OPP_INN', { department_id: 'D_INN', sector_id: 'INN' }); // إدارتها من قطاعٍ آخر → لا تُورَّث
  await mkOpp('OPP_NONE', {});                                // بلا إدارة → لا شيء يُشتقّ منها
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الاستدراك: عبر الفرصة المصدر، ثم المالك، ويُترك ما لا يُحسم — ولا يخمّن عبر القطاعات', async () => {
  const mk = (id, extra) => db.insert('project', {
    id, name_ar: 'مشروع ' + id, sector_id: 'SOL', status: 'IN_PROGRESS', rag: 'GREEN', created_at: T, ...extra });
  await mk('P_VIAOPP', { source_opp_id: 'OPP_SOL' });                       // ⟵ إدارة فرصته من قطاعه
  await mk('P_OPPWINS', { source_opp_id: 'OPP_SOL', owner_user_id: 'u_own2' }); // الفرصة تسبق المالك
  await mk('P_VIAOWNER', { owner_user_id: 'u_own' });                       // بلا فرصة ⟵ إدارة مالكه
  await mk('P_OPPX', { source_opp_id: 'OPP_INN' });                         // فرصةٌ من قطاعٍ آخر ⟵ يُترك
  await mk('P_OWNERX', { owner_user_id: 'u_mis' });                         // مالكٌ من قطاعٍ آخر ⟵ يُترك
  await mk('P_OPPNONE', { source_opp_id: 'OPP_NONE', owner_user_id: 'u_noemp' }); // لا فرصةَ إدارةٍ ولا موظفَ مالك ⟵ يُترك
  await mk('P_NONE', {});                                                   // لا صاحبَ يُحسم ⟵ يُترك
  await mk('P_SET', { owner_user_id: 'u_own', department_id: 'D_SOL2' });    // له إدارة — لا يُمَسّ

  const r = await backfill.backfillProjectDepartments({});
  assert.equal(r.skipped, false);
  assert.ok(r.viaOpp.some((x) => x.project === 'مشروع P_VIAOPP' && x.department === 'إدارة الحلول الرقمية'), 'لم يُنسب عبر الفرصة المصدر');
  assert.ok(r.viaOpp.some((x) => x.project === 'مشروع P_OPPWINS'), 'الفرصة المصدر لم تسبق المالك');
  assert.ok(r.viaOwner.some((x) => x.project === 'مشروع P_VIAOWNER' && x.department === 'إدارة الحلول الرقمية'), 'لم يُنسب عبر المالك');
  assert.ok(r.left.some((x) => x.project === 'مشروع P_OPPX'), 'فرصةٌ من قطاعٍ آخر وُرِّثت — كُسر الجمع');
  assert.ok(r.left.some((x) => x.project === 'مشروع P_OWNERX'), 'مالكٌ من قطاعٍ آخر وُرِّث');

  assert.equal(await dept('P_VIAOPP'), 'D_SOL');
  assert.equal(await dept('P_OPPWINS'), 'D_SOL', 'الفرصة تسبق: صار من إدارة مالكه لا فرصته');
  assert.equal(await dept('P_VIAOWNER'), 'D_SOL');
  assert.equal(await dept('P_OPPX'), null, 'وُرِّثت إدارةٌ من قطاعٍ آخر عبر الفرصة');
  assert.equal(await dept('P_OWNERX'), null, 'وُرِّثت إدارةٌ من قطاعٍ آخر عبر المالك');
  assert.equal(await dept('P_OPPNONE'), null);
  assert.equal(await dept('P_NONE'), null);
  assert.equal(await dept('P_SET'), 'D_SOL2', 'مُسّ مشروعٌ له إدارته');

  // كلُّ كتابةٍ مُدقَّقة — يُقرأ فاعلُها في «آخر التحديثات» على صفحة المشروع.
  const a = await db.get(`SELECT COUNT(*) n FROM audit_log WHERE resource = 'project' AND action = 'update' AND resource_id = ?`, ['P_VIAOPP']);
  assert.ok(Number(a.n) >= 1, 'التسكين الرجعي لم يُدقَّق');
});

test('والاستدراك لا يُعاد بلا إلزام — طابعه في سجلّ «ما جرى مرةً واحدة»', async () => {
  await db.insert('project', { id: 'P_LATE', name_ar: 'مشروع P_LATE', sector_id: 'SOL',
    status: 'IN_PROGRESS', rag: 'GREEN', owner_user_id: 'u_own', created_at: T });
  const again = await backfill.backfillProjectDepartments({});
  assert.equal(again.skipped, true, 'أُعيد التشغيل فأُعيدت كتابة ما قد يكون المالك صحّحه بيده');
  assert.equal(await dept('P_LATE'), null, 'كُتب صفٌّ رغم الطابع');
});

test('و‏«أعد رغم الطابع» يعالج ما استجدّ — للتشغيل اليدوي المقصود وحده', async () => {
  const r = await backfill.backfillProjectDepartments({ force: true });
  assert.equal(r.skipped, false);
  assert.equal(await dept('P_LATE'), 'D_SOL');
});
