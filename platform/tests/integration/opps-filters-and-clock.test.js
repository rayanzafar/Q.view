// أربعة مطالب صغيرة من المالك، ثلاثةٌ منها عيوبٌ يقف عليها كل يوم:
//   • «إذا رجعت للخانة اللي قبلها يحتاج يرجّعني محل ما وقفت وبنفس الفلتر، مو يتغيّر كل شي كأنه
//     انمسحت كل الفلاتر».
//   • «لازم يكون في فلتر إذا هي RFI أو RFP من صفحة الفرص».
//   • «في المستندات والروابط لما أحطّ ما يطلع لي الرابط ولا ينضغط — مكان يقول انقر هنا».
//   • «لا تحطّ أي فرصة متوقّفة… صفّر العدّاد بحيث كأنه نقطة الصفر اليوم».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-filters-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, docs, clock, opps;
const T = new Date().toISOString();
const OLD = '2024-01-01T00:00:00.000Z';           // أقدم من كل عتبات التوقّف
const TODAY = new Date().toISOString().slice(0, 10);
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  P = await import('../../src/web/pages.js');
  docs = await import('../../src/modules/crm/oppdocs.js');
  clock = await import('../../scripts/reset-stage-clock.js');
  opps = await import('../../src/modules/crm/opportunities.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('client', { id: 'CL', name_ar: 'وزارة الاقتصاد والتخطيط', created_at: T });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', name_ar: 'مدير النظام', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', name_ar: 'إدارة الابتكار', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('stage', { id: 'WON', name_ar: 'مكسوبة', is_won: 1, is_lost: 0, sort_order: 9 });

  const mk = (id2, sol, stage = 'PROPOSAL') => db.insert('opportunity', {
    id: id2, title_ar: 'فرصة ' + id2, sector_id: 'SOL', department_id: 'D1', stage_id: stage,
    solicitation_type: sol, value_halalas: 100000, owner_user_id: 'u_admin',
    year: Number(TODAY.slice(0, 4)), stage_changed_at: OLD, created_at: OLD,
  });
  await mk('O_RFI', 'RFI');
  await mk('O_RFP1', 'RFP');
  await mk('O_RFP2', 'RFP');
  await mk('O_NONE', null);
  await mk('O_WON', 'RFP', 'WON');
});
after(() => rmSync(dir, { recursive: true, force: true }));

// ── مُرشِّح نوع الطرح ─────────────────────────────────────────────────────────
test('شاشة الفرص فيها مُرشِّح نوع الطرح — RFI و RFP كلٌّ بعدده', async () => {
  const html = await P.opportunitiesPage(ADMIN, {});
  assert.ok(html.includes('نوع الطرح'), 'لا مُرشِّح لنوع الطرح');
  assert.ok(html.includes('استطلاع سوق (RFI)') && html.includes('طلب عرض (RFP)'), 'الأنواع غير معروضة');
  assert.ok(html.includes('sol=RFP'), 'الشريحة لا تُرشِّح فعلاً');
});

test('والترشيح يعمل: «طلب عرض» يُبقي فرصه ويُخرج غيرها', async () => {
  const html = await P.opportunitiesPage(ADMIN, { sol: 'RFP' });
  assert.ok(html.includes('فرصة O_RFP1') && html.includes('فرصة O_RFP2'), 'أُسقطت فرصة من نوعها');
  assert.ok(!html.includes('فرصة O_RFI'), 'فرصةٌ من نوعٍ آخر ما زالت معروضة');
  assert.ok(!html.includes('فرصة O_NONE'), 'فرصةٌ بلا نوع ظهرت تحت نوعٍ محدَّد');
});

test('و«لم يُحدَّد» مُرشِّحٌ قائم — فالفرص غير المصنَّفة تُرى لتُصنَّف', async () => {
  const html = await P.opportunitiesPage(ADMIN, { sol: 'none' });
  assert.ok(html.includes('فرصة O_NONE'), 'الفرص غير المصنَّفة لا تُرى');
  assert.ok(!html.includes('فرصة O_RFP1'), 'فرصةٌ مصنَّفة ظهرت تحت «لم يُحدَّد»');
});

// ── الرجوع بنفس المُرشِّحات ───────────────────────────────────────────────────
test('روابط القائمة تحمل معها حالتها، وصفحة الفرصة تُعيدها كما هي', async () => {
  const list = await P.opportunitiesPage(ADMIN, { sector: 'SOL', dept: 'D1', sol: 'RFP' });
  assert.ok(list.includes('?from='), 'الروابط لا تحمل حالة القائمة');
  const detail = await P.opportunityDetailPage(ADMIN, 'O_RFP1', { from: 'sector=SOL&dept=D1&sol=RFP' });
  assert.ok(detail.includes('/app/opportunities?sector=SOL&amp;dept=D1&amp;sol=RFP')
    || detail.includes('/app/opportunities?sector=SOL&dept=D1&sol=RFP'),
  'الرجوع يمسح المُرشِّحات — يعود إلى قائمةٍ غير التي جاء منها');
});

test('ولا يُبنى الرجوع إلا من مُرشِّحاتٍ معروفة — لا يُعاد ما وصل كما هو', async () => {
  const detail = await P.opportunityDetailPage(ADMIN, 'O_RFP1',
    { from: 'sector=SOL&evil=<script>&next=//example.com' });
  assert.ok(detail.includes('sector=SOL'), 'أُسقط مُرشِّح صحيح');
  assert.ok(!detail.includes('evil=') && !detail.includes('example.com'),
    'قيمةٌ من الرابط أُعيدت في عنوانٍ بلا تدقيق');
});

