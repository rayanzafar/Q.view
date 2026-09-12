// ── كتابة خريطة أشهر لتسكينٍ واحد (v5.26) ────────────────────────────────────
// «طبّق على الأشهر المحددة» و«نسخ شهرٍ إلى مدى» يكتبان خريطةً دفعةً واحدة: تحديثٌ واحد
// وسطرُ تدقيقٍ واحد بتفصيل الأشهر — والفرعان القائمان (خلية واحدة / مدى موحّد) لا يمسّهما
// شيء: مفاتيح الحمولة منفصلة والاختبار يثبّت الثلاثة معاً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-months.db');
process.env.SANAD_DB = TEST_DB;

let db, projects;
const YEAR = new Date().getUTCFullYear();
const now = () => new Date().toISOString();
const U = (role, sector, scope, extra = {}) => ({ id: 'u_' + role + (sector || ''), username: role, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set(), ...extra });
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const mjOf = async (id) => JSON.parse((await db.get('SELECT monthly_json FROM allocation WHERE id = ?', [id])).monthly_json);

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
  await db.insert('employee', { id: 'E1', name_ar: 'موظف', sector_id: 'S1', status: 'نشط', active: 1, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'مشروع', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
  await db.insert('allocation', { id: 'A1', employee_id: 'E1', person_name_ar: 'موظف', project_id: 'P1', project_name: 'مشروع',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ 7: 1, 9: 0.4 }), source: 'manual', created_at: now() });
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('الخريطة تكتب أشهرها فقط: قيمٌ تُدمج، وصفرٌ يمسح شهره، وما لم يُذكر يبقى', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  const r = await projects.setAllocationMonths(ctx(lead), 'A1', { 3: 50, 4: 80, 7: 0 });
  assert.deepEqual(r.months, { 3: 0.5, 4: 0.8, 9: 0.4 }, 'سبتمبر المحرَّر يدوياً لم يُمسّ ويوليو مُسح');
  assert.deepEqual(await mjOf('A1'), { 3: 0.5, 4: 0.8, 9: 0.4 });
  const aud = await db.get(`SELECT * FROM audit_log WHERE resource='allocation' AND resource_id='A1' AND action='update' ORDER BY at DESC LIMIT 1`);
  const det = JSON.parse(aud.detail_json);
  assert.deepEqual(det.months, { 3: 50, 4: 80, 7: 0 }, 'سطر تدقيق واحد بتفصيل الأشهر نسباً');
  const n = await db.get(`SELECT COUNT(*) c FROM audit_log WHERE resource='allocation' AND resource_id='A1' AND action='update'`);
  assert.equal(Number(n.c), 1, 'كتابة الخريطة سطرُ تدقيقٍ واحد لا سطرٌ لكل شهر');
});

test('نفس عقد الخلية: قصّ 0–150، وشهر خارج 1..12 ونسبة غير رقمية يُرفضان بالعربية', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await projects.setAllocationMonths(ctx(lead), 'A1', { 5: 900 });
  assert.equal((await mjOf('A1'))[5], 1.5, 'فوق 150 يُقصّ إلى السقف');
  await assert.rejects(() => projects.setAllocationMonths(ctx(lead), 'A1', { 13: 50 }), /بين 1 و12/);
  await assert.rejects(() => projects.setAllocationMonths(ctx(lead), 'A1', { 3: 'كثير' }), /نسبة تسكين صحيحة/);
  await assert.rejects(() => projects.setAllocationMonths(ctx(lead), 'A1', {}), /شهراً واحداً على الأقل/);
});

test('التفويض تفويض الخلية نفسه: قائد قطاعٍ آخر وموظفٌ بلا صلاحية يُرَدّان', async () => {
  await assert.rejects(() => projects.setAllocationMonths(ctx(U('sector_lead', 'S2', 'sector')), 'A1', { 3: 10 }),
    /صلاحية إدارة المشروع/);
  await assert.rejects(() => projects.setAllocationMonths(ctx(U('employee', 'S1', 'own')), 'A1', { 3: 10 }),
    /صلاحية إدارة المشروع/);
});

test('التوجيه في PATCH واحد: months خريطةً، وmonth خليةً، وpct مدىً — الفرعان القائمان بلا مساس', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  // months أولاً
  await projects.setAllocation(ctx(lead), 'A1', { months: { 2: 30 } });
  assert.equal((await mjOf('A1'))[2], 0.3);
  // month خلية واحدة (العقد المثبَّت في staffing-edit)
  await projects.setAllocation(ctx(lead), 'A1', { month: 2, pct: 60 });
  assert.equal((await mjOf('A1'))[2], 0.6);
  // مدى موحّد يحفظ المحرَّر يدوياً (سبتمبر 40 من البذرة)
  await projects.setAllocation(ctx(lead), 'A1', { pct: 100, fromMonth: 8, toMonth: 10 });
  const mj = await mjOf('A1');
  assert.equal(mj[8], 1);
  assert.equal(mj[9], 0.4, 'الشهر المحرَّر يدوياً داخل المدى يبقى');
  assert.equal(mj[10], 1);
});

test('الإسناد بخريطة أشهر: مشروعٌ وبندٌ داخلي يقبلان months بدل المدى الموحّد', async () => {
  const lead = U('sector_lead', 'S1', 'sector');
  await db.insert('employee', { id: 'E2', name_ar: 'موظفة', sector_id: 'S1', status: 'نشط', active: 1, created_at: now() });
  await projects.assignEmployee(ctx(lead), 'P1', { employeeId: 'E2', months: { 2: 40, 6: 70 } });
  const a = await db.get(`SELECT * FROM allocation WHERE employee_id='E2' AND project_id='P1' AND deleted_at IS NULL`);
  assert.deepEqual(JSON.parse(a.monthly_json), { 2: 0.4, 6: 0.7 }, 'أشهر غير متتالية تُكتب كما حُدّدت');
  // بند داخلي بخريطة — قائد القطاع يملك أمر موظفي قطاعه
  await projects.assignInternalWork(ctx(lead), { employeeId: 'E2', bucket: 'bd', months: { 3: 20 } });
  const b = await db.get(`SELECT * FROM allocation WHERE employee_id='E2' AND work_bucket='bd' AND deleted_at IS NULL`);
  assert.deepEqual(JSON.parse(b.monthly_json), { 3: 0.2 });
  // خريطة كلها أصفار = خطأ إدخال يُقال (بند «تطوير منتجات» الشاغر — فحص التكرار لا يسبق الرسالة)
  await assert.rejects(() => projects.assignInternalWork(ctx(lead), { employeeId: 'E2', bucket: 'product', months: { 4: 0 } }),
    /شهراً واحداً على الأقل/);
});
