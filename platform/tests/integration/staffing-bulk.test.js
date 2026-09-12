// ── دفعة التسكين الذرّية (v5.26) ─────────────────────────────────────────────
// المعاينة وعدٌ بما سيُطبَّق كاملاً: إما كل العمليات أو لا شيء — حتى صفوف التدقيق تُسحب مع
// الفشل («رفضٌ لا يترك أثر كتابة»). والتفويض تفويض الدوال القائمة نفسها لكل عملية على حدة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-bulk.db');
process.env.SANAD_DB = TEST_DB;

let db, projects;
const YEAR = new Date().getUTCFullYear();
const now = () => new Date().toISOString();
const U = (role, sector, scope, extra = {}) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), ...extra });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const allocCount = async () => Number((await db.get('SELECT COUNT(*) c FROM allocation WHERE deleted_at IS NULL')).c);
const auditCount = async () => Number((await db.get(`SELECT COUNT(*) c FROM audit_log WHERE resource='allocation'`)).c);

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  projects = await import('../../src/modules/pmo/projects.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع ١', active: 1, created_at: now() });
  await db.insert('sector', { id: 'S2', name_ar: 'قطاع ٢', active: 1, created_at: now() });
  await db.insert('employee', { id: 'E1', name_ar: 'سارة العتيبي', sector_id: 'S1', status: 'نشط', active: 1, created_at: now() });
  await db.insert('employee', { id: 'E2', name_ar: 'خالد الغامدي', sector_id: 'S1', status: 'نشط', active: 1, created_at: now() });
  await db.insert('employee', { id: 'EX', name_ar: 'موظف القطاع الآخر', sector_id: 'S2', status: 'نشط', active: 1, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'منصة التحول', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('الذرّية: بندٌ صالح + بندٌ محظور ⇒ لا صف تسكين ولا سطر تدقيق — المعاينة لا تكذب', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const before1 = { a: await allocCount(), au: await auditCount() };
  await assert.rejects(() => projects.bulkStaffing(ctx(lead), {
    year: YEAR,
    ops: [
      { op: 'assign', kind: 'project', targetId: 'P1', employeeId: 'E1', pct: 50, fromMonth: 2, toMonth: 4 },
      // بند داخلي لموظفٍ من قطاعٍ آخر — ownsEmployee يردّه
      { op: 'assign', kind: 'bucket', targetId: 'bd', employeeId: 'EX', pct: 20 },
    ],
  }), /البند 2.*خارج من تديرهم/s, 'الفشل يسمّي بنده بالعربية');
  assert.equal(await allocCount(), before1.a, 'لا صف تسكين بقي بعد الفشل');
  assert.equal(await auditCount(), before1.au, 'حتى التدقيق أُرجع — لا أثر كتابة لرفض');
});

test('النجاح: عمليات الأنواع الثلاثة تمرّ بدوالها وتدقيقها، ويعود العدد المطبَّق', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const r1 = await projects.bulkStaffing(ctx(lead), {
    year: YEAR,
    ops: [
      { op: 'assign', kind: 'project', targetId: 'P1', employeeId: 'E1', months: { 2: 40, 3: 40 } },
      { op: 'assign', kind: 'bucket', targetId: 'pmo', employeeId: 'E2', pct: 30, fromMonth: 5, toMonth: 6 },
    ],
  });
  assert.deepEqual(r1, { ok: true, applied: 2 });
  const a1 = await db.get(`SELECT id, monthly_json FROM allocation WHERE employee_id='E1' AND project_id='P1' AND deleted_at IS NULL`);
  assert.deepEqual(JSON.parse(a1.monthly_json), { 2: 0.4, 3: 0.4 });
  const a2 = await db.get(`SELECT id FROM allocation WHERE employee_id='E2' AND work_bucket='pmo' AND deleted_at IS NULL`);
  assert.ok(a2);
  // set + remove في دفعة ثانية
  const r2 = await projects.bulkStaffing(ctx(lead), {
    ops: [
      { op: 'set', allocId: a1.id, months: { 4: 60 } },
      { op: 'remove', allocId: a2.id },
    ],
  });
  assert.deepEqual(r2, { ok: true, applied: 2 });
  assert.equal(JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [a1.id])).monthly_json)[4], 0.6);
  assert.ok((await db.get('SELECT deleted_at FROM allocation WHERE id = ?', [a2.id])).deleted_at, 'الإزالة حذف ناعم');
  const audits = await db.get(`SELECT COUNT(*) c FROM audit_log WHERE resource='allocation'`);
  assert.equal(Number(audits.c), 4, 'كل عملية بسطر تدقيقها — أربع عمليات أربعة أسطر');
});

test('الحدود: دفعة فارغة، وفوق السقف، ونوع مجهول — رسائل عربية تسمّي المشكلة', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await assert.rejects(() => projects.bulkStaffing(ctx(lead), { ops: [] }), /لا تغييرات في الدفعة/);
  await assert.rejects(() => projects.bulkStaffing(ctx(lead), {
    ops: Array.from({ length: projects.BULK_STAFFING_MAX + 1 }, () => ({ op: 'remove', allocId: 'x' })),
  }), new RegExp(String(projects.BULK_STAFFING_MAX)));
  await assert.rejects(() => projects.bulkStaffing(ctx(lead), { ops: [{ op: 'teleport' }] }),
    /البند 1.*غير معروف/s);
});

test('تفويض المشروع لكل عملية: من لا يدير المشروع تُرَدّ دفعتُه كاملة', async () => {
  const stranger = U('sector_lead', 'S2', 'sector');
  const before1 = await allocCount();
  await assert.rejects(() => projects.bulkStaffing(ctx(stranger), {
    year: YEAR,
    ops: [{ op: 'assign', kind: 'project', targetId: 'P1', employeeId: 'EX', pct: 10 }],
  }), /البند 1/);
  assert.equal(await allocCount(), before1);
});
