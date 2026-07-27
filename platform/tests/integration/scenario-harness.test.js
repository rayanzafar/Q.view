// حزمة مختصرة من مشغّل السيناريوهات، داخل الفحص الآلي.
//
// السبب: المشغّل (scripts/scenarios.mjs) يزرع بيانات لكل قطاع ولكل شخص، يجرّب الحالات على
// الشبكة الحقيقية، ثم يمحو ويُثبت النظافة. أداةٌ بهذه القيمة إن بقيت رهنَ من يتذكّر تشغيلها
// فهي غير موجودة عملياً: يكفي انحرافٌ واحد في خدمة ليكسر عشرين مساراً بلا أن يسمع أحد.
// هذا الملف يشغّل النسخة المختصرة (بلا مسح الصفحات لكل شخص — مغطّىً في permissions-matrix)
// ويؤكد ثلاثة أشياء لا رابع لها:
//   ① كل فحوص السيناريوهات نجحت (ومنها **تثبيت العيوب**: إن عولج عيبٌ سقط تثبيته وقال ذلك).
//   ② الإحصاء بعد المحو مطابقٌ لما قبل الزرع، صفاً صفاً وعموداً عموداً — عدا سجل التدقيق.
//   ③ نموّ سجل التدقيق منسوبٌ بالكامل إلى فاعلي التشغيل: التدقيق يبقى، ولا يُحذف منه شيء.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-scenario-harness.db');
process.env.SANAD_DB = TEST_DB;
process.env.SANAD_SCENARIOS = '1';   // وجهة صريحة ⟵ إعلان نية صريح، تماماً كما على سطر الأوامر

let out, db, seedMod;
const wipe = () => { for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); };

before(async () => {
  wipe();
  const harness = await import('../../scripts/scenarios.mjs');
  db = await import('../../src/core/db/index.js');
  seedMod = await import('../../scripts/seed.js');
  // يوم مثبَّت: كل تاريخ في الحزمة يُشتقّ منه، فلا يتغيّر الفحص بتغيّر يوم التشغيل.
  out = await harness.runHarness({ today: '2026-07-27', compact: true, log: () => {} });
});

after(async () => { await db?.close(); wipe(); });

test('scenarios: every assertion across every role and segment passes', () => {
  const failed = out.recorder.failed.map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  assert.deepEqual(failed, [], `فحوص فاشلة:\n${failed.join('\n')}`);
  assert.ok(out.recorder.passed.length > 200, `عدد الفحوص أقل مما ينبغي (${out.recorder.passed.length})`);
  const broken = out.recorder.scenarios.filter((s) => s.error).map((s) => `${s.key}: ${s.error}`);
  assert.deepEqual(broken, [], 'لا سيناريو انقطع في منتصفه');
});

test('scenarios: the known-defect pins still describe the live behaviour', () => {
  // العيوب لا تُصلَح هنا، لكنها **تُثبَّت**: تغيّر السلوك (بإصلاحٍ أو بانحدار) يسقط التثبيت
  // ويقول ذلك صراحةً بدل أن يمرّ صامتاً.
  // كانت تسعةً حين كُتبت، ثم عولج SCN-D1 (مستخلص يحمل مخرج مشروع قطاع آخر)، ثم SCN-D7 («مهام
  // فريقي» كانت مشروطة بمنح التعديل فيُرَدّ المدير المباشر ٤٠٣ على شاشته الوحيدة) — وكلٌّ منهما
  // تحوّل تثبيتُه إلى فحصٍ دائم داخل السيناريو نفسه. العدد ينزل بمقدار كل عيب يُعالَج، لا بمقدار
  // عيب يُنسى: من يُصلح عيباً يُنزل هذا الرقم في التغيير نفسه.
  assert.ok(out.recorder.defects.length >= 3,
    'قائمة العيوب المُثبَّتة تقلّصت بلا تحديث — عيبٌ أُصلح ولم يتحوّل تثبيتُه إلى تأكيد على السلوك الصحيح');
  const drifted = out.recorder.defects.filter((d) => !d.pinnedMatches).map((d) => `${d.id}: ${d.label}`);
  assert.deepEqual(drifted, [], `عيبٌ تغيّر سلوكه — حدّث التثبيت في scripts/scenarios.mjs:\n${drifted.join('\n')}`);
  for (const d of out.recorder.defects) {
    assert.match(d.ref, /^src\/.+:\d+$/, `${d.id} بلا موضع دقيق في الكود`);
    assert.ok(d.shouldBe && d.shouldBe.length > 20, `${d.id} بلا وصف للصواب`);
  }
});

test('purge: the census after the purge matches the census before seeding — row by row, column by column', () => {
  const residue = out.residue.map((d) => `${d.table}: +${d.added.length} / -${d.removed.length}`);
  assert.deepEqual(residue, [], `بقيت آثار بعد المحو:\n${residue.join('\n')}`);
  assert.ok(out.purge.deleted > 100, 'المحو لم يحذف شيئاً يُذكر — هل زُرعت البيانات أصلاً؟');
  assert.deepEqual(out.purge.blocked, [], 'حذوفات تعذّرت وبقيت');
});

