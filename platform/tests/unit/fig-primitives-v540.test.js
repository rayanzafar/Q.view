// وحدة: أوليات v5.40 — الشرارة المساحية، نصف العدّاد، اتجاه المحور الأيسر، وخط التوقع المتقطع.
// (عقود الأوليات الأربع المثبَّتة في fig-primitives.test.js لم تُمسّ — هذه إضافات لا تعديلات.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figSpark, figGaugeHalf, figLine, figCombo, figHeat } from '../../src/web/layout.js';

test('figSpark: يسار القراءة افتراضاً، تدرّجٌ بمعرّف فريد، ونقطة نهاية عند آخر نقطة', () => {
  const a = figSpark([1, 2, 3], { w: 100, h: 30 });
  const b = figSpark([1, 2, 3], { w: 100, h: 30 });
  const gidA = a.match(/id="(spkGrad\d+)"/)[1];
  const gidB = b.match(/id="(spkGrad\d+)"/)[1];
  assert.notEqual(gidA, gidB, 'معرّف التدرّج يجب أن يتفرّد بين استدعاءين');
  // يسار القراءة: أول نقطة عند أدنى x وآخرها عند أعلاه — والقيمة الأعلى (الأخيرة) عند y الأدنى
  const pts = a.match(/polyline points="([^"]+)"/)[1].trim().split(' ').map((p) => p.split(',').map(Number));
  assert.ok(pts[0][0] < pts[2][0], 'المحور يساري');
  assert.ok(pts[2][1] < pts[0][1], 'القيمة الأعلى أعلى الرسم');
  // نقطة النهاية على آخر نقطة
  const cx = Number(a.match(/circle cx="([\d.]+)"/)[1]);
  assert.equal(cx.toFixed(1), pts[2][0].toFixed(1));
  assert.ok(figSpark([5]) === '', 'نقطة واحدة لا تُرسم');
});

test('figGaugeHalf: النسبة الحقيقية مطبوعة ولو ثُبّت القوس عند سقف المحور', () => {
  const h = figGaugeHalf(130, { max: 125, sub: 'من الطاقة' });
  assert.ok(h.includes('>130%'), 'النسبة الحقيقية 130 لا المقصوصة');
  assert.ok(h.includes('من الطاقة'));
  // القوس مقصوص عند 100% من نصف المحيط: dasharray الأول = π·r كاملاً
  const r = (120 - 12) / 2;
  const full = (Math.PI * r).toFixed(1);
  assert.ok(h.includes(`stroke-dasharray="${full} `), 'القوس مثبَّت عند سقفه');
  const zero = figGaugeHalf(0, {});
  assert.ok(!zero.includes('ring-fill'), 'صفرٌ بلا قوس تعبئة');
});

test('figLine: axisDir يقلب المحور، وmarks ترسم شرحاً رأسياً داخل الإطار', () => {
  const rtl = figLine([{ points: [1, 2, 3] }], { w: 100, h: 50 });
  const ltr = figLine([{ points: [1, 2, 3] }], { w: 100, h: 50, axisDir: 'ltr', marks: [{ i: 1, label: 'فجوة' }] });
  const first = (svg) => Number(svg.match(/polyline points="([\d.]+),/)[1]);
  assert.ok(first(rtl) > 50, 'الافتراض يميني: أول نقطة عند x مرتفع');
  assert.ok(first(ltr) < 50, 'ltr يساري: أول نقطة عند x منخفض');
  assert.ok(ltr.includes('class="mk-l"') && ltr.includes('فجوة'));
  assert.ok(ltr.includes('stroke-dasharray="4 3"'), 'خط الشرح متقطع');
});

test('figCombo: خط توقعٍ متقطع بقيمة نهايةٍ معلنة يحلّ محل الدائرة، وعناوين مزدوجة عند طلبها', () => {
  const c = figCombo({ bars: [10, 20], cum: [10, 30], target: 40, labels: ['يناير', 'فبراير'],
    labelsTight: ['Jan', 'Feb'], axisDir: 'ltr', w: 200, h: 100,
    forecastLine: { points: [{ i: 0, v: 10 }, { i: 1, v: 38 }], endLabel: '38' }, fmt: (v) => String(v) });
  assert.ok(c.includes('stroke-dasharray="5 4"'), 'خط التوقع متقطع');
  assert.ok(c.includes('المتوقع نهاية السنة: 38'));
  assert.ok(c.includes('class="m-full"') && c.includes('class="m-tight"') && c.includes('Jan'));
  // بلا forecastLine تعود دائرة التوقع القديمة كما كانت
  const d = figCombo({ bars: [10], cum: [10], forecast: 12, labels: ['1'] });
  assert.ok(d.includes('r="5"') && d.includes('المتوقع نهاية السنة: 12'));
});

test('figHeat: ltr يوجّه الجدول يساراً وعناوين الصفوف تبقى', () => {
  const h = figHeat([{ label: 'إدارة البيانات', cells: [50, null] }], ['أغسطس', 'سبتمبر'], { ltr: true });
  assert.ok(h.includes('<table class="fig-heat" dir="ltr">'));
  assert.ok(h.includes('إدارة البيانات'));
  const rtl = figHeat([{ label: 'س', cells: [1] }], ['م']);
  assert.ok(rtl.includes('<table class="fig-heat">'), 'الافتراض بلا dir');
});
