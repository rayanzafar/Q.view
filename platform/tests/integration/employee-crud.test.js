// Employee (team) CRUD — create / update / soft-delete via the org service. Verifies persistence,
// hire-date handling + validation, audit rows on every write, and the RBAC boundary: HR and admin
// manage staff; a sector lead may add/edit in their sector but NOT delete; a non-privileged role is
// refused every write. Isolated temp SQLite DB (no DATABASE_URL → SQLite driver).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-employee-crud.db');
process.env.SANAD_DB = TEST_DB;

let db, org;
const now = () => new Date().toISOString();
const U = (role, sector, scope, extra = {}) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), ...extra });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const lastAudit = (action, id) => db.get(`SELECT * FROM audit_log WHERE resource='employee' AND resource_id=? AND action=? ORDER BY at DESC LIMIT 1`, [id, action]);

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  org = await import('../../src/modules/org/org.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('HR creates an employee with hire date + fields, and it is audited', async () => {
  const hr = U('hr', null, 'company');
  const emp = await org.createEmployee(ctx(hr), { name_ar: 'أروى الحربي', name_en: 'Arwa', job_title: 'مستشار أول', sector_id: 'S1', hire_date: '2024-03-01', salary_sar: 22000 });
  assert.ok(emp.id && emp.id.startsWith('emp_'), 'id has the emp_ prefix');
  assert.equal(emp.name_ar, 'أروى الحربي');
  assert.equal(emp.job_title, 'مستشار أول');
  assert.equal(emp.sector_id, 'S1');
  assert.equal(emp.hire_date, '2024-03-01', 'hire date persisted as ISO text');
  // ختم الراتب: لا دور يملك منح الراتب إطلاقاً — ولا حتى الموارد البشرية — ومدير النظام وحده
  // يمرّ بمنحه الشامل (قرار المالك حتى التكامل مع Odoo). وتعديل الراتب ونقله مختومان أصلاً،
  // فكان **الإنشاء** الباب الوحيد المفتوح: من لا يرى الراتب كان **يحدّده**، ثم لا يقرأ ما كتب.
  // هذا التأكيد كان يوثّق الثغرة لا السلوك الصحيح؛ صار يحرس الختم من جانب الكتابة أيضاً.
  assert.equal(emp.salary_halalas, null, 'الموارد البشرية لا تحدّد الراتب — الختم يشمل الكتابة لا القراءة فقط');
  assert.equal(emp.active, 1);

  const aud = await lastAudit('create', emp.id);
  assert.ok(aud, 'create is audited');
  assert.equal(aud.sector_id, 'S1');
  assert.equal(aud.role_id, 'hr');
});

test('HR updates name, job title and hire date; the change is audited', async () => {
  const hr = U('hr', null, 'company');
  const emp = await org.createEmployee(ctx(hr), { name_ar: 'بدر', sector_id: 'S1' });
  assert.equal(emp.hire_date, null, 'no hire date given → unknown (empty)');

  const upd = await org.updateEmployee(ctx(hr), emp.id, { name_ar: 'بدر العتيبي', job_title: 'محلل', hire_date: '2023-09-15' });
  assert.equal(upd.name_ar, 'بدر العتيبي');
  assert.equal(upd.job_title, 'محلل');
  assert.equal(upd.hire_date, '2023-09-15');

  const aud = await lastAudit('update', emp.id);
  assert.ok(aud, 'update is audited');
  const det = JSON.parse(aud.detail_json);
  assert.ok(det.includes('hire_date') && det.includes('name_ar'), 'audit detail lists the changed columns');
});

test('clearing the hire date on update sets it back to unknown (empty)', async () => {
  const hr = U('hr', null, 'company');
  const emp = await org.createEmployee(ctx(hr), { name_ar: 'جواهر', sector_id: 'S1', hire_date: '2022-01-10' });
  const upd = await org.updateEmployee(ctx(hr), emp.id, { hire_date: '' });
  assert.equal(upd.hire_date, null, 'empty string clears the date');
});

test('HR soft-deletes an employee: deleted_at set, inactive, audited, and gone from the roster', async () => {
  const hr = U('hr', null, 'company');
  const emp = await org.createEmployee(ctx(hr), { name_ar: 'دانة', sector_id: 'S1' });

  const before = await org.staffingRoster(U('admin', null, 'company'));
  assert.ok(before.roster.some((r) => r.id === emp.id), 'present before delete');

  const r = await org.softDeleteEmployee(ctx(hr), emp.id);
  assert.equal(r.ok, true);

  const row = await db.get('SELECT * FROM employee WHERE id = ?', [emp.id]);
  assert.ok(row.deleted_at, 'deleted_at stamped');
  assert.equal(row.active, 0, 'marked inactive');

  const aud = await lastAudit('delete', emp.id);
  assert.ok(aud, 'delete is audited');
  assert.equal(aud.sector_id, 'S1');

  const after = await org.staffingRoster(U('admin', null, 'company'));
  assert.ok(!after.roster.some((r2) => r2.id === emp.id), 'excluded from the roster after soft-delete');
});

