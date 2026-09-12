// ── حقول المنافسة: ثابتةٌ على الفرصة (الترحيلة 048) وحرّةٌ لكل منافسة (ADR-0024) ──────────────
// ما تحرسه:
//   ١) الثابت يُكتب عند الإنشاء ويُعدَّل بعده بقاعدة موقع التسليم: الفراغ فراغ، وما لم يُرسَل لا يُمَسّ،
//      والتاريخ والمدة يُردّان بجملةٍ إن لم يصحّا.
//   ٢) الحرّ: الاسم يفرد الحقل (الكتابة باسمٍ قائم تحديث)، والتسمية بالمعرّف لا تصطدم بغيره، والحذف
//      ناعم، والصلاحية صلاحيةُ تعديل الفرصة نفسها.
//   ٣) الحذف الناعم للفرصة يطوي حقولها ويعيدها معها.
//   ٤) صفحة الفرصة: خاناتٌ تُكتب وبطاقتان تُقرآن، والفراغ «لم يُحدَّد» لا تسرّباً.
//   ٥) أدوات المحادثة: التسجيل والتعديل يقبلان الحقول كلها صفاً صفاً، والقراءة تعيدها، والقيمة قبل
//      الضريبة تُسجَّل شاملةً كما تفعل الشاشة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-tender-'));
process.env.SANAD_DB = join(dir, 't.db');
const ROOT = new URL('../..', import.meta.url).pathname;
for (const s of ['scripts/migrate.js', 'scripts/seed-rbac.js']) {
  execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, s)], { env: process.env, stdio: 'ignore' });
}

let db, opps, fields, P, lifecycle, runTool;
const T = new Date().toISOString();
const ADMIN = { id: 'u_admin', username: 'admin', role_id: 'admin', scope: 'company', projectIds: new Set(), teamIds: new Set() };
const OTHER = { id: 'u_other', username: 'other', name_ar: 'موظف', role_id: 'employee', scope: 'own', sector_id: 'SOL', projectIds: new Set(), teamIds: new Set() };
const CTX = { user: ADMIN, ip: '1' };
const asOther = { user: OTHER, ip: '1' };

before(async () => {
  db = await import('../../src/core/db/index.js');
  await (await import('../../src/core/rbac/index.js')).initRbac();
  opps = await import('../../src/modules/crm/opportunities.js');
  fields = await import('../../src/modules/crm/oppfields.js');
  P = await import('../../src/web/pages.js');
  lifecycle = await import('../../src/core/lifecycle/remove.js');
  const team = await import('../../src/modules/ai/team-tools.js');
  const crm = await import('../../src/modules/ai/crm-tools.js');
  team.registerTools(crm.CRM_TOOLS); runTool = team.runTool;
  await db.insert('sector', { id: 'SOL', name_ar: 'قطاع الحلول', kind: 'delivery', active: 1, created_at: T });
  await db.insert('department', { id: 'D1', sector_id: 'SOL', name_ar: 'إدارة الحلول', active: 1, created_at: T });
  await db.insert('stage', { id: 'LEAD', name_ar: 'ليدز', default_win_pct: 10, is_won: 0, is_lost: 0, sort_order: 1 });
  await db.insert('stage', { id: 'WON', name_ar: 'فائزة', default_win_pct: 100, is_won: 1, is_lost: 0, sort_order: 9 });
  await db.insert('app_user', { id: ADMIN.id, username: 'admin', role_id: 'admin', scope: 'company', active: 1, created_at: T });
  await db.insert('app_user', { id: OTHER.id, username: 'other', name_ar: 'موظف', role_id: 'employee', scope: 'own', sector_id: 'SOL', active: 1, created_at: T });
  await db.insert('client', { id: 'C1', name_ar: 'صندوق التنمية', active: 1, created_at: T });
});
after(async () => { await db.close(); rmSync(dir, { recursive: true, force: true }); });

const mk = (over = {}) => opps.createOpportunity(CTX, { title_ar: 'فرصة', sector_id: 'SOL', value_sar: 1000, client_id: 'C1', ...over });

