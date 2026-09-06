// حذف الحساب — قدرةٌ كانت ناقصة في المنتج.
//
// كان في خدمة الهوية دعوةٌ وتعطيلٌ وتعديل ولا حذف إطلاقاً: حسابٌ أُنشئ بالخطأ يبقى إلى الأبد،
// ويحجز بريده على أي حسابٍ جديد بنفس العنوان، ولا سبيل إلى إزالته إلا بفتح القاعدة يدوياً.
// وهذه الفحوص تحرس الأبواب التي لو انفتحت لصار الحذف أخطر من غيابه:
//   · آخر مدير نظام لا يُحذف — منصةٌ بلا مدير نظام لا يُصلحها أحد من داخلها.
//   · لا أحد يحذف حسابه — من يفعل يقفل الباب وهو داخله.
//   · صاحبُ عملٍ حيّ يُمنع، والرسالة تسمّي المانع بعدده وتقول البديل.
//   · البريد يُفرَج عنه فعلاً (قيدُ التفرّد في المخطط لا يستثني المحذوف).
//   · المحذوف يختفي من القوائم والشاشة ويبقى في التدقيق.
//   · ومن لا يملك الصلاحية يُردّ ٤٠٣.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-user-removal.db');
process.env.SANAD_DB = TEST_DB;
process.env.MAIL_TRANSPORT = 'preview';

let db, ids, identity, remove;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

const ADMIN = 'u_rm_admin', ADMIN2 = 'u_rm_admin2', STAFF = 'u_rm_staff';
const ctxOf = (u) => ({ user: u, ip: '127.0.0.1' });
let adminUser, admin2User, staffUser;

async function mkUser(id, { role = 'employee', email, active = 1, name = 'حساب فحص' } = {}) {
  await db.insert('app_user', {
    id, username: id, email, name_ar: name, role_id: role, scope: role === 'admin' ? 'company' : 'own',
    active, must_change_pw: 0, failed_attempts: 0, created_at: ids.nowIso(),
  });
  return db.get('SELECT * FROM app_user WHERE id = ?', [id]);
}