test('purge: soft-deleted rows are purged too — a deleted_at flag is not proof of removal', () => {
  // سيناريو «الحذف الناعم» يحذف موظفاً حذفاً ناعماً؛ الصف يبقى في الجدول بعلامة حذف. لو كان
  // الإحصاء يرشّح `deleted_at IS NULL` لأعلن النظافة والصف قائم. هنا نتأكد أن الجدول عاد إلى
  // عدده الأصلي **بلا ترشيح**، أي أن الصف المحذوف ناعماً مُحي فعلاً في المحو.
  const emp = out.diffs.find((d) => d.table === 'employee');
  assert.equal(emp, undefined, 'جدول الموظفين لم يعد كما كان');
});

test('audit: the trail grew, is fully attributable, and nothing was deleted from it', () => {
  assert.ok(out.auditAdded.length > 50, `سطور التدقيق قليلة جداً (${out.auditAdded.length}) — هل تُدقَّق الكتابات؟`);
  const actors = new Set(seedMod.DEMO_USERS.map((u) => u.u));
  const strays = out.auditAdded.filter((r) => !actors.has(r.username)).map((r) => `${r.username}:${r.action}`);
  assert.deepEqual(strays, [], 'سطر تدقيق غير منسوب إلى فاعل من فاعلي التشغيل');
  const auditDiff = out.diffs.find((d) => d.table === 'audit_log');
  assert.equal(auditDiff?.removed.length ?? 0, 0, 'سجل التدقيق لا يُحذف منه شيء — ولو كان تدقيق تجربة');
  // الكتابات الأساسية كلها مدقَّقة: إنشاء ومشروع وفرصة ومهمة ووقت واعتماد
  const kinds = new Set(out.auditAdded.map((r) => `${r.action}:${r.resource}`));
  for (const k of ['create:opportunity', 'create:project', 'create:task', 'create:timesheet',
    'create:employee', 'create:allocation', 'approve:approval', 'login:session'])
    assert.ok(kinds.has(k), `لا سطر تدقيق من نوع ${k}`);
});

test('regression: a MUTATED pre-existing row is restored, never deleted (login bookkeeping)', async () => {
  // العطل الذي كُشف أثناء بناء المشغّل: المحو كان يقارن **بالمحتوى**، فيقرأ صفَّ حسابٍ تغيّر
  // فيه «آخر دخول» صفاً جديداً ويحذفه — فيخرج التشغيل وقد محا ستة عشر حساباً من حسابات العرض.
  // التمييز الآن بالمعرّف: الجديد يُحذف، والقائم المتغيّر يُرجَع إلى حالته.
  const users = await db.all('SELECT username, last_login_at, employee_id FROM app_user ORDER BY username');
  assert.equal(users.length, seedMod.DEMO_USERS.length, 'حسابات العرض السبعة عشر كلها باقية بعد المحو');
  assert.deepEqual(users.filter((u) => u.last_login_at).map((u) => u.username), [],
    'ولا أثر لتسجيل الدخول عليها — أُرجعت إلى حالتها قبل التشغيل');
  assert.ok(out.purge.restored.length > 0, 'خطوة الإرجاع نُفِّذت فعلاً وذُكرت في التقرير');
});

test('guard: a database holding one unmarked business row is refused BEFORE any write or delete', async () => {
  // الطبقة الأخيرة من الحارس تُفحص على قاعدة حقيقية: صفٌّ واحد باسم لا يحمل وسم التجربة يعني
  // أن القاعدة ليست قاعدة رمي — والمشغّل يمحو، فالرفض يجب أن يقع **قبل** أول كتابة.
  const harness = await import('../../scripts/scenarios.mjs');
  await db.insert('client', { id: 'GUARD-REAL-1', name_ar: 'أمانة العاصمة المقدسة', active: 1,
    created_at: '2026-01-01T00:00:00Z' });
  await assert.rejects(() => harness.runHarness({ today: '2026-07-27', compact: true, log: () => {} }),
    /بيانات لم يُنشئها هذا المشغّل/);
  // ولم يُلمَس شيء: الصف المدسوس وحده في الجدول، ولا قطاع ولا موظف زُرع
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM client')).n), 1, 'لم يُزرع عميل واحد بعد الرفض');
  assert.equal(Number((await db.get('SELECT COUNT(*) n FROM sector')).n), 0, 'ولا قطاع');
  await db.run('DELETE FROM client WHERE id = ?', ['GUARD-REAL-1']);
});

test('regression: nothing the scenarios created survives — no orphan business row of any kind', async () => {
  for (const table of ['sector', 'department', 'employee', 'client', 'opportunity', 'project',
    'contract', 'invoice', 'collection', 'task', 'time_entry', 'timesheet_period', 'allocation',
    'deliverable', 'approval_request', 'approval_action', 'notification', 'session', 'login_history',
    'revenue_line', 'invoice_line', 'opportunity_stage_history', 'stage']) {
    const n = Number((await db.get(`SELECT COUNT(*) n FROM ${table}`)).n);
    assert.equal(n, 0, `${table} بقي فيه ${n} صفاً بعد المحو`);
  }
});
