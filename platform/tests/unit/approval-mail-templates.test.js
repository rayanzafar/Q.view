// قوالب بريد الاعتمادات — التهريب، والعنوان بلا تفصيل، والرابط إلى «صفحتي»، والذيل الصحيح.
// النموذج هو `mail-templates.test.js`: القالب دالة نقية تُفحص مخرجاتها نصاً.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { newApprovalsMail, approvalReminderMail } = await import('../../src/core/mail/approval-mail.js');
const { config } = await import('../../src/core/config.js');

const items = [
  { label: 'إعداد <script>alert("خطة")</script> الاختبار', parent: 'مشروع "التحوّل"', kindLabel: 'اعتماد مهمة', requesterName: "سجى O'ألشكر", ageDays: 2 },
  { label: null, parent: '', kindLabel: 'تأكيد تسكين', requesterName: 'مدير الفرع', ageDays: 0 },
];

test('كل نصٍّ متغيّر مُهرَّب — لا وسم يمرّ من عنوان مهمة أو اسم شخص', () => {
  const { html } = newApprovalsMail({ items, platformUrl: config.platformUrl });
  assert.ok(!html.includes('<script>'), 'وسمٌ حيّ تسرّب من عنوان مهمة');
  assert.ok(html.includes('&lt;script&gt;'), 'التهريب لم يقع أصلاً');
  assert.ok(html.includes('&quot;التحوّل&quot;'), 'علامات الاقتباس في اسم الجهة بلا تهريب');
  assert.ok(html.includes('O&#39;ألشكر'), 'الفاصلة العليا في الاسم بلا تهريب');
});

test('العنوان يقول ماذا وصل ولا يحمل تفصيلاً — لا عنوان مهمة ولا اسم شخص فيه', () => {
  const n = newApprovalsMail({ items, platformUrl: config.platformUrl });
  const r = approvalReminderMail({ items, platformUrl: config.platformUrl });
  assert.equal(n.subject, 'اعتمادات بانتظارك في سند');
  assert.equal(r.subject, 'تذكير صباحي: اعتمادات بانتظارك في سند');
  assert.notEqual(n.subject, r.subject);
  for (const s of [n.subject, r.subject]) {
    assert.ok(!s.includes('الاختبار') && !s.includes('سجى'), 'تفصيلٌ حيّ في عنوان رسالة');
  }
});

test('البند بلا اسمٍ يقع على نوعه، والعمر بصيغته، والرابط إلى «صفحتي» بعنوان المنصة', () => {
  const { html } = newApprovalsMail({ items, platformUrl: config.platformUrl });
  assert.ok(html.includes('تأكيد تسكين'), 'البند مجهول الاسم اختفى بدل أن يقع على نوعه');
  assert.ok(html.includes('منذ يومين'), 'عمر البند لا يُقرأ');
  assert.ok(html.includes('اليوم'), 'بند اليوم لا يُقرأ');
  assert.ok(html.includes(`${config.platformUrl}/app/home`), 'الرابط لا يقود إلى «صفحتي»');
  assert.ok(html.includes('طلبها مدير الفرع'), 'اسم الطالب غائب');
});

test('الذيل ذيلُ تنبيهٍ لا ذيلُ تقرير — ويشرح متى تتوقف الرسائل', () => {
  const { html } = approvalReminderMail({ items, platformUrl: config.platformUrl });
  assert.ok(html.includes('تتوقف الرسائل من تلقاء نفسها حين لا يبقى شيء بانتظارك'));
  assert.ok(!html.includes('تُحجب الأرقام الحساسة'), 'ذيل التقارير تسرّب إلى رسالة تنبيه');
  assert.ok(html.includes('dir="rtl"'), 'الرسالة بلا اتجاه عربي');
});
