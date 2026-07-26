// وحدة: المعجم والعتبات وفاحص المصطلحات.
// ما تحرسه هذه الاختبارات:
//   • كل قيمة مخزَّنة تظهر للمستخدم لها تسمية عربية (نوع العمل، حالة الرسالة، إجراء التدقيق، السجل).
//   • عتبات الطاقة وتسميات حالة المشروع مصدرها ملف واحد — لا نسختين تختلفان بين صفحة وبريد.
//   • فاحص المعجم يقرأ النص الظاهر فعلاً: يتجاهل الكود داخل ${…} و<script> وقيم value/data-*،
//     ويمسك النص المعروض وقيم السمات التي يقرأها المستخدم (title/aria-label/placeholder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, workKindLabel, WORK_KIND_OPTIONS, resourceLabel, mailStatusLabel, mailEventLabel,
  auditActionLabel, BANNED_UI_TERMS } from '../../src/web/i18n/glossary.js';
import { HEALTH, HEALTH_LABELS, CAPACITY, capacityBand, capacityLabel, capacityColor, capacityVar,
  health, healthLabel } from '../../src/core/i18n/thresholds.js';
import { staticStrings, visibleText, bannedTermIn } from '../../scripts/check-glossary.mjs';

// ── تسميات القيم المخزَّنة ────────────────────────────────────────────────────
test('نوع العمل في سجل الوقت: كل قيمة مخزَّنة لها تسمية عربية ولا شيء يبقى إنجليزياً', () => {
  const stored = ['project', 'opportunity', 'proposal', 'product', 'internal', 'leave', 'training', 'bd'];
  for (const k of stored) {
    const label = workKindLabel(k);
    assert.ok(/[؀-ۿ]/.test(label), `${k}: لا تسمية عربية`);
    assert.ok(!/[A-Za-z]/.test(label), `${k}: تسريب حروف لاتينية`);
  }
  assert.equal(workKindLabel('opportunity'), 'فرصة');
  assert.equal(workKindLabel('internal'), 'عمل داخلي');
  assert.equal(workKindLabel('PROJECT'), 'مشروع', 'الحالة الكبيرة تُطابق أيضاً');
  assert.equal(workKindLabel('شيء غريب'), 'غير محدَّد', 'قيمة غير معروفة لا تُطبع كما هي');
  assert.equal(workKindLabel(null), 'غير محدَّد');
  assert.deepEqual(WORK_KIND_OPTIONS.map(([k]) => k), stored, 'ترتيب خيارات النموذج ثابت');
  assert.ok(WORK_KIND_OPTIONS.every(([, ar]) => /[؀-ۿ]/.test(ar)));
});

test('اسم السجل وحالة الرسالة وإجراء التدقيق: لا قيمة خام تصل للمستخدم', () => {
  assert.equal(resourceLabel('invoice'), 'فاتورة');
  assert.equal(resourceLabel('report_schedule'), 'جدولة تقرير');
  assert.equal(resourceLabel('طارئ'), 'سجل');
  // «جارٍ الإرسال» كانت تظهر SENDING لأنها خارج جدول تسميات الواجهة
  assert.equal(mailStatusLabel('SENDING'), 'جارٍ الإرسال');
  assert.equal(mailStatusLabel('QUEUED'), 'بانتظار الإرسال');
  assert.equal(mailStatusLabel('حالة مجهولة'), 'حالة غير معروفة');
  assert.equal(mailEventLabel('enqueued'), 'بانتظار الإرسال');
  assert.equal(mailEventLabel('failed'), 'تعذّر الإرسال');
  assert.equal(auditActionLabel('import.apply'), 'تنفيذ استيراد');
  assert.equal(auditActionLabel('read'), 'اطّلاع');
  assert.equal(auditActionLabel('كذا'), 'إجراء آخر');
  for (const fn of [resourceLabel, mailStatusLabel, mailEventLabel, auditActionLabel]) {
    assert.ok(!/[A-Za-z]/.test(fn('anything_unknown')), 'القيمة المجهولة لا تُعاد كما هي');
  }
});

