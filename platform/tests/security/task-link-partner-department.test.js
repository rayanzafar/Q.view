// ربطُ المهمة بجهة الشراكة يمرّ من البابين الواحدين (ADR-0006 للفرصة، ADR-0008 للمشروع) —
// لا من الصفّ العاري. الحالة الحية (2026-08-13): د. أيوب مديرُ إدارةٍ **مشارِكة** في فرصة
// الحشود يفتحها ويعدّلها منذ v5.20، لكنه كان يُرَدّ «هذه الفرصة خارج نطاقك» عند ربط مهمةٍ
// بها — `assertMayLink` كان يحمل الصفّ بعموده وحده فلا يرى المشاركة الساكنة في جدولَي
// `opportunity_department`/`project_department`. والمنتقي يعرف الجهة منذ v5.11، فتُعرَض ثم
// تُرفَض عند الحفظ. هذا الملف يثبّت: المشارِكة تربط (إنشاءً وتعديلاً، فرصةً ومشروعاً)،
// والغريبُ يُرَدّ كما كان، و«غير موجودة» تبقى برسالة المنتقي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-tasklink-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, depts;
const T = new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
let AYOUB, GHAREEB; // مدير الإدارة المشارِكة، ومدير إدارةٍ لا شأن لها بالجهتين
const OPP = 'OPP_HAJJ';
const PRJ = 'PRJ_HAJJ';

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  depts = await import('../../src/core/rbac/departments.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const [uid, name] of [['u_rayan', 'ريان ظفر'], ['u_ayoub', 'د. أيوب الزاكي'], ['u_ghareeb', 'مديرٌ غريب']]) {
    await db.insert('app_user', { id: uid, username: uid, name_ar: name, role_id: 'department_manager',
      scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', manager_user_id: 'u_rayan', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CITY', name_ar: 'إدارة المدن الذكية', sector_id: 'SOL', manager_user_id: 'u_ayoub', active: 1, created_at: T });
  await db.insert('department', { id: 'D_OTHER', name_ar: 'إدارةٌ ثالثة', sector_id: 'SOL', manager_user_id: 'u_ghareeb', active: 1, created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  // المسؤولة D_AI (ريان)، والمشارِكة D_CITY (أيوب) — كالحالة الحية حرفاً.
  await db.insert('opportunity', { id: OPP, title_ar: 'خدمات إدارة الحشود في المشاعر المقدسة', sector_id: 'SOL',
    department_id: 'D_AI', stage_id: 'PROPOSAL', value_halalas: 5000000, owner_user_id: 'u_rayan', created_by: 'u_rayan', created_at: T });
  await db.insert('opportunity_department', { opportunity_id: OPP, department_id: 'D_CITY', created_at: T });
  // ومشروعٌ على البنية نفسها (ADR-0008): المسؤولة D_AI، والمشارِكة D_CITY.
  await db.insert('project', { id: PRJ, name_ar: 'مشروع النقل في المشاعر', sector_id: 'SOL',
    department_id: 'D_AI', status: 'IN_PROGRESS', created_at: T });
  await db.insert('project_department', { project_id: PRJ, department_id: 'D_CITY', created_at: T });

  const mk = async (uid) => ({ id: uid, username: uid, role_id: 'department_manager', scope: 'department',
    sector_id: 'SOL', department_id: null, departmentIds: await depts.readerDepartmentIds(uid, null) });
  AYOUB = await mk('u_ayoub');
  GHAREEB = await mk('u_ghareeb');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ═══ مدير الإدارة المشارِكة يربط مهمته بفرصة الشراكة — إنشاءً وتعديلاً ═══════════

test('أيوب (المشارِكة) يضيف مهمةً مربوطةً بفرصة الشراكة — لا «هذه الفرصة خارج نطاقك»', async () => {
  const res = await tasks.quickAddTask(ctx(AYOUB), { title: 'تجهيز عرض إدارة الحشود', opportunity_id: OPP });
  assert.ok(res && res.id, 'الإضافة رُدّت عن المشارِكة');
  const row = await db.get('SELECT opportunity_id, work_kind FROM task WHERE id = ?', [res.id]);
  assert.equal(row.opportunity_id, OPP, 'المهمة لم تُربط بالفرصة');
  assert.equal(row.work_kind, 'opportunity');
});

test('وأيوب يعيد ربط مهمةٍ داخلية بفرصة الشراكة من باب التعديل — الحارس نفسه في المسارين', async () => {
  const created = await tasks.quickAddTask(ctx(AYOUB), { title: 'مهمة داخلية تُصحَّح جهتها' });
  await tasks.updateTask(ctx(AYOUB), created.id, { opportunity_id: OPP });
  const row = await db.get('SELECT opportunity_id FROM task WHERE id = ?', [created.id]);
  assert.equal(row.opportunity_id, OPP, 'إعادة الربط رُدّت عن المشارِكة');
});

// ═══ والمشروع المشترك (ADR-0008) من بابه الواحد كذلك ═══════════════════════════

test('وأيوب يربط مهمةً بمشروع الشراكة — فرع المشروع من بابه الواحد كذلك', async () => {
  const res = await tasks.quickAddTask(ctx(AYOUB), { title: 'خطة تشغيل النقل', project_id: PRJ });
  const row = await db.get('SELECT project_id, work_kind FROM task WHERE id = ?', [res.id]);
  assert.equal(row.project_id, PRJ, 'المهمة لم تُربط بالمشروع المشترك');
  assert.equal(row.work_kind, 'project');
});

// ═══ الباب لم يتّسع: الغريب يُرَدّ كما كان، و«غير موجودة» برسالة المنتقي ═══════════

test('ومديرٌ لا إدارةَ له في الجهتين يُرَدّ عن الربط — فتحُ الشراكة ليس فتحاً للجميع', async () => {
  await assert.rejects(
    () => tasks.quickAddTask(ctx(GHAREEB), { title: 'تسلُّل', opportunity_id: OPP }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message),
    'ربطُ فرصةٍ لا شأن له بها مرّ');
  await assert.rejects(
    () => tasks.quickAddTask(ctx(GHAREEB), { title: 'تسلُّل', project_id: PRJ }),
    (e) => e.status === 403 && /خارج نطاقك/.test(e.message),
    'ربطُ مشروعٍ لا شأن له به مرّ');
  assert.equal(await db.get("SELECT id FROM task WHERE title = 'تسلُّل'"), undefined);
});

test('وفرصةٌ غير موجودة تُرَدّ برسالة المنتقي الإرشادية لا برسالة الباب العامة', async () => {
  await assert.rejects(
    () => tasks.quickAddTask(ctx(AYOUB), { title: 'على فرصةٍ ذهبت', opportunity_id: 'OPP_GONE' }),
    (e) => e.status === 400 && /اخترها من القائمة/.test(e.message));
});
