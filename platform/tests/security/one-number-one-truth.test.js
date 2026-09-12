// «هذه كلها راح يكون عليها حساب ومحاسبة شديدة من الإدارة» — بلسان المالك.
//
// وأخطرُ ما يواجه رقماً يُحاسَب عليه ليس أن يكون خاطئاً، بل أن **تختلف عليه شاشتان**: عندئذٍ
// لا أحد يعرف أيّهما يصدّق، ويصير كل اجتماعٍ نقاشاً على الرقم بدل النقاش على العمل.
//
// وقد وقع هذا فعلاً على البيانات الحيّة: مشروع «منصة البيانات السعودية» اعتُمدت مخرجاته
// الاثنا عشر كلها (أوزانها ١٠٠٪) فقرأته صفحتُه **١٠٠٪** وصفحةُ عميله **٥٨٪** — والرقم الثاني
// عمودٌ مستورد من المنصة القديمة لا يتحرّك مهما عمل الفريق.
//
// هذا الملف حارسٌ **بنيوي** لا فحص حالة: يقرأ الشيفرة نفسها ويرفض أي شاشة تطبع نسبة إنجاز
// مشروعٍ من العمود المخزَّن مباشرةً. فالقاعدة تُحرَس بالبناء لا بالانضباط، وأي شاشة جديدة
// تُضاف غداً تسقط هنا إن خالفت.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

// الطبقات التي تُنتج نصاً يقرؤه إنسان: الشاشات، والتقارير (المعروضة والمُرسَلة بالبريد)،
// **وشيفرة المتصفّح**.
//
// وإضافةُ الثالثة ليست توسّعاً احتياطياً بل سدُّ ثقبٍ أثبت أنه ثقب: النافذة الجانبية للمشروع
// في `web/public/app.js` بقيت تطبع العمود المخزَّن بعد أن أُصلحت الشاشات الستّ كلها — لأن
// الحارس كان يمسح ما يُصيَّر في الخادم وحده. فقرأ المالك «١٠٠٪» على صفحة المشروع و«٥٨٪» في
// نافذته في الدقيقة نفسها. الحارسُ الذي لا يغطّي كل ما يراه المستخدم يعطي طمأنينةً كاذبة.
const SURFACES = ['src/web/views', 'src/core/reports', 'src/web/public'];

// المواضع المسموحة صراحةً — كلٌّ بسببه المكتوب:
//   • progress.js نفسه هو المصدر.
//   • pmo.js: يقرأ العمود داخل `effProg` كتراجعٍ لمشروعٍ بلا مخرجات — وهو الاستعمال الصحيح.
//   • أسطر تكتب العمود بعد حسابه من المصدر (`p.progress_pct = pm.get(...)`) لا تقرؤه.
const WRITE_BACK = /progress_pct\s*=\s*(pm|progMap|prog)/;
const FALLBACK_OK = /progress_pct\s*\)\s*\|\|\s*0\s*\)\s*,\s*source:\s*'stored'|source:\s*'stored'/;
// سطرٌ يقرأ **الحقل المحسوب أولاً** ثم يتراجع إلى العمود عند غيابه ليس مخالفة: الرقم المعروض
// هو المحسوب، والعمود شبكةُ أمانٍ لصفٍّ وصل من مسارٍ قديم. والشرط أن يُذكر المحسوب في السطر
// نفسه — وسطرُ العطل الأصلي (`${Math.round(p.progress_pct || 0)}%`) لا يذكره، فيبقى ممسوكاً.
const READS_EFFECTIVE = /progress_effective_pct/;
// كتابةُ نسبة إنجاز **مهمة** إلى الخادم ليست طباعةَ نسبة مشروع: مفتاحٌ في كائن يُرسَل، لا رقمٌ
// يُعرَض. ويُميَّز بأنه لا يقع داخل استبدالٍ نصّي (`${…}`) ولا يلمس كائن مشروع.
const TASK_WRITE = /^\s*progress_pct\s*:/;

test('لا شاشة تطبع نسبة إنجاز مشروع من العمود المخزَّن — المصدر واحد', () => {
  const offenders = [];
  for (const rel of SURFACES) {
    for (const file of walk(join(ROOT, rel))) {
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (!/progress_pct/.test(line)) return;
        if (/^\s*(\/\/|\*)/.test(line)) return;                 // تعليق
        if (WRITE_BACK.test(line) || FALLBACK_OK.test(line)) return;
        if (READS_EFFECTIVE.test(line) || TASK_WRITE.test(line)) return;
        // قراءةٌ من صفٍّ داخل استعلام (SELECT/GROUP BY) ليست طباعة — الطباعة تلمس الكائن
        if (/SELECT|GROUP BY|COALESCE\(p\.progress_pct/.test(line) && !/\$\{/.test(line)) return;
        // مهمة لا مشروع: `t.progress_pct` على المهام محورٌ آخر
        if (/\bt\.progress_pct|Number\(t\.progress_pct\)/.test(line)) return;
        // تراجع صريح داخل نفس السطر الذي يقرأ الخريطة
        if (/progMap|progMapS|pm\d?\.get|effectiveProgress/.test(line)) return;
        offenders.push(`${file.replace(ROOT, '')}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
  }
  assert.deepEqual(offenders, [],
    'شاشات تطبع نسبة الإنجاز من العمود المخزَّن مباشرةً — مرّرها على effectiveProgress()، '
    + 'وإلا اختلفت عن صفحة المشروع كما اختلفت صفحة العميل (٥٨٪ مقابل ١٠٠٪) على البيانات الحيّة:\n'
    + offenders.join('\n'));
});

// والحارس نفسه يجب أن يمسك المخالفة لو عادت — وإلا كان أخضرَ بلا معنى.
test('والحارس يمسك المخالفة فعلاً — لا يمرّ أخضرَ بلا فحص', () => {
  const bad = '${Math.round(p.progress_pct || 0)}%';
  const isOffender = (line) => /progress_pct/.test(line)
    && !WRITE_BACK.test(line) && !FALLBACK_OK.test(line)
    && !READS_EFFECTIVE.test(line) && !TASK_WRITE.test(line)
    && !/progMap|progMapS|pm\d?\.get|effectiveProgress/.test(line);
  assert.equal(isOffender(bad), true, 'الحارس لا يرى السطر الذي كان في صفحة العميل حرفياً');
  assert.equal(isOffender('for (const p of rows) p.progress_pct = progMap.get(p.id)?.pct;'), false,
    'الحارس يرفض السطر الذي يكتب الرقم المحسوب — فيمنع الإصلاح نفسه');
});

// والإعفاءان المضافان لا يفتحان باباً للعطل نفسه — يُثبَت بالسطر الحرفي الذي وقع.
test('وإعفاءا «المحسوب أولاً» و«كتابة المهمة» لا يمرّران سطر العطل', () => {
  const bad = '${Math.round(p.progress_pct || 0)}%';
  assert.equal(READS_EFFECTIVE.test(bad), false, 'سطر العطل يُعفى بحجّة الحقل المحسوب');
  assert.equal(TASK_WRITE.test(bad), false, 'سطر العطل يُعفى بحجّة كتابة المهمة');
  // والسطر الصحيح يمرّ فعلاً
  assert.equal(READS_EFFECTIVE.test('${Math.round(p.progress_effective_pct ?? p.progress_pct ?? 0)}%'), true);
});