// ── مصدر واحد للعتبات وحالة المشروع ───────────────────────────────────────────
test('حالة المشروع: تسمية واحدة يشترك فيها المعجم والبريد', () => {
  assert.equal(G.hOnTrack, HEALTH_LABELS.GREEN);
  assert.equal(G.hAtRisk, HEALTH_LABELS.AMBER);
  assert.equal(G.hCritical, HEALTH_LABELS.RED);
  assert.deepEqual([G.hOnTrack, G.hAtRisk, G.hCritical], ['على المسار', 'في خطر', 'حرج']);
  assert.equal(healthLabel('red'), 'حرج', 'الحالة تُقرأ بأي حالة أحرف');
  assert.equal(healthLabel(null), 'غير محدَّدة');
  assert.equal(healthLabel('<img src=x>'), 'غير محدَّدة', 'قيمة ملوّثة تسقط إلى تسمية آمنة');
  assert.equal(health('AMBER').color, HEALTH.AMBER.color);
});

test('عتبات الطاقة: حدود واضحة ولون واحد لكل نسبة', () => {
  assert.deepEqual([CAPACITY.over, CAPACITY.healthy], [110, 70]);
  assert.equal(capacityBand(111), 'over');
  assert.equal(capacityBand(110), 'ok', '110 نفسها ضمن الطاقة لا تجاوز');
  assert.equal(capacityBand(70), 'ok');
  assert.equal(capacityBand(69), 'low');
  assert.equal(capacityBand(0), 'off');
  assert.equal(capacityBand(0, { sectorMember: true }), 'park');
  assert.equal(capacityLabel(120), 'تجاوز الطاقة');
  assert.equal(capacityLabel(50), 'سعة متاحة');
  // لون هكس للبريد ومتغيّر تصميم للصفحات — من نفس القرار
  assert.equal(capacityColor(80), '#047857');
  assert.equal(capacityVar(80), 'var(--green)');
  assert.equal(capacityVar(130), 'var(--red)');
  assert.ok(G.capacityLegend.includes('110') && G.capacityLegend.includes('70'));
  assert.ok(!/[A-Za-z]/.test(G.capacityLegend));
});

test('قائمة المصطلحات المحظورة تغطي ما كان يتسرّب فعلاً', () => {
  for (const t of ['Outbox', 'RAG', 'RED', 'AMBER', 'GREEN', 'API', 'JSON', 'undefined']) {
    assert.ok(BANNED_UI_TERMS.includes(t), `${t} يجب أن يكون محظوراً في نصوص الواجهة`);
  }
});

// ── فاحص المعجم نفسه ─────────────────────────────────────────────────────────
test('استخراج النصوص: القوالب المتداخلة والتعابير النمطية لا تُربك الفاحص', () => {
  // تعبير نمطي بداخله علامة اقتباس داخل ${…} — كان يفقد التزامن ويبتلع الكود كأنه نص
  const src = 'const a = `<div data-x="${esc(h).replace(/"/g, \'\')}">مرحباً</div>`;\n'
    + 'const b = `<span>${cond ? `<b>نص داخلي</b>` : \'\'}</span>`;';
  const texts = staticStrings(src).map((s) => s.text);
  assert.ok(texts.some((t) => t.includes('مرحباً')), 'النص الظاهر التُقط');
  assert.ok(texts.some((t) => t.includes('نص داخلي')), 'نص القالب المتداخل داخل ${…} التُقط أيضاً');
  assert.ok(!texts.some((t) => t.includes('const b')), 'الكود لم يُحسب نصاً');
});

test('النص المعروض: الكود وقيم الحقول ليست نصاً، وقيم title/aria-label نص يُحاسب عليه', () => {
  const optionish = '<select><option value="GREEN" data-status="APPROVED">على المسار</option></select>';
  assert.equal(bannedTermIn(visibleText(optionish)), null, 'قيمة الحقل تُرسل للخادم ولا تُقرأ');
  const scriptish = '<div>حسناً</div><script>var x = null; // JSON</script>';
  assert.equal(bannedTermIn(visibleText(scriptish)), null, 'كود المتصفح ليس نصاً معروضاً');
  assert.equal(bannedTermIn(visibleText('<button title="حالة RED">حالة</button>')), 'RED', 'سمة title يقرأها المستخدم');
  assert.equal(bannedTermIn(visibleText('<div>صندوق Outbox</div>')), 'Outbox');
  assert.equal(bannedTermIn(visibleText('<div>القيمة undefined</div>')), 'undefined');
  assert.equal(bannedTermIn('تصدير Excel من الرابط https://x'), null, 'أسماء المنتجات والروابط مسموحة');
  assert.equal(bannedTermIn('تعذّر الحفظ — أعد المحاولة'), null);
});
