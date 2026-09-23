// ── منح إدارة الفعاليات بالأشخاص (v5.60) ─────────────────────────────────────
//
// «أعطِ مازن وريان وعبدالرحمن إدارة فعالية LEAP كاملة» — بطلب حسين (٢٠٢٦-٠٨-٢٩).
// الفعاليات شركيّةُ النطاق بالبناء (ADR-0013)، وأبوابُ خدمتها تُنادي can() بلا صفّ هدف —
// فالإدارةُ على صفّ المنحة قيدُ جدولٍ لا قيدُ أثر. أدقّ ما يُحرَس هنا ثلاثة:
//   ① الموظفُ بلا منحةٍ محرومٌ كما كان: لا إنشاء ولا تعديل ولا إغلاق ولا حذفَ لبطاقة غيره.
//   ② والمنحةُ تفتح البابَ الذي سُمّيت له فقط، ورفعُها يُطفئه من الطلب التالي بلا إعادة دخول.
//   ③ ومَن لا يملك إدارة الفعاليات لا يمنحها (مديرُ الإدارة يُرَدّ)، والقائمةُ المغلقة تبقى
//      مغلقةً أمام ما لم يُسمَّ (event_blob مثلاً).
//
// ── سحب v5.70 (قرار حسين ٢٠٢٦-٠٩-٠١) ────────────────────────────────────────
// صارت الأزواجُ أربعةً: «يحذف فعاليات» خرج من القائمة المغلقة، وحذفُ الفعالية لمدير النظام
// وحده — لأنه يمحو صور البطاقات ورموز الكشك محواً فعلياً لا رجعة فيه. ويُحرَس هنا أمران:
// أن الزوج لم يعد يُمنَح أصلاً، وأن صفّاً قديماً باقياً في الجدول (منحُ ٢٠٢٦-٠٨-٢٩ على الحيّ)
// لا يفتح الباب — لأن `grantsForUser()` يمرّر كل صفٍّ على `isGrantable()` ويُسقط ما خرج،
// فلا ترحيلةَ ولا سكربتَ رفعٍ يلزم.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-evgrants-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, G, ev, resolveUser;
let leapId, cardAbd;
const T = '2026-08-29T00:00:00Z';
const sess = async (uid) => {
  const sid = 's_' + uid + '_' + Math.random().toString(36).slice(2, 8);
  await db.insert('session', { id: sid, user_id: uid, created_at: T,
    expires_at: new Date(Date.now() + 864e5).toISOString() });
  return await resolveUser(sid);
};
const ctxOf = async (uid) => ({ user: await sess(uid), ip: '1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  ({ resolveUser } = await import('../../src/core/http/context.js'));
  G = await import('../../src/modules/identity/grants.js');
  ev = await import('../../src/modules/events/events.js');

  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D_DATA', sector_id: 'SOL',
    name_ar: 'إدارة الذكاء الاصطناعي والبيانات', active: 1, created_at: T });

  await db.insert('app_user', { id: 'u_admin', username: 'u_admin', name_ar: 'مدير النظام',
    role_id: 'admin', sector_id: 'SOL', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_lead', username: 'sector.lead', name_ar: 'قائد القطاع',
    role_id: 'sector_lead', sector_id: 'SOL', scope: 'sector', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_dm', username: 'dept.manager', name_ar: 'مدير الإدارة',
    role_id: 'department_manager', sector_id: 'SOL', scope: 'department', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_maz', username: 'mazin.demo', name_ar: 'مازن',
    role_id: 'employee', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_abd', username: 'abd.demo', name_ar: 'عبدالرحمن',
    role_id: 'employee', sector_id: 'SOL', scope: 'own', active: 1, created_at: T });

  for (const [eid, uid, name] of [
    ['e_dm', 'u_dm', 'مدير الإدارة'], ['e_maz', 'u_maz', 'مازن نجوم'], ['e_abd', 'u_abd', 'عبدالرحمن خالد'],
  ]) {
    await db.insert('employee', { id: eid, user_id: uid, name_ar: name, sector_id: 'SOL',
      department_id: 'D_DATA', job_title: 'موظف', active: 1, created_at: T });
    await db.update('app_user', uid, { employee_id: eid });
  }
  await db.update('department', 'D_DATA', { manager_user_id: 'u_dm' });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const FOUR = [
  ['event', 'create'], ['event', 'update'],
  ['event_contact', 'delete'], ['event_partner', 'delete'],
];