test('الثابت يُكتب عند الإنشاء ويُقرأ مع الفرصة', async () => {
  const o = await mk({ tender_no: ' T-4548 ', submission_due: '2026-10-15', duration_months: '24', consortium_partners: 'رؤية الخبراء + مزن' });
  assert.equal(o.tender_no, 'T-4548', 'الفراغ الطرفي لم يُنظَّف');
  assert.equal(o.submission_due, '2026-10-15');
  assert.equal(o.submitted_on, null, 'قيمةٌ كُتبت نيابةً عن أحد');
  assert.equal(Number(o.duration_months), 24);
  const d = await opps.opportunityDetail(ADMIN, o.id);
  assert.equal(d.opp.consortium_partners, 'رؤية الخبراء + مزن');
  assert.deepEqual(d.fields, [], 'فرصةٌ بلا حقول حرّة تعيد قائمةً فارغة لا غياباً');
});

test('ويُعدَّل بقاعدة موقع التسليم: الفراغ فراغ، وما لم يُرسَل لا يُمَسّ، والخطأ يُردّ بجملة', async () => {
  const o = await mk({ tender_no: 'A-1', duration_months: 12 });
  const a = await opps.updateOpportunity(CTX, o.id, { submitted_on: '2026-09-09' });
  assert.equal(a.tender_no, 'A-1', 'حقلٌ لم يُرسَل وقد مُحي');
  assert.equal(a.submitted_on, '2026-09-09');
  const b = await opps.updateOpportunity(CTX, o.id, { tender_no: '   ', duration_months: '' });
  assert.equal(b.tender_no, null, 'نصٌّ فارغ خُزِّن بدل الفراغ');
  assert.equal(b.duration_months, null);
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { submission_due: '15/10/2026' }), /سنة-شهر-يوم/);
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { submission_due: '2026-02-30' }), /سنة-شهر-يوم/, 'يومٌ لا وجود له مرّ');
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { duration_months: 0 }), /من 1 إلى/);
  await assert.rejects(() => opps.updateOpportunity(CTX, o.id, { duration_months: 2.5 }), /من 1 إلى/);
  const c = await mk({ consortium_partners: 'ش'.repeat(500) });
  assert.equal(c.consortium_partners.length, opps.CONSORTIUM_MAX, 'يُقصّ عند حدّه لا يسقط الحفظ');
});

