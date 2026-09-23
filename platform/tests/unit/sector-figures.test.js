// لبنات مركز القطاع في المتصفح: الصياغة والرسم — تُحمَّل هنا في سياقٍ مصطنع بلا صفحة.
// ما يُحرس: الرقم لا يخرج عارياً (غلافٌ معزول الاتجاه في الوسم، وصنفٌ مثبِّت في الرسم
// المتّجهي)، والاسم يُهرَّب، والاسم المجهول للأيقونة يعيد فراغاً لا رمزاً مكسوراً، والملف
// لا يحمل في مصدره أثراً لقيمةٍ غائبة أو حسابٍ غير عددي يتسرّب إلى شاشة المستخدم.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC_PATH = new URL('../../src/web/public/pages/sector-figures.js', import.meta.url).pathname;
const SRC = readFileSync(SRC_PATH, 'utf8');

function load(sanad) {
  const win = {};
  win.window = win;
  if (sanad) win.Sanad = sanad;
  const ctx = { window: win };
  runInNewContext(SRC, ctx);
  return win.CC;
}

const CC = load();

test('الاختصار: الهللات تصير ريالات، والمليون بخانةٍ عشرية واحدة داخل غلافٍ معزول', () => {
  assert.equal(CC.fmt.short(2830000000, 'm'), '<bdi dir="ltr" class="tnum">28.3M</bdi>');
  assert.equal(CC.fmt.plain.short(2830000000, 'm'), '28.3M');
  assert.equal(CC.fmt.plain.short(2830000000, 'k'), '28,300K');
  assert.equal(CC.fmt.plain.short(2830000000, 'sar'), '28,300,000');
  assert.equal(CC.fmt.plain.short(2830000000), '28.3M', 'التلقائي يتبع عُرف سند نفسه');
  assert.equal(CC.fmt.plain.short(28300000), '283K');
  assert.equal(CC.fmt.plain.short(-2830000000, 'm'), '−28.3M', 'إشارة طرحٍ حقيقية لا شرطة');
});

test('ما لا قيمة له يُقال إنه بلا قيمة — لا صفراً ولا أثراً لحسابٍ غير عددي', () => {
  assert.equal(CC.fmt.plain.short(null, 'm'), '—');
  assert.equal(CC.fmt.plain.pct(undefined), '—');
  assert.equal(CC.fmt.plain.sar(0 / 0), '—');
  assert.equal(CC.fmt.plain.signedPct(0), '0%');
  assert.equal(CC.fmt.plain.signedPct(0.124), '+12%');
  assert.equal(CC.fmt.plain.signedPct(-0.124), '−12%');
  assert.equal(CC.fmt.plain.pct(0.723, 1), '72.3%');
});

test('المال الكامل يمرّ بمُنسِّق سند حين يكون محمَّلاً، وإلا ببديلٍ مطابق', () => {
  const withSanad = load({ fmtSar: () => 'قيمة من سند', esc: (s) => String(s) });
  assert.equal(withSanad.fmt.plain.sar(2830000000), 'قيمة من سند');
  assert.match(CC.fmt.plain.sar(2830000000), /28,300,000/);
});

test('السنة رقمُ تقويمٍ لا مقدار: ٢٠٢٦ بلا فاصلة آلاف', () => {
  // الشاشة الحية طبعت «سنة 2,026» في سطر المرشِّحات: السنة مرّت بمُنسِّق الأعداد.
  assert.equal(CC.fmt.plain.year(2026), '2026');
  assert.equal(CC.fmt.year(2026), '<bdi dir="ltr" class="tnum">2026</bdi>');
  assert.ok(!CC.fmt.year(2026).includes(','), 'فاصلةُ الآلاف تحوّل السنة إلى عدّ');
  assert.equal(CC.fmt.plain.year(null), '—');
});

test('العدّ بالعربية: واحد واثنان وجمعٌ ومفردٌ منصوب', () => {
  const F = ['شهر واحد', 'شهران', 'أشهر', 'شهراً'];
  assert.equal(CC.fmt.countAr(1, ...F), 'شهر واحد');
  assert.equal(CC.fmt.countAr(2, ...F), 'شهران');
  assert.equal(CC.fmt.countAr(5, ...F), '5 أشهر');
  assert.equal(CC.fmt.countAr(11, ...F), '11 شهراً');
});

// كل <text> فيه رقمٌ داخل رسمٍ متّجهي يجب أن يحمل الصنف المثبِّت للاتجاه (معرَّف في sector.css)
function unclassedNumberTexts(svg) {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter((m) => /[0-9]/.test(m[2]) && !/class="[^"]*\bsvgnum\b/.test(m[1]))
    .map((m) => m[2]);
}