// ── ① نقطة البدء مثبَّتة ─────────────────────────────────────────────────────
test('قبل المنح: الموظف لا ينشئ فعالية ولا يعدّلها ولا يحذف بطاقة زميله', async () => {
  const ctxMaz = await ctxOf('u_maz');
  await assert.rejects(() => ev.createEvent(ctxMaz, {
    name_ar: 'معرضٌ قبل المنح', starts_on: '2026-08-31', ends_on: '2026-09-03',
  }), /ليس ضمن صلاحيتك|لا تسمح/);

  const created = await ev.createEvent(await ctxOf('u_lead'), {
    name_ar: 'معرض LEAP 2026', starts_on: '2026-08-31', ends_on: '2026-09-03', venue: 'الرياض',
  });
  const evId = created.id || created.event?.id;
  assert.ok(evId, 'القائد لم يستطع إنشاء الفعالية — العيّنة فاسدة');

  await assert.rejects(() => ev.updateEvent(ctxMaz, evId, { venue: 'جدة' }), /ليس ضمن صلاحيتك|لا تسمح/);
  await assert.rejects(() => ev.closeEvent(ctxMaz, evId), /ليس ضمن صلاحيتك|لا تسمح/);
  await assert.rejects(() => ev.deleteEvent(ctxMaz, evId), /ليس ضمن صلاحيتك|لا تسمح/);

  const { contact } = await ev.createContact(await ctxOf('u_abd'), evId,
    { kind: 'تعريف بالشركة', person_name: 'زائرٌ أول', capture_key: 'k-abd-1' });
  await assert.rejects(() => ev.deleteContact(ctxMaz, contact.id), /ليس ضمن صلاحيتك|لا تسمح|لمن التقطها|ليست بطاقتك/);
  leapId = evId; cardAbd = contact.id;
});

// ── ③ القائمة المغلقة ومَن يمنح ─────────────────────────────────────────────
test('القائمة المغلقة تقبل الأزواج الأربعة وتردّ الغريب و«يحذف فعاليات» المسحوب — ومدير الإدارة لا يمنح ما لا يملكه', async () => {
  const admin = await ctxOf('u_admin');
  await assert.rejects(() => G.grantDepartment(admin,
    { user_id: 'u_maz', department_id: 'D_DATA', resource: 'event_blob', action: 'delete' }),
  /غير متاحة للمنح/, 'event_blob تسرّب إلى القائمة المغلقة');

  // الزوج المسحوب: لا في القائمة، ولا يُمنَح، ولا يظهر في لوحة المنح لمن يملك كل شيء.
  assert.equal(G.isGrantable('event', 'delete'), false, '«يحذف فعاليات» ما زال قابلاً للمنح');
  assert.equal(G.GRANTABLE.filter((g) => g.resource.startsWith('event')).length, 4,
    'أزواج الفعاليات القابلة للمنح ليست أربعة');
  await assert.rejects(() => G.grantDepartment(admin,
    { user_id: 'u_maz', department_id: 'D_DATA', resource: 'event', action: 'delete' }),
  /غير متاحة للمنح/, 'حذف الفعالية ما زال يُمنَح لشخص');
  assert.ok(!(await G.grantableOptions(admin.user)).some((g) => g.resource === 'event' && g.action === 'delete'),
    'حذف الفعالية معروضٌ في لوحة المنح');

  const dm = await ctxOf('u_dm');
  await assert.rejects(() => G.grantDepartment(dm,
    { user_id: 'u_abd', department_id: 'D_DATA', resource: 'event', action: 'update' }),
  /لا يملكه|لا تملك/, 'مدير الإدارة منح إدارة الفعاليات وهو لا يملكها');

  for (const [resource, action] of FOUR) {
    const r = await G.grantDepartment(admin, { user_id: 'u_maz', department_id: 'D_DATA',
      resource, action, note: 'إدارة فعالية LEAP — بطلب حسين 2026-08-29' });
    assert.equal(r.ok, true, `${resource}:${action} رُفض وهو في القائمة`);
  }
  // وقائد القطاع يمنح بنفسه (يملكها شركيّاً) — منحةً واحدة تكفي عيّنةً.
  const r2 = await G.grantDepartment(await ctxOf('u_lead'),
    { user_id: 'u_abd', department_id: 'D_DATA', resource: 'event', action: 'update', note: 'عيّنة' });
  assert.equal(r2.ok, true, 'قائد القطاع لا يستطيع منح ما يملكه');
});

