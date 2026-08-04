// ── ما يُعرَض في القائمة يجب أن يُفتح ────────────────────────────────────────
//
// «أنا ريان، في فرص تطلع لي ولما أضغط عليها تجيني الصلاحية غير مسموحة» — والشاشة تردّ ٤٠٣.
//
// وهو تناقضٌ بين مسارين يقرّران نفس السؤال بحكمين مختلفين:
//  · **القائمة** (`scopeFilter` ← `roleScopeFilter`) بنطاق «إدارة» **تفشل مفتوحةً إلى القطاع**
//    عن قصدٍ موثَّق: عمود الإدارة لا يُمرَّر للاستعلامات قبل نسبة البيانات كلها.
//  · **الصفّ** (`can` ← `scopeReaches`) كان يقصّ على الإدارات التي يقودها القارئ وحدها.
// فيرى مدير الإدارة صفوف قطاعه في كل قائمة، ولا يفتح منها إلا صفوف إدارته.
//
// والتناقض قديم لكنه كان مستوراً: أكثر الصفوف بلا إدارة فتمرّ من الفرع المتساهل. ولمّا نُسبت
// الفرص إلى إداراتها (استدراك المرآة بين المشاريع والفرص) وقع على صفوفٍ حقيقية — وأولها فرصةٌ
// في «إدارة المدن الذكية» ظهرت للمالك في «الفرص» ولم تُفتح.
//
// **والحدّ الذي لا يتحرّك: القراءة تتبع القائمة، والكتابة لا.**
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-listrow-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, can;
const T = '2026-08-04T09:00:00Z';
// ريان كما هو في القاعدة الحيّة: مدير إدارة، نطاقه المسجَّل «قطاع»، يقود إدارتين لا ثلاثاً.
const RAYAN = {
  id: 'u_rayan', username: 'rayn', role_id: 'department_manager', scope: 'sector', sector_id: 'SOLUTIONS',
  departmentIds: new Set(['dep_innovation', 'dep_ai']), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [],
};
const CTX = { user: RAYAN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  ({ can } = await import('../../src/core/rbac/index.js'));
  await (await import('../../src/core/rbac/index.js')).initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');

  await db.insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_rayan', username: 'rayn', role_id: 'department_manager',
    scope: 'sector', sector_id: 'SOLUTIONS', active: 1, created_at: T });
  for (const [id, name] of [['dep_innovation', 'إدارة الابتكار'], ['dep_ai', 'إدارة الذكاء الاصطناعي والبيانات']]) {
    await db.insert('department', { id, sector_id: 'SOLUTIONS', name_ar: name, manager_user_id: 'u_rayan', active: 1, created_at: T });
  }
  await db.insert('department', { id: 'dep_cities', sector_id: 'SOLUTIONS', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  await db.insert('department', { id: 'dep_other_sector', sector_id: 'CONSULTING', name_ar: 'إدارة في قطاع آخر', active: 1, created_at: T });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', default_win_pct: 100, sort_order: 9, is_won: 1, is_lost: 0 });

  // الفرصة التي ردّت المالك بـ٤٠٣ — قطاعه، وإدارةٌ لا يقودها.
  await db.insert('opportunity', { id: 'opp_cities', title_ar: 'المركز الوطني لإدارة النفايات',
    sector_id: 'SOLUTIONS', department_id: 'dep_cities', stage_id: 'WON', value_halalas: 0, year: 2026, created_at: T });
  await db.insert('opportunity', { id: 'opp_mine', title_ar: 'فرصة إدارته',
    sector_id: 'SOLUTIONS', department_id: 'dep_innovation', stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
  await db.insert('opportunity', { id: 'opp_nodept', title_ar: 'فرصة بلا إدارة',
    sector_id: 'SOLUTIONS', department_id: null, stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
  // وفرصةٌ في قطاعٍ آخر — الحدّ الذي يجب ألّا يتحرّك بأي حال.
  await db.insert('opportunity', { id: 'opp_far', title_ar: 'فرصة قطاع آخر',
    sector_id: 'CONSULTING', department_id: 'dep_other_sector', stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('كل فرصةٍ تظهر في قائمته تُفتح — لا صفَّ يُعرض ثم يُرَدّ بـ«صلاحيتك لا تسمح»', async () => {
  const listed = await opps.listOpportunities(RAYAN, { year: 2026 });
  assert.ok(listed.length >= 3, 'القائمة تعرض فرص قطاعه');
  for (const o of listed) {
    await assert.doesNotReject(() => opps.getOpportunity(RAYAN, o.id),
      `«${o.title_ar}» تظهر في القائمة ولا تُفتح — وهذا بعينه ما رآه المالك`);
  }
});

test('وفرصةُ إدارةٍ أخرى داخل قطاعه تُقرأ — لأن قائمته تعرضها أصلاً', () => {
  const row = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), true);
});

test('**ولا تُعدَّل**: القراءة تتبع القائمة والكتابة لا — وإلا صار إصلاحُ عرضٍ منحَ صلاحية', () => {
  const row = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'update', 'opportunity', row), false, 'تعديل فرصة إدارة أخرى سلطة لم تُمنَح');
  assert.equal(can(RAYAN, 'create', 'opportunity', row), false);
});

test('وفرصة إدارته تُقرأ وتُعدَّل كما كانت — لا نقصان في وصولٍ قائم', () => {
  const row = { id: 'opp_mine', sector_id: 'SOLUTIONS', department_id: 'dep_innovation' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), true);
  assert.equal(can(RAYAN, 'update', 'opportunity', row), true);
});

test('وحدُّ القطاع لا يتحرّك: فرصةُ قطاعٍ آخر لا تُقرأ ولا تُعدَّل', async () => {
  const row = { id: 'opp_far', sector_id: 'CONSULTING', department_id: 'dep_other_sector' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), false);
  assert.equal(can(RAYAN, 'update', 'opportunity', row), false);
  await assert.rejects(() => opps.getOpportunity(RAYAN, 'opp_far'));
});

// ── والمشروع يبقى بحدّه: توسعة القراءة **لا تشمله** ─────────────────────────
// حارسٌ قائم يمنع ذلك صراحةً («التوسيع المطلوب كان على الفرص لا على الناس»، ومعه المشروع في
// اثني عشر فحصاً). فحدّ الإدارة على المشاريع مقصود، وعلاجُ تناقضه **تضييق المحفظة** لا توسيع
// الصفّ — وهو مؤجَّل حتى تُنسَب المشاريع إلى إداراتها، إذ التضييق اليوم يُخفي كل مشروعٍ بلا
// إدارة فيستبدل تسريباً بعُطل. وهذا الفحص يُثبِّت أن التوسعة لم تتسرّب إليه.
test('ومشروع إدارةٍ أخرى لا يُقرأ — التوسعة على الفرص وحدها لا على المشاريع', () => {
  const row = { id: 'p_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'read', 'project', row), false, 'حدّ المشاريع بالإدارة محروس بقرار سابق');
  assert.equal(can(RAYAN, 'read', 'employee', row), false, 'وحدّ الناس كذلك');
});

test('ومديرُ إدارةٍ في قطاعٍ آخر لا يقرأ فرص هذا القطاع — التوسعة داخل القطاع وحده', () => {
  const stranger = { id: 'u_str', role_id: 'department_manager', scope: 'sector', sector_id: 'CONSULTING',
    departmentIds: new Set(['dep_other_sector']), projectIds: new Set(), teamIds: new Set() };
  const row = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(stranger, 'read', 'opportunity', row), false);
});
