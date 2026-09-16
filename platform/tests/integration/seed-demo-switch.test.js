// مفتاح إطفاء بذور العرض يعني **إطفاءها**: لا إنشاءً ولا إحياءً.
//
// وقع هذا على بيئة حيّة قبل الإطلاق: أُغلقت حسابات العرض الثمانية عشر عبر خدمة الهوية، ثم
// أعادها أوّلُ نشرٍ تالٍ نشطةً. السبب أن `seed-roles.js` يُشغَّل في كل إقلاع بلا نظرٍ إلى
// SANAD_SEED_DEMO، وكتابته `ON CONFLICT … DO UPDATE SET … active = EXCLUDED.active` **تُعيد
// التفعيل** لا تُنشئ فقط.
//
// وأخطر ما فيه أنه صامت: لا أحد يعيد فتح تلك الحسابات، ولا أحد يعلم أنها فُتحت. وحسابٌ
// تجريبي نشطٌ يوم الإطلاق ليس عيباً في العرض بل بابُ دخولٍ لم يُغلَق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-demoswitch-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let seedRoles, db;
const quiet = () => {};

before(async () => {
  ({ seedRoles } = await import('../../scripts/seed-roles.js'));
  db = await import('../../src/core/db/index.js');
});

after(() => { delete process.env.SANAD_SEED_DEMO; rmSync(dir, { recursive: true, force: true }); });

test('مع المفتاح مطفأً: لا يُنشأ حساب عرض واحد', async () => {
  process.env.SANAD_SEED_DEMO = '0';
  const r = await seedRoles({ apply: true, log: quiet });
  assert.equal(r.applied, false, 'كتب شيئاً وبذور العرض مطفأة');
  assert.equal(r.skipped, 'demo-off');
  const n = await db.get("SELECT COUNT(*) n FROM app_user WHERE username LIKE 'demo.%'");
  assert.equal(Number(n.n), 0, 'أُنشئت حسابات عرض رغم إطفاء المفتاح');
});

test('وبلا المفتاح: تُنشأ كما كانت — الإطفاء اختيارٌ لا تعطيلٌ للأداة', async () => {
  delete process.env.SANAD_SEED_DEMO;
  const r = await seedRoles({ apply: true, log: quiet });
  assert.notEqual(r.skipped, 'demo-off', 'تخطّى وبذور العرض مشغّلة');
  const n = await db.get("SELECT COUNT(*) n FROM app_user WHERE username LIKE 'demo.%'");
  assert.ok(Number(n.n) > 0, 'لم تُنشأ حسابات العرض في الوضع الطبيعي');
});

// هذا هو جوهر العيب: الإنشاء لم يكن المشكلة، بل **إعادة التفعيل**.
test('والأهم: حساب عرضٍ أُغلق عمداً لا يُعاد تفعيله عند الإقلاع التالي', async () => {
  delete process.env.SANAD_SEED_DEMO;
  await seedRoles({ apply: true, log: quiet });
  const one = await db.get("SELECT id FROM app_user WHERE username LIKE 'demo.%' LIMIT 1");
  assert.ok(one, 'لا حساب عرض لفحصه');
  // إغلاقٌ عمدي بختمه، كما تفعله خدمة الهوية
  await db.run('UPDATE app_user SET active = 0, deactivated_at = ? WHERE id = ?', [new Date().toISOString(), one.id]);

  process.env.SANAD_SEED_DEMO = '0';
  await seedRoles({ apply: true, log: quiet });   // الإقلاع التالي
  const after = await db.get('SELECT active, deactivated_at FROM app_user WHERE id = ?', [one.id]);
  assert.equal(Number(after.active), 0, 'أُعيد تفعيل حسابٍ أُغلق عمداً — بابُ دخولٍ يُفتح بلا قرار');
  assert.ok(after.deactivated_at, 'مُحي ختم الإغلاق');
});

// ── الحدّ الذي لا يعتمد على البيئة ──
// الحارس البيئي صحيحٌ ولا يكفي: تبيّن على الخادم الحيّ أنه **لا يبلغ العملية** — عملت البذرة
// والمفتاح مضبوط، فعادت سبعة حسابات نشطةً بعد إغلاقها، ثلاث مرات. فالقرار يُقرأ من البيانات:
// ختمُ الإغلاق يمنع الإحياء مهما كانت البيئة. اختبارٌ **بلا المفتاح إطلاقاً** يثبّت ذلك.
test('وحتى بلا المفتاح: ختمُ الإغلاق وحده يمنع الإحياء', async () => {
  delete process.env.SANAD_SEED_DEMO;
  await seedRoles({ apply: true, log: quiet });
  const rows = await db.all("SELECT id FROM app_user WHERE username LIKE 'demo.%'");
  assert.ok(rows.length >= 2, 'حسابات عرض غير كافية للفحص');
  const closed = rows[0].id, open = rows[1].id;
  const stamp = new Date().toISOString();
  await db.run('UPDATE app_user SET active = 0, deactivated_at = ? WHERE id = ?', [stamp, closed]);
  await db.run('UPDATE app_user SET active = 0, deactivated_at = NULL WHERE id = ?', [open]);

  await seedRoles({ apply: true, log: quiet });   // بلا أي مفتاح بيئة

  const a = await db.get('SELECT active, deactivated_at FROM app_user WHERE id = ?', [closed]);
  assert.equal(Number(a.active), 0, 'أُحيي حسابٌ يحمل ختم إغلاق — والبذرة لا تنقض قرار إنسان');
  assert.equal(a.deactivated_at, stamp, 'مُسّ ختم الإغلاق');
  const b = await db.get('SELECT active FROM app_user WHERE id = ?', [open]);
  assert.equal(Number(b.active), 1, 'حسابٌ بلا ختم لم يُهيَّأ — البذرة عطّلت نفسها بالكامل');
});
