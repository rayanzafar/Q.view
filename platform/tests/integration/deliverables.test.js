// المخرجات داخل المشروع — أول مسار في المنتج يضيفها ويحرّك حالتها بعد إنشاء المشروع.
// قبل هذا: الكتابة الوحيدة كانت لحظة استلام العقد، والتحويل الآلي إلى «مُفوتر» عند إصدار
// المستخلص. فالمنصة كانت تُنبِّه على «مخرجات شهور سابقة لم تُقبل» بينما لا يملك أحد أداةً
// لقبولها. هذا الملف يثبّت: الإضافة، الانتقال وتواريخه، حارس المشروع على مستوى الصف،
// كتابة سجل التدقيق، وحدَّ ما يملكه الإنسان مقابل ما يملكه المسار المالي.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-dlv-'));
process.env.SANAD_DB = join(dir, 'd.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

const { insert, get, all, update, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const gov = await import('../../src/modules/pmo/governance.js');

const TS = '2026-07-01T00:00:00Z';
const ctx = (u) => ({ user: u, ip: '127.0.0.1' });
const U = (id, role, sector, scope) => ({ id, role_id: role, sector_id: sector, scope, projectIds: new Set(), teamIds: new Set() });

const lead = U('d_lead', 'sector_lead', 'D1', 'sector');       // يدير قطاع المشروع
const foreign = U('d_out', 'sector_lead', 'D2', 'sector');      // قائد قطاع آخر
const consultant = U('d_cons', 'consultant', 'D1', 'own');      // عضو مشروع بلا صلاحية إدارة

before(async () => {
  await insert('sector', { id: 'D1', name_ar: 'الحلول', active: 1, sort_order: 1, kind: 'delivery', created_at: TS });
  await insert('sector', { id: 'D2', name_ar: 'الاستشارات', active: 1, sort_order: 2, kind: 'delivery', created_at: TS });
  for (const [id, sec, role] of [['d_lead', 'D1', 'sector_lead'], ['d_out', 'D2', 'sector_lead'], ['d_cons', 'D1', 'consultant']]) {
    await insert('app_user', { id, username: id, name_ar: 'مستخدم ' + id, role_id: role, sector_id: sec, scope: 'own', active: 1, created_at: TS });
  }
  await insert('project', { id: 'DP1', name_ar: 'مشروع المخرجات', sector_id: 'D1', status: 'IN_PROGRESS', rag: 'GREEN',
    start_date: '2026-01-01', end_date: '2026-12-31', created_at: TS });
  consultant.projectIds = new Set(['DP1']);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test('المخرج يُضاف من صفحة المشروع — وكان مستحيلاً بعد إنشاء المشروع', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'تقرير المرحلة الأولى', period: '2026-06', amount_sar: 45000 });
  assert.equal(d.name_ar, 'تقرير المرحلة الأولى');
  assert.equal(d.status, 'DRAFT', 'المخرَج يولد مسودةً — أول خطوة في دورة العمل البشرية');
  assert.equal(d.amount_halalas, 4_500_000, 'المال هللات صحيحة لا كسور عشرية');
  assert.equal(d.month, 6);
  assert.equal(d.year, 2026, 'الشهر لا يُخزَّن بلا سنته — وإلا سقط من تنبيه الأشهر السابقة');
  assert.equal(d.sector_id, 'D1', 'يرث قطاع المشروع فتصله تغذية «يحتاج انتباهك»');
  assert.equal(d.delivered_at, null);
  // ويظهر في حمولة صفحة المشروع نفسها
  const payload = await gov.projectGovernance(lead, 'DP1');
  assert.ok(payload.deliverables.some((x) => x.id === d.id), 'المخرجات ضمن سجلات الحوكمة لا استعلام موازٍ');
});

test('اسم فارغ يُرفض برسالة عربية تخص المخرج لا رسالة عامة', async () => {
  await assert.rejects(() => gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: '   ' }), /اسم المخرج مطلوب/);
});

test('القيمة غير المتفق عليها تُخزَّن فراغاً لا صفراً', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'ورشة تسليم' });
  assert.equal(d.amount_halalas, null, 'الفراغ يُعرض «غير محدَّدة»؛ الصفر يُقرأ اتفاقاً على لا شيء');
  assert.equal(d.month, null);
  assert.equal(d.year, null);
});

test('قيمة غير صحيحة أو شهر غير صحيح يُرفضان بما يقوله المستخدم لا بخطأ داخلي', async () => {
  await assert.rejects(() => gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'س', amount_sar: 'كثير' }), /رقماً بالريال/);
  await assert.rejects(() => gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'س', amount_sar: -5 }), /رقماً بالريال/);
  await assert.rejects(() => gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'س', period: '2026-13' }), /شهر الاستحقاق/);
});

