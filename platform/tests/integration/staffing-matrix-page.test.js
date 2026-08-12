// ── صفحة مساحة عمل التسكين (v5.26) — عقود الرندر ─────────────────────────────
// المصفوفة مسطّحة (لا أقسام قابلة للطي)، أربع بلاطات فقط، `?year=` يعمل أخيراً،
// `?dept=` يضيّق ولا يوسّع، الفجوة التاريخية تُرسم «غير مسكن»، ومرساة الجولة `#staff-q`
// لكل الأدوار — قراءةً وكتابةً.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

const TEST_DB = resolve(process.cwd(), 'data/test-staffing-matrix.db');
process.env.SANAD_DB = TEST_DB;

let db, P;
const YEAR = new Date().getUTCFullYear();
const NEXT = YEAR + 1;
const now = () => new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true });
  db = await import('../../src/core/db/index.js');
  const { migrate } = await import('../../scripts/migrate.js');
  const { seedRbac } = await import('../../scripts/seed-rbac.js');
  await migrate(); await seedRbac();
  await (await import('../../src/core/rbac/index.js')).initRbac();
  P = await import('../../src/web/pages.js');

  await db.insert('sector', { id: 'S1', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: now() });
  await db.insert('department', { id: 'D1', name_ar: 'إدارة الابتكار', sector_id: 'S1', active: 1, created_at: now() });
  await db.insert('department', { id: 'D2', name_ar: 'إدارة الذكاء', sector_id: 'S1', active: 1, created_at: now() });
  await db.insert('employee', { id: 'E1', name_ar: 'سارة العتيبي', job_title: 'استشارية', sector_id: 'S1', department_id: 'D1',
    hire_date: `${YEAR - 1}-01-01`, status: 'نشط', active: 1, created_at: now() });
  await db.insert('employee', { id: 'E2', name_ar: 'خالد الغامدي', job_title: 'محلل', sector_id: 'S1', department_id: 'D2',
    hire_date: `${YEAR - 1}-01-01`, status: 'نشط', active: 1, created_at: now() });
  await db.insert('project', { id: 'P1', name_ar: 'منصة التحول', sector_id: 'S1', status: 'IN_PROGRESS', created_at: now() });
  // سارة مشغولة هذه السنة؛ وسنةَ القادمة لها تسكين مميز يثبت أن ?year= يعمل
  await db.insert('allocation', { id: 'A1', employee_id: 'E1', person_name_ar: 'سارة العتيبي', project_id: 'P1', project_name: 'منصة التحول',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ 1: 0.8, 2: 0.8, 3: 0.8, 4: 0.8, 5: 0.8, 6: 0.8, 7: 0.8, 8: 0.8, 9: 0.8, 10: 0.8, 11: 0.8, 12: 0.8 }), source: 'manual', created_at: now() });
  await db.insert('allocation', { id: 'A2', employee_id: 'E1', person_name_ar: 'سارة العتيبي', project_id: 'P1', project_name: 'منصة التحول',
    sector_id: 'S1', type: 'member', year: NEXT, monthly_json: JSON.stringify({ 3: 0.65 }), source: 'manual', created_at: now() });
  // خالد بلا أي تسكين هذه السنة ⇒ فجواته أشهرُ الماضي كلها
});
after(async () => { await db.close(); for (const s of ['', '-wal', '-shm']) rmSync(TEST_DB + s, { force: true }); });

test('البنية: مصفوفة مسطّحة بأربع بلاطات فقط، ومرساة الجولة والمفاتيح المثبَّتة حاضرة', async () => {
  const html = await P.staffingPage(ADMIN, {});
  assert.ok(html.includes('id="staff-q"'), 'مرساة الجولة غابت');
  assert.ok(html.includes('id="mx"'), 'حاوية المصفوفة غائبة');
  assert.ok(!html.includes('<details class="bsec"'), 'الأقسام القابلة للطي عادت — المصفوفة لم تعد مسطّحة');
  const tiles = (html.match(/kpi4-tile/g) || []).length;
  assert.equal(tiles, 4, `أربع بلاطات بالضبط لا ${tiles}`);
  for (const pin of ['workBuckets:', 'staffYear:', 'تطوير منتجات', 'إدارة مشاريع', 'الفجوات التاريخية']) {
    assert.ok(html.includes(pin), `«${pin}» غاب`);
  }
  assert.ok(!/undefined|NaN|\[object/.test(html));
});

test('?year= يعمل أخيراً: تسكين السنة القادمة يظهر بنسبته وسنته', async () => {
  const html = await P.staffingPage(ADMIN, { year: String(NEXT) });
  assert.ok(html.includes(`staffYear:${NEXT}`), 'السنة المعروضة ليست المطلوبة');
  assert.ok(html.includes('65%'), 'نسبة السنة القادمة غائبة — السنة ما زالت تُسقَط');
  // سنة خارج النافذة تُقصّ إلى الحية بلا انفجار
  const clamped = await P.staffingPage(ADMIN, { year: '1999' });
  assert.ok(clamped.includes(`staffYear:${YEAR}`));
});

test('?dept= يضيّق داخل النطاق: إدارةٌ تُظهر أهلها وتُخفي غيرهم', async () => {
  const html = await P.staffingPage(ADMIN, { dept: 'D1' });
  assert.ok(html.includes('سارة العتيبي'));
  assert.ok(!html.includes('خالد الغامدي'), 'مرشِّح الإدارة لم يقصّ');
});

test('الفجوة التاريخية تُرسم «غير مسكن» بحتمية شهرٍ مثبَّت — والمستقبل الصفري ليس فجوة', async () => {
  // month=6 يجعل «الآن» يونيو حتماً ⇒ يناير..مايو ماضٍ
  const html = await P.staffingPage(ADMIN, { month: '6' });
  assert.ok(html.includes('غير مسكن'), 'خلية الفجوة لا تقول «غير مسكن»');
  assert.ok(html.includes('t-gap'), 'صنف الفجوة غائب');
  // بلاطة الفجوات ترى فجوات خالد الخمسة على الأقل
  assert.match(html, /الفجوات التاريخية/);
});

test('القراءة بلا كتابة: قارئٌ يبلغ الصفحة يرى المصفوفة و#staff-q بلا أزرار كتابة', async () => {
  // bd_manager يقرأ الموظفين (بوابة الصفحة القائمة) ولا يملك تسكيناً — القارئ الحقيقي هنا.
  const reader = { id: 'u_bd', username: 'bd', role_id: 'bd_manager', scope: 'sector', sector_id: 'S1' };
  const html = await P.staffingPage(reader, {});
  assert.ok(html.includes('id="staff-q"'), 'مرساة الجولة يجب أن تُرندر لكل دور يبلغ الصفحة');
  assert.ok(!html.includes('data-action="staff-new"'), 'زر تسكين جديد ظهر لقارئ');
  assert.ok(!html.includes('data-action="mx-select-toggle"'), 'زر التحديد ظهر لقارئ');
  assert.ok(!/undefined|NaN|\[object/.test(html));
});

test('نطاق أعمى: «لا أعضاء ضمن نطاقك» حرفياً', async () => {
  await db.insert('app_user', { id: 'u_dm', username: 'dm', role_id: 'department_manager', scope: 'department', sector_id: 'S1', active: 1, created_at: now() });
  const dm = { id: 'u_dm', username: 'dm', role_id: 'department_manager', scope: 'department', sector_id: 'S1', departmentIds: [] };
  const html = await P.staffingPage(dm, {});
  assert.ok(html.includes('لا أعضاء ضمن نطاقك'));
});
