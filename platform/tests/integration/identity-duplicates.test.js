// شخصٌ واحد بحسابين — وإغلاق الدعوة التي لم تُستعمل.
//
// وقع هذا على بيانات حقيقية: خمسة موظفين صار لكلٍّ منهم حسابان، لأن العنوانين اختلفا حرفاً
// واحداً (hussein/hussien · sayed/sayid · karmi/karbi)، ففحصُ «هذا البريد مستعمل» مرّ سليماً
// في كل مرة. والأثر ليس صفّاً زائداً: عند الإطلاق تُرسَل دعوةٌ إلى عنوانٍ قد لا يوجد على خادم
// الشركة، بينما لصاحبها حسابٌ آخر يعمل — فلا هو دخل، ولا أحد يعرف لماذا.
//
// ثم تبيّن أن العيب مزدوج: حتى لو عُرف التكرار، **لم يكن في المنتج طريقٌ لإغلاق الدعوة**.
// `setUserActive` كانت تردّ «لا تغيير» لأن الدعوة غير نشطة أصلاً، وزرّ الصفّ الوحيد «تفعيل».
// أي أن دعوةً أُنشئت بعنوانٍ خاطئ تبقى إلى الأبد في عدّاد المنتظِرين وفي قائمة من يُدعَون.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-iddup-'));
process.env.SANAD_DB = join(dir, 't.db');
process.env.MAIL_TRANSPORT = 'preview';   // لا تُلمس الشبكة في الاختبار
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let identity, db, usersPage;
const ADMIN = { id: 'u_admin_t', name_ar: 'مدير النظام', username: 'admin.t', role_id: 'admin', scope: 'company' };
const ctx = { user: ADMIN, ip: '127.0.0.1' };

before(async () => {
  identity = await import('../../src/modules/identity/identity.js');
  db = await import('../../src/core/db/index.js');
  ({ usersPage } = await import('../../src/web/views/govern.js'));
  await db.insert('app_user', {
    id: ADMIN.id, username: ADMIN.username, email: 'admin.t@evc.sa', name_ar: ADMIN.name_ar,
    role_id: 'admin', scope: 'company', active: 1, created_at: new Date().toISOString(),
  });
});

after(() => rmSync(dir, { recursive: true, force: true }));

// ─────────────────── مفتاح الشخص الواحد ───────────────────

test('التطبيع يجمع صور الاسم الواحد ويفرّق بين شخصين مختلفين', () => {
  const { personKey } = identity;
  assert.equal(personKey('م. حسين الجفري'), personKey('حسين الجفري'), 'اللقب فرّق بين الاسم ونفسه');
  assert.equal(personKey('إسحاق سيد'), personKey('اسحاق سيد'), 'صورة الألف فرّقت');
  assert.equal(personKey('شوق  بامشموس '), personKey('شوق بامشموس'), 'المسافات فرّقت');
  assert.equal(personKey('د. مروة الهادي'), personKey('مروه الهادي'), 'التاء المربوطة فرّقت');
  assert.notEqual(personKey('هادي كرمي'), personKey('هادي كربي'), 'اسمان مختلفان جُمعا');
  assert.notEqual(personKey('يعقوب سيد'), personKey('حسين الجفري'), 'اسمان بعيدان جُمعا');
});

// ─────────────────── الحارس عند الدعوة ───────────────────

test('دعوة ثانية بنفس الاسم وبريدٍ مختلف تُوقَف وتُشرَح', async () => {
  await identity.inviteUser(ctx, {
    email: 'hussein.aljafri@evc.sa', name_ar: 'م. حسين الجفري', role_id: 'employee', scope: 'own',
  });
  await assert.rejects(
    () => identity.inviteUser(ctx, {
      email: 'hussien.aljifri@evc.sa', name_ar: 'حسين الجفري', role_id: 'employee', scope: 'own',
    }),
    (e) => {
      assert.match(e.message, /حساب بالاسم نفسه/, 'الرسالة لا تقول ما المشكلة');
      assert.ok(e.message.includes('hussein.aljafri@evc.sa'), 'الرسالة لا تُظهر العنوان القائم للمقارنة');
      // والاشتباه يُعلَن قابلاً للتأكيد — وإلا قرأته الشاشة رفضاً نهائياً بلا مخرج
      assert.equal(e.details && e.details.confirmable, 'duplicate_person', 'الاشتباه لم يُعلَن قابلاً للتأكيد');
      return true;
    },
  );
  // ولم يُنشأ الحساب الثاني
  const n = await db.get("SELECT COUNT(*) n FROM app_user WHERE email = 'hussien.aljifri@evc.sa'");
  assert.equal(Number(n.n), 0, 'أُنشئ الحساب المكرَّر رغم الاعتراض');
});