// ── ② المنحة تفتح بابها المسمّى فقط ─────────────────────────────────────────
test('بعد المنح: الموظف ينشئ فعاليةً باسمه ويعدّل ويغلق ويحذف بطاقة زميله وشراكته — ولا يحذف الفعالية', async () => {
  const ctxMaz = await ctxOf('u_maz');

  const created = await ev.createEvent(ctxMaz, {
    name_ar: 'فعالية مازن', starts_on: '2026-09-10', ends_on: '2026-09-11',
  });
  const mine = created.id || created.event?.id;
  assert.ok(mine, 'المنحة لم تفتح الإنشاء');
  assert.equal((await db.get('SELECT created_by FROM event WHERE id = ?', [mine])).created_by,
    'u_maz', 'المنشئ ليس صاحب المنحة');

  await ev.updateEvent(ctxMaz, leapId, { venue: 'الرياض — واجهة روشن' });
  await ev.deleteContact(ctxMaz, cardAbd);
  const partner = await ev.createPartner(await ctxOf('u_abd'), leapId,
    { org_name: 'شركة تجريبية', partner_kind: 'شراكة تقنية' });
  await ev.deletePartner(ctxMaz, partner.id || partner.partner?.id);
  await ev.closeEvent(ctxMaz, mine);
  // والحذف ليس من منحه ولا من منح أحدٍ: بابُ حذف الفعالية لمدير النظام وحده (٢٠٢٦-٠٩-٠١).
  await assert.rejects(() => ev.deleteEvent(ctxMaz, mine), /ليس ضمن صلاحيتك|لا تسمح/,
    'حاملُ منح الفعاليات حذف فعاليةً كاملة');
  assert.equal((await db.get('SELECT deleted_at FROM event WHERE id = ?', [mine])).deleted_at, null, 'الرفض حذف');
  await ev.deleteEvent(await ctxOf('u_admin'), mine);
  assert.ok((await db.get('SELECT deleted_at FROM event WHERE id = ?', [mine])).deleted_at, 'مدير النظام لم يحذف');

  // والموظف الآخر مُنح التعديل وحده: يعدّل ولا يحذف بطاقةً ليست له.
  const ctxAbd = await ctxOf('u_abd');
  await ev.updateEvent(ctxAbd, leapId, { booth_no: 'B-12' });
  const { contact } = await ev.createContact(ctxMaz, leapId,
    { kind: 'تعريف بالشركة', person_name: 'زائرٌ ثانٍ', capture_key: 'k-maz-2' });
  await assert.rejects(() => ev.deleteContact(ctxAbd, contact.id), /ليس ضمن صلاحيتك|لا تسمح|لمن التقطها|ليست بطاقتك/);
});

// ── ② الرفع يُطفئ من الطلب التالي — والأثر مكتوب ────────────────────────────
test('رفعُ منحة التعديل يُقفل البابَ من الطلب التالي بلا إعادة دخول — وكل منحٍ ورفعٍ في الأثر', async () => {
  const admin = await ctxOf('u_admin');
  const rows = await G.listUserGrants(admin.user, 'u_maz');
  const upd = rows.find((r) => r.resource === 'event' && r.action === 'update');
  assert.ok(upd, 'منحة التعديل غائبة عن الكشف');
  await G.revokeDepartmentGrant(admin, upd.id);
  const mazAfter = await ctxOf('u_maz');
  await assert.rejects(() => ev.updateEvent(mazAfter, leapId, { venue: 'لا' }), /ليس ضمن صلاحيتك|لا تسمح/);

  const trail = await db.all(
    "SELECT action FROM audit_log WHERE resource = 'user_grant' ORDER BY at");
  assert.ok(trail.some((r) => r.action === 'create'), 'المنح بلا أثر');
  assert.ok(trail.some((r) => r.action === 'delete'), 'الرفع بلا أثر');
});

// ── الصفُّ القديم لا يفتح باباً سُحب (v5.70) ──────────────────────────────────
// ثلاثةُ صفوفٍ على الحيّ تحمل «event:delete» من منح ٢٠٢٦-٠٨-٢٩. لا ترحيلةَ ترفعها ولا سكربت:
// `grantsForUser()` يمرّر كل صفٍّ على القائمة المغلقة، فما خرج منها يبطل من الطلب التالي.
test('صفُّ منحٍ قديمٌ بـ«يحذف فعاليات» يبقى في الجدول ولا أثر له — لا في السياق ولا في الكشف ولا على الباب', async () => {
  await db.insert('user_department_grant', { id: 'ugr_legacy_del', user_id: 'u_abd', resource: 'event',
    action: 'delete', department_id: 'D_DATA', note: 'منحةٌ قديمة قبل السحب', granted_by: 'u_admin', created_at: T });
  assert.ok(await db.get('SELECT id FROM user_department_grant WHERE id = ?', ['ugr_legacy_del']), 'الصفّ لم يُكتب');

  const ctxAbd = await ctxOf('u_abd'); // جلسةٌ جديدة: المنح تُقرأ مع كل طلب
  assert.ok(!(ctxAbd.user.departmentGrants || []).some((g) => g.resource === 'event' && g.action === 'delete'),
    'الصفّ القديم تسرّب إلى سياق الطلب');

  const target = await ev.createEvent(await ctxOf('u_lead'),
    { name_ar: 'فعالية تحرس الصفّ القديم', starts_on: '2026-09-20', ends_on: '2026-09-21' });
  const tid = target.id || target.event?.id;
  await assert.rejects(() => ev.deleteEvent(ctxAbd, tid), /ليس ضمن صلاحيتك|لا تسمح/,
    'صفٌّ قديمٌ بـevent:delete فتح الباب بعد سحب الزوج');
  assert.equal((await db.get('SELECT deleted_at FROM event WHERE id = ?', [tid])).deleted_at, null, 'الرفض حذف');

  const shown = await G.listUserGrants((await ctxOf('u_admin')).user, 'u_abd');
  assert.ok(!shown.some((r) => r.resource === 'event' && r.action === 'delete'),
    'الصفّ القديم معروضٌ في كشف الصلاحيات وهو بلا أثر');
});
