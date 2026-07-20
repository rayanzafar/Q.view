#!/usr/bin/env node
// فاحص المصطلحات: يرفض أي مصطلح تقني محظور داخل النصوص الظاهرة للمستخدم.
// يفحص القوالب النصية في src/web/views + قوالب البريد + رسائل الأخطاء في الوحدات.
// الاستهداف: النص العربي/الظاهر فقط — أسماء المتغيرات والكود ليست هدف الفحص، لذلك
// نفحص فقط ما يقع داخل نصوص template literals/strings التي تحتوي حروفاً عربية،
// وكذلك أي ظهور خام لكلمات التسريب (undefined/null/NaN/[object) في تلك النصوص.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TARGETS = ['src/web/views', 'src/web/i18n', 'src/core/mail/templates.js', 'src/web/layout.js', 'src/web/nav.js'];
const BANNED = [
  /\bAPI\b/, /\bSchema\b/i, /\bEntity\b/, /\bAdapter\b/, /\bQueue\b/, /\bWorker\b/,
  /\bJSON\b/, /\bSQL\b/, /\bDatabase\b/, /\bBackend\b/, /\bFrontend\b/,
  /\bundefined\b/, /\bNaN\b/, /\[object/, /\bUUID\b/, /سكيما|كيوري|انتيتي|باك اند|فرونت اند/,
];
// كلمات مسموحة رغم لاتينيتها: أسماء منتجات وصيغ ملفات
const ALLOW = /Excel|CSV|xlsx|EVC|Consulting|SST|IBM Plex|PDF|SAR/;

const files = [];
function walk(p) {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) return readdirSync(p).forEach((f) => walk(join(p, f)));
  if (/\.(js|mjs)$/.test(p)) files.push(p);
}
TARGETS.forEach((t) => walk(join(ROOT, t)));
// ملف المعجم نفسه يحوي قائمة المحظورات كتعريف — ليس نص واجهة
const scanFiles = files.filter((f) => !f.endsWith('glossary.js'));
files.length = 0; files.push(...scanFiles);

let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // كل نص string/template يحتوي عربية = نص واجهة
  const uiStrings = [...src.matchAll(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g)]
    .map((m) => ({ text: m[0], idx: m.index }))
    .filter((s) => /[؀-ۿ]/.test(s.text));
  for (const s of uiStrings) {
    // تجاهل تعابير ${...} الداخلية — نفحص النص الثابت فقط
    const staticText = s.text.replace(/\$\{[^}]*\}/g, ' ');
    for (const rx of BANNED) {
      const m = staticText.match(rx);
      if (m && !ALLOW.test(m[0])) {
        const line = src.slice(0, s.idx).split('\n').length;
        console.error(`✗ ${relative(ROOT, f)}:${line} — مصطلح محظور "${m[0]}" داخل نص واجهة: ${staticText.slice(0, 90).trim()}`);
        bad++;
      }
    }
  }
}
if (bad) { console.error(`\n${bad} مخالفة — النص الظاهر للمستخدم يجب أن يكون عربياً خالياً من المصطلحات التقنية.`); process.exit(1); }
console.log(`✓ فحص المعجم: ${files.length} ملفاً نظيفاً من المصطلحات المحظورة.`);
