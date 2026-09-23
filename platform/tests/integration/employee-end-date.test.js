// تاريخ انتهاء خدمة الموظف (الموجة 008) — الطرف المقابل لتاريخ التعيين.
// الاختبار يجري على قاعدة **مُرحَّلة سلفاً وعامرة** لا على قاعدة جديدة فارغة: القاعدة الحيّة
// اليوم عليها 001…007 وفيها موظفون فعليون، فالسؤال الحقيقي هو «هل تُطبَّق الموجة فوقهم بلا كسر
// صف واحد» لا «هل تُنشأ الأعمدة من الصفر». ثم يُثبت سلوك الخدمة: الحفظ، قاعدة ترتيب التاريخين،
// اشتقاق «نشط»، التدقيق، وبوابة الصلاحية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WAVE = '008_employee_end_date.sql';
const dir = mkdtempSync(join(tmpdir(), 'sanad-emp-end-'));
process.env.SANAD_DB = join(dir, 'legacy.db');
const ROOT = new URL('../..', import.meta.url).pathname;
const MIG = join(ROOT, 'migrations');
const T = '2026-01-05T00:00:00.000Z';

// تواريخ نسبية إلى لحظة التشغيل — كي لا يتحوّل «الماضي» إلى «مستقبل» بمرور الوقت على الاختبار.
const dayShift = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const PAST = dayShift(-30);
const FUTURE = dayShift(+30);