// ── رابط المستند يُفتح ───────────────────────────────────────────────────────
test('لكل مستندٍ زرُّ فتحٍ ظاهر لا اسمٌ صغير يُنقر عليه', async () => {
  await docs.addOpportunityDocument({ user: ADMIN, ip: '1' }, 'O_RFP1',
    { kind: 'technical', name: 'س', url: 'https://drive.example.com/tech.pdf' });
  const html = await P.opportunityDetailPage(ADMIN, 'O_RFP1', {});
  assert.ok(html.includes('فتح ↗'), 'لا زرّ فتح — الاسم القصير وحده لا يكاد يُنقر');
  assert.ok(html.includes('https://drive.example.com/tech.pdf'), 'الرابط غائب عن الصفحة');
  assert.ok(html.includes('target="_blank"') && html.includes('rel="noopener noreferrer"'),
    'الرابط يفتح في نفس النافذة أو بلا حماية');
});

// ── تصفير عدّاد المراحل ──────────────────────────────────────────────────────
test('قبل التصفير: الفرص المستوردة كلها «متوقّفة» — علامةٌ حمراء بلا معنى', async () => {
  const rows = await opps.listOpportunities(ADMIN, {}, { today: TODAY });
  const open = rows.filter((o) => o.stage_id !== 'WON');
  assert.ok(open.length >= 4);
  assert.ok(open.every((o) => o.rot), 'العيّنة ليست متوقّفة أصلاً — الفحص لا يقيس شيئاً');
});

test('والتصفير يجعل اليوم نقطة الصفر — فلا فرصة متوقّفة', async () => {
  const r = await clock.resetStageClock();
  assert.equal(r.skipped, false);
  assert.equal(r.updated, 4, 'صُفِّرت المكسوبة أيضاً — والتوقّف لا يُقاس عليها');
  const rows = await opps.listOpportunities(ADMIN, {}, { today: TODAY });
  assert.ok(rows.every((o) => !o.rot), 'بقيت فرصةٌ متوقّفة بعد التصفير');
  assert.ok(rows.filter((o) => o.stage_id !== 'WON').every((o) => o.stage_age_days === 0),
    'العدّاد لم يبدأ من اليوم');
});

test('ولا يُعاد التصفير مع كل إقلاع — وإلا أُلغيَ كل توقّفٍ حقيقي بعده', async () => {
  const again = await clock.resetStageClock();
  assert.equal(again.skipped, true, 'التصفير يُعاد فيُلغي التوقّف الحقيقي كل مرة');
  assert.equal(again.updated, 0);
});

test('والمكسوبة لم تُمَسّ ساعتها — تغييرٌ بلا أثرٍ على شاشة هو مسٌّ لبياناتٍ بلا سبب', async () => {
  const won = await db.get('SELECT stage_changed_at FROM opportunity WHERE id = ?', ['O_WON']);
  assert.equal(won.stage_changed_at, OLD, 'مُسَّت ساعة فرصةٍ محسومة');
});

// «المفروض ما يطلع «لا أيام» — لازم بعد ٢٠ يوم من الفرصة يذكر كم مضى عنها» — بلسان المالك.
// وبعد تصفير العدّاد صارت كل بطاقة تحمل «لا أيام»: شارةٌ على كل شيء لا تميّز شيئاً.
test('شارة العمر لا تظهر قبل عشرين يوماً، وتظهر بعدها قائلةً كم مضى', async () => {
  const now = new Date();
  const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
  await db.update('opportunity', 'O_RFI', { stage_changed_at: daysAgo(3) });     // فتيّة
  await db.update('opportunity', 'O_RFP1', { stage_changed_at: daysAgo(25) });   // مضى عليها
  const html = await P.opportunitiesPage(ADMIN, {});
  assert.ok(html.includes('مضى'), 'لا شارة عمرٍ على فرصةٍ مضى عليها خمسة وعشرون يوماً');
  assert.ok(!html.includes('لا أيام'), '«لا أيام» ما زالت تُطبع');
});

test('لكنها تظهر قبل العشرين إن كانت متوقفة فعلاً — لا يُطفأ تنبيهٌ صحيح', async () => {
  const now = new Date();
  // «ترشيح» تتوقف بعد أربعة عشر يوماً — فخمسة عشر متوقّفة وإن لم تبلغ العشرين.
  await db.update('opportunity', 'O_NONE', {
    stage_id: 'LEAD', stage_changed_at: new Date(now.getTime() - 16 * 86400000).toISOString() });
  const rows = await opps.listOpportunities(ADMIN, {}, { today: TODAY });
  const rotting = rows.find((o) => o.id === 'O_NONE');
  assert.equal(rotting.rot, true, 'العيّنة ليست متوقّفة — الفحص لا يقيس شيئاً');
  const html = await P.opportunitiesPage(ADMIN, {});
  assert.ok(html.includes('مضى 16 يوماً') || html.includes('مضى ١٦ يوماً') || html.includes('16'),
    'أُخفيت شارة فرصةٍ متوقّفة لأنها دون العشرين');
});