test('admin can create, update and delete', async () => {
  const admin = U('admin', null, 'company');
  const emp = await org.createEmployee(ctx(admin), { name_ar: 'هيثم', sector_id: 'S2', hire_date: '2025-02-02' });
  await org.updateEmployee(ctx(admin), emp.id, { job_title: 'مدير' });
  const r = await org.softDeleteEmployee(ctx(admin), emp.id);
  assert.equal(r.ok, true);
  assert.ok(await lastAudit('delete', emp.id), 'admin delete audited');
});

test('sector lead may add/edit within their sector but CANNOT delete (403)', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const emp = await org.createEmployee(ctx(lead), { name_ar: 'ريم', sector_id: 'S1', hire_date: '2024-06-01' });
  assert.equal(emp.sector_id, 'S1');
  const upd = await org.updateEmployee(ctx(lead), emp.id, { job_title: 'منسق' });
  assert.equal(upd.job_title, 'منسق');
  await assert.rejects(() => org.softDeleteEmployee(ctx(lead), emp.id), /صلاحي|forbidden/, 'delete refused for sector lead');
});

test('sector lead cannot create in ANOTHER sector (403)', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await assert.rejects(() => org.createEmployee(ctx(lead), { name_ar: 'خارج النطاق', sector_id: 'S2' }), /صلاحي|forbidden/);
});

test('a non-privileged role (consultant) is refused create, update and delete', async () => {
  const hr = U('hr', null, 'company');
  const seed = await org.createEmployee(ctx(hr), { name_ar: 'للاختبار', sector_id: 'S1' });
  const cons = U('consultant', 'S1', 'project');
  await assert.rejects(() => org.createEmployee(ctx(cons), { name_ar: 'ممنوع', sector_id: 'S1' }), /صلاحي|forbidden/);
  await assert.rejects(() => org.updateEmployee(ctx(cons), seed.id, { job_title: 'x' }), /صلاحي|forbidden/);
  await assert.rejects(() => org.softDeleteEmployee(ctx(cons), seed.id), /صلاحي|forbidden/);
});

test('validation: missing name and a malformed hire date are rejected in Arabic', async () => {
  const hr = U('hr', null, 'company');
  await assert.rejects(() => org.createEmployee(ctx(hr), { sector_id: 'S1' }), /اسم/);
  await assert.rejects(() => org.createEmployee(ctx(hr), { name_ar: 'س', sector_id: 'S1', hire_date: '01/03/2024' }), /تاريخ التعيين/);
  const ok = await org.createEmployee(ctx(hr), { name_ar: 'سالم', sector_id: 'S1' });
  await assert.rejects(() => org.updateEmployee(ctx(hr), ok.id, { hire_date: 'ليس تاريخاً' }), /تاريخ التعيين/);
});

test('deleting an unknown employee is a clear not-found', async () => {
  const hr = U('hr', null, 'company');
  await assert.rejects(() => org.softDeleteEmployee(ctx(hr), 'emp_does_not_exist'), /غير موجود/);
});

// ── ختم الراتب من جانب الكتابة، وتصدير الموظفين بنطاق الإدارة ────────────────
// عيبان أظهرتهما حزمة السيناريوهات بالتنفيذ لا بالقراءة.

test('مدير النظام وحده يحدّد الراتب — والفراغ يبقى فراغاً لا صفراً', async () => {
  const admin = U('admin', null, 'company');
  const withPay = await org.createEmployee(ctx(admin), { name_ar: 'سارة القحطاني', sector_id: 'S1', salary_sar: 18000 });
  assert.equal(withPay.salary_halalas, 1800000, 'مدير النظام يكتب الراتب');

  const noPay = await org.createEmployee(ctx(admin), { name_ar: 'خالد الشمري', sector_id: 'S1' });
  assert.equal(noPay.salary_halalas, null,
    'بلا راتب مُدخَل ⟵ فراغ لا صفر: «لم يُدخَل» و«بلا أجر» لا يجوز أن يصيرا شيئاً واحداً');

  const zero = await org.createEmployee(ctx(admin), { name_ar: 'نورة العنزي', sector_id: 'S1', salary_sar: 0 });
  assert.equal(zero.salary_halalas, 0, 'والصفر المُدخَل صراحةً يبقى صفراً — قياسٌ لا غياب');
});

test('من لا يرى الراتب لا يكتبه — ولو أرسله في الطلب', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const emp = await org.createEmployee(ctx(lead), { name_ar: 'ماجد الدوسري', sector_id: 'S1', salary_sar: 12345 });
  assert.equal(emp.salary_halalas, null, 'قائد القطاع أرسل راتباً فلم يُكتب');
  const row = await db.get('SELECT salary_halalas FROM employee WHERE id = ?', [emp.id]);
  assert.equal(row.salary_halalas, null, 'ولا في الصف المخزَّن — لا في الرد وحده');
});
