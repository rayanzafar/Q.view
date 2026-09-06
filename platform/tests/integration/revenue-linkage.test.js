// ── كل إيرادٍ مربوط (v5.32) ──────────────────────────────────────────────────
//
// «مشروع عليه إيرادات بس ما هي مكتوبة في المخرجات أو في أي مكان ثاني — ما ينفع، لازم كل
// إيراد يكون مربوطاً بشكل كامل» — بلسان المالك (2026-08-16).
//
// أدقّ ما يُحرَس هنا **حفظ المجموع هللةً بهللة**: الربط والتحويل يستبدلان سطرَ الإيراد
// المستورد بسطرٍ مشتقٍّ من مخرَجه بنفس المبلغ — فلا يهبط إيراد القطاع ولا يتضاعف. ومعه
// بابا الشراكة: مديرة الإدارة الشريكة تفتح فريق المشروع وحوكمته وتكتب فيهما (كانت تُرَدّ
// بفحصٍ خام يُبتلع فيظهر «لا فريق مُسكَّن» كذباً — لقطة المالك نفسها).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-revlink-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, gov, P, capacity;
const T = '2026-06-01T00:00:00Z';
const MGR = { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'department',
  sector_id: 'SOL', departmentIds: new Set(['D1']), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() };
const PARTNER = { id: 'u_partner', username: 'partner', role_id: 'department_manager', scope: 'department',
  sector_id: 'SOL', departmentIds: new Set(['D2']), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() };
const EMP = { id: 'u_emp', username: 'emp', role_id: 'employee', scope: 'own',
  sector_id: 'SOL', projectIds: new Set(['PRJ']), teamIds: new Set() };