test('التسليم ثم القبول ينقلان الحالة ويكتبان تاريخيهما — وكانا عمودين لا يكتبهما شيء', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج ينتقل' });
  const del = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'DELIVERED' });
  assert.equal(del.status, 'DELIVERED');
  assert.ok(del.delivered_at, 'تاريخ التسليم يُكتب لحظة الانتقال');
  assert.equal(del.accepted_at, null);

  const acc = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'ACCEPTED' });
  assert.equal(acc.status, 'ACCEPTED');
  assert.equal(acc.delivered_at, del.delivered_at, 'تاريخ التسليم الأصلي لا يُعاد كتابته');
  assert.ok(acc.accepted_at, 'تاريخ القبول يُكتب');

  const back = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'DRAFT' });
  assert.equal(back.delivered_at, null, 'العودة إلى المسودة تمحو تاريخين لم يعودا صحيحين');
  assert.equal(back.accepted_at, null);

  const wip = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'IN_PROGRESS' });
  assert.equal(wip.status, 'IN_PROGRESS', '«جارٍ العمل» خطوة قائمة بذاتها بين المسودة والتسليم');
  assert.equal(wip.delivered_at, null);

  const rej = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'REJECTED' });
  assert.equal(rej.status, 'REJECTED');
});

test('كل تغيير حالة يُختم باسم من غيّره ووقته — وهذا كل «مسار الاعتماد» المطلوب', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج مختوم' });
  assert.equal(d.status_by, lead.id, 'الإنشاء نفسه ختمٌ أول');
  const acc = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'ACCEPTED' });
  assert.equal(acc.status_by, lead.id, 'الاعتماد قرارُ شخص لا حدثٌ بلا صاحب');
  assert.ok(acc.status_at, 'ومعه وقته');
});

test('الفوترة والتحصيل ختمان مستقلان لا يمسّان حالة العمل — ولا يُضبطان بيد الإنسان', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج مالي' });
  // لا يُقبلان من مسار المشروع: لا حالةً (لم تعودا حالتين) ولا حقلاً مباشراً.
  await assert.rejects(() => gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'INVOICED' }), /الحالة غير صحيحة/);
  await assert.rejects(() => gov.updateItem(ctx(lead), 'deliverable', d.id, { invoiced_at: '2026-01-01' }), /من صفحة المالية/);
  await assert.rejects(() => gov.updateItem(ctx(lead), 'deliverable', d.id, { collected_at: '2026-01-01' }), /من صفحة المالية/);
  assert.equal((await get('SELECT status FROM deliverable WHERE id = ?', [d.id])).status, 'DRAFT', 'لم تتغير الحالة فعلياً');
});

test('المخرج المفوتر تبقى حالته حالته — الفوترة لا تُقرأ إنجازاً ولا اعتماداً', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج مفوتر', amount_sar: 1000 });
  await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'ACCEPTED' });
  await update('deliverable', d.id, { invoiced_at: TS }); // كما يفعل مسار المستخلص فعلياً
  const after = await get('SELECT * FROM deliverable WHERE id = ?', [d.id]);
  assert.equal(after.status, 'ACCEPTED', 'الختم المالي لا يدوس اعتماد العميل — وهو العيب الذي عولج');
  assert.ok(after.invoiced_at, 'والختم مسجَّل بجانبه');
  // والحالة تبقى بيد الفريق بعد الفوترة: قد يُعاد التسليم، وهو واقعٌ لا شذوذ.
  const re = await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'DELIVERED' });
  assert.equal(re.status, 'DELIVERED');
  assert.ok(re.invoiced_at, 'وختم الفوترة باقٍ — لا تُفكّ فاتورة صادرة من شاشة مشروع');
  // لكن الحذف ممنوع: يترك سطر فاتورة يشير إلى لا شيء.
  await assert.rejects(() => gov.deleteItem(ctx(lead), 'deliverable', d.id), /ألغِ الفاتورة أولاً/);
  const renamed = await gov.updateItem(ctx(lead), 'deliverable', d.id, { name_ar: 'مخرج مفوتر (اسم مصحَّح)' });
  assert.equal(renamed.name_ar, 'مخرج مفوتر (اسم مصحَّح)');
});

test('حارس المشروع على مستوى الصف: من هو خارج المشروع لا يضيف ولا يعدّل ولا يحذف', async () => {
  await assert.rejects(() => gov.createItem(ctx(foreign), 'DP1', 'deliverable', { name_ar: 'دسّ من قطاع آخر' }),
    (e) => e.code === 'forbidden' || e.code === 'not_found');
  const mine = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج محروس' });
  await assert.rejects(() => gov.updateItem(ctx(foreign), 'deliverable', mine.id, { status: 'DELIVERED' }),
    (e) => e.code === 'forbidden' || e.code === 'not_found');
  await assert.rejects(() => gov.deleteItem(ctx(foreign), 'deliverable', mine.id),
    (e) => e.code === 'forbidden' || e.code === 'not_found');
  // وعضو المشروع بلا صلاحية إدارة يقرأ ولا يكتب
  await assert.rejects(() => gov.createItem(ctx(consultant), 'DP1', 'deliverable', { name_ar: 'من عضو' }), (e) => e.code === 'forbidden');
  assert.ok((await gov.listItems(consultant, 'DP1', 'deliverable')).length > 0, 'القراءة مسموحة لعضو المشروع');
});