test('الحرّ: الاسم يفرد الحقل، والتسمية بالمعرّف لا تصطدم، والحذف ناعم، والصلاحية صلاحيةُ الفرصة', async () => {
  const o = await mk({});
  const f1 = await fields.setOpportunityField(CTX, o.id, { name_ar: ' رقم  الضمان ', value_text: 'G-77' });
  assert.equal(f1.name_ar, 'رقم الضمان', 'المسافات المكرّرة لم تُطبَّع');
  const f1b = await fields.setOpportunityField(CTX, o.id, { name_ar: 'رقم الضمان', value_text: 'G-78' });
  assert.equal(f1b.id, f1.id, 'الكتابة باسمٍ قائم صنعت صفاً ثانياً');
  const f2 = await fields.setOpportunityField(CTX, o.id, { name: 'اسم مشروع الجهة', value: 'تفعيل الحوكمة' });
  let list = await fields.listOpportunityFields(o.id);
  assert.deepEqual(list.map((f) => [f.name_ar, f.value_text]), [['رقم الضمان', 'G-78'], ['اسم مشروع الجهة', 'تفعيل الحوكمة']]);
  // تسميةٌ بالمعرّف تصطدم باسمٍ قائم لغيره ⟵ تُردّ بجملة، ولا تُكتب
  await assert.rejects(() => fields.setOpportunityField(CTX, o.id, { id: f2.id, name_ar: 'رقم الضمان', value_text: 'x' }), /حقلٌ آخر باسم/);
  const renamed = await fields.setOpportunityField(CTX, o.id, { id: f2.id, name_ar: 'مشروع الجهة', value_text: 'تفعيل الحوكمة' });
  assert.equal(renamed.id, f2.id);
  await assert.rejects(() => fields.setOpportunityField(CTX, o.id, { name_ar: '', value_text: 'x' }), /اسم الحقل مطلوب/);
  // الحذف ناعم: الصفّ يبقى بختمٍ ولا يُعدّ
  await fields.removeOpportunityField(CTX, f1.id);
  list = await fields.listOpportunityFields(o.id);
  assert.deepEqual(list.map((f) => f.name_ar), ['مشروع الجهة']);
  assert.ok((await db.get('SELECT deleted_at FROM opportunity_field WHERE id = ?', [f1.id])).deleted_at, 'محوٌ لا حذفٌ ناعم');
  // ومن لا يملك تعديل الفرصة لا يكتب حقولها ولا يقرؤها
  await assert.rejects(() => fields.setOpportunityField(asOther, o.id, { name_ar: 'x', value_text: 'y' }), (e) => { assert.equal(e.status, 403); return true; });
  await assert.rejects(() => fields.removeOpportunityField(asOther, f2.id), (e) => { assert.equal(e.status, 403); return true; });
  await assert.rejects(() => fields.opportunityFields(OTHER, o.id), (e) => { assert.equal(e.status, 403); return true; });
  // دفعةٌ في معاملة واحدة: قيمةٌ فارغة تطوي، وغيرها يُكتب — وما يفشل يُرجع الكل
  const out = await fields.applyOpportunityFields(CTX, o.id, [{ name: 'مشروع الجهة', value: '' }, { name: 'رمز الموقع', value: 'RYD-1' }]);
  assert.deepEqual(out, { set: ['رمز الموقع'], removed: ['مشروع الجهة'] });
  assert.deepEqual((await fields.listOpportunityFields(o.id)).map((f) => f.name_ar), ['رمز الموقع']);
  await assert.rejects(() => fields.applyOpportunityFields(CTX, o.id, [{ name: 'أ', value: 'ب' }, { name: '', value: 'ج' }]), /اسم الحقل مطلوب/);
  assert.deepEqual((await fields.listOpportunityFields(o.id)).map((f) => f.name_ar), ['رمز الموقع'], 'نصفُ دفعةٍ كُتب رغم فشلها');
});

test('حذفُ الفرصة يطوي حقولها الحرّة ويعيدها معها', async () => {
  const o = await mk({});
  const f = await fields.setOpportunityField(CTX, o.id, { name_ar: 'رقم الضمان', value_text: 'G-1' });
  await lifecycle.removeRecord(CTX, 'opportunity', o.id, { reason: 'تكرار' });
  assert.ok((await db.get('SELECT deleted_at FROM opportunity_field WHERE id = ?', [f.id])).deleted_at, 'الحقل بقي حيّاً على فرصةٍ محذوفة');
  await lifecycle.restoreRecord(CTX, 'opportunity', o.id);
  assert.equal((await db.get('SELECT deleted_at FROM opportunity_field WHERE id = ?', [f.id])).deleted_at, null, 'الحقل لم يعد مع فرصته');
});

test('صفحة الفرصة: خاناتٌ تُكتب وبطاقتان تُقرآن، والفراغ «لم يُحدَّد» لا تسرّباً', async () => {
  const o = await mk({ tender_no: 'T-9', duration_months: 3 });
  await fields.setOpportunityField(CTX, o.id, { name_ar: 'رقم الضمان', value_text: 'G-77' });
  const html = await P.opportunityDetailPage(ADMIN, o.id, {});
  for (const needle of ['رقم المنافسة', 'oc-tender', 'oc-due', 'oc-submitted', 'oc-duration', 'oc-consortium', 'T-9', '3</span> أشهر',
    'حقول إضافية', 'رقم الضمان', 'G-77', 'opp-field-save', 'opp-field-remove', 'لم يُقدَّم بعد', 'الشركة وحدها']) {
    assert.ok(html.includes(needle), `لا أثر لـ«${needle}» في الصفحة`);
  }
  const slice = html.split('المنافسة')[1].slice(0, 1500);
  assert.ok(!/undefined|NaN|\bnull\b/.test(slice), 'تسرَّب فراغ تقني في بطاقة المنافسة');
  // غير المحرِّر يقرأ ولا يرى أزرار الكتابة
  await db.insert('app_user', { id: 'u_viewer', username: 'viewer', role_id: 'viewer', scope: 'company', active: 1, created_at: T });
  const ro = await P.opportunityDetailPage({ id: 'u_viewer', username: 'viewer', role_id: 'viewer', scope: 'company', projectIds: new Set(), teamIds: new Set() }, o.id, {});
  assert.ok(ro.includes('رقم الضمان') && !ro.includes('opp-field-save'), 'القارئ رأى زرّ حفظٍ لا يملكه');
});

