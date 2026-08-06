// ── ما يُعرَض في القائمة يجب أن يُفتح — والقائمة صارت قائمة **إدارته** ─────────
//
// القصة على فصلين، والحارس واحد:
//  · الفصل الأول: «أنا ريان، في فرص تطلع لي ولما أضغط عليها تجيني الصلاحية غير مسموحة» —
//    القائمة كانت قطاعية والصفُّ إدارياً، فعُولج التناقض يومها بتوسيع قراءة الصفّ إلى القطاع
//    (SECTOR_WIDE_LISTS) كي يلحق الصفُّ بالقائمة.
//  · الفصل الثاني (قرار المالك ٢٠٢٦-٠٨): انقلبت القاعدة نفسها — مدير الإدارة يرى فرص
//    **إدارته** (مسؤولةً أو مشاركة) لا فرص قطاعه، ومدير تطوير الأعمال فرصَه هو. فضاقت
//    القائمة (`deptCol` مُفعَّل في scope.js) وأُزيل المُوسِّع القديم من قراءة الصفّ — إذ صار
//    وجودُه هو التسريب: صفٌّ لا تعرضه قائمته ويُفتح بالعنوان المباشر.
//
// والحارس في الفصلين هو هو: **كل ما يُعرَض يُفتح، والكتابة لا تتبع القراءة** — وتغيّر تحته
// اتساعُ القائمة لا الحارسُ نفسه.
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
  managedDepartmentIds: new Set(['dep_innovation', 'dep_ai']),
};

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

  // فرصة «المدن الذكية»: قطاعُه، وإدارةٌ لا يقودها — كانت تظهر ولا تُفتح، وصارت لا تظهر ولا تُفتح.
  await db.insert('opportunity', { id: 'opp_cities', title_ar: 'المركز الوطني لإدارة النفايات',
    sector_id: 'SOLUTIONS', department_id: 'dep_cities', stage_id: 'WON', value_halalas: 0, year: 2026, created_at: T });
  await db.insert('opportunity', { id: 'opp_mine', title_ar: 'فرصة إدارته',
    sector_id: 'SOLUTIONS', department_id: 'dep_innovation', stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
  await db.insert('opportunity', { id: 'opp_partner', title_ar: 'فرصة تشارك فيها إدارته',
    sector_id: 'SOLUTIONS', department_id: 'dep_cities', stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
  await db.insert('opportunity_department', { opportunity_id: 'opp_partner', department_id: 'dep_ai', created_at: T });
  await db.insert('opportunity', { id: 'opp_nodept', title_ar: 'فرصة بلا إدارة',
    sector_id: 'SOLUTIONS', department_id: null, stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
  // وفرصةٌ في قطاعٍ آخر — الحدّ الذي يجب ألّا يتحرّك بأي حال.
  await db.insert('opportunity', { id: 'opp_far', title_ar: 'فرصة قطاع آخر',
    sector_id: 'CONSULTING', department_id: 'dep_other_sector', stage_id: 'WON', value_halalas: 100, year: 2026, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('قائمته فرصُ إدارتيه — مسؤولةً أو مشاركة — وكل صفٍّ فيها يُفتح فعلاً', async () => {
  const listed = await opps.listOpportunities(RAYAN, { year: 2026 });
  assert.deepEqual(listed.map((o) => o.id).sort(), ['opp_mine', 'opp_partner'],
    'القائمة لم تَعُد قطاعية: إدارتاه (والمشاركة تلحق) لا أكثر ولا أقل');
  for (const o of listed) {
    await assert.doesNotReject(() => opps.getOpportunity(RAYAN, o.id),
      `«${o.title_ar}» تظهر في القائمة ولا تُفتح — وهذا بعينه ما رآه المالك في الفصل الأول`);
  }
});

test('فرصةُ إدارةٍ أخرى في قطاعه: لا تُعرَض ولا تُفتح — القاعدة انقلبت والاتساق بقي', async () => {
  const row = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), false,
    'المُوسِّع القطاعي القديم ما زال حياً — وقد صار تسريباً منذ ضاقت القائمة');
  await assert.rejects(() => opps.getOpportunity(RAYAN, 'opp_cities'),
    (e) => e.status === 403, 'العنوان المباشر يفتح ما لا تعرضه قائمته');
});

test('**ولا كتابة بحال**: لا على إدارةٍ أخرى، ولا على فرصةٍ تشارك فيها إدارتُه', () => {
  const other = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'update', 'opportunity', other), false, 'تعديل فرصة إدارة أخرى سلطة لم تُمنَح');
  assert.equal(can(RAYAN, 'create', 'opportunity', other), false);
  // المشاركة تفتح القراءة (الفرصة في قائمته) ولا تفتح القلم — قرارُها عند إدارتها المسؤولة.
  const partner = { id: 'opp_partner', sector_id: 'SOLUTIONS', department_id: 'dep_cities',
    partner_department_ids: ['dep_ai'] };
  assert.equal(can(RAYAN, 'read', 'opportunity', partner), true, 'المشاركة لا تفتح صفَّها');
  assert.equal(can(RAYAN, 'update', 'opportunity', partner), false, 'المشاركة فتحت القلم — وهي رؤية عملٍ لا ولاية');
});

test('وفرصة إدارته تُقرأ وتُعدَّل كما كانت — لا نقصان في وصولٍ قائم', () => {
  const row = { id: 'opp_mine', sector_id: 'SOLUTIONS', department_id: 'dep_innovation' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), true);
  assert.equal(can(RAYAN, 'update', 'opportunity', row), true);
});

// ── الفرصة «بلا إدارة» — الحالة التي يقرّرها الكود لا التمنّي، مثبَّتةً من طرفَيها ──
// القائمة تفشل **مغلقةً**: `departmentInSql` عضويةٌ في مجموعة إداراته، وصفٌّ إدارتُه فارغة
// ليس عضواً في شيء — فلا يظهر في قائمة مديرِ إدارة، ويظهر لقائد القطاع وفي مُرشِّح «بلا إدارة»
// ليُسنَد. أما **الصفُّ** فيبقى مفتوحاً بالعنوان المباشر داخل قطاعه: فحص النطاق لا يغلق هدفاً
// بلا إدارة في قطاع القارئ (إغلاقه الكامل يحرم موارد لا تحمل عمود إدارة أصلاً — موثَّق في
// rbac/index.js)، وفرصةٌ لم تُنسَب بعد ليست سرَّ إدارةٍ أخرى. فالعرضُ أضيق من القراءة هنا
// عمداً — والعكس (يُعرَض ولا يُفتح) هو وحده الكسر الذي يحرسه هذا الملف.
test('فرصة بلا إدارة: خارج قائمته (فشل مغلق) — ويفتحها العنوان المباشر داخل قطاعه', async () => {
  const listed = await opps.listOpportunities(RAYAN, { year: 2026 });
  assert.ok(!listed.some((o) => o.id === 'opp_nodept'), 'صفٌّ بلا إدارة ظهر في قائمة مدير إدارة');
  const row = { id: 'opp_nodept', sector_id: 'SOLUTIONS', department_id: null };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), true,
    'فرصة قطاعه غير المُسنَدة انغلقت عليه صفّياً — وليست سرّ إدارةٍ أخرى');
});

test('وحدُّ القطاع لا يتحرّك: فرصةُ قطاعٍ آخر لا تُقرأ ولا تُعدَّل', async () => {
  const row = { id: 'opp_far', sector_id: 'CONSULTING', department_id: 'dep_other_sector' };
  assert.equal(can(RAYAN, 'read', 'opportunity', row), false);
  assert.equal(can(RAYAN, 'update', 'opportunity', row), false);
  await assert.rejects(() => opps.getOpportunity(RAYAN, 'opp_far'));
});

// ── والمشروع يبقى بحدّه: لا توسعة صفٍّ ولا تضييق قائمة تسرّبا إليه ───────────
// حارسٌ قائم يمنع ذلك صراحةً («التوسيع المطلوب كان على الفرص لا على الناس»، ومعه المشروع في
// اثني عشر فحصاً). فحدّ الإدارة على المشاريع مقصود، وعلاجُ تناقضه **تضييق المحفظة** — وهو
// مؤجَّل حتى تُنسَب المشاريع إلى إداراتها (نصف D15 الباقي)، إذ التضييق اليوم يُخفي كل مشروعٍ
// بلا إدارة فيستبدل تسريباً بعُطل. وهذا الفحص يُثبِّت أن قلب قاعدة الفرص لم يمسّه.
test('ومشروع إدارةٍ أخرى لا يُقرأ — قلبُ قاعدة الفرص لم يمسّ المشاريع ولا الناس', () => {
  const row = { id: 'p_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(RAYAN, 'read', 'project', row), false, 'حدّ المشاريع بالإدارة محروس بقرار سابق');
  assert.equal(can(RAYAN, 'read', 'employee', row), false, 'وحدّ الناس كذلك');
});

test('ومديرُ إدارةٍ في قطاعٍ آخر لا يقرأ فرص هذا القطاع — الحدود كلها من كل جهة', () => {
  const stranger = { id: 'u_str', role_id: 'department_manager', scope: 'sector', sector_id: 'CONSULTING',
    departmentIds: new Set(['dep_other_sector']), projectIds: new Set(), teamIds: new Set() };
  const row = { id: 'opp_cities', sector_id: 'SOLUTIONS', department_id: 'dep_cities' };
  assert.equal(can(stranger, 'read', 'opportunity', row), false);
});
