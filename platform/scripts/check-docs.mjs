#!/usr/bin/env node
// فاحص الوثائق: يضمن أن docs/ تلاحق الكود لا العكس — فالكود هو المرجع، والوثيقة سجلٌّ يجب
// ألا يتخلّف عنه. يفحص أربعة عقود (انظر docs/README.md):
//   (1) كل صفحة في خريطة PAGES داخل src/web/routes.js مذكورة بمفتاحها بين علامتي ` داخل
//       قسم «## Pages» في docs/FEATURES.md — المفاتيح تُستخرج من نص الملف لا من استيراده،
//       حتى يعمل الفحص بلا تشغيل الخادم وبلا آثار جانبية.
//   (2) كل ملف ترحيلة migrations/NNN_*.sql له صفٌّ يبدأ بـ«| NNN » في docs/FEATURES.md.
//   (3) كل مجلد وحدة تحت src/modules/ مذكور بمساره src/modules/<name> في docs/FEATURES.md.
//   (4) الوثائق الأربع الأساسية (ARCHITECTURE/FEATURES/KNOWN-ISSUES/CHANGELOG) موجودة وغير
//       فارغة، وسجل المشاكل بلا مواضع مؤجَّلة "TODO(".
// كل إخفاق يُسمّى باسمه ويُنهي بالرمز 1 — لا إخفاق صامت.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const rd = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
};

// ── الاستخراج من الكود (المصدر الوحيد للحقيقة) ────────────────────────────────
// مفاتيح PAGES من نص routes.js: معرّف مجرّد أو مفتاح بين اقتباس، يليه نقطتان.
export function pageKeysFrom(routesSrc) {
  const m = routesSrc.match(/const\s+PAGES\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return null;
  const keys = [];
  for (const k of m[1].matchAll(/(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)) {
    keys.push(k[1] ?? k[2] ?? k[3]);
  }
  return keys;
}

// أرقام الترحيلات الثلاثية من أسماء ملفات migrations/*.sql
export function migrationNumbers() {
  return readdirSync(join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.match(/^(\d{3})_/)?.[1])
    .filter(Boolean)
    .sort();
}

// مجلدات الوحدات تحت src/modules/ (المجلدات فقط — ملفات *.routes.js ليست وحدات)
export function moduleDirs() {
  const base = join(ROOT, 'src/modules');
  return readdirSync(base).filter((f) => statSync(join(base, f)).isDirectory()).sort();
}

// قسم «## Pages» من FEATURES.md: من عنوانه حتى العنوان التالي من نفس المستوى (أو نهاية الملف)
export function pagesSection(featuresSrc) {
  const m = featuresSrc.match(/^##\s+Pages\b.*$/m);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = featuresSrc.slice(start);
  const next = rest.search(/^##\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// ── التشغيل ───────────────────────────────────────────────────────────────────
export function run() {
  const problems = [];
  const miss = (msg) => problems.push(msg);

  // (4) أولاً: الوثائق الأساسية موجودة وغير فارغة — بقية الفحوص تعتمد على FEATURES.md
  const CORE_DOCS = ['docs/ARCHITECTURE.md', 'docs/FEATURES.md', 'docs/KNOWN-ISSUES.md', 'docs/CHANGELOG.md'];
  const docs = {};
  for (const rel of CORE_DOCS) {
    docs[rel] = rd(rel);
    if (docs[rel] == null) miss(`${rel} غير موجود — الوثائق الأساسية إلزامية`);
    else if (!docs[rel].trim()) miss(`${rel} فارغ — وثيقة بلا محتوى كغيابها`);
  }

  const features = docs['docs/FEATURES.md'];
  if (features && features.trim()) {
    // (1) الصفحات: كل مفتاح من PAGES بين علامتي ` داخل قسم «## Pages»
    const routesSrc = rd('src/web/routes.js');
    const keys = routesSrc == null ? null : pageKeysFrom(routesSrc);
    if (keys == null) miss('تعذّر إيجاد كائن PAGES في src/web/routes.js — عدّل الفاحص إن تغيّر شكل الخريطة');
    else {
      const section = pagesSection(features);
      if (section == null) miss('docs/FEATURES.md بلا قسم «## Pages» — الصفحات تُسجَّل تحته');
      else for (const k of keys) {
        if (!section.includes('`' + k + '`')) miss(`الصفحة \`${k}\` (src/web/routes.js) غائبة عن قسم «## Pages» في docs/FEATURES.md`);
      }
    }

    // (2) الترحيلات: صفٌّ يبدأ بـ«| NNN » لكل ملف migrations/NNN_*.sql
    for (const n of migrationNumbers()) {
      if (!new RegExp(`^\\|\\s*${n}\\s`, 'm').test(features)) miss(`الترحيلة ${n} (migrations/) بلا صفّ «| ${n} » في docs/FEATURES.md`);
    }

    // (3) الوحدات: كل مجلد src/modules/<name> مذكور بمساره
    for (const d of moduleDirs()) {
      if (!features.includes(`src/modules/${d}`)) miss(`الوحدة src/modules/${d} غير مذكورة في docs/FEATURES.md`);
    }
  }

  // (5) سجل المشاكل بلا مواضع مؤجَّلة
  const known = docs['docs/KNOWN-ISSUES.md'];
  if (known && known.includes('TODO(')) miss('docs/KNOWN-ISSUES.md يحوي "TODO(" — يُكتب البند كاملاً أو لا يُكتب');

  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length) {
    console.error(`\n${problems.length} مخالفة — حدِّث الوثيقة في نفس الإيداع الذي غيّر الكود (العقد في docs/README.md).`);
    return 1;
  }
  const routesSrc = rd('src/web/routes.js');
  console.log(`✓ فحص الوثائق: ${pageKeysFrom(routesSrc).length} صفحة و${migrationNumbers().length} ترحيلة و${moduleDirs().length} وحدة موثَّقة في FEATURES.md — والوثائق الأساسية الأربع حاضرة بلا مواضع مؤجَّلة.`);
  return 0;
}

// يُنفَّذ فقط عند التشغيل المباشر — الاستيراد في الاختبارات لا يشغّل الفحص.
if (process.argv[1] && process.argv[1].endsWith('check-docs.mjs')) process.exit(run());