before(async () => {
  wipe();
  db = await import('../../src/core/db/index.js');
  ids = await import('../../src/core/util/ids.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  const { initRbac } = await import('../../src/core/rbac/index.js');
  await initRbac();
  identity = await import('../../src/modules/identity/identity.js');
  remove = await import('../../src/core/lifecycle/remove.js');
  await db.insert('sector', { id: 'S_RM', name_ar: 'قطاع الفحص', active: 1, created_at: ids.nowIso() });
  adminUser = await mkUser(ADMIN, { role: 'admin', email: 'admin.rm@evc.sa', name: 'مدير النظام' });
  admin2User = await mkUser(ADMIN2, { role: 'admin', email: 'admin2.rm@evc.sa', name: 'مدير النظام الثاني' });
  staffUser = await mkUser(STAFF, { role: 'employee', email: 'staff.rm@evc.sa', name: 'موظف' });
});

after(async () => { await db.close(); wipe(); });

test('الحذف الناعم يقع فعلاً — ويُسجَّل في التدقيق بسببه ومَن نفّذه', async () => {
  await mkUser('u_rm_typo', { email: 'typo.rm@evc.sa', name: 'حساب أُنشئ بالخطأ' });
  const r = await identity.removeUser(ctxOf(adminUser), 'u_rm_typo', { reason: 'حساب مكرر لنفس الشخص' });
  assert.equal(r.ok, true);

  const row = await db.get('SELECT deleted_at, active FROM app_user WHERE id = ?', ['u_rm_typo']);
  assert.ok(row.deleted_at, 'لم يُختم الحساب بالحذف');
  assert.equal(Number(row.active), 0, 'حسابٌ محذوف بقي نشطاً — واستعلاماتٌ قائمة تختار بـ«نشط» وحدها');

  const a = await db.get(
    "SELECT user_id, action, detail_json FROM audit_log WHERE resource = 'app_user' AND action = 'delete' ORDER BY at DESC LIMIT 1");
  assert.ok(a, 'حذفٌ بلا أثر في التدقيق');
  assert.equal(a.user_id, ADMIN, 'الأثر لا يحمل اسم فاعله');
  assert.match(String(a.detail_json), /حساب أُنشئ بالخطأ/, 'الأثر لا يسمّي المحذوف');
  assert.match(String(a.detail_json), /حساب مكرر لنفس الشخص/, 'السبب النصّي لم يُسجَّل');
});

test('آخر مدير نظام نشط لا يُحذف — والرسالة تقول العدد الباقي', async () => {
  // بوجود مديرَين نشطَين: لا مانع من هذا الباب
  const check = await identity.userRemovalCheck(ctxOf(adminUser), ADMIN2);
  assert.equal(check.removable, true, 'مديرٌ ثانٍ عُدّ آخر مدير وهما اثنان');

  // نُعطّل الثاني، فيصير الأول وحده — ومحاولة حذفه تُردّ
  await db.run('UPDATE app_user SET active = 0 WHERE id = ?', [ADMIN2]);
  const solo = await db.get('SELECT * FROM app_user WHERE id = ?', [ADMIN2]);
  await assert.rejects(() => identity.removeUser(ctxOf(solo), ADMIN), (e) => {
    assert.match(e.message, /آخر مدير نظام/, 'المانع لم يُسمَّ');
    assert.match(e.message, /الباقون بعده: لا أحد/, 'الرسالة لا تقول العدد الباقي');
    return true;
  });
  assert.equal((await db.get('SELECT deleted_at FROM app_user WHERE id = ?', [ADMIN])).deleted_at, null,
    'حُذف آخر مدير نظام — والمنصة تبقى بلا من يديرها');
  await db.run('UPDATE app_user SET active = 1 WHERE id = ?', [ADMIN2]);
});

test('ولا أحد يحذف حسابه — من يحذف نفسه يقفل الباب وهو داخله', async () => {
  await assert.rejects(() => identity.removeUser(ctxOf(adminUser), ADMIN), /حسابك أنت/);
  assert.equal((await db.get('SELECT deleted_at FROM app_user WHERE id = ?', [ADMIN])).deleted_at, null);
  assert.ok(admin2User);
});

test('صاحبُ عملٍ حيّ يُمنع — والرسالة تسمّي المانع بعدده وتقول البديل', async () => {
  await mkUser('u_rm_busy', { email: 'busy.rm@evc.sa', name: 'صاحب عمل قائم' });
  await db.insert('project', {
    id: 'p_rm_1', name_ar: 'مشروع قائم', sector_id: 'S_RM', status: 'IN_PROGRESS',
    owner_user_id: 'u_rm_busy', created_at: ids.nowIso(),
  });
  await db.insert('task', {
    id: 't_rm_1', project_id: 'p_rm_1', title: 'مهمة مفتوحة', status: 'TODO',
    assignee_user_id: 'u_rm_busy', created_at: ids.nowIso(),
  });
  await db.insert('task', {
    id: 't_rm_done', project_id: 'p_rm_1', title: 'مهمة منجزة', status: 'DONE',
    assignee_user_id: 'u_rm_busy', created_at: ids.nowIso(),
  });

  // العاقبة تُعرض قبل الضغط — لا تُقال بعد الرفض
  const check = await identity.userRemovalCheck(ctxOf(adminUser), 'u_rm_busy');
  assert.equal(check.removable, false);
  assert.equal(check.blockers.length, 2, 'المهمة المنجزة عُدّت عملاً حيّاً، أو سقط مانع');
  assert.ok(check.blockers.some((b) => /مهمة مفتوحة واحدة/.test(b)), 'المهمة المفتوحة لم تُعدّ');
  assert.ok(check.blockers.some((b) => /مشروع قائم يملكه/.test(b)), 'المشروع المملوك لم يُعدّ');

  await assert.rejects(() => identity.removeUser(ctxOf(adminUser), 'u_rm_busy'), (e) => {
    assert.match(e.message, /مهمة مفتوحة واحدة/, 'المانع لم يُسمَّ بعدده');
    assert.match(e.message, /صاحب عمل قائم/, 'المانع لم يُسمَّ باسم الحساب');
    assert.match(e.message, /عطّل الحساب/, 'لم يُقترح البديل — والرفض بلا مخرج رسالةٌ عاجزة');
    return true;
  });
  assert.equal((await db.get('SELECT deleted_at FROM app_user WHERE id = ?', ['u_rm_busy'])).deleted_at, null);

  // ونقلُ العمل يفتح الحذف: هذا هو المخرج الذي تَعِد به الرسالة
  await db.run("UPDATE task SET assignee_user_id = ? WHERE id = 't_rm_1'", [STAFF]);
  await db.run("UPDATE project SET owner_user_id = ? WHERE id = 'p_rm_1'", [STAFF]);
  const after2 = await identity.userRemovalCheck(ctxOf(adminUser), 'u_rm_busy');
  assert.deepEqual(after2.blockers, [], 'بقي مانعٌ بعد نقل العمل — فالوعد في الرسالة كاذب');
  assert.equal((await identity.removeUser(ctxOf(adminUser), 'u_rm_busy')).ok, true);
});

// ── تحرير البريد ──
// شرطُ التعارض في الدعوة يستثني المحذوف فيبدو سليماً بالنظر — لكن تفرّد البريد في المخطط
// (قيدٌ على العمود وفهرسٌ فريد على lower(trim(email))) لا يستثنيه. فحذفٌ ناعم يترك العنوان
// محجوزاً، وأول دعوةٍ به تسقط بخطأٍ خام لا برسالة عربية. يُثبَت بالفحص لا بالنظر.
test('البريد يصير قابلاً لإعادة الاستعمال بعد الحذف — ولو بحالة أحرف مختلفة', async () => {
  await mkUser('u_rm_mail', { email: 'reuse.rm@evc.sa', name: 'صاحب العنوان الأول' });
  await identity.removeUser(ctxOf(adminUser), 'u_rm_mail', { reason: 'عنوان خاطئ' });

  const dead = await db.get('SELECT email FROM app_user WHERE id = ?', ['u_rm_mail']);
  assert.equal(dead.email, null, 'العنوان بقي محجوزاً على صفٍّ محذوف');
  const a = await db.get(
    "SELECT detail_json FROM audit_log WHERE resource = 'app_user' AND action = 'delete' AND resource_id = ? ORDER BY at DESC LIMIT 1",
    ['u_rm_mail']);
  assert.match(String(a.detail_json), /reuse\.rm@evc\.sa/, 'العنوان المحرَّر لم يُحفظ في الأثر');

  const r = await identity.inviteUser(ctxOf(adminUser), {
    email: 'Reuse.RM@evc.sa', name_ar: 'صاحب العنوان الجديد', role_id: 'employee',
  });
  assert.equal(r.ok, true);
  const fresh = await db.get('SELECT email, deleted_at FROM app_user WHERE id = ?', [r.id]);
  assert.equal(fresh.email, 'reuse.rm@evc.sa');
  assert.equal(fresh.deleted_at, null);
});

test('الجلسات تُقطع مع الحذف والرموز المعلَّقة تُحرق — وإلا بقي المحذوف داخلاً', async () => {
  await mkUser('u_rm_live', { email: 'live.rm@evc.sa', name: 'حساب بجلسة قائمة' });
  await db.insert('session', {
    id: ids.id('sess'), user_id: 'u_rm_live', created_at: ids.nowIso(),
    expires_at: new Date(Date.now() + 12 * 3600000).toISOString(), ip: '127.0.0.1',
  });
  const { hashPassword } = await import('../../src/core/auth/password.js');
  await db.insert('login_code', {
    id: ids.id('lc'), user_id: 'u_rm_live', code_hash: hashPassword('123456'), purpose: 'signin',
    expires_at: new Date(Date.now() + 600000).toISOString(), attempts: 0, created_at: ids.nowIso(),
  });

  await identity.removeUser(ctxOf(adminUser), 'u_rm_live');
  const live = await db.all('SELECT id FROM session WHERE user_id = ? AND revoked_at IS NULL', ['u_rm_live']);
  assert.equal(live.length, 0, 'جلسةٌ حيّة لحسابٍ محذوف');
  const codes = await db.all('SELECT id FROM login_code WHERE user_id = ? AND consumed_at IS NULL', ['u_rm_live']);
  assert.equal(codes.length, 0, 'رمزٌ في بريده يفتح ما حُذف');
});

test('المحذوف يختفي من القوائم والشاشة — ويبقى في سجل التدقيق', async () => {
  await mkUser('u_rm_gone', { email: 'gone.rm@evc.sa', name: 'حساب مُزال من القوائم' });
  await identity.removeUser(ctxOf(adminUser), 'u_rm_gone', { reason: 'تكرار' });

  const rows = await identity.listUsers(adminUser);
  assert.equal(rows.some((u) => u.id === 'u_rm_gone'), false, 'المحذوف ما زال يُعرض في قائمة الحسابات');

  const { usersPage } = await import('../../src/web/views/govern.js');
  const html = await usersPage(adminUser);
  assert.equal(html.includes('حساب مُزال من القوائم'), false, 'المحذوف ما زال ظاهراً على الشاشة');

  const trace = await db.all(
    "SELECT id FROM audit_log WHERE resource = 'app_user' AND resource_id = ?", ['u_rm_gone']);
  assert.ok(trace.length >= 1, 'الأثر التاريخي مُحي مع الحساب');
});

// والشاشة تُفرّق بين الفعلين قبل الضغط: زرّان متجاوران يفعلان شيئين مختلفين اختلافاً تاماً،
// ومن لا يقرأ الفرق يظن الحذف تعطيلاً أشدّ. وحساب الفاعل نفسه لا يُعرض له زرّ حذف أصلاً.
test('شاشة المستخدمين تعرض الحذف بجوار التعطيل وتُفرّق بينهما — ولا تعرضه على حساب الفاعل', async () => {
  await mkUser('u_rm_ui', { email: 'ui.rm@evc.sa', name: 'حساب لفحص الشاشة' });
  const { usersPage } = await import('../../src/web/views/govern.js');
  const html = await usersPage(adminUser);
  const i = html.indexOf('حساب لفحص الشاشة');
  assert.ok(i > 0);
  const row = html.slice(i, i + 1400);
  assert.ok(row.includes('تعطيل'), 'اختفى زرّ التعطيل');
  assert.ok(row.includes('حذف الحساب'), 'لا زرّ حذف في الشاشة — والقدرة بلا باب لا تُستعمل');
  assert.match(html, /التعطيل يُغلق الباب مؤقتاً/, 'الشاشة لا تشرح الفرق بين التعطيل والحذف');

  const selfAt = html.indexOf('مدير النظام</td>') > 0 ? html.indexOf('مدير النظام</td>') : html.indexOf('مدير النظام');
  const selfRow = html.slice(selfAt, selfAt + 900);
  assert.equal(selfRow.includes('data-action="idn-remove"'), false, 'عُرض زرّ حذف على حساب الفاعل نفسه');
});

test('ومن لا يملك الصلاحية يُردّ ٤٠٣ — لا من الشاشة بل من الخدمة', async () => {
  await mkUser('u_rm_target', { email: 'target.rm@evc.sa', name: 'هدف محاولة غير مصرَّح بها' });
  for (const call of [
    () => identity.removeUser(ctxOf(staffUser), 'u_rm_target'),
    () => identity.userRemovalCheck(ctxOf(staffUser), 'u_rm_target'),
  ]) {
    await assert.rejects(call, (e) => {
      assert.equal(e.status, 403, 'ردٌّ بغير ٤٠٣ على محاولة بلا صلاحية');
      assert.match(e.message, /مدير النظام/);
      return true;
    });
  }
  assert.equal((await db.get('SELECT deleted_at FROM app_user WHERE id = ?', ['u_rm_target'])).deleted_at, null);
});

test('وحذفُ حسابٍ لا وجود له أو محذوفٍ سابقاً يُردّ بوضوح لا بخطأٍ غامض', async () => {
  await assert.rejects(() => identity.removeUser(ctxOf(adminUser), 'u_rm_nope'), /غير موجود/);
  await assert.rejects(() => identity.removeUser(ctxOf(adminUser), 'u_rm_gone'), /غير موجود/);
});

test('والحارس الواحد يخدم الأنواع الثلاثة — الحساب في نفس مسار المشروع والفرصة', async () => {
  assert.ok(remove.REMOVABLE.user, 'الحساب ليس ضمن الحذف المحروس');
  assert.equal(remove.REMOVABLE.user.table, 'app_user');
  const b = await remove.removalBlockers('user', ADMIN, ctxOf(adminUser));
  assert.ok(b.some((x) => /حسابك أنت/.test(x)), 'فحصُ الموانع لا يرى حذف الذات');
});