test('الرسوم: لا رقم عارٍ في نصوص الرسم، والأشهر العربية وحدها بلا صنف', () => {
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, null, null, null, null];
  assert.deepEqual(unclassedNumberTexts(CC.fig.spark(vals, { area: true })), []);
  assert.deepEqual(unclassedNumberTexts(CC.fig.sparkR(vals, {})), []);
  const line = CC.fig.lineR({
    series: [{ values: vals, color: '#244a99', dots: true }],
    yFmt: (v) => CC.fmt.plain.short(v * 100, 'm'),
    label: 'الإيراد التراكمي',
  });
  assert.deepEqual(unclassedNumberTexts(line), []);
  assert.match(line, /<text class="svgnum"/, 'أرقام المحور مثبَّتة الاتجاه');
  assert.deepEqual(unclassedNumberTexts(CC.fig.barsR({ plan: vals, act: vals })), []);
  assert.deepEqual(unclassedNumberTexts(CC.fig.ring(0.62)), []);
  assert.deepEqual(unclassedNumberTexts(CC.fig.gauge(0.8, { center: '80%', sub: 'من الطاقة' })), []);
});

test('الرسوم: الأشهر تُرسم من اليمين، والتلميح نصٌّ صريح بلا وسم', () => {
  CC.config({ closedThrough: 8, currentMonth: 9 });
  const bars = CC.fig.barsR({ plan: Array(12).fill(1000), act: [1, 2, 3, 4, 5, 6, 7, 8, null, null, null, null], sel: new Set([1, 2]) });
  assert.match(bars, /data-m="1"/);
  assert.match(bars, /لم يغلق بعد/);
  assert.match(bars, /لم يبدأ بعد/);
  assert.ok(!/data-tip="[^"]*&lt;b&gt;/.test(bars), 'التلميح بلا وسمٍ مهروب — نصٌّ للقارئ');
  const x1 = Number(bars.match(/data-m="1"[^>]*><rect x="([\d.]+)"/)[1]);
  const x12 = Number(bars.match(/data-m="12"[^>]*><rect x="([\d.]+)"/)[1]);
  assert.ok(x1 > x12, 'يناير إلى يمين ديسمبر');
});

test('كل نصٍّ مُمرَّر يُهرَّب قبل أن يدخل الوسم', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const line = CC.fig.lineR({ series: [{ values: [1, 2], color: '#000' }], label: bad });
  assert.ok(!line.includes('<img'), 'وصف الرسم مهروب');
  const legend = CC.fig.stkLegend([{ label: bad, color: 'var(--primary)' }]);
  assert.ok(!legend.includes('<img'));
  const rel = CC.fig.relBar({ rev: 1, backlog: 1, pipe: 1 }, 3);
  assert.match(rel, /class="relbar"/);
  assert.equal(CC.esc('<a "b" & c>'), '&lt;a &quot;b&quot; &amp; c&gt;');
});

test('الشارات: التكلفة تُقرأ عكس الإيراد، وبلا قيمةٍ لا شارة', () => {
  assert.match(CC.fig.varChip(0.2, 'revenue'), /class="var good"/);
  assert.match(CC.fig.varChip(0.2, 'cost'), /class="var bad"/);
  assert.equal(CC.fig.varChip(null, 'cost'), '');
  assert.match(CC.fig.ptsChip(-0.021), /class="var bad"/);
  assert.match(CC.fig.ptsChip(-0.021), /نقطة/);
});

test('الأيقونة: اسمٌ معروف يرسم، واسمٌ مجهول يعيد فراغاً', () => {
  assert.equal(CC.icon('unknown'), '');
  assert.equal(typeof CC.icon('unknown'), 'string');
  assert.match(CC.icon('search'), /^<svg class="ic"/);
  assert.match(CC.icon('search', 'big'), /class="ic big"/);
  // الأسماء المشتركة مع أيقونات الخادم تحمل مسارها نفسه فلا يختلف الشكل بين الطبقتين
  const server = readFileSync(new URL('../../src/web/icons.js', import.meta.url).pathname, 'utf8');
  for (const name of ['search', 'check', 'clock', 'users', 'x', 'flag', 'building', 'filter', 'trend', 'info', 'plus', 'download', 'history']) {
    const path = server.match(new RegExp(`\\n  ${name}: '([^']+)'`))[1];
    assert.ok(CC.icon(name).includes(path), `أيقونة «${name}» تطابق أيقونة الخادم`);
  }
});

test('الملف نفسه: لا يعلن إلا CC، ولا يحمل في مصدره أثر قيمةٍ غائبة', () => {
  assert.deepEqual(Object.keys(CC).sort(), ['config', 'esc', 'fig', 'fmt', 'icon', 'iconNames', 'months']);
  assert.ok(!/undefined|NaN/.test(SRC), 'لا ذكر لقيمةٍ غائبة ولا لحسابٍ غير عددي في المصدر');
  assert.ok(!/document\.|window\.(?!CC)/.test(SRC.replace(/^\/\/.*$/gm, '')), 'لا لمس للصفحة');
});
