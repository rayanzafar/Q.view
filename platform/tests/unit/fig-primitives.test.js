// لغة الرسم الواحدة (v5.38 · ADR-0011) — عقود اللبنات الأربع:
// الامتلاء بالخواص المنطقية (inset-inline-start) لا اليسار الفيزيائي؛ القصّ 0–100؛
// القطعة الصفرية لا تُرسم؛ الوصف الصوتي حاضر أو aria-hidden؛ الهروب على كل نصٍّ مُمرَّر.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figBullet, figStacked100, figBars, figColumns } from '../../src/web/layout.js';

test('figBullet: قصّ النسبة، علامة الهدف بخاصية منطقية، ووصف صوتي', () => {
  const h = figBullet({ pct: 123, tick: 64, ariaLabel: 'المحقق 23% والمسار 64%' });
  assert.match(h, /width:100%/);
  assert.match(h, /inset-inline-start:64%/);
  assert.match(h, /aria-label="المحقق 23% والمسار 64%"/);
  assert.ok(!h.includes('left:'), 'لا خواص فيزيائية');
  const quiet = figBullet({ pct: -5 });
  assert.match(quiet, /width:0%/);
  assert.match(quiet, /aria-hidden="true"/);
});

test('figStacked100: التطبيع إلى مئة، الصفر لا يُرسم، والفراغ مسارٌ رمادي', () => {
  const h = figStacked100([{ v: 2, color: 'var(--st-good)' }, { v: 0, color: 'var(--st-warn)' }, { v: 2, color: 'var(--st-bad)' }]);
  assert.equal((h.match(/<i /g) || []).length, 2, 'قطعتان لا ثلاث');
  assert.match(h, /width:50\.0%/);
  const empty = figStacked100([{ v: 0 }]);
  assert.match(empty, /var\(--track\)/);
});

test('figBars: صفٌّ له تفصيل يُرسم زرّاً بمعرّفه، والنص يُهرَّب، والعرض من الأقصى', () => {
  const h = figBars([
    { label: 'الإجمالي <x>', value: 100, count: 10, total: true },
    { label: 'ترشيح', value: 50, count: 4, dd: 'fnl-LEAD', ariaLabel: 'ترشيح: 4' },
  ], { fmt: (v) => v + 'M' });
  assert.match(h, /الإجمالي &lt;x&gt;/);
  assert.match(h, /<button class="fig-r"[^>]*data-dd="fnl-LEAD"/);
  assert.match(h, /width:50\.0%/);
  assert.match(h, /100M/);
  assert.ok(!h.includes('onclick'), 'تفويض data-action لا onclick');
});

test('figColumns: الأقدم أقصى اليمين (المحور معكوس داخل dir=ltr) والجاري مميّز', () => {
  const h = figColumns([{ v: 1, label: '1' }, { v: 2, label: '2' }, { v: 4, label: '3' }], { now: 3 });
  assert.match(h, /class="fig-cols"[^>]*/);
  const order = [...h.matchAll(/<b class="tnum">(\d)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['3', '2', '1'], 'داخل حاوية ltr: الأول في السلسلة يُرسم أخيراً فيقع يمين المحور');
  assert.match(h, /class="cc now"/);
  assert.match(h, /height:100%/);
});