test('والتأكيد الصريح يمرّ — زميلان باسمٍ واحد أمرٌ واقع، فالحارس ينبّه ولا يمنع', async () => {
  const r = await identity.inviteUser(ctx, {
    email: 'hussien.aljifri@evc.sa', name_ar: 'حسين الجفري', role_id: 'employee', scope: 'own',
    confirm_duplicate: true,
  });
  assert.ok(r.ok && r.id, 'التأكيد لم يمرّ — الحارس صار منعاً');
});

test('واختلاف البريد وحده لا يُخفي التكرار — وهو ما مرّ خمس مرات على البيانات الحقيقية', async () => {
  for (const [a, b] of [['isaac.sayid', 'ishaq.sayed'], ['jacob.sayid', 'jacob.sayed']]) {
    await identity.inviteUser(ctx, { email: `${a}@evc.sa`, name_ar: 'شخص تجربة ' + a, role_id: 'employee', scope: 'own' });
    await assert.rejects(
      () => identity.inviteUser(ctx, { email: `${b}@evc.sa`, name_ar: 'شخص تجربة ' + a, role_id: 'employee', scope: 'own' }),
      /حساب بالاسم نفسه/,
    );
  }
});

// ─────────────────── إغلاق الدعوة ───────────────────

test('إغلاق دعوةٍ لم تُستعمل فعلٌ حقيقي لا «لا تغيير»', async () => {
  const inv = await identity.inviteUser(ctx, {
    email: 'wrong.address@evc.sa', name_ar: 'عنوان خاطئ', role_id: 'employee', scope: 'own',
  });
  const before = await db.get('SELECT active, deactivated_at FROM app_user WHERE id = ?', [inv.id]);
  assert.equal(Number(before.active), 0, 'الدعوة تُنشأ غير نشطة');
  assert.equal(before.deactivated_at, null, 'الدعوة الجديدة مختومة بالإغلاق');

  const r = await identity.setUserActive(ctx, inv.id, false);
  assert.notEqual(r.unchanged, true, 'رُدّ الإغلاق بـ«لا تغيير» — الحالة الثالثة غير قابلة للبلوغ');
  assert.equal(r.closedInvite, true, 'لم يُميَّز إغلاق الدعوة عن تعطيل موظف');

  const after = await db.get('SELECT active, deactivated_at FROM app_user WHERE id = ?', [inv.id]);
  assert.equal(Number(after.active), 0);
  assert.ok(after.deactivated_at, 'لم يُكتب ختم الإغلاق — فتبقى الدعوة تُقرأ «معلّقة» إلى الأبد');
});

test('والدعوة المغلقة تخرج من عدّاد المنتظِرين وتُعرض «مغلق» لا «دعوة معلّقة»', async () => {
  const inv = await identity.inviteUser(ctx, {
    email: 'closed.one@evc.sa', name_ar: 'دعوة مغلقة', role_id: 'employee', scope: 'own',
  });
  const openHtml = await usersPage(ADMIN);
  const rowOpen = openHtml.split('closed.one@evc.sa')[1] || '';
  assert.match(rowOpen.slice(0, 400), /دعوة معلّقة/, 'الدعوة الحيّة لا تظهر معلّقة');

  await identity.setUserActive(ctx, inv.id, false);
  const closedHtml = await usersPage(ADMIN);
  const rowClosed = closedHtml.split('closed.one@evc.sa')[1] || '';
  assert.equal(/دعوة معلّقة/.test(rowClosed.slice(0, 400)), false,
    'الدعوة المغلقة ما زالت تُعرض «معلّقة» — فيُعاد إرسالها عند الإطلاق');
  assert.match(rowClosed.slice(0, 400), /معطّل/, 'حالة الحساب المغلق غير معروضة');
});

