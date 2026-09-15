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
  // خالد بلا أي تسكين هذه السنة ⇒ فجواته أشهرُ الماضي كلها — وهو حالة «لم يُسجَّل تسكينه»
  // نادر: **له** سجلُّ تسكينٍ لكنه صفرٌ هذا الشهر ⇒ «على الرف» حقيقةً، لا غيابَ بيانات.
  // الشهر المختار غير الشهر الحالي دائماً كي يبقى صفر «الآن» مقصوداً أياً كان وقت التشغيل.
  await db.insert('employee', { id: 'E3', name_ar: 'نادر القحطاني', job_title: 'مهندس', sector_id: 'S1', department_id: 'D1',
    hire_date: `${YEAR - 1}-01-01`, status: 'نشط', active: 1, created_at: now() });
  const otherMonth = (new Date().getUTCMonth() % 12) + 1 === new Date().getUTCMonth() + 1
    ? ((new Date().getUTCMonth() + 1) % 12) + 1 : ((new Date().getUTCMonth() + 1) % 12) + 1;
  await db.insert('allocation', { id: 'A3', employee_id: 'E3', person_name_ar: 'نادر القحطاني', project_id: 'P1', project_name: 'منصة التحول',
    sector_id: 'S1', type: 'member', year: YEAR, monthly_json: JSON.stringify({ [otherMonth]: 0.5 }), source: 'manual', created_at: now() });
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
  // المدير المباشر يقرأ موظفي إدارته ولا يكتب تسكيناً ولا مشروعاً — القارئ الحقيقي هنا.
  // (كان القارئ مديرَ تطوير الأعمال حتى قرار المالك ٢٠٢٦-٠٨-١٧: صار يدير مشاريع قطاعه
  //  فصارت أزرار التسكين حقاً له — انظر tests/security/bd-project-management.test.js.)
  const reader = { id: 'u_lm', username: 'lm', role_id: 'line_manager', scope: 'department', sector_id: 'S1', departmentIds: ['D1'] };
  const html = await P.staffingPage(reader, {});
  assert.ok(html.includes('id="staff-q"'), 'مرساة الجولة يجب أن تُرندر لكل دور يبلغ الصفحة');
  assert.ok(!html.includes('data-action="staff-new"'), 'زر تسكين جديد ظهر لقارئ');
  assert.ok(!html.includes('data-action="mx-select-toggle"'), 'زر التحديد ظهر لقارئ');
  assert.ok(!/undefined|NaN|\[object/.test(html));
  // ومدير تطوير الأعمال لم يعد قارئاً: زر التسكين يظهر له بقرار المالك ٢٠٢٦-٠٨-١٧.
  const bd = { id: 'u_bd', username: 'bd', role_id: 'bd_manager', scope: 'sector', sector_id: 'S1' };
  const bdHtml = await P.staffingPage(bd, {});
  assert.ok(bdHtml.includes('data-action="staff-new"'), 'يدير مشاريع قطاعه فيسكّن عليها');
});

test('نطاق أعمى: «لا أعضاء ضمن نطاقك» حرفياً', async () => {
  await db.insert('app_user', { id: 'u_dm', username: 'dm', role_id: 'department_manager', scope: 'department', sector_id: 'S1', active: 1, created_at: now() });
  const dm = { id: 'u_dm', username: 'dm', role_id: 'department_manager', scope: 'department', sector_id: 'S1', departmentIds: [] };
  const html = await P.staffingPage(dm, {});
  assert.ok(html.includes('لا أعضاء ضمن نطاقك'));
});

// ── «لم يُسجَّل» ≠ «صفر» ───────────────────────────────────────────────────────
// أخطر ما في شاشة الإشغال أن تدّعي عن موظفٍ أنه فارغٌ بينما الحقيقة أن أحداً لم يُدخل
// تسكينه بعد. على البيانات الحيّة كان أربعةَ عشرَ من سبعةَ عشرَ في قطاع الحلول بلا تسكين،
// فكانت الشاشة تعرضهم جميعاً «على الرف» بنسبة 0% — رقمٌ يبدو قياساً وهو غيابُ قياس.
test('من لا سجلَّ تسكينٍ له يُقال عنه «لم يُسجَّل» — لا يُحسب على الرف بصفرٍ مقيس', async () => {
  const html = await P.staffingPage(ADMIN, {});
  const row = (id) => {
    const i = html.indexOf(`data-emp="${id}"`);
    assert.ok(i > 0, `صفّ ${id} غائب`);
    return html.slice(i, i + 200);
  };
  assert.match(row('E2'), /data-status="unset"/, 'من بلا سجلّ تسكين وُسم حالةً أخرى');
  assert.match(row('E3'), /data-status="bench"/, 'من له سجلّ وصفرُه مقيس لم يُوسم رفّاً');
  assert.match(row('E1'), /data-status="(ok|over|avail)"/, 'المسكَّن فعلاً وُسم خطأً');

  // والقارئ يُخبَر بالعدد وبالأساس الذي بُني عليه المتوسط
  assert.ok(html.includes('لم يُسجَّل تسكينهم بعد'), 'لا إفصاح عن عدد من لم يُسجَّل تسكينهم');
  assert.ok(html.includes('سُجِّل تسكينهم'), 'المتوسط لا يقول على كم سجلٍّ بُني');
  // ومرشِّحٌ يفرزهم — فالعلاج (إدخال التسكين) يبدأ بمعرفة مَن
  assert.ok(html.includes('بلا تسكين مسجَّل'), 'لا مرشِّح لمن بلا تسكين مسجَّل');
});

test('وقائمة «غير مُسكَّن» لا تخلط الصنفين — لكلٍّ عنوانه وعلاجه', async () => {
  const html = await P.staffingPage(ADMIN, {});
  const dd = html.slice(html.indexOf('dd-bench'), html.indexOf('dd-bench') + 2500);
  assert.ok(dd.includes('نادر القحطاني'), 'الرفّ الحقيقي غائب عن قائمته');
  assert.ok(dd.includes('خالد الغامدي'), 'من لم يُسجَّل تسكينه غائب عن القائمة كلها');
  assert.ok(dd.includes('غيابُ بيانات لا فراغُ طاقة'), 'لم يُفصَل الصنفان بعنوانٍ يشرح الفارق');
  // ولا يُنسب إليه «0%» — فهو ادّعاء قياسٍ لم يقع. والفحص على صفّه هو، لا على نافذةٍ
  // تمتدّ إلى قوائم أخرى بعده (فيها أصفارٌ مشروعة لمن قِيسوا فعلاً).
  const rowOfName = (name) => {
    const i = dd.indexOf(name);
    assert.ok(i > 0, `${name} غائب عن القائمة`);
    return dd.slice(dd.lastIndexOf('<div class="dd-row"', i), dd.indexOf('</div>', i + name.length) + 200);
  };
  const khaled = rowOfName('خالد الغامدي');
  assert.ok(khaled.includes('لم يُسجَّل'), 'لم يُقل عنه «لم يُسجَّل»');
  assert.ok(!khaled.includes('0%'), 'ما زال يُنسب صفرٌ مقيس لمن لا سجلَّ له');
  assert.ok(rowOfName('نادر القحطاني').includes('0%'), 'الرفّ الحقيقي فقد صفره المقيس');
});