test('أدوات المحادثة: التسجيل يقبل الحقول كلها صفاً صفاً، والقيمة قبل الضريبة تُسجَّل شاملةً', async () => {
  const pv = await runTool(CTX, 'sanad_preview_opportunity_create', {
    title: 'تفعيل حوكمة الذكاء الاصطناعي', clientId: 'C1', valueSar: 1000, valueVatIncluded: false,
    tenderNo: 'T-4548', submissionDue: '2026-10-01', durationMonths: 24, consortiumPartners: 'رؤية الخبراء + مزن',
    engagementType: 'PROJECT', solicitationType: 'RFP', deliveryLocation: 'الرياض', departmentId: 'D1',
    customFields: [{ name: 'رقم الضمان', value: 'G-5' }, { name: 'فارغ', value: '' }],
  });
  const rows = pv.will_be; assert.equal(rows.department_ar, 'إدارة الحلول (قطاع الحلول)', 'الإدارة تُسمّى مع قطاعها');
  assert.equal(rows.value_sar.value, 1150, 'قبل الضريبة لم تُحوَّل إلى الشامل');
  assert.match(pv.summary, /1,150 ريال/);
  const display = (await db.get('SELECT preview_json FROM ai_activity_log WHERE preview_json IS NOT NULL ORDER BY at DESC LIMIT 1'));
  const disp = JSON.parse(display.preview_json).display.map((r) => r.field_ar);
  for (const f of ['رقم المنافسة', 'موعد تقديم العرض', 'مدة التنفيذ', 'شركاء التحالف', 'نوع الارتباط', 'نوع الطرح', 'موقع التسليم', 'الإدارة المسؤولة', 'حقل إضافي «رقم الضمان»']) {
    assert.ok(disp.includes(f), `صفّ «${f}» غائب عن المعاينة`);
  }
  assert.ok(!disp.includes('حقل إضافي «فارغ»'), 'حقلٌ بلا قيمة عُرض كأنه يُكتب');
  const out = await runTool(CTX, 'sanad_create_opportunity', { previewToken: pv.previewToken });
  const row = await db.get('SELECT * FROM opportunity WHERE id = ?', [out.opportunity.id]);
  assert.equal(row.tender_no, 'T-4548'); assert.equal(Number(row.duration_months), 24); assert.equal(row.department_id, 'D1');
  assert.equal(row.engagement_type, 'PROJECT'); assert.equal(row.solicitation_type, 'RFP'); assert.equal(row.delivery_location, 'الرياض');
  assert.equal(Number(row.value_halalas), 115000, 'المخزَّن ليس الشامل');
  assert.deepEqual(out.opportunity.custom_fields.map((f) => [f.name, f.value]), [['رقم الضمان', 'G-5']]);
  const g = await runTool(CTX, 'sanad_get_opportunity', { opportunityId: row.id });
  assert.equal(g.opportunity.tender.tender_no.value, 'T-4548');
  assert.equal(g.opportunity.tender.submitted_on.recorded, false, 'الغائب قيل مقاساً');
  assert.equal(g.opportunity.solicitation_type_ar, 'طلب عرض (RFP)');
  assert.deepEqual(g.opportunity.custom_fields.map((f) => f.name), ['رقم الضمان']);
  await assert.rejects(() => runTool(CTX, 'sanad_preview_opportunity_create', { title: 'فرصة بإدارةٍ لا وجود لها', clientId: 'C1', valueSar: 1, departmentId: 'D9' }), /الإدارة المحدَّدة غير موجودة/);
});