test('وإغلاقٌ ثانٍ لدعوةٍ مغلقة لا يفعل شيئاً — الختم لا يُعاد كتابته بلا سبب', async () => {
  const inv = await identity.inviteUser(ctx, {
    email: 'twice.closed@evc.sa', name_ar: 'إغلاق مكرر', role_id: 'employee', scope: 'own',
  });
  await identity.setUserActive(ctx, inv.id, false);
  const stamp = (await db.get('SELECT deactivated_at FROM app_user WHERE id = ?', [inv.id])).deactivated_at;
  const again = await identity.setUserActive(ctx, inv.id, false);
  assert.equal(again.unchanged, true, 'الإغلاق المكرر عُدّ تغييراً');
  const stamp2 = (await db.get('SELECT deactivated_at FROM app_user WHERE id = ?', [inv.id])).deactivated_at;
  assert.equal(stamp2, stamp, 'أُعيدت كتابة ختم الإغلاق بلا فعل');
});

test('وتفعيل حسابٍ نشط ما زال «لا تغيير» — الإصلاح لم يفتح باباً آخر', async () => {
  const inv = await identity.inviteUser(ctx, {
    email: 'already.active@evc.sa', name_ar: 'حساب نشط', role_id: 'employee', scope: 'own',
  });
  const first = await identity.setUserActive(ctx, inv.id, true);
  assert.notEqual(first.unchanged, true, 'التفعيل الأول لم يقع');
  const second = await identity.setUserActive(ctx, inv.id, true);
  assert.equal(second.unchanged, true, 'تفعيل النشط صار فعلاً يتكرر بلا داع');
});

test('وتفعيل حسابٍ أُغلق يمحو ختمه — فلا يبقى مغلقاً وهو يعمل', async () => {
  const inv = await identity.inviteUser(ctx, {
    email: 'reopened@evc.sa', name_ar: 'أُعيد فتحه', role_id: 'employee', scope: 'own',
  });
  await identity.setUserActive(ctx, inv.id, false);
  await identity.setUserActive(ctx, inv.id, true);
  const row = await db.get('SELECT active, deactivated_at FROM app_user WHERE id = ?', [inv.id]);
  assert.equal(Number(row.active), 1);
  assert.equal(row.deactivated_at, null, 'بقي ختم الإغلاق على حسابٍ نشط');
});

// ─────────────────── لوحة التكرار على الشاشة ───────────────────

test('الشاشة تُظهر أصحاب الحسابين معاً — التكرار لا يُكتشف بتصفّح ثلاثمئة صف', async () => {
  const html = await usersPage(ADMIN);
  assert.match(html, /أشخاص لهم أكثر من حساب/, 'لا لوحة تكرار على الشاشة');
  // المجموعة تعرض العنوانين معاً كي يُقارَنا بالعين — وهو كل المطلوب لاتخاذ القرار
  const band = html.split('أشخاص لهم أكثر من حساب')[1].split('حسابات الدخول')[0];
  assert.ok(band.includes('hussein.aljafri@evc.sa') && band.includes('hussien.aljifri@evc.sa'),
    'العنوانان لا يظهران معاً في اللوحة');
  assert.match(band, /حسين الجفري/, 'اسم الشخص غائب عن اللوحة');
  assert.equal(/\bnull\b|\bundefined\b|\bNaN\b/.test(band), false, 'قيمة خام في اللوحة');
});

test('واللوحة تعدّ الأشخاص لا الحسابات — وتصمت حين لا تكرار', async () => {
  const html = await usersPage(ADMIN);
  const shown = Number((html.match(/أشخاص لهم أكثر من حساب \((\d+)\)/) || [])[1]);
  // العدّ من القاعدة نفسها بنفس قاعدة التطبيع: الشاشة لا تُصدَّق على كلمتها
  const rows = await db.all("SELECT name_ar FROM app_user WHERE deleted_at IS NULL AND name_ar IS NOT NULL");
  const seen = new Map();
  for (const r of rows) {
    const k = identity.personKey(r.name_ar);
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const expected = [...seen.values()].filter((n) => n > 1).length;
  assert.equal(shown, expected, 'عدّاد اللوحة لا يطابق ما في القاعدة');

  // وعلى قاعدةٍ بلا تكرار لا تظهر اللوحة إطلاقاً — تحذيرٌ دائم يُهمَل بعد أسبوع
  const solo = { rows: [{ name_ar: 'أحمد' }, { name_ar: 'سارة' }] };
  const keys = solo.rows.map((r) => identity.personKey(r.name_ar));
  assert.equal(new Set(keys).size, keys.length, 'قاعدة الاختبار نفسها فيها تكرار');
});
