// ── قيمة المخرَج وأثرها الإيرادي يتبيّنان في الجدول (v5.31) ──────────────────
//
// «لازم يتبيّن في جدول المخرجات قيمة المخرَج والحالة تبعه، وإذا كان تم الاعتماد المفترض
// يُسجَّل في إيرادات القطاع، ولازم ما يكون في مسار مالي خلاص — كله يتم العمل عليه من مدير
// المشروع ومدير الإدارة والقطاع اللي لهم صلاحية» — بلسان المالك (2026-08-16).
//
// المحرّك كان يعمل (recognition.js منذ قرار «الإيراد يتبع التسليم») لكن الشاشة تكتمه:
// القيمة محجوبة عن مدير الإدارة (بوابة مال العميل)، والاعتراف صامت، وشارة «تُضبط من
// المسار المالي» توحي بسلطةٍ مالية نُفيت. فالحارس هنا على **قول الحقيقة**: من يملك تحريك
// الحالة يرى القيمة ويكتبها من الخانة، والاعتراف يُقال نصاً، والطيّ يبقى لمن لا صلاحية له.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dlvvalue-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, P, gov;
const T = '2026-03-01T00:00:00Z';
const MGR = { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'department',
  sector_id: 'SOL', departmentIds: new Set(['D1']), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() };
const EMP = { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', projectIds: new Set(['PRJ']), teamIds: new Set() };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  P = await import('../../src/web/pages.js');
  gov = await import('../../src/modules/pmo/governance.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة البيانات', active: 1, created_at: T });
  for (const u of [MGR, EMP]) {
    await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, scope: u.scope, sector_id: 'SOL', active: 1, created_at: T });
  }
  await db.insert('project', { id: 'PRJ', name_ar: 'منصة البيانات', sector_id: 'SOL', department_id: 'D1',
    status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-01-01', created_at: T });
  // معتمَد بقيمة (سيحمل سطر إيراد) · معتمَد بلا قيمة (فجوة تُقال) · مفوتر (شارة المستخلص)
  await db.insert('deliverable', { id: 'DLV_VAL', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'مستكشف المعرفة',
    status: 'ACCEPTED', amount_halalas: 64233250, month: 5, year: 2026, accepted_at: T, created_at: T });
  await db.insert('deliverable', { id: 'DLV_NOVAL', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'خطة تسويقية بلا قيمة',
    status: 'ACCEPTED', amount_halalas: null, month: 6, year: 2026, accepted_at: T, created_at: T });
  await db.insert('deliverable', { id: 'DLV_INV', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'وثيقة المؤشرات',
    status: 'ACCEPTED', amount_halalas: 1000000, month: 4, year: 2026, accepted_at: T, invoiced_at: T, created_at: T });
  // سطرا الإيراد المشتقان (كما يكتبهما المحرّك للمعتمَد ذي القيمة)
  for (const [rid, dlv, amt, m] of [['rl_dlv_DLV_VAL', 'DLV_VAL', 64233250, 5], ['rl_dlv_DLV_INV', 'DLV_INV', 1000000, 4]]) {
    await db.insert('revenue_line', { id: rid, project_id: 'PRJ', sector_id: 'SOL', deliverable_id: dlv,
      amount_halalas: amt, month: m, year: 2026, auto: 1, rule_id: 'deliverable_delivered', created_at: T });
  }
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('مديرة الإدارة ترى القيمة وتكتبها من الخانة، والاعتراف يُقال نصاً بمجموعه', async () => {
  const html = await P.projectDetailPage(MGR, 'PRJ', {});
  assert.ok(html.includes('القيمة'), 'عمود القيمة غائب عمّن يملك العمل على المخرَج');
  assert.ok(html.includes('data-action-blur="dlv-amount"'), 'خانة الكتابة المباشرة غائبة');
  assert.ok(/value="642332(\.5)?"|value="642333"/.test(html), 'قيمة المخرَج لا تظهر في خانتها بالريال');
  assert.ok(html.includes('إيراده مسجَّل في القطاع'), 'الاعتراف الإيرادي صامت — وهو عين شكّ المالك');
  assert.ok(html.includes('لن يُسجَّل إيراده حتى تُحدَّد'), 'المعتمَد بلا قيمة لا يُقال عيبه');
  assert.ok(html.includes('المسجَّل إيراداً للقطاع من هذا المشروع'), 'مجموع الاعتراف غائب من رأس الجدول');
  assert.ok(!html.includes('تُضبط من المسار المالي'), 'شارة المسار المالي بقيت بعد قرار إلغائه');
  assert.ok(html.includes('صدر بها مستخلص'), 'واقعة المستخلص لم تعد تُقال');
});

test('الموظف المسكَّن قراءةً يبقى على الوزن وحده — لا قيم ولا شارات إيراد', async () => {
  const html = await P.projectDetailPage(EMP, 'PRJ', {});
  assert.ok(!html.includes('642,33') && !/value="642332/.test(html), 'قيمة المخرَج تسرّبت لقارئٍ بلا صلاحية');
  assert.ok(!html.includes('إيراده مسجَّل في القطاع'), 'شارة الإيراد تسرّبت');
  assert.ok(html.includes('الوزن'), 'عمود الوزن غاب عن القارئ');
});

test('كتابة القيمة من الخانة تُسجِّل الإيراد في القطاع فوراً — ومسحُها يمحوه', async () => {
  const ctx = { user: MGR, ip: '1' };
  await gov.updateItem(ctx, 'deliverable', 'DLV_NOVAL', { amount_sar: 5000 });
  const rl = await db.get(`SELECT * FROM revenue_line WHERE id = 'rl_dlv_DLV_NOVAL'`);
  assert.ok(rl, 'المعتمَد الذي كُتبت قيمته لم يُسجَّل إيراده');
  assert.equal(Number(rl.amount_halalas), 500000, 'الإيراد بغير القيمة المكتوبة');
  assert.equal(rl.sector_id, 'SOL', 'الإيراد بلا نسبة قطاع — فلا يظهر في إيرادات القطاع');
  await gov.updateItem(ctx, 'deliverable', 'DLV_NOVAL', { amount_sar: null });
  assert.equal(await db.get(`SELECT id FROM revenue_line WHERE id = 'rl_dlv_DLV_NOVAL'`), undefined,
    'مسحُ القيمة ترك سطر إيرادٍ يتيماً');
});
