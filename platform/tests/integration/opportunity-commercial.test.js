// «وأي فرصة… يا إنه تحطها اتفاقية إطارية، وبرضو يكون في مساحة تكون RFI أو RFP، وكم المبلغ
// بضريبة وبدون ضريبة» — بلسان المالك.
//
// ثلاثة أشياء، وثالثها ليس حقلاً جديداً بل قاعدةً قائمة تُعلَن: المبلغ المسجَّل على أي مستندٍ
// تجاري **إجمالي** — ما تدفعه الجهة — والصافي يُشتقّ منه بقاعدةٍ واحدة مكتوبة في
// `modules/finance/vat.js`. فلا عمود ضريبةٍ ثانٍ على الفرصة: الفرصةُ تصير عقداً ثم فاتورةً ثم
// تحصيلاً، ولو اختلف تفسير رقمها هنا عن تفسيره هناك لاختلف الرقم على نفسه في رحلته.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-comm-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, P, vat;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company' };
const CTX = { user: ADMIN, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  const rbac = await import('../../src/core/rbac/index.js');
  await rbac.initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  vat = await import('../../src/modules/finance/vat.js');
  P = await import('../../src/web/pages.js');
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  // مرحلة «ترشيح» هي الافتراضية عند الإنشاء، فبدونها يسقط الإدراج على قيد المفتاح الأجنبي.
  await db.insert('stage', { id: 'LEAD', name_ar: 'ترشيح', is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('stage', { id: 'PROPOSAL', name_ar: 'عرض مقدَّم', is_won: 0, is_lost: 0, sort_order: 3 });
  await db.insert('app_user', { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const mk = (over = {}) => opps.createOpportunity(CTX, { title_ar: 'فرصة', sector_id: 'SOL', value_sar: 1150, ...over });

test('الفرصة تُولَد باتفاقيةٍ إطارية ونوعِ طرحٍ معلوم', async () => {
  const o = await mk({ engagement_type: 'FRAMEWORK', solicitation_type: 'RFP' });
  const row = await db.get('SELECT engagement_type, solicitation_type FROM opportunity WHERE id=?', [o.id]);
  assert.equal(row.engagement_type, 'FRAMEWORK');
  assert.equal(row.solicitation_type, 'RFP');
});

test('وتُبدَّل صفتها من صفحتها — من استطلاع سوق إلى طلب عرض', async () => {
  const o = await mk({ solicitation_type: 'RFI' });
  await opps.updateOpportunity(CTX, o.id, { solicitation_type: 'RFP', engagement_type: 'PROJECT' });
  const row = await db.get('SELECT engagement_type, solicitation_type FROM opportunity WHERE id=?', [o.id]);
  assert.equal(row.solicitation_type, 'RFP');
  assert.equal(row.engagement_type, 'PROJECT');
});

test('وتُمحى الصفة صراحةً — «لم يُحدَّد» جوابٌ صادق لا خطأ', async () => {
  const o = await mk({ engagement_type: 'FRAMEWORK', solicitation_type: 'RFQ' });
  await opps.updateOpportunity(CTX, o.id, { engagement_type: '', solicitation_type: '' });
  const row = await db.get('SELECT engagement_type, solicitation_type FROM opportunity WHERE id=?', [o.id]);
  assert.equal(row.engagement_type, null);
  assert.equal(row.solicitation_type, null);
});

// قيمةٌ لا تعرفها القوائم تصنع شريحةً يتيمة في كل تقرير — تُرَدّ عند الباب.
test('وقيمةٌ خارج القائمتين تُرَدّ برسالة عربية', async () => {
  const o = await mk();
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { solicitation_type: 'EOI' }),
    (e) => /نوع الطرح/.test(e.message) && /اختر من القائمة/.test(e.message));
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { engagement_type: 'RETAINER' }),
    (e) => /نوع الارتباط/.test(e.message));
  await assert.rejects(() => mk({ solicitation_type: 'EOI' }), (e) => /نوع الطرح/.test(e.message));
});

// ── الضريبة: رقمٌ واحد بثلاثة وجوه، من القاعدة الواحدة ───────────────────────
test('المبلغ يُعرَض بضريبةٍ وبدونها — والاشتقاق من قاعدة المنصة الواحدة لا من نسخةٍ ثانية', async () => {
  const o = await mk({ value_sar: 1150 });
  const html = await P.opportunityDetailPage(ADMIN, o.id);
  const m = vat.splitGross(115000); // ١١٥٠ ريالاً بالهللات
  assert.equal(m.net_halalas, 100000, 'قاعدة الصافي تغيّرت — الفحص يقيس شيئاً آخر');
  assert.equal(m.vat_halalas, 15000);
  assert.ok(html.includes('المبلغ شاملاً الضريبة'), 'الشاشة لا تقول إن المُدخَل إجمالي');
  assert.ok(html.includes('بدون ضريبة'), 'لا يظهر المبلغ بدون ضريبة');
  // ١٬٠٠٠ و١٬١٥٠ و١٥٠ — بأي تنسيقٍ عرضته الشاشة
  for (const n of ['1,000', '1,150', '150']) {
    assert.ok(html.includes(n), `الرقم ${n} غائب عن عرض الضريبة`);
  }
});

test('وصفة الفرصة تُقرأ على شاشتها: شارةٌ في الترويسة وسطرٌ في التفاصيل', async () => {
  const o = await mk({ engagement_type: 'FRAMEWORK', solicitation_type: 'RFI' });
  const html = await P.opportunityDetailPage(ADMIN, o.id);
  assert.ok(html.includes('اتفاقية إطارية'), 'شارة الاتفاقية الإطارية غائبة');
  assert.ok(html.includes('استطلاع سوق (RFI)'), 'نوع الطرح غائب');
  assert.ok(html.includes('oc-engagement') && html.includes('oc-solicitation'), 'لا خانتان في شريط التحكم');
  // وشرحُ كلٍّ حاضر كي لا يُختار نوعٌ بالتخمين
  assert.ok(html.includes('سقفٌ لا التزامٌ مؤكَّد'), 'شرح الاتفاقية الإطارية غائب');
});

test('وفرصةٌ بلا صفةٍ تقول «لم يُحدَّد» ولا تخترع نوعاً', async () => {
  const o = await mk();
  const html = await P.opportunityDetailPage(ADMIN, o.id);
  assert.ok(html.includes('لم يُحدَّد'), 'تُعرض قيمةٌ مخترَعة بدل الإقرار بأنها غير محدَّدة');
});

// ── المبلغ يُكتب بأي وجهٍ، ويُخزَّن بوجهٍ واحد ────────────────────────────────
// «وينضاف مبلغها مع الضريبة أو بدون» — بلسان المالك. والجهة تقتبس أحياناً صافياً وأحياناً
// إجمالياً، فإجبارُ المُدخِل على ضرب الرقم في ١٫١٥ بنفسه يُنتج أخطاءً صامتة في مبلغٍ يُحاسَب
// عليه. والمخزَّن يبقى إجمالياً دائماً — فلا يصير للمبلغ تفسيران حسب الباب الذي دخل منه.
test('المبلغ يُكتب بدون ضريبة فيُحفَظ شاملاً لها', async () => {
  const o = await mk({ value_sar: 1000, value_vat_included: false });
  const row = await db.get('SELECT value_halalas FROM opportunity WHERE id=?', [o.id]);
  assert.equal(row.value_halalas, 115000, 'ألفُ ريالٍ صافيةً يجب أن تُحفَظ ١١٥٠ إجمالياً');
  assert.equal(vat.netOfGross(row.value_halalas), 100000, 'والعودة تُرجع الصافي كما كُتب');
});

test('ويُكتب شاملاً لها فيُحفَظ كما هو — وهو السلوك الافتراضي', async () => {
  const a = await mk({ value_sar: 1150, value_vat_included: true });
  const b = await mk({ value_sar: 1150 }); // بلا راية إطلاقاً
  for (const o of [a, b]) {
    const row = await db.get('SELECT value_halalas FROM opportunity WHERE id=?', [o.id]);
    assert.equal(row.value_halalas, 115000, 'المبلغ الشامل تغيّر عند الحفظ');
  }
});

test('والتعديل يقبل الوجهين كذلك — لا باب الإنشاء وحده', async () => {
  const o = await mk({ value_sar: 1150 });
  await opps.updateOpportunity(CTX, o.id, { value_sar: 2000, value_vat_included: false });
  assert.equal((await db.get('SELECT value_halalas FROM opportunity WHERE id=?', [o.id])).value_halalas, 230000);
  await opps.updateOpportunity(CTX, o.id, { value_sar: 2300, value_vat_included: true });
  assert.equal((await db.get('SELECT value_halalas FROM opportunity WHERE id=?', [o.id])).value_halalas, 230000,
    'الوجهان يؤدّيان إلى نفس المخزَّن — وإلا صار للمبلغ تفسيران');
});

test('وخانة الاختيار على الشاشة، والمحفوظ يبقى الشامل', async () => {
  const o = await mk({ value_sar: 1150 });
  const html = await P.opportunityDetailPage(ADMIN, o.id);
  assert.ok(html.includes('oc-vat'), 'لا خانة اختيارٍ لوجه المبلغ');
  assert.ok(html.includes('شامل الضريبة') && html.includes('بدون ضريبة'), 'الخياران غير معروضين');
  assert.ok(html.includes('المحفوظ دائماً هو الشامل'), 'الشاشة لا تقول أيُّ رقمٍ يُحفَظ');
});
