// وحدة: كلمة تصنيف المشروع كما يقرأها المستخدم.
// القاعدة في خدمة المشاريع، والكلمة في المعجم — وهذا الملف يحرس الوصلة بينهما:
//   • كل مفتاح تُخرجه القاعدة له كلمة عربية (لا مفتاح يتسرّب خاماً إلى الشاشة).
//   • كل «سبب تصنيف» تُخرجه القاعدة له جملة عربية (التلميح لا يظهر نصفه فارغاً).
//   • المجهول لا يُخمَّن «تشغيل داخلي» — الخطأ الذي نصلحه أصلاً هو تخمينُ الداخلي عند الجهل.
//   • قرار المالك في التسمية محفوظ: لا كيان اسمه «مشاريع داخلية».
// ملف وحدة بلا قاعدة بيانات: `projectKind` دالة صرفة، ووصل قاعدة البيانات كسولٌ لا يُفتح باستيراد.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectKind } from '../../src/modules/pmo/projects.js';
import { PROJECT_KIND_AR, PROJECT_KIND_BASIS_AR, projectKindLabel, projectKindBasisLabel,
  projectKindTip } from '../../src/web/i18n/glossary.js';

// صفوف تمثّل كل فرع في القاعدة — تُستخدم لجمع المفاتيح والأسباب الممكنة كلها
const CASES = [
  [{ client_id: 'C', kind: 'internal' }, { clientType: 'حكومي' }],
  [{ client_id: 'C', kind: 'external' }, { clientType: 'داخلي' }],
  [{ kind: 'product' }, {}],
  [{ kind: 'internal', contract_value_halalas: 100 }, {}],
  [{ kind: 'internal', po_value_halalas: 100 }, {}],
  [{ kind: 'internal' }, { revenueHalalas: 100 }],
  [{ kind: 'internal', source_opp_id: 'O' }, {}],
  [{ kind: 'external' }, {}],
  [{ kind: 'internal' }, {}],
];

test('كل مفتاح تصنيف تُخرجه القاعدة له كلمة عربية في المعجم', () => {
  const keys = [...new Set(CASES.map(([row, ev]) => projectKind(row, ev).key))];
  assert.deepEqual(keys.sort(), ['client', 'internal', 'product'], 'ثلاثة تصنيفات لا رابع');
  for (const k of keys) {
    const label = projectKindLabel(k);
    assert.ok(PROJECT_KIND_AR[k], `${k}: بلا تسمية في المعجم`);
    assert.ok(/[؀-ۿ]/.test(label), `${k}: لا تسمية عربية`);
    assert.ok(!/[A-Za-z]/.test(label), `${k}: تسريب حروف لاتينية`);
  }
  assert.equal(projectKindLabel('client'), 'مشروع عميل');
  assert.equal(projectKindLabel('internal'), 'تشغيل داخلي');
  assert.equal(projectKindLabel('product'), 'منتج');
});

test('كل سبب تصنيف له جملة عربية — فلا يظهر التلميح ناقصاً', () => {
  const bases = [...new Set(CASES.map(([row, ev]) => projectKind(row, ev).basis))];
  assert.equal(bases.length, 9, 'كل فرع في القاعدة له سبب مستقل يُقال للمستخدم');
  for (const b of bases) {
    assert.ok(PROJECT_KIND_BASIS_AR[b], `${b}: بلا جملة في المعجم`);
    assert.ok(/[؀-ۿ]/.test(projectKindBasisLabel(b)), `${b}: الجملة ليست عربية`);
    assert.ok(!/[A-Za-z]/.test(projectKindBasisLabel(b)), `${b}: تسريب حروف لاتينية`);
  }
});

test('المجهول لا يُخمَّن تشغيلاً داخلياً — والتسمية الممنوعة غائبة', () => {
  assert.equal(projectKindLabel('شيء غريب'), 'غير مصنَّف', 'الجهل يُقال لا يُخمَّن');
  assert.equal(projectKindLabel(null), 'غير مصنَّف');
  assert.equal(projectKindBasisLabel('لا شيء'), '', 'سبب مجهول لا يُطبع خاماً');
  for (const label of Object.values(PROJECT_KIND_AR)) {
    assert.equal(label.includes('مشاريع داخلية'), false, 'قرار المالك: لا كيان بهذا الاسم');
  }
});

test('التلميح: التصنيف وسببه — والتناقض مع المدوَّن يُقال صراحةً حين يقع', () => {
  const p = projectKind({ client_id: 'C', kind: 'internal' }, { clientType: 'حكومي' });
  const tip = projectKindTip(p);
  assert.match(tip, /^التصنيف: مشروع عميل — له عميل مسجَّل/);
  assert.match(tip, /يقول غير ذلك ولم يُصحَّح بعد/, 'المخزَّن يخالف المشتقّ ⟵ يُقال');
  const q = projectKind({ client_id: 'C', kind: 'external' }, { clientType: 'حكومي' });
  assert.equal(/يقول غير ذلك/.test(projectKindTip(q)), false, 'لا تناقض ⟵ لا جملة زائدة');
  assert.match(projectKindTip(q), /^التصنيف: مشروع عميل — له عميل مسجَّل$/);
  assert.equal(projectKindTip(), 'التصنيف: غير مصنَّف', 'بلا معطيات: جملة سليمة لا نص مكسور');
});
