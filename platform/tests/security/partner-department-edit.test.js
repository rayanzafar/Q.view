// الفرصة على إدارتين يعدّلها مديراهما معاً (ADR-0006، بقرار المالك 2026-08-11) — والحالة الحية
// شكلاً: فرصةٌ مسؤولتها «الذكاء الاصطناعي» (مديرها ريان) وتشارك فيها «المدن الذكية» (مديرها
// د. أيوب). أيوب يفتح التحكم ويضيف الفريق ويحرّك المرحلة — ولا يمسّ **نسبة** الفرصة (الإدارة
// المسؤولة أو المشارِكة أو القطاع)، ولا يحذفها ولا ينشئ. وريان (المسؤولة) يملك النسبة كاملةً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-partneredit-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, oppteam, remove, attribution, depts, P, can;
const T = new Date().toISOString();
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });
let RAYAN, AYOUB; // مديرا الإدارتين
const OPP = 'OPP_HAJJ';

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  ({ can } = rbac);
  opps = await import('../../src/modules/crm/opportunities.js');
  oppteam = await import('../../src/modules/crm/oppteam.js');
  remove = await import('../../src/core/lifecycle/remove.js');
  attribution = await import('../../src/modules/org/attribution.js');
  depts = await import('../../src/core/rbac/departments.js');
  ({ opportunityDetailPage: P } = await import('../../src/web/views/opportunity-detail.js'));

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('sector', { id: 'CON', name_ar: 'قطاع الاستشارات', kind: 'delivery', active: 1, created_at: T });
  for (const [uid, name] of [['u_rayan', 'ريان ظفر'], ['u_ayoub', 'د. أيوب الزاكي']]) {
    await db.insert('app_user', { id: uid, username: uid, name_ar: name, role_id: 'department_manager',
      scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  }
  await db.insert('department', { id: 'D_AI', name_ar: 'إدارة الذكاء الاصطناعي', sector_id: 'SOL', manager_user_id: 'u_rayan', active: 1, created_at: T });
  await db.insert('department', { id: 'D_CITY', name_ar: 'إدارة المدن الذكية', sector_id: 'SOL', manager_user_id: 'u_ayoub', active: 1, created_at: T });
  await db.insert('department', { id: 'D_OTHER', name_ar: 'إدارةٌ ثالثة', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('employee', { id: 'e_hand', name_ar: 'موظف يُضاف للفريق', sector_id: 'SOL', department_id: 'D_CITY', active: 1, created_at: T });

  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('stage', { id: 'LEAD', name_ar: 'مبدئي', is_won: 0, is_lost: 0, sort_order: 1 });
  // المسؤولة D_AI (ريان)، والمشارِكة D_CITY (أيوب) — كالحالة الحية حرفاً.
  await db.insert('opportunity', { id: OPP, title_ar: 'خدمات إدارة الحشود في المشاعر المقدسة', sector_id: 'SOL',
    department_id: 'D_AI', stage_id: 'PROPOSAL', value_halalas: 5000000, owner_user_id: 'u_rayan', created_by: 'u_rayan', created_at: T });
  await db.insert('opportunity_department', { opportunity_id: OPP, department_id: 'D_CITY', created_at: T });

  const mk = async (uid) => ({ id: uid, username: uid, role_id: 'department_manager', scope: 'department',
    sector_id: 'SOL', department_id: null, departmentIds: await depts.readerDepartmentIds(uid, null) });
  RAYAN = await mk('u_rayan');
  AYOUB = await mk('u_ayoub');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const row = () => db.get('SELECT * FROM opportunity WHERE id = ?', [OPP]);

// ═══ مدير الإدارة المشارِكة يعدّل الحقول العادية ولا يُردّ «خرجت عن نطاقك» ═══════

test('أيوب (المشارِكة) يعدّل العنوان والقيمة والمسؤول ويحرّك المرحلة — والرد كامل لا «خرجت عن نطاقك»', async () => {
  const res = await opps.updateOpportunity(ctx(AYOUB), OPP, {
    title_ar: 'خدمات إدارة الحشود — نسخة محدَّثة', value_sar: 6000000, win_pct: 40, owner_user_id: 'u_ayoub' });
  assert.ok(!res || !res.movedOutOfReach, 'رُدّ «خرجت عن نطاقك» على تعديلٍ نجح (finding A)');
  const r = await row();
  assert.equal(r.title_ar, 'خدمات إدارة الحشود — نسخة محدَّثة');
  assert.equal(r.owner_user_id, 'u_ayoub', 'المسؤول حقلٌ عمليٌّ مفتوحٌ للمشارِكة');

  const staged = await opps.moveStage(ctx(AYOUB), OPP, 'LEAD', 'مراجعة');
  assert.ok(staged, 'تحريك المرحلة رُدّ عن المشارِكة');
  assert.equal((await row()).stage_id, 'LEAD');
});

// ═══ حقول النسبة محجوزة — بالمقارنة لا بوجود المفتاح ═══════════════════════════

test('ولا يمسّ نسبةَ الفرصة: الإدارة أو القطاع أو المشارِكات — بينما القيم نفسها تمرّ', async () => {
  // القيم الحالية نفسها (كما ترسلها الشاشة في كل حفظ) تمرّ ولا تُمنَع.
  const same = await opps.updateOpportunity(ctx(AYOUB), OPP, {
    title_ar: 'ثابتٌ', department_id: 'D_AI', sector_id: 'SOL', partner_department_ids: ['D_CITY'] });
  assert.ok(!same.movedOutOfReach, 'رُفض حفظٌ لأن قيمَ النسبة غير المتغيّرة رافقته');

  await assert.rejects(() => opps.updateOpportunity(ctx(AYOUB), OPP, { department_id: 'D_CITY' }),
    /قرارُ الإدارة المسؤولة/, 'غيّر الإدارة المسؤولة');
  await assert.rejects(() => opps.updateOpportunity(ctx(AYOUB), OPP, { sector_id: 'CON' }),
    /قرارُ الإدارة المسؤولة/, 'غيّر القطاع');
  await assert.rejects(() => opps.updateOpportunity(ctx(AYOUB), OPP, { partner_department_ids: ['D_CITY', 'D_OTHER'] }),
    /قرارُ الإدارة المسؤولة/, 'أضاف إدارةً ثالثة شريكة — منحُ وصولٍ لطرفٍ ثالث');
  // نقل القطاع (يرفع المسؤولة) مرفوضٌ للمشارِكة كذلك.
  await assert.rejects(() => opps.moveSector(ctx(AYOUB), OPP, 'CON'),
    /قرارُ الإدارة المسؤولة/, 'نقل القطاع فتح للمشارِكة');
});

// ═══ الحذف والإنشاء يبقيان مرفوعين عن المشارِكة ═══════════════════════════════

test('والحذف والإنشاء مرفوعان عن المشارِكة — قائمة السماح read|update لا تفتحهما', async () => {
  const enriched = { ...(await row()), partner_department_ids: ['D_CITY'] };
  assert.equal(can(AYOUB, 'delete', 'opportunity', enriched), false);
  await assert.rejects(() => remove.removeRecord(ctx(AYOUB), 'opportunity', OPP), (e) => e.status === 403 || /صلاح/.test(e.message));
  // باب النسبة الجانبي (org/attribution) مسؤولٌ فقط ببنائه — يُثبَت أنه يردّ المشارِكة.
  await assert.rejects(() => attribution.setWorkDepartment(ctx(AYOUB), { kind: 'opportunity', id: OPP, department_id: 'D_CITY' }),
    (e) => e.status === 403 || /صلاح|قرار/.test(e.message), 'باب النسبة الجانبي فُتح للمشارِكة');
});

// ═══ فريق الفرصة يُضاف من المشارِكة ═══════════════════════════════════════════

test('أيوب يفتح كشف الفريق ويضيف عضواً ويرفعه — الباب نفسه فُتح بالتعديل', async () => {
  const { roster } = await oppteam.rosterForOpportunity(AYOUB, OPP);
  assert.ok(Array.isArray(roster) && roster.length, 'كشف الفريق رُدّ عن المشارِكة');
  const added = await oppteam.addMember(ctx(AYOUB), OPP, { employee_id: 'e_hand', role_in_group: 'member' });
  assert.ok(added, 'إضافة العضو رُدّت عن المشارِكة');
  const mem = await db.get("SELECT * FROM membership WHERE group_id = ? AND employee_id = 'e_hand'", [OPP]);
  assert.ok(mem, 'العضو لم يُكتب');
  await oppteam.removeMember(ctx(AYOUB), mem.id);
  assert.ok((await db.get('SELECT * FROM membership WHERE id = ?', [mem.id])).deleted_at, 'الرفع رُدّ عن المشارِكة');
});

// ═══ المسؤولة تملك النسبة كاملةً ═══════════════════════════════════════════════

test('وريان (المسؤولة) يعدّل النسبة نفسها بلا منعٍ — الحجزُ على المشارِكة وحدها', async () => {
  const r = await opps.updateOpportunity(ctx(RAYAN), OPP, { partner_department_ids: ['D_CITY', 'D_OTHER'] });
  assert.ok(!r.movedOutOfReach);
  const parts = (await db.all('SELECT department_id FROM opportunity_department WHERE opportunity_id = ?', [OPP])).map((x) => x.department_id).sort();
  assert.deepEqual(parts, ['D_CITY', 'D_OTHER'], 'المسؤولة لم تُحرَّر إدارات الشراكة');
  // تُعاد إلى الحالة الحية لبقية الفحوص إن وُجدت.
  await opps.updateOpportunity(ctx(RAYAN), OPP, { partner_department_ids: ['D_CITY'] });
});

// ═══ الشاشة: بطاقة التحكم وفريق الفرصة تظهران، وحقول النسبة معطَّلةٌ لا محذوفة ═══

test('صفحة الفرصة لأيوب: تحكّمٌ وفريق، وحقول النسبة **معطَّلة** (لا محذوفة — لئلا يُمسح عمودها)', async () => {
  const html = await P(AYOUB, OPP);
  assert.ok(html.includes('التحكم بالفرصة'), 'بطاقة التحكم غائبة عن المشارِكة');
  assert.ok(html.includes('team-emp-q') || html.includes('إضافة') || html.includes('الفريق'), 'نموذج الفريق غائب');
  for (const id of ['oc-sector', 'oc-dept', 'oc-partners']) {
    const re = new RegExp(`id="${id}"[^>]*disabled`);
    assert.ok(re.test(html), `الحقل ${id} غير معطَّل للمشارِكة`);
  }
  assert.ok(html.includes('إدارتك مشاركة'), 'لا تلميح يشرح لماذا حقول النسبة مقفلة');
  assert.ok(!/undefined|NaN|\[object/.test(html));
});

test('وصفحة الفرصة لريان (المسؤولة): حقول النسبة مفتوحة', async () => {
  const html = await P(RAYAN, OPP);
  assert.ok(html.includes('التحكم بالفرصة'));
  assert.ok(!/id="oc-dept"[^>]*disabled/.test(html), 'حقل الإدارة معطَّلٌ على المسؤولة');
});
