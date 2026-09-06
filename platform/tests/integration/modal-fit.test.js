// النافذة المنبثقة يجب أن تسع الشاشة دائماً مهما طال محتواها. العيب الذي حدث فعلاً: التمرير كان
// على البطاقة كلها، فتهرب الترويسة مع التمرير ويُقتطع أسفل النافذة على الشاشات القصيرة — وهو ما
// رآه المالك على شاشته. هذه الاختبارات تحرس العقد في نص التنسيق نفسه، فلا يعود بصمت.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/web/layout.js', import.meta.url), 'utf8');
const ruleFor = (sel) => {
  // أول تعريف للمُحدِّد في ورقة التنسيق (التعريفات اللاحقة تُفحص على حدة عند الحاجة)
  const m = css.match(new RegExp(`\\n\\s*\\${sel}\\{([^}]*)\\}`)) || css.match(new RegExp(`\\n${sel.replace('.', '\\.')}\\{([^}]*)\\}`));
  assert.ok(m, `لم يُعثر على قاعدة ${sel} في ورقة التنسيق`);
  return m[1].replace(/\s+/g, '');
};

test('بطاقة النافذة عمود مقيَّد بارتفاع الشاشة — لا تتمدّد خارجها', () => {
  const r = ruleFor('.modal-card');
  assert.match(r, /display:flex/, 'البطاقة عمود مرن');
  assert.match(r, /flex-direction:column/);
  assert.match(r, /max-height:calc\(100dvh-2rem\)/, 'مقيَّدة بارتفاع الشاشة الفعلي');
  assert.match(r, /overflow:hidden/, 'البطاقة نفسها لا تُمرَّر');
  assert.ok(!/max-height:92vh/.test(css), 'لا أثر للحد القديم الذي كان يسمح بالتجاوز');
});

test('الترويسة والذيل ثابتان — لا يهربان مع التمرير', () => {
  // المسافات محذوفة في ruleFor، فـ«flex:0 0 auto» تصير «flex:00auto».
  for (const sel of ['.modal-head', '.modal-foot'])
    assert.match(ruleFor(sel), /flex:00auto/, `${sel} يجب أن يكون ثابتاً لا ينكمش`);
});

test('الجسم وحده هو ما يُمرَّر، ولا يجرّ الصفحة خلفه', () => {
  const r = ruleFor('.modal-body');
  assert.match(r, /overflow-y:auto/, 'الجسم يُمرَّر');
  assert.match(r, /min-height:0/, 'بدونها لا ينكمش العنصر المرن فلا يعمل التمرير أصلاً');
  assert.match(r, /overscroll-behavior:contain/, 'التمرير لا يتسرّب إلى الصفحة خلف النافذة');
});

test('بديل للمتصفحات بلا dvh — لا تبقى بلا حدّ ارتفاع', () => {
  assert.match(css, /@supports not \(height:100dvh\)\{\.modal-card\{max-height:calc\(100vh - 2rem\)\}\}/);
});
