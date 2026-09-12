// وحدة: تعريب أسماء الإدارات + التباس التسمية + صيغ العدد بالعربية.
// دوال خالصة لا تلمس قاعدة البيانات إطلاقاً — تُختبر وحدها لأن عليها يقوم اقتراح إعادة التسمية
// الذي سيقرأه المالك ويقرّره بنفسه (المنصة تقترح ولا تعيد التسمية تلقائياً).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestArabicName, isArabicName, bareName, countPhrase, WARN, NOTE }
  from '../../src/modules/org/org-quality.js';
import { bannedTermIn } from '../../scripts/check-glossary.mjs';

test('كشف الاسم غير العربي: «Ai&Data» و«Innovation» غير عربيين، والمختلط عربي', () => {
  assert.equal(isArabicName('Ai&Data'), false);
  assert.equal(isArabicName('Innovation'), false);
  assert.equal(isArabicName('PMO'), false);
  assert.equal(isArabicName(''), false);
  assert.equal(isArabicName(null), false);
  assert.equal(isArabicName('إدارة المدن الذكية'), true);
  assert.equal(isArabicName('مكتب إدارة المشاريع (PMO)'), true, 'اسم عربي بلاحقة أجنبية يبقى عربياً');
});

test('اقتراح اسم عربي: العبارة الكاملة أولاً ثم الكلمة كلمة — والاقتراح عربي خالص', () => {
  assert.equal(suggestArabicName('Ai&Data'), 'إدارة الذكاء الاصطناعي والبيانات');
  assert.equal(suggestArabicName('Innovation'), 'إدارة الابتكار');
  assert.equal(suggestArabicName('Smart Cities'), 'إدارة المدن الذكية');
  assert.equal(suggestArabicName('Business Development'), 'إدارة تطوير الأعمال');
  assert.equal(suggestArabicName('PMO'), 'مكتب إدارة المشاريع', 'ما بدأ بلقب لا يُسبق بلقب ثانٍ');
  assert.equal(suggestArabicName('Data Analytics'), 'إدارة البيانات والتحليلات', 'كلمتان معروفتان تُوصلان بالواو');
  for (const n of ['Ai&Data', 'Innovation', 'Smart Cities']) {
    assert.ok(!/[A-Za-z]/.test(suggestArabicName(n)), `${n}: الاقتراح يجب أن يكون عربياً خالصاً`);
  }
});

test('لا اقتراح مخمَّن: كلمة مجهولة ⟵ نص فارغ بدل اسم نصفه مترجم', () => {
  assert.equal(suggestArabicName('Zumra Eleven'), '', 'لا نخترع اسماً لما لا نعرفه');
  assert.equal(suggestArabicName('XYZ Unit 42'), '');
  assert.equal(suggestArabicName(''), '');
  assert.equal(suggestArabicName(null), '');
});

test('التباس التسمية: «الحلول» داخل «قطاع الحلول» اسم واحد بعد نزع الألقاب العامة', () => {
  assert.equal(bareName('الحلول'), bareName('قطاع الحلول'));
  assert.equal(bareName('إدارة الحلول'), bareName('قطاع الحلول'));
  assert.equal(bareName('حلول'), bareName('قطاع الحلول'), 'أداة التعريف لا تصنع اسمين');
  assert.notEqual(bareName('إدارة المدن الذكية'), bareName('قطاع الحلول'));
  assert.notEqual(bareName('تطوير الأعمال'), bareName('قطاع الاستشارات'));
  assert.equal(bareName(''), '');
});

test('صيغ العدد بالعربية: مفرد ومثنى وجمع قلة وجمع كثرة — لا «1 موظفين»', () => {
  assert.equal(countPhrase(1, 'employee'), 'موظف واحد');
  assert.equal(countPhrase(2, 'employee'), 'موظفان');
  assert.equal(countPhrase(10, 'employee'), '10 موظفين');
  assert.equal(countPhrase(29, 'employee'), '29 موظفاً');
  assert.equal(countPhrase(1, 'department'), 'إدارة واحدة');
  assert.equal(countPhrase(5, 'department'), '5 إدارات');
  assert.equal(countPhrase(43, 'project'), '43 مشروعاً');
  assert.equal(countPhrase(2, 'sector'), 'قطاعان');
  assert.equal(countPhrase(3, 'opportunity'), '3 فرص');
});

test('الشدّتان عربيتان وخاليتان من أي مصطلح محظور', () => {
  assert.equal(WARN, 'تحذير');
  assert.equal(NOTE, 'ملاحظة');
  for (const s of [WARN, NOTE]) assert.equal(bannedTermIn(s), null);
});
