# Tesseract.js 5.1.1 — مورَّد داخل سند

قارئ بطاقات العمل يعمل **داخل متصفّح المستخدم**، والملفّات كلّها تُخدَم من أصل سند نفسه
(`/static/vendor/tesseract-5.1.1/`) — لا شبكة توزيع خارجية، ولا تخرج صورةٌ ولا نصٌّ من المنصّة
للقراءة (قرار المالك: الذكاء الاصطناعي محلّي). الإصدار في اسم المجلّد عمداً: الترقية مجلّدٌ جديد
بعناوين جديدة، فلا نافذةَ تخبئةٍ قديمة (رؤوس `immutable` على `public/vendor/**`).

| الملفّ | المصدر | الحجم |
|---|---|---|
| `tesseract.min.js` | https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js | 66,695 |
| `worker.min.js` | https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js | 123,724 |
| `tesseract-core-simd-lstm.wasm.js` | https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js | 3,938,657 |
| `lang/eng.traineddata.gz` | https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz | 1,984,273 |
| `lang/ara.traineddata.gz` | https://tessdata.projectnaptha.com/4.0.0_fast/ara.traineddata.gz | 725,639 |
| `LICENSE.md` | https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/LICENSE.md | 11,357 |

تاريخ الجلب: 2026-08-27. الرخصة: Apache-2.0 (tesseract.js · tesseract.js-core · tessdata).
`tesseract.js@5.1.1` يعتمد `tesseract.js-core ^5.1.1` — النواة المورَّدة مطابقة.
النواة ملفٌّ واحد يضمّ WebAssembly داخله (لا حاجة لملفّ `.wasm` منفصل). النسخة `simd-lstm` فقط:
الأجهزة بلا SIMD تسقط إلى مسار اللصق بلا خطأ ظاهر.

## بصمات SHA-256
```
a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8  tesseract.min.js
aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc  worker.min.js
ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf  tesseract-core-simd-lstm.wasm.js
18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b  lang/eng.traineddata.gz
cfdec92af6c72289984b03dfe5e03d25f7fee591733081aa6f40761f3f5884cf  lang/ara.traineddata.gz
b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1  LICENSE.md
```

## التحقّق بعد الجلب
`gzip -t lang/*.gz` · `node --check *.js` (بوّابة الصياغة في `npm run quality` تمرّ على هذا المجلّد) ·
`sha256sum` مطابق للجدول أعلاه. اختبار `tests/security/ocr-engine-vendored.test.js` يحرس وجود
الملفّات وأحجامها الدنيا وبداية `1F 8B` لملفّات اللغة، وأنّ شيفرة الصفحة لا تذكر أيّ شبكة توزيع.

## الترقية
مجلّدٌ جديد `tesseract-<الإصدار>/`، وتحديث المسارات الثلاثة في `src/web/public/pages/events.js`
والمُحمِّل في `scripts:[]` لصفحة الفعالية واختبار التوريد، ثم حذف المجلّد القديم.