test('كل كتابة على المخرج تترك أثراً في سجل التدقيق', async () => {
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج مُدقَّق' });
  await gov.updateItem(ctx(lead), 'deliverable', d.id, { status: 'DELIVERED' });
  const rows = await all('SELECT action, resource, resource_id FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY at', ['deliverable', d.id]);
  assert.ok(rows.some((r) => r.action === 'create'), 'الإضافة مسجَّلة');
  assert.ok(rows.some((r) => r.action === 'update'), 'التحديث مسجَّل');
  await gov.deleteItem(ctx(lead), 'deliverable', d.id);
  const after = await all('SELECT action FROM audit_log WHERE resource = ? AND resource_id = ?', ['deliverable', d.id]);
  assert.ok(after.some((r) => r.action === 'delete'), 'الحذف مسجَّل');
  assert.ok((await get('SELECT deleted_at FROM deliverable WHERE id = ?', [d.id])).deleted_at, 'حذف ناعم لا محو');
});

test('المسار العام للمخرجات مشتقّ من سجل الأنواع نفسه — لا خريطة ثانية تُنسى', async () => {
  assert.equal(gov.GOVERNANCE_PLURALS.deliverables, 'deliverable');
  const { governanceRouter } = await import('../../src/modules/pmo/governance.routes.js');
  const paths = governanceRouter.stack.map((l) => l.route && l.route.path).filter(Boolean);
  assert.ok(paths.includes('/projects/:id/deliverables'), 'مسار الإضافة موجود فعلاً');
  assert.ok(paths.includes('/pmo/deliverable/:id'), 'مسار تغيير الحالة موجود فعلاً');
});

// ── الواجهة: «سهولة» المالك تعني نقرة واحدة داخل صفحة المشروع لا رحلة شاشات ──
test('صفحة المشروع: إضافة مخرَج وتحريك حالته بنقرة، وإضافة مهمة تسقط على المشروع نفسه', async () => {
  const { projectDetailPage } = await import('../../src/web/views/pmo.js');
  const d = await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج للعرض', period: '2026-08', amount_sar: 12000 });
  const html = await projectDetailPage(lead, 'DP1');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

  assert.ok(main.includes('id="g-dlv-name"'), 'شريط إضافة مخرَج داخل الصفحة');
  assert.ok(main.includes('id="g-dlv-period"') && main.includes('أغسطس'), 'شهر الاستحقاق بأسماء عربية كاملة');
  assert.ok(main.includes('data-kind="deliverable"'), 'أزرار المخرجات موصولة بسجل الحوكمة نفسه');
  assert.ok(main.includes('مخرج للعرض'), 'المخرج المضاف يظهر في الجدول');
  assert.ok(main.includes('data-action="gov-status"'), 'انتقال الحالة بنقرة واحدة من الصف');
  assert.ok(main.includes('تسليم'), 'الفعل التالي معروض باسمه لا برمز');
  assert.ok(main.includes('id="prj-task-title"') && main.includes('id="prj-task-due"'), 'إضافة مهمة على المشروع بموعدها');
  assert.ok(!/undefined|NaN|\[object/.test(main), 'لا تسريب قيم تقنية في صفحة المشروع');

  // المخرَج بلا قيمة يُقرأ «غير محدَّدة» لا صفراً
  await gov.createItem(ctx(lead), 'DP1', 'deliverable', { name_ar: 'مخرج بلا قيمة' });
  const html2 = await projectDetailPage(lead, 'DP1');
  assert.ok(html2.includes('غير محدَّدة'), 'الغياب يُعرض غياباً لا رقماً');
});

test('صفحة المشروع لمن لا يملك الإدارة: قراءة بلا أدوات كتابة', async () => {
  const { projectDetailPage } = await import('../../src/web/views/pmo.js');
  const html = await projectDetailPage(consultant, 'DP1');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.ok(!main.includes('id="g-dlv-name"'), 'لا شريط إضافة مخرَج لمن لا يملك إدارة المشروع');
  assert.ok(!main.includes('data-action="gov-status"'), 'ولا أزرار تحريك الحالة');
  assert.ok(main.includes('للقراءة فقط بدورك الحالي'), 'ويُقال له لماذا بوضوح');
});