// (١) قاعدة تشبه الحيّة: كل الترحيلات قبل الموجة مطبَّقة ومسجَّلة، وفيها موظف قائم فعلاً.
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const before008 = files.slice(0, files.indexOf(WAVE));
{
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(process.env.SANAD_DB);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of before008) {
    raw.exec(readFileSync(join(MIG, f), 'utf8'));
    raw.prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)').run(f, T);
  }
  for (const [sid, nm] of [['S1', 'قطاع الحلول'], ['S2', 'قطاع الاستشارات']])
    raw.prepare('INSERT INTO sector (id, name_ar, active, sort_order, created_at) VALUES (?, ?, 1, 1, ?)').run(sid, nm, T);
  raw.prepare(`INSERT INTO employee (id, name_ar, sector_id, job_title, hire_date, salary_halalas, active, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run('emp_legacy', 'موظف قائم قبل الموجة', 'S1', 'مستشار', '2021-04-01', 1800000, T);
  raw.close();
}

const { migrate } = await import('../../scripts/migrate.js');
const db = await import('../../src/core/db/index.js');

let org;
const U = (role, sector, scope) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const HR = () => U('hr', null, 'company');
const lastAudit = (id) => db.get("SELECT * FROM audit_log WHERE resource='employee' AND resource_id=? AND action='update' ORDER BY at DESC LIMIT 1", [id]);
const auditCols = async (id) => JSON.parse((await lastAudit(id)).detail_json);
const row = (id) => db.get('SELECT * FROM employee WHERE id = ?', [id]);
let seq = 0;
const makeEmp = async (hire = '2022-01-10', sector = 'S1') =>
  await org.createEmployee(ctx(HR()), { name_ar: `موظف اختبار ${++seq}`, sector_id: sector, hire_date: hire });

before(async () => {
  await migrate();
  await (await import('../../scripts/seed-rbac.js')).seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  org = await import('../../src/modules/org/org.js');
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

// ── الموجة نفسها ─────────────────────────────────────────────────────────────
test('العمود قائم واختياري بعد الموجة — والموظف القائم لم يُمس', async () => {
  assert.ok(await db.get('SELECT version FROM schema_migration WHERE version = ?', [WAVE]), 'الموجة مسجَّلة');
  // بلا تسمية الأعمدة: notnull كلمة محجوزة كمعامل في SQLite (تعني IS NOT NULL) فلا تصلح في القائمة.
  const col = (await db.all("SELECT * FROM pragma_table_info('employee')")).find((c) => c.name === 'end_date');
  assert.ok(col, 'عمود تاريخ انتهاء الخدمة قائم على جدول الموظف');
  assert.equal(Number(col.notnull), 0, 'العمود اختياري — لا قيمة مفروضة');
  assert.equal(col.dflt_value, null, 'بلا قيمة افتراضية: الفراغ يعني «لم يغادر»');

  const legacy = await row('emp_legacy');
  assert.equal(legacy.name_ar, 'موظف قائم قبل الموجة', 'الصف القديم كما هو');
  assert.equal(legacy.hire_date, '2021-04-01', 'تاريخ التعيين القديم سليم');
  assert.equal(legacy.salary_halalas, 1800000, 'بقية الأعمدة سليمة');
  assert.equal(legacy.active, 1, 'الموجة لا تمس حالة النشاط');
  assert.equal(legacy.end_date, null, 'الموظفون القائمون بلا تاريخ مغادرة — لا تخمين ولا تعبئة صامتة');
});

test('إدخال لا يذكر العمود الجديد يظل يعمل، وإعادة التشغيل لا تعيد تطبيق الموجة', async () => {
  await db.run('INSERT INTO employee (id, name_ar, sector_id, active, created_at) VALUES (?, ?, ?, 1, ?)',
    ['emp_after', 'موظف بعد الموجة', 'S1', T]);
  assert.equal((await row('emp_after')).end_date, null, 'توافق خلفي كامل — لا عمود إلزامي يكسر استيراداً قائماً');
  await migrate(); await migrate();
  const rows = await db.all('SELECT version FROM schema_migration WHERE version = ?', [WAVE]);
  assert.equal(rows.length, 1, 'سطر تسجيل واحد مهما تكرّر التشغيل (الإدمبوتنسي على مستوى الملف)');
  assert.equal((await row('emp_legacy')).hire_date, '2021-04-01', 'ولا صف انكسر بعد إعادة التشغيل');
});

// ── الحفظ والتحقق ────────────────────────────────────────────────────────────
test('تسجيل تاريخ المغادرة يُحفظ ويظهر في سطر التدقيق', async () => {
  const emp = await makeEmp('2022-01-10');
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: '2025-11-30' });
  assert.equal(upd.end_date, '2025-11-30', 'التاريخ محفوظ بصيغة سنة-شهر-يوم');
  assert.equal((await row(emp.id)).end_date, '2025-11-30', 'ومحفوظ في السجل نفسه لا في الرد فقط');
  const cols = await auditCols(emp.id);
  assert.ok(cols.includes('end_date'), 'التدقيق يذكر عمود تاريخ المغادرة');
});

test('تاريخ مغادرة أسبق من التعيين مرفوض — والرسالة تسمّي التاريخين', async () => {
  const emp = await makeEmp('2024-03-01');
  await assert.rejects(
    () => org.updateEmployee(ctx(HR()), emp.id, { end_date: '2023-05-09' }),
    (err) => {
      assert.match(err.message, /تاريخ انتهاء الخدمة/);
      assert.ok(err.message.includes('2023-05-09') && err.message.includes('2024-03-01'), 'الرسالة تذكر التاريخين معاً');
      return true;
    });
  assert.equal((await row(emp.id)).end_date, null, 'لم يُكتب شيء بعد الرفض');
});

test('تعديل تاريخ التعيين ليتجاوز مغادرة مسجَّلة مرفوض أيضاً — لا باب خلفي للتناقض', async () => {
  const emp = await makeEmp('2020-01-01');
  await org.updateEmployee(ctx(HR()), emp.id, { end_date: '2021-06-30' });
  await assert.rejects(() => org.updateEmployee(ctx(HR()), emp.id, { hire_date: '2022-01-01' }), /تاريخ انتهاء الخدمة/);
  assert.equal((await row(emp.id)).hire_date, '2020-01-01', 'تاريخ التعيين لم يتغيّر');
});

test('تاريخ المغادرة نفسه يوم التعيين مقبول — الرفض للأسبق فقط', async () => {
  const emp = await makeEmp('2023-07-01');
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: '2023-07-01' });
  assert.equal(upd.end_date, '2023-07-01');
});

test('تاريخ بصيغة غير صحيحة مرفوض برسالة عربية', async () => {
  const emp = await makeEmp();
  await assert.rejects(() => org.updateEmployee(ctx(HR()), emp.id, { end_date: '30/11/2025' }), /تاريخ انتهاء الخدمة/);
  await assert.rejects(() => org.updateEmployee(ctx(HR()), emp.id, { end_date: '2025-13-45' }), /تاريخ انتهاء الخدمة/);
  await assert.rejects(() => org.updateEmployee(ctx(HR()), emp.id, { end_date: 'ليس تاريخاً' }), /تاريخ انتهاء الخدمة/);
  assert.equal((await row(emp.id)).end_date, null, 'لا قيمة نصف صحيحة تتسرّب إلى السجل');
});

test('الفراغ يمسح تاريخ المغادرة (عودة إلى «لم يغادر»)', async () => {
  const emp = await makeEmp();
  await org.updateEmployee(ctx(HR()), emp.id, { end_date: '2025-02-01' });
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: '' });
  assert.equal(upd.end_date, null, 'النص الفارغ يمسح التاريخ');
});

// ── القرار المُثبَّت: أثر تاريخ المغادرة على «نشط» ───────────────────────────
test('مغادرة في الماضي تُنزل «نشط» إلى صفر في العملية نفسها، والتدقيق يُظهرها', async () => {
  const emp = await makeEmp();
  assert.equal(emp.active, 1);
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: PAST });
  assert.equal(upd.end_date, PAST);
  assert.equal(upd.active, 0, 'من غادر أمس لا يُحسب في طاقة الفريق اليوم');
  const cols = await auditCols(emp.id);
  assert.ok(cols.includes('active') && cols.includes('end_date'), 'التدقيق يُظهر أن «نشط» تغيّر ضمن هذه العملية');
  // وأثره الظاهر: يخرج من طاقة الكشف بينما يبقى في القائمة بتاريخه
  const { roster, summary } = await org.staffingRoster(U('admin', null, 'company'), { month: 7 });
  const me = roster.find((r) => r.id === emp.id);
  assert.equal(me.end_date, PAST, 'تاريخ المغادرة مقروء من الكشف — «متى غادر» صار له جواب');
  assert.equal(me.active, 0);
  assert.ok(!roster.filter((r) => r.active !== 0).some((r) => r.id === emp.id), 'خارج المحسوبين في الطاقة');
  assert.ok(summary.capacityFte >= 0);
});

test('مغادرة مستقبلية لا تُعطّل الموظف — ما زال على رأس العمل حتى تاريخه', async () => {
  const emp = await makeEmp();
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: FUTURE });
  assert.equal(upd.end_date, FUTURE);
  assert.equal(upd.active, 1, 'إشعار مغادرة مسبق لا يُخرج أحداً من الفريق اليوم');
});

test('الاختيار الصريح لـ «نشط» يفوز على الاشتقاق', async () => {
  const emp = await makeEmp();
  const upd = await org.updateEmployee(ctx(HR()), emp.id, { end_date: PAST, active: 1 });
  assert.equal(upd.end_date, PAST);
  assert.equal(upd.active, 1, 'ما ذكره المسؤول صراحةً يُحترم كما هو');
});

test('مسح تاريخ المغادرة لا يُعيد التنشيط تلقائياً — العودة قرار صريح', async () => {
  const emp = await makeEmp();
  await org.updateEmployee(ctx(HR()), emp.id, { end_date: PAST });
  const cleared = await org.updateEmployee(ctx(HR()), emp.id, { end_date: '' });
  assert.equal(cleared.end_date, null);
  assert.equal(cleared.active, 0, 'لا تنشيط صامت — يُطلب «نشط» صراحةً');
  const back = await org.updateEmployee(ctx(HR()), emp.id, { active: 1 });
  assert.equal(back.active, 1, 'والتنشيط الصريح يعمل');
});

// ── الصلاحية ─────────────────────────────────────────────────────────────────
test('البوابة كما هي: من لا يملك تعديل الموظف لا يسجّل مغادرته', async () => {
  const emp = await makeEmp();
  const cons = U('consultant', 'S1', 'project');
  await assert.rejects(() => org.updateEmployee(ctx(cons), emp.id, { end_date: PAST }), /صلاحي|forbidden/);
  const after2 = await row(emp.id);
  assert.equal(after2.end_date, null, 'لا كتابة بعد الرفض');
  assert.equal(after2.active, 1, 'ولا اشتقاق لحالة النشاط');
  // وقائد قطاع آخر ممنوع كذلك — نطاق البوابة القائم بلا توسعة
  await assert.rejects(() => org.updateEmployee(ctx(U('sector_lead', 'S2', 'sector')), emp.id, { end_date: PAST }), /صلاحي|forbidden/);
  // بينما قائد القطاع نفسه يملكها (نفس بوابة بقية الحقول، لا أوسع ولا أضيق)
  const ok = await org.updateEmployee(ctx(U('sector_lead', 'S1', 'sector')), emp.id, { end_date: PAST });
  assert.equal(ok.end_date, PAST);
});
