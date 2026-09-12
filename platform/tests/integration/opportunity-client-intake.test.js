// ── الجهة تُسجَّل من باب الفرصة (v5.30) ──────────────────────────────────────
//
// «لازم من إضافة الفرصة أحط أهم المعلومات كاملة… والعميل لازم يكون موجوداً وأقدر أبحث
// عنه، أو أكتب اسم عميل جديد إذا مو موجود ويضاف في المنصة» — بلسان المالك (2026-08-16).
//
// وأدقّ ما يُحرَس ألّا يفتح هذا الباب تكرارَ الجهات الذي حاربته ترحيلتا الدمج (011)
// وتأكيد الاسم (012): الاسم المكتوب يُطابَق مطبَّعاً فيُعاد استعمال الموجود — الإنشاء
// للجديد حقاً وحده. والسلطة سلطةُ تسجيل الفرصة: مدير الإدارة يسجّل فرصه بجهاتها ولا
// يملك منحة «إنشاء جهة» — فلا تسقط الجهة في وجهه فيعود يكتبها نصاً حراً في العنوان.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-oppintake-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL' };
const CTX = { user: ADMIN, ip: '1' };
// مديرة إدارة: تنشئ الفرص ولا تملك منحة إنشاء جهة — عين حالة القرار.
const MGR = { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'department',
  sector_id: 'SOL', departmentIds: new Set(['D1']), projectIds: new Set(), teamIds: new Set(),
  opportunityIds: new Set(), departmentGrants: [], managedDepartmentIds: new Set() };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة الذكاء الاصطناعي', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('app_user', { id: 'u_mgr', username: 'mgr', role_id: 'department_manager', scope: 'department', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('client', { id: 'CL_EXIST', name_ar: 'الهيئة الملكية لمدينة مكة', active: 1, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('اسم جديد يُسجِّل جهةً بتدقيقٍ يسمّي بابه، والفرصة تُربط بها', async () => {
  const r = await opps.createOpportunity(CTX, {
    title_ar: 'منظومة رصد الحافلات', sector_id: 'SOL', department_id: 'D1',
    new_client_name: '  جمعية نسك   الإنسانية ', value_sar: 7000000,
  });
  const c = await db.get(`SELECT * FROM client WHERE name_ar = 'جمعية نسك الإنسانية' AND deleted_at IS NULL`);
  assert.ok(c, 'الجهة لم تُسجَّل — أو سُجّلت بلا تطبيع المسافات');
  assert.equal(r.client_id, c.id, 'الفرصة لم تُربط بجهتها الجديدة');
  const aud = await db.get(`SELECT detail_json FROM audit_log WHERE resource='client' AND resource_id=? AND action='create'`, [c.id]);
  assert.ok(aud && JSON.parse(aud.detail_json).via === 'تسجيل فرصة', 'تسجيل الجهة بلا أثرٍ يسمّي بابه');
});

test('الاسم المطابق لجهةٍ قائمة يعيد استعمالها — لا تكرار مهما اختلفت المسافات والحالة', async () => {
  const before1 = Number((await db.get('SELECT COUNT(*) c FROM client WHERE deleted_at IS NULL')).c);
  const r = await opps.createOpportunity(CTX, {
    title_ar: 'فرصة ثانية لنفس الجهة', sector_id: 'SOL',
    new_client_name: 'جمعية  نسك الإنسانية',
  });
  assert.equal(Number((await db.get('SELECT COUNT(*) c FROM client WHERE deleted_at IS NULL')).c), before1,
    'تكرّرت الجهة — وهو عين ما بُنيت منصة الجهات لمنعه');
  const c = await db.get(`SELECT id FROM client WHERE name_ar = 'جمعية نسك الإنسانية'`);
  assert.equal(r.client_id, c.id, 'لم يُعَد استعمال الجهة القائمة');
});

test('مديرة الإدارة تسجّل فرصتها بجهةٍ جديدة — سلطة تسجيل الفرصة لا منحة الجهات', async () => {
  const { can } = await import('../../src/core/rbac/index.js');
  assert.equal(can(MGR, 'create', 'client'), false, 'الاختبار يفترض أن الدور بلا منحة جهات — تغيّرت المصفوفة');
  const r = await opps.createOpportunity({ user: MGR, ip: '1' }, {
    title_ar: 'فرصة إدارتها بجهة جديدة', sector_id: 'SOL', department_id: 'D1',
    new_client_name: 'هيئة تطوير جديدة',
  });
  assert.ok(r.client_id, 'سقط تسجيل الجهة في وجه من يملك تسجيل الفرصة');
  assert.ok(await db.get('SELECT id FROM client WHERE id = ?', [r.client_id]));
});

test('التعديل من نفس الباب: اسمٌ جديد يبدّل الجهة، ومعرّفٌ قائم يبقى، والمجهول يُرَدّ بالعربية', async () => {
  const o = await opps.createOpportunity(CTX, { title_ar: 'فرصة للتعديل', sector_id: 'SOL', client_id: 'CL_EXIST' });
  const r1 = await opps.updateOpportunity(CTX, o.id, { new_client_name: 'جهة التعديل الجديدة' });
  assert.ok(r1.client_id && r1.client_id !== 'CL_EXIST', 'الاسم الجديد لم يبدّل الجهة');
  const r2 = await opps.updateOpportunity(CTX, o.id, { client_id: 'CL_EXIST' });
  assert.equal(r2.client_id, 'CL_EXIST');
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { client_id: 'cl_ghost' }),
    /الجهة المختارة غير موجودة/, 'معرّف مجهول مرّ بصمت');
  const r3 = await opps.updateOpportunity(CTX, o.id, { client_id: '' });
  assert.equal(r3.client_id ?? null, null, 'التفريغ الصريح يرفع الجهة');
});

test('حمولة الإضافة الكاملة تُكتب كما أُدخلت: جهة وقطاع وإدارة ومبلغ ومرحلة ومسؤول وشراكة', async () => {
  await db.insert('department', { id: 'D2', sector_id: 'SOL', name_ar: 'إدارة المدن الذكية', active: 1, created_at: T });
  const r = await opps.createOpportunity(CTX, {
    title_ar: 'فرصة كاملة الحقول', sector_id: 'SOL', department_id: 'D1',
    partner_department_ids: ['D2'], client_id: 'CL_EXIST', value_sar: 1234567,
    stage_id: 'LEAD', priority: 'P1', owner_user_id: 'u_mgr', year: 2027, next_action: 'اجتماع تعريفي',
  });
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', [r.id]);
  assert.equal(row.client_id, 'CL_EXIST');
  assert.equal(row.department_id, 'D1');
  assert.equal(row.owner_user_id, 'u_mgr');
  assert.equal(row.priority, 'P1');
  assert.equal(row.year, 2027);
  assert.equal(row.next_action, 'اجتماع تعريفي');
  const partners = await opps.opportunityDepartments(r.id);
  assert.deepEqual(partners.map((p) => p.department_id), ['D2'], 'الشراكة من باب الإضافة نفسها');
});
