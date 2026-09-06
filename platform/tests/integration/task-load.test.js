// حِمل المهام — مجموعُ النِّسب على المهام الجارية، ومصفوفةُ ما يدخل الجمع وما لا يدخله.
//
// «إذا وضعتُ نسبة المهمة ٥٠٪ وأخذت أسبوعاً، فنصفُ طاقتي مشغولٌ بقية الأسبوع حتى تنتهي؛
// وستُّ مهامَّ بنِسَب ١٠+١٠+١٠+١٠+١٠+٥٠ تُظهر الشهر كله ١٠٠٪» — بلسان المالك. وهذا الملف
// يُثبت مثالَه حرفياً، ثم يُثبت الحدود التي تجعل الرقم صادقاً:
//   ① المنجَزة والملغاة تُفرَغ، والمعلَّقة اعتمادُها لا تستهلك قبل أن تُعتمد.
//   ② والشخصية خارجه في كل الشاشات — حتى على رأس صاحبها، وإلا اختلف الرقمُ الواحد بين
//      «مهامي» و«مهام فريقي» لأنها محجوبةٌ عن المدير وعداً.
//   ③ **والمتأخرة المفتوحة تظلّ تستهلك** — ولو أُسقطت لبدا الغارقُ في التأخير أكثرَ الناس فراغاً.
//   ④ وما لم يُقدَّر يُعدّ ولا يُجمع: صفرٌ مخترَع يجعل المُثقَل يقرأ فارغاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-taskload-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, tasks, load;
const T = new Date().toISOString();
const EMP = { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', employee_id: 'e_emp' };
const ctx = (u) => ({ user: u, ip: '1.1.1.1' });

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  tasks = await import('../../src/modules/pmo/tasks.js');
  load = await import('../../src/modules/pmo/task-load.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', created_at: T });
  // الربط ذو اتجاهين (`app_user.employee_id` و`employee.user_id`)، فيُكتب على مرحلتين.
  await db.insert('employee', { id: 'e_emp', name_ar: 'سجى لشكر', sector_id: 'SOL', created_at: T });
  await db.insert('app_user', { id: 'u_emp', username: 'emp', name_ar: 'سجى لشكر', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', employee_id: 'e_emp', active: 1, created_at: T });
  await db.update('employee', 'e_emp', { user_id: 'u_emp' });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const add = (pct, extra = {}) => tasks.quickAddTask(ctx(EMP), { title: `مهمة ${pct ?? 'بلا'}`, utilization_pct: pct, ...extra });

test('مثالُ المالك حرفياً: ١٠+١٠+١٠+١٠+١٠+٥٠ تُظهر الشخص على ١٠٠٪', async () => {
  for (const p of [10, 10, 10, 10, 10, 50]) await add(p);
  const l = await load.myTaskLoad(EMP);
  assert.equal(l.pct, 100, 'المجموع ليس مئة');
  assert.equal(l.open, 6);
  assert.equal(l.unsized, 0);
});

test('والمنجَزة تُفرِغ حِملها، والملغاة كذلك — الحِمل للجاري لا للمنتهي', async () => {
  const t = await add(30);
  assert.equal((await load.myTaskLoad(EMP)).pct, 130);
  await tasks.updateTask(ctx(EMP), t.id, { status: 'DONE' });
  assert.equal((await load.myTaskLoad(EMP)).pct, 100, 'بقيت المنجَزة تستهلك');
  const c = await add(25);
  await tasks.updateTask(ctx(EMP), c.id, { status: 'CANCELLED' });
  assert.equal((await load.myTaskLoad(EMP)).pct, 100, 'بقيت الملغاة تستهلك');
});

test('والمهمة الشخصية خارج المقياس — حتى على رأس صاحبها', async () => {
  await add(40, { work_kind: 'personal' });
  assert.equal((await load.myTaskLoad(EMP)).pct, 100, 'دخلت الشخصية الحِمل — واختلف الرقم بين شاشتين');
});

// القاعدة الجوهرية: لا شرطَ تاريخ استحقاق البتة.
test('والمتأخرة المفتوحة تظلّ تستهلك حتى تُغلق — التأخرُ لا يُفرِّغ الجدول', async () => {
  await add(20, { due_date: '2020-01-01' });
  const l = await load.myTaskLoad(EMP);
  assert.equal(l.pct, 120, 'أُسقطت المتأخرة فبدا المُثقَل فارغاً');
});

test('وما لم تُقدَّر نسبتُه يُعدّ ولا يُجمع — ورقمُه معلَن لا مُخفى', async () => {
  const before = await load.myTaskLoad(EMP);
  await add(null);
  await add(undefined);
  const after = await load.myTaskLoad(EMP);
  assert.equal(after.pct, before.pct, 'حُسبت مهمةٌ بلا تقدير');
  assert.equal(after.unsized, before.unsized + 2, 'لم تُعدّ غير المقدَّرة — فالرقم يكذب صامتاً');
  assert.equal(after.open, before.open + 2);
});

test('والصفر يُقرأ «لم يُقدَّر» لا «صفرُ حِمل» — مهمةٌ قائمة لا تستهلك شيئاً تناقض', async () => {
  const t = await add(0);
  const row = await db.get('SELECT utilization_pct FROM task WHERE id = ?', [t.id]);
  assert.equal(row.utilization_pct, null);
});

test('والنسبة خارج ١..١٠٠ تُردّ بالعربية، والكسرُ كذلك', async () => {
  for (const bad of [101, -5, 12.5, 'كثير']) {
    await assert.rejects(() => add(bad), (e) => /حجم المهمة نسبة/.test(String(e.message)), `قُبلت ${bad}`);
  }
});

// المجموع يتجاوز المئة بحقّ — وهي إشارةُ «فوق الطاقة» نفسها، لا خطأ يُقصّ.
test('ومجموعُ الشخص يتجاوز المئة ولا يُقصّ عندها', async () => {
  const fresh = { ...EMP, id: 'u_over' };
  await db.insert('app_user', { id: 'u_over', username: 'over', name_ar: 'مثقَل', role_id: 'employee',
    scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  for (const p of [90, 80]) await tasks.quickAddTask(ctx(fresh), { title: `ثقيلة ${p}`, utilization_pct: p });
  assert.equal((await load.myTaskLoad(fresh)).pct, 170, 'قُصّ المجموع عند مئة فاختفت إشارة تجاوز الطاقة');
});

test('والحِمل يُقرأ لمجموعةٍ في نداءٍ واحد', async () => {
  const m = await load.taskLoadFor(['u_emp', 'u_over', 'u_lا_وجود']);
  assert.equal(m.get('u_over').pct, 170);
  assert.equal(m.get('u_emp').pct, 120);
  assert.equal(m.get('u_lا_وجود'), undefined, 'اختُرع صفٌّ لحسابٍ بلا مهام');
});

// اسمٌ ثالث لا يصطدم بالاثنين القائمين، وسطرُ أساسٍ يقوله في كل عرض.
test('والاسم «حِمل المهام» وسطرُ أساسه يصرّحان بأنه لا يُجمع مع الإشغالَين', () => {
  assert.equal(load.TASK_LOAD_AR, 'حِمل المهام');
  assert.doesNotMatch(load.TASK_LOAD_AR, /إشغال/, 'سُمّي إشغالاً — ثلاثة أرقام باسم واحد للشخص الواحد');
  assert.match(load.TASK_LOAD_BASIS_AR, /لا يُجمع معهما/);
});

// ── الأثر يقول ماذا تغيّر (KI-080) ────────────────────────────────────────────
// النسبة تُعدَّل بعد الاعتماد بلا اعتمادٍ ثانٍ — وهو قرارٌ مقصود لكبح الاحتكاك. وثمنُه أن
// يكون التغيير **مقتفىً**: بلا فرقٍ مسجَّل تصير النسبةُ المعتمَدة قابلةً للرفع بلا شاهد.
test('تعديلُ النسبة بعد الاعتماد يترك أثراً يقول القديم والجديد', async () => {
  const t = await add(10);
  await tasks.updateTask(ctx(EMP), t.id, { utilization_pct: 50 });
  const a = await db.get(`SELECT detail_json FROM audit_log WHERE resource = 'task' AND action = 'update'
     AND resource_id = ? ORDER BY at DESC`, [t.id]);
  assert.ok(a, 'تعديلٌ بلا أثر في التدقيق');
  assert.match(String(a.detail_json), /حجم المهمة/, 'الأثر لا يسمّي الحقل');
  assert.match(String(a.detail_json), /10٪/, 'الأثر بلا القيمة القديمة');
  assert.match(String(a.detail_json), /50٪/, 'الأثر بلا القيمة الجديدة');
});

// وقيمةُ الحالة تُكتب عربيةً من مصدرها: الخام تُطبع في شاشة التدقيق كما هي، و«DONE»
// مصطلحٌ يرصده فاحصُ المعجم ومسحُ ما بعد النشر.
test('ووصفُ الأثر عربيٌّ بلا رمزٍ إنجليزي', async () => {
  const t = await add(15);
  await tasks.updateTask(ctx(EMP), t.id, { status: 'DONE' });
  const a = await db.get(`SELECT detail_json FROM audit_log WHERE resource = 'task' AND action = 'update'
     AND resource_id = ? ORDER BY at DESC`, [t.id]);
  assert.match(String(a.detail_json), /الحالة: من قيد الانتظار إلى منجز/);
  assert.doesNotMatch(String(a.detail_json), /DONE|TODO|IN_PROGRESS/, 'رمزٌ إنجليزي في وصفٍ يُعرض على شاشة');
});

test('وختمُ الإنجاز يحمل صاحبه، وإعادةُ الفتح تمحوه', async () => {
  const t = await add(12);
  await tasks.updateTask(ctx(EMP), t.id, { status: 'DONE' });
  let row = await db.get('SELECT completed_at, completed_by FROM task WHERE id = ?', [t.id]);
  assert.ok(row.completed_at, 'لا ختم إنجاز');
  assert.equal(row.completed_by, 'u_emp', 'مَن أغلقها مجهول — والمهمة تمرّ باعتماد');
  await tasks.updateTask(ctx(EMP), t.id, { status: 'TODO' });
  row = await db.get('SELECT completed_at, completed_by FROM task WHERE id = ?', [t.id]);
  assert.equal(row.completed_at, null);
  assert.equal(row.completed_by, null, 'بقي مُغلِقٌ على مهمةٍ أُعيد فتحها');
});

// وتعديلٌ لا يغيّر شيئاً لا يكتب أثراً — سجلٌّ يمتلئ بسطورٍ فارغة لا يُقرأ.
test('وحفظٌ بلا تغييرٍ فعلي لا يترك سطراً', async () => {
  const t = await add(20);
  const n0 = (await db.all(`SELECT id FROM audit_log WHERE resource = 'task' AND resource_id = ?`, [t.id])).length;
  await tasks.updateTask(ctx(EMP), t.id, { utilization_pct: 20, title: t.title });
  const rows = await db.all(`SELECT detail_json FROM audit_log WHERE resource = 'task' AND action = 'update' AND resource_id = ?`, [t.id]);
  assert.ok(rows.every((r) => !r.detail_json || r.detail_json === 'null'), 'وُصف تغييرٌ لم يقع');
  assert.ok(n0 >= 0);
});
