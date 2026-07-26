// الهيكل ذاتي الخدمة + منع تكرار الأسماء — قراران صريحان من المالك:
//  (١) «ممكن مدير قطاع يضيف إداراتهم ويغير المناصب حسب الحاجة» — كان مستحيلاً: إنشاء الإدارة
//      محروس بصلاحية على مورد «القطاع» لا يملكها قائد القطاع إطلاقاً، ولم تكن هناك أي خدمة
//      تعديل أو حذف للإدارات (إنشاء فقط بلا رجعة).
//  (٢) «ما ينفع يكون في أسماء مكررة» — لم يكن هناك أي فحص تكرار في الكود كله.
// دليل القبول الحقيقي من هيكلة EVC: إعادة تسمية «قطاع المدن الذكية» إلى «إدارة المدن الذكية»
// ونقلها تحت الحلول، بلا فقدان بيانات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-orgss-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const org = await import('../../src/modules/org/org.js');

const T = '2026-07-01T00:00:00Z';
const ctx = (user) => ({ user, ip: '127.0.0.1' });
// قائد قطاع الحلول: يملك update employee على قطاعه ⟵ يملك هيكل قطاعه
const lead = { id: 'u_lead', role_id: 'sector_lead', sector_id: 'SOLUTIONS', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const otherLead = { id: 'u_other', role_id: 'sector_lead', sector_id: 'CONSULTING', scope: 'sector', projectIds: new Set(), teamIds: new Set() };
const admin = { id: 'u_admin', role_id: 'admin', sector_id: null, scope: 'company', projectIds: new Set(), teamIds: new Set() };
const bd = { id: 'u_bd', role_id: 'bd_manager', sector_id: 'SOLUTIONS', scope: 'sector', projectIds: new Set(), teamIds: new Set() };

before(async () => {
  await insert('sector', { id: 'SOLUTIONS', name_ar: 'قطاع الحلول', active: 1, sort_order: 1, created_at: T });
  await insert('sector', { id: 'CONSULTING', name_ar: 'قطاع الاستشارات', active: 1, sort_order: 2, created_at: T });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

// ── (١) الهيكل ذاتي الخدمة ──
test('قائد القطاع يضيف إدارة داخل قطاعه بنفسه — كان محروساً على مدير النظام وحده', async () => {
  const d = await org.createDepartment(ctx(lead), { sector_id: 'SOLUTIONS', name_ar: 'إدارة البيانات والذكاء الاصطناعي والابتكار' });
  assert.ok(d.id, 'أُنشئت الإدارة');
  assert.equal(d.sector_id, 'SOLUTIONS');
  const a = await get('SELECT id FROM audit_log WHERE resource = ? AND resource_id = ?', ['department', d.id]);
  assert.ok(a, 'كل كتابة تُدقَّق');
});

test('قائد القطاع يُمنع من العبث بهيكل قطاع غيره', async () => {
  await assert.rejects(
    () => org.createDepartment(ctx(otherLead), { sector_id: 'SOLUTIONS', name_ar: 'إدارة دخيلة' }),
    (e) => e.code === 'forbidden', 'قائد قطاع آخر يُرفض'
  );
});

test('من لا يملك إدارة الفريق (تطوير الأعمال) يُمنع من تعديل الهيكل', async () => {
  await assert.rejects(
    () => org.createDepartment(ctx(bd), { sector_id: 'SOLUTIONS', name_ar: 'إدارة من تطوير الأعمال' }),
    (e) => e.code === 'forbidden'
  );
});

test('دليل القبول: إعادة تسمية إدارة ونقلها بين القطاعين بلا فقدان بيانات', async () => {
  const d = await org.createDepartment(ctx(admin), { sector_id: 'CONSULTING', name_ar: 'قطاع المدن الذكية' });
  await insert('employee', { id: 'e_move', name_ar: 'موظف المدن الذكية', sector_id: 'CONSULTING', department_id: d.id, created_at: T });

  // إعادة تسمية + نقل إلى الحلول في عملية واحدة (مدير النظام يملك الطرفين)
  const moved = await org.updateDepartment(ctx(admin), d.id, { name_ar: 'إدارة المدن الذكية', sector_id: 'SOLUTIONS' });
  assert.equal(moved.name_ar, 'إدارة المدن الذكية');
  assert.equal(moved.sector_id, 'SOLUTIONS');

  const emp = await get('SELECT * FROM employee WHERE id = ?', ['e_move']);
  assert.ok(emp, 'الموظف لم يُفقد');
  assert.equal(emp.department_id, d.id, 'ارتباط الموظف بالإدارة سليم بعد النقل');
});

test('حذف الإدارة يُرفض ما دام بها موظفون — لا يختفي أحد من الشجرة بصمت', async () => {
  const d = await get('SELECT * FROM department WHERE name_ar = ?', ['إدارة المدن الذكية']);
  await assert.rejects(() => org.deleteDepartment(ctx(admin), d.id), /موظف/, 'يذكر العدد ويطلب نقلهم أولاً');
  // بعد إفراغها يُقبل الحذف (حذف ناعم)
  await (await import('../../src/core/db/index.js')).update('employee', 'e_move', { department_id: null });
  await org.deleteDepartment(ctx(admin), d.id);
  const after = await get('SELECT deleted_at FROM department WHERE id = ?', [d.id]);
  assert.ok(after.deleted_at, 'حذف ناعم لا صلب — السجل باقٍ للتدقيق');
});

// ── (٢) منع تكرار الأسماء ──
test('تطبيع الاسم: التشكيل والتطويل وصور الألف والمسافات لا تصنع أسماء مختلفة', () => {
  assert.equal(org.normName('محمّد   عليّ'), org.normName('محمد علي'));
  assert.equal(org.normName('أحمد'), org.normName('احمد'));
  assert.equal(org.normName('فاطمة'), org.normName('فاطمه'));
  assert.equal(org.normName('مصطفى'), org.normName('مصطفي'));
});

test('اسم الموظف فريد على مستوى الشركة — والتكرار يُرفض برسالة عربية واضحة', async () => {
  await org.createEmployee(ctx(admin), { name_ar: 'عمار الرجوب', sector_id: 'SOLUTIONS' });
  await assert.rejects(
    () => org.createEmployee(ctx(admin), { name_ar: 'عمار  الرجوب', sector_id: 'CONSULTING' }),
    /مستخدم بالفعل/, 'حتى بمسافة زائدة وقطاع مختلف'
  );
});

test('إعادة تسمية موظف إلى اسم قائم تُرفض — لا التفاف على القاعدة بالتعديل', async () => {
  const e = await org.createEmployee(ctx(admin), { name_ar: 'أيوب الزاكي', sector_id: 'SOLUTIONS' });
  await assert.rejects(
    () => org.updateEmployee(ctx(admin), e.id, { name_ar: 'عمار الرجوب' }),
    /مستخدم بالفعل/
  );
  // وحفظ السجل نفسه بنفس اسمه يمر (لا يصطدم بذاته)
  const same = await org.updateEmployee(ctx(admin), e.id, { name_ar: 'أيوب الزاكي', job_title: 'مدير إدارة' });
  assert.equal(same.job_title, 'مدير إدارة');
});

test('اسم الإدارة فريد داخل قطاعه فقط — لا عبر الشركة', async () => {
  await org.createDepartment(ctx(admin), { sector_id: 'SOLUTIONS', name_ar: 'إدارة العمليات' });
  await assert.rejects(
    () => org.createDepartment(ctx(admin), { sector_id: 'SOLUTIONS', name_ar: 'إدارة  العمليات' }),
    /مستخدم بالفعل/, 'تكرار داخل نفس القطاع يُرفض'
  );
  const ok = await org.createDepartment(ctx(admin), { sector_id: 'CONSULTING', name_ar: 'إدارة العمليات' });
  assert.ok(ok.id, 'نفس الاسم مسموح في قطاع آخر — لكل قطاع عملياته');
});

test('اسم الوحدة فريد داخل إدارتها، وإنشاؤها يخضع لصلاحية قطاع إدارتها', async () => {
  const d = await get('SELECT * FROM department WHERE sector_id = ? AND name_ar = ?', ['SOLUTIONS', 'إدارة العمليات']);
  await org.createUnit(ctx(lead), { department_id: d.id, name_ar: 'وحدة التشغيل' });
  await assert.rejects(() => org.createUnit(ctx(lead), { department_id: d.id, name_ar: 'وحدة التشغيل' }), /مستخدم بالفعل/);
  await assert.rejects(
    () => org.createUnit(ctx(otherLead), { department_id: d.id, name_ar: 'وحدة دخيلة' }),
    (e) => e.code === 'forbidden', 'قائد قطاع آخر لا يضيف وحدة داخل إدارة ليست في قطاعه'
  );
});