test('والتعديل: قبل/بعد لكل حقل منافسة، ومسحٌ صريح، وحقولٌ حرّة تُكتب وتُحذف — ثم التنفيذ كما عُرض', async () => {
  const o = await mk({ tender_no: 'OLD-1', duration_months: 12 });
  await fields.setOpportunityField(CTX, o.id, { name_ar: 'رقم الضمان', value_text: 'G-1' });
  await assert.rejects(() => runTool(CTX, 'sanad_preview_opportunity_update', { opportunityId: o.id, tenderNo: 'N', clearFields: ['tenderNo'] }), /قرّر أحدهما/);
  await assert.rejects(() => runTool(CTX, 'sanad_preview_opportunity_update', { opportunityId: o.id, durationMonths: 12, tenderNo: 'OLD-1' }), /لا شيء يتغيّر/);
  const pv = await runTool(CTX, 'sanad_preview_opportunity_update', {
    opportunityId: o.id, durationMonths: 36, clearFields: ['tenderNo'], submittedOn: '2026-09-09',
    customFields: [{ name: 'رقم الضمان', value: '' }, { name: 'رمز الموقع', value: 'RYD-1' }, { name: 'رقم الضمان الجديد', value: 'G-1' }],
  });
  const by = Object.fromEntries(pv.changes.map((c) => [c.field_ar, c]));
  assert.equal(by['مدة التنفيذ'].before_ar, '12 شهراً'); assert.equal(by['مدة التنفيذ'].after_ar, '36 شهراً');
  assert.equal(by['رقم المنافسة'].before_ar, 'OLD-1'); assert.match(by['رقم المنافسة'].after_ar, /يُمسح/);
  assert.equal(by['تاريخ تقديم العرض'].before_ar, 'لم يُحدَّد');
  assert.equal(by['حقل إضافي «رقم الضمان»'].after_ar, 'يُحذف');
  assert.equal(by['حقل إضافي «رمز الموقع»'].before_ar, 'غير موجود — يُضاف');
  const out = await runTool(CTX, 'sanad_update_opportunity', { previewToken: pv.previewToken });
  assert.equal(out.changed_fields_ar, 3 + 3);
  const row = await db.get('SELECT tender_no, duration_months, submitted_on FROM opportunity WHERE id = ?', [o.id]);
  assert.deepEqual([row.tender_no, Number(row.duration_months), row.submitted_on], [null, 36, '2026-09-09']);
  assert.deepEqual((await fields.listOpportunityFields(o.id)).map((f) => [f.name_ar, f.value_text]).sort(), [['رقم الضمان الجديد', 'G-1'], ['رمز الموقع', 'RYD-1']]);
  // طلبٌ كلُّه حقولٌ حرّة يمرّ بلا تعديلٍ فارغ على الفرصة
  const before = (await db.get('SELECT updated_at FROM opportunity WHERE id = ?', [o.id])).updated_at;
  const pv2 = await runTool(CTX, 'sanad_preview_opportunity_update', { opportunityId: o.id, customFields: [{ name: 'رمز الموقع', value: 'RYD-2' }] });
  await runTool(CTX, 'sanad_update_opportunity', { previewToken: pv2.previewToken });
  assert.equal((await db.get('SELECT updated_at FROM opportunity WHERE id = ?', [o.id])).updated_at, before, 'كُتب تعديلٌ فارغ على الفرصة');
  assert.equal((await fields.listOpportunityFields(o.id)).find((f) => f.name_ar === 'رمز الموقع').value_text, 'RYD-2');
  // والإدارة تبقى مغلقةً عند التعديل — كما كانت
  await assert.rejects(() => runTool(CTX, 'sanad_preview_opportunity_update', { opportunityId: o.id, departmentId: 'D1' }), /إدارة الفرصة/);
});
