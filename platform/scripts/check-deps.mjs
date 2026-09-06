// فحصٌ مُسبَق قبل الاختبارات. تبعياتٌ غير مثبّتة تجعل `node --test` يُظهر عشرات الأعطال بصيغة
// «Cannot find package 'express'» على أسماء اختباراتٍ من صميم العمل — فتبدو انحداراً حقيقياً وهي
// ليست إلا `npm install` منسيّة (١٢٢١ اختباراً «ينجح» بلا تبعيات فيبدو التثبيت الناقص سليماً ٨٧٪).
// يُفحص هنا أولاً ويُقال بوضوح.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
  require.resolve('express');
} catch {
  console.error('\n✗ التبعيات غير مثبّتة (express غير موجود). شغّل أولاً:\n    npm install\n');
  process.exit(1);
}
