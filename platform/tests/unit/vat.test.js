// حساب فصل ضريبة القيمة المضافة — الرياضيات وحدها، بلا قاعدة بيانات.
//
// الفحص المهم هنا ليس أن القسمة تعمل، بل أن **الجمع مغلق**: صافٍ + ضريبة = إجمالي لكل صفٍّ
// ولكل مجموع. وهذا ما ينكسر أول ما ينكسر حين يُقرَّب الطرفان كلٌّ على حدة.
//
// وتحذيرٌ مُثبَت في المواصفة: المبالغ الأربعة الواردة فيها (٧٥٦٬٦٤٢٫٥٠ · ٦٬٤٢٣٬٣٢٥٫٠٠ ·
// ٤١٢٬٦٢٠٫٠٠ · ٤٬١٩٩٬٨٠٠٫٠٠) **كلها تقبل القسمة على ١١٥ بلا باقٍ** — أي أن فحصاً يقتصر عليها
// لا يمرّ بمسار الباقي إطلاقاً، فيمرّ أخضرَ ولو كان التقريب مكسوراً تماماً. لذلك أُضيف إلى
// الفحص مبلغٌ **غير قابل للقسمة** بعينه: ١٠٠٫٠٠ ر.س. = ١٠٬٠٠٠ هللة، صافيه ٨٬٦٩٥ هللة وضريبته
// ١٬٣٠٥ — والقسمة تُسقط كسراً حقيقياً (١٠٬٠٠٠×١٠٠÷١١٥ = ٨٬٦٩٥٫٦٥…). ومعه مبالغ أخرى ذات باقٍ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VAT_RATE_PCT, netOfGross, vatOfGross, splitGross, netSql, vatSql } from '../../src/modules/finance/vat.js';
import { NET_SQL } from '../../src/core/reports/project-cash.js';

const SAR = (v) => Math.round(v * 100); // ريالات ⟵ هللات

test('النسبة خمسة عشر بالمئة، مُعلَنة في موضع واحد', () => {
  assert.equal(VAT_RATE_PCT, 15);
});

test('المبالغ الأربعة الواردة في المواصفة — وكلها تقبل القسمة بلا باقٍ', () => {
  // gross ⟵ [net, vat] بالهللات. هذه الأربعة لا تختبر مسار الباقي، ولذلك لا تكفي وحدها.
  const cases = [
    [SAR(756642.50), 65795000, 9869250],
    [SAR(6423325.00), 558550000, 83782500],
    [SAR(412620.00), 35880000, 5382000],
    [SAR(4199800.00), 365200000, 54780000],
  ];
  for (const [gross, net, vat] of cases) {
    assert.equal(netOfGross(gross), net, `صافي ${gross}`);
    assert.equal(vatOfGross(gross), vat, `ضريبة ${gross}`);
    assert.equal(net + vat, gross, 'الجمع مغلق');
    // وتأكيدُ التحذير نفسه: هذه الأربعة تقبل القسمة، فلا باقيَ فيها يُختبَر.
    assert.equal((gross * 100) % 115, 0, 'هذا المبلغ يقبل القسمة — وهو سبب عدم كفايته');
  }
});

test('مبلغ غير قابل للقسمة — المسار الذي كانت المواصفة عمياء عنه', () => {
  // مئة ريال بالتمام: ١٠٬٠٠٠ هللة. الحاصل ٨٬٦٩٥٫٦٥٢… فيُقتطع إلى ٨٬٦٩٥ وتأخذ الضريبة الباقي.
  const gross = SAR(100);
  assert.notEqual((gross * 100) % 115, 0, 'هذا المبلغ لا يقبل القسمة — وهو المقصود');
  assert.equal(netOfGross(gross), 8695);
  assert.equal(vatOfGross(gross), 1305);
  assert.equal(netOfGross(gross) + vatOfGross(gross), gross);
  // والضريبة هنا **ليست** خمسة عشر بالمئة من الصافي مقرَّبةً استقلالاً: ٨٬٦٩٥×٠٫١٥ = ١٬٣٠٤٫٢٥
  // فلو قُرِّبت وحدها لخرجت ١٬٣٠٤ ولنقص المجموع هللةً عن المبلغ. الفارق يذهب إلى الضريبة عمداً.
  assert.notEqual(Math.round(netOfGross(gross) * VAT_RATE_PCT / 100), vatOfGross(gross));
});

test('مبالغ أخرى ذات باقٍ — الجمع يبقى مغلقاً في كلٍّ منها', () => {
  const rough = [1, 7, 13, 99, 101, 12345, 999999, 756642_51, 1_000_000_01];
  for (const gross of rough) {
    const s = splitGross(gross);
    assert.equal(s.net_halalas + s.vat_halalas, gross, `الجمع مغلق عند ${gross}`);
    assert.ok(Number.isInteger(s.net_halalas) && Number.isInteger(s.vat_halalas), 'هللات صحيحة لا كسور');
    assert.ok(s.vat_halalas >= 0 && s.vat_halalas <= gross, 'الضريبة داخل حدود المبلغ');
  }
});

test('لا هللة تضيع عبر مجموع كبير من الصفوف غير القابلة للقسمة', () => {
  // ألفُ صفٍّ كلٌّ منها يُسقط كسراً. لو قُرِّب الطرفان استقلالاً لتراكم الفارق حتى ظهر في المطابقة.
  let gross = 0; let net = 0; let vat = 0;
  for (let i = 1; i <= 1000; i++) {
    const g = 10_000 + i * 7; // مبالغ متتابعة، أكثرها لا يقبل القسمة
    const s = splitGross(g);
    gross += g; net += s.net_halalas; vat += s.vat_halalas;
  }
  assert.equal(net + vat, gross, 'مجموع الصوافي + مجموع الضرائب = مجموع الإجماليات');
});

test('الصفر والفراغ لا يخترعان رقماً', () => {
  assert.deepEqual(splitGross(0), { gross_halalas: 0, net_halalas: 0, vat_halalas: 0 });
  assert.deepEqual(splitGross(null), { gross_halalas: 0, net_halalas: 0, vat_halalas: 0 });
  assert.deepEqual(splitGross(undefined), { gross_halalas: 0, net_halalas: 0, vat_halalas: 0 });
});

test('صيغة SQL: المخزَّن يسبق الاشتقاق، والضريبة فارقٌ لا حسابٌ ثانٍ', () => {
  assert.equal(netSql('i.amount_halalas', 'i.net_amount_halalas'),
    'COALESCE(i.net_amount_halalas, CAST(COALESCE(i.amount_halalas, 0) AS BIGINT) * 100 / 115)');
  assert.ok(vatSql('i.amount_halalas', 'i.net_amount_halalas')
    .includes(netSql('i.amount_halalas', 'i.net_amount_halalas')), 'الضريبة تُطرح من الصافي نفسه');
});

test('نسخة القاعدة في core/reports مطابقة حرفاً بحرف لأصلها في وحدة المالية', () => {
  // `core/reports/project-cash.js` لا يستورد من `modules` بقاعدة معلنة في رأسه، فيحمل نسخة
  // من الصيغة. النسخة المسموحة هي التي يحرسها فحص — وهذا هو الفحص. أي انحرافٍ بينهما يعني
  // رقمين لسؤال واحد، وهو بالضبط ما تعالجه هذه الترحيلة لا ما تُنشئه.
  for (const [g, n] of [['i.amount_halalas', 'i.net_amount_halalas'], ['c.amount_halalas', 'c.net_amount_halalas']]) {
    assert.equal(NET_SQL(g, n), netSql(g, n));
  }
});