const sectorRevenue = async () =>
  Number((await db.get(`SELECT COALESCE(SUM(amount_halalas),0) s FROM revenue_line WHERE sector_id = 'SOL'`)).s);

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  gov = await import('../../src/modules/pmo/governance.js');
  capacity = await import('../../src/modules/pmo/capacity.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  for (const [id, name] of [['D1', 'إدارة المدن الذكية'], ['D2', 'إدارة الذكاء الاصطناعي']]) {
    await db.insert('department', { id, sector_id: 'SOL', name_ar: name, active: 1, created_at: T });
  }
  for (const u of [MGR, PARTNER, EMP]) {
    await db.insert('app_user', { id: u.id, username: u.username, role_id: u.role_id, scope: u.scope, sector_id: 'SOL', active: 1, created_at: T });
  }
  await db.insert('project', { id: 'PRJ', name_ar: 'منظومة رصد الحافلات', sector_id: 'SOL', department_id: 'D1',
    status: 'IN_PROGRESS', rag: 'GREEN', start_date: '2026-05-01', created_at: T });
  await db.insert('project_department', { project_id: 'PRJ', department_id: 'D2', created_at: T });
  // فريقٌ مُسكَّن — لحارسة «لا فريق» الكاذبة
  await db.insert('employee', { id: 'E1', name_ar: 'يعقوب سيد', sector_id: 'SOL', department_id: 'D2', status: 'نشط', active: 1, created_at: T });
  await db.insert('allocation', { id: 'AL1', employee_id: 'E1', person_name_ar: 'يعقوب سيد', project_id: 'PRJ',
    project_name: 'منظومة رصد الحافلات', sector_id: 'SOL', type: 'member', year: 2026,
    monthly_json: JSON.stringify({ 5: 1, 6: 1 }), source: 'manual', created_at: T });
  // مخرجات: مؤهلٌ للربط (معتمَد بلا قيمة) · مرفوضان (بقيمة · مسودة)
  await db.insert('deliverable', { id: 'DLV_OK', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'تشغيل المنظومة',
    status: 'ACCEPTED', amount_halalas: null, accepted_at: T, created_at: T });
  await db.insert('deliverable', { id: 'DLV_VALUED', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'مخرَج بقيمته',
    status: 'ACCEPTED', amount_halalas: 100000, accepted_at: T, created_at: T });
  await db.insert('revenue_line', { id: 'rl_dlv_DLV_VALUED', project_id: 'PRJ', sector_id: 'SOL', deliverable_id: 'DLV_VALUED',
    amount_halalas: 100000, month: 5, year: 2026, auto: 1, rule_id: 'deliverable_delivered', created_at: T });
  await db.insert('deliverable', { id: 'DLV_DRAFT', project_id: 'PRJ', sector_id: 'SOL', name_ar: 'مسودة',
    status: 'DRAFT', amount_halalas: null, created_at: T });
  // سطرا الإيراد المستوردان اليتيمان — عين حالة المالك
  await db.insert('revenue_line', { id: 'rl_import_1', project_id: 'PRJ', sector_id: 'SOL', deliverable_id: null,
    amount_halalas: 303732400, month: 6, year: 2026, label: 'إيراد مفوتر (المرحلة الأولى)', auto: 0, created_at: T });
  await db.insert('revenue_line', { id: 'rl_import_2', project_id: 'PRJ', sector_id: 'SOL', deliverable_id: null,
    amount_halalas: 50000000, month: 7, year: 2026, label: 'دفعة يوليو', auto: 0, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('الصفحة تقول اليتيم بمجموعه وأدوات ربطه لصاحب الصلاحية — وتطويه عن الموظف', async () => {
  const html = await P.projectDetailPage(MGR, 'PRJ', {});
  assert.ok(html.includes('إيراد مسجَّل على المشروع غير مربوط بأي مخرَج'), 'اليتيم صامت — عين شكوى المالك');
  assert.ok(html.includes('إيراد مفوتر (المرحلة الأولى)'), 'السطر لا يُسمّى');
  assert.ok(html.includes('data-action="rev-attach"'), 'زر الربط غائب');
  assert.ok(html.includes('data-action="rev-convert"'), 'زر التحويل غائب');
  const emp = await P.projectDetailPage(EMP, 'PRJ', {});
  assert.ok(!emp.includes('غير مربوط بأي مخرَج'), 'المال تسرّب لقارئٍ بلا صلاحية');
});

test('الربط بمخرَجٍ قائم: المخرَج يتبنّى القيمة والشهر، والمجموع محفوظ هللةً بهللة', async () => {
  const before1 = await sectorRevenue();
  const r = await gov.attachRevenueLine({ user: MGR, ip: '1' }, 'PRJ', 'rl_import_1', 'DLV_OK');
  assert.equal(r.ok, true);
  assert.equal(await sectorRevenue(), before1, 'إيراد القطاع تغيّر — والربط استبدالٌ لا إضافة');
  assert.equal(await db.get(`SELECT id FROM revenue_line WHERE id = 'rl_import_1'`), undefined, 'المستورد بقي بعد الربط');
  const derived = await db.get(`SELECT * FROM revenue_line WHERE id = 'rl_dlv_DLV_OK'`);
  assert.ok(derived, 'لا سطر مشتق للمخرَج الرابط');
  assert.equal(Number(derived.amount_halalas), 303732400, 'المبلغ تبدّل في الطريق');
  const d = await db.get(`SELECT amount_halalas, month, year FROM deliverable WHERE id = 'DLV_OK'`);
  assert.equal(Number(d.amount_halalas), 303732400, 'المخرَج لم يتبنَّ القيمة');
  assert.equal(Number(d.month), 6, 'شهر السطر لم يُتبنَّ والمخرَج بلا شهر');
  const aud = await db.get(`SELECT detail_json FROM audit_log WHERE resource='revenue_line' AND resource_id='rl_import_1' AND action='delete'`);
  assert.ok(aud && JSON.parse(aud.detail_json).reason.includes('رُبط'), 'محو المستورد بلا أثرٍ يسمّي سببه');
});

test('الرفض بالعربية: مخرَجٌ بقيمته يعدّ المال مرتين، ومسودةٌ لا تحمل اعترافاً، ومربوطٌ لا يُعاد', async () => {
  await assert.rejects(() => gov.attachRevenueLine({ user: MGR, ip: '1' }, 'PRJ', 'rl_import_2', 'DLV_VALUED'),
    /يعدّ المال مرتين/);
  await assert.rejects(() => gov.attachRevenueLine({ user: MGR, ip: '1' }, 'PRJ', 'rl_import_2', 'DLV_DRAFT'),
    /مُسلَّم أو معتمَد/);
  await assert.rejects(() => gov.attachRevenueLine({ user: MGR, ip: '1' }, 'PRJ', 'rl_dlv_DLV_VALUED', 'DLV_OK'),
    /مربوطٌ بمخرَجه أصلاً/);
});

test('التحويل مخرَجاً: معتمَدٌ باسم السطر وقيمته وشهره — والمجموع محفوظ، بيد الإدارة الشريكة', async () => {
  const before1 = await sectorRevenue();
  // مديرة الإدارة الشريكة تكتب في حوكمة مشروعٍ تشارك فيه إدارتها (v5.32 — كانت تُرَدّ)
  const r = await gov.convertRevenueLine({ user: PARTNER, ip: '1' }, 'PRJ', 'rl_import_2');
  assert.equal(r.ok, true);
  assert.equal(await sectorRevenue(), before1, 'المجموع تغيّر بالتحويل');
  const dlv = await db.get(`SELECT * FROM deliverable WHERE id = ?`, [r.deliverable_id]);
  assert.equal(dlv.name_ar, 'دفعة يوليو');
  assert.equal(dlv.status, 'ACCEPTED');
  assert.equal(Number(dlv.amount_halalas), 50000000);
  assert.equal(Number(dlv.month), 7);
  assert.ok(await db.get(`SELECT id FROM revenue_line WHERE deliverable_id = ?`, [r.deliverable_id]), 'لا سطر مشتق للمخرَج الجديد');
  assert.equal(await db.get(`SELECT id FROM revenue_line WHERE id = 'rl_import_2'`), undefined);
});

test('حارسة «لا فريق» الكاذبة: مديرة الإدارة الشريكة ترى فريق المشروع بعد توحيد الأبواب', async () => {
  const t = await capacity.projectTeamLoad(PARTNER, 'PRJ', { year: 2026 });
  assert.equal((t.team || []).length, 1, 'الفريق محجوب عن الشراكة — عين لقطة المالك');
  assert.equal(t.team[0].name, 'يعقوب سيد');
});
