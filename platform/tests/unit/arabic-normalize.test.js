// ── تطبيع العربية للبحث: ما لا يفرّقه القارئ لا يفرّقه البحث ─────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArabic, searchTokens, withinOneEdit, matchScore, matchesQuery, bestScore } from '../../src/core/i18n/arabic.js';

test('الهمزات والتاء المربوطة والألف المقصورة والتشكيل والأرقام الهندية تُوحَّد', () => {
  assert.equal(normalizeArabic('أَحْمَد الشِّهْرِي'), 'احمد الشهري');
  assert.equal(normalizeArabic('إدارة آل مؤسّسة ٤٥٤٨'), 'اداره ال موسسه 4548');
  assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
  assert.equal(normalizeArabic('  Data   Science  '), 'data science');
  assert.equal(normalizeArabic('رؤية — الخبراء، (EVC)'), 'رويه الخبراء evc');
  assert.equal(normalizeArabic('ـــمـــد'), 'مد', 'التطويل لم يُحذف');
});

test('كلمات الاستعلام: «ال» التعريف تُنزع من الكلمة الطويلة وحدها', () => {
  assert.deepEqual(searchTokens('الحوكمة المؤسسية'), ['حوكمه', 'موسسيه']);
  assert.deepEqual(searchTokens('الرياض'), ['رياض']);
  assert.deepEqual(searchTokens('ال علي'), ['ال', 'علي'], 'كلمة «ال» القصيرة تبقى');
});

test('خطأٌ واحد لا أكثر', () => {
  assert.ok(withinOneEdit('حوكمه', 'حوكه'));      // حذف
  assert.ok(withinOneEdit('حوكمه', 'حوكمهه'));    // إدراج
  assert.ok(withinOneEdit('حوكمه', 'حوكنه'));     // إبدال
  assert.ok(withinOneEdit('حوكمه', 'حوكهم'));     // تبديل متجاورين
  assert.ok(!withinOneEdit('حوكمه', 'حومه'.slice(0, 2)));
  assert.ok(!withinOneEdit('سالم', 'سلامه'));
});

test('المطابقة تُدرَّج: تامة، فبادئة، فكل الكلمات، فتقريبية — ولا مطابقة على غير ذلك', () => {
  assert.equal(matchScore('مؤسسة الحوكمة', 'موسسه الحوكمه'), 4);
  assert.equal(matchScore('مؤسسة الحوكمة الرقمية', 'مؤسسة'), 3);
  assert.equal(matchScore('تفعيل حوكمة الذكاء الاصطناعي', 'الذكاء حوكمه'), 2, 'ترتيب الكلمات لا يهم');
  assert.equal(matchScore('تفعيل حوكمة الذكاء الاصطناعي', 'الحوكه'), 1, 'خطأ واحد في كلمة طويلة');
  assert.equal(matchScore('أحمد الشهري', 'احمد الشهرى'), 4);
  assert.equal(matchScore('سالم العمري', 'سلام'), 0, 'كلمة قصيرة لا تُقارَب — «سالم» ليس «سلام»');
  assert.equal(matchScore('منافسة 4548', '٤٥٤٨'), 2, 'الرقم الهندي يطابق الرقم العربي');
  assert.ok(!matchesQuery('مشروع منصة الزوار', 'الحوكمة'));
  assert.equal(bestScore(['علي', 'محلل بيانات'], 'بيانات'), 2);
});
