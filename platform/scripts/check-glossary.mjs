#!/usr/bin/env node
// فاحص المصطلحات: يرفض أي مصطلح تقني محظور — أو قيمة مخزَّنة خام — داخل النص الذي يقرأه المستخدم.
// يفحص طبقتين:
//   (1) نصوص الواجهة: src/web/views + src/web/i18n + core/i18n + قالب البريد + layout/nav
//       + ملفات صفحات المتصفح (src/web/public/pages). أي نص ثابت فيه حروف عربية = نص واجهة.
//   (2) رسائل الأخطاء الظاهرة للمستخدم في كل الطبقات: badRequest/forbidden/notFound/conflict
//       (رسائل 5xx تُستبدل برسالة عامة في core/http/errors.js، فلا معنى لفحصها).
//
// دقة الفحص: النصوص تُستخرج بمُحلِّل صغير يفهم القوالب المتداخلة `${`…`}` والتعابير النمطية،
// فلا يُحسب الكود داخل ${…} نصاً. ومن النص الثابت نأخذ ما يُعرض فعلاً: نص خارج الوسوم +
// قيم السمات التي يقرأها المستخدم (title/aria-label/placeholder/alt) — أما value/data-* فهي
// قيم تُرسل للخادم لا نص معروض، ولا تُحاسب على الإنجليزية.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// `src/core/ai` نصُّ واجهة بحكم الأمر الواقع: ردّ المساعد يُعرض للمستخدم حرفياً كما تُعرض
// الصفحة. وكان مُدرَجاً في أهداف **رسائل الأخطاء** وحدها، فبقي نصّ الردود بلا فحص — وتسرّبت
// منه فعلاً قيمة حالة خام داخل جملة عربية، ورمز أولوية، ومعرّف مرحلة داخلي. الطبقة لا تُقرَّر
// بمجلدها بل بمن يقرأ مخرجاتها.
const UI_TARGETS = ['src/web/views', 'src/web/i18n', 'src/core/i18n', 'src/core/mail/templates.js',
  'src/core/mail/approval-mail.js', 'src/core/mail/meeting-mail.js',
  'src/web/layout.js', 'src/web/nav.js', 'src/web/public/pages', 'src/core/ai'];
const ERROR_TARGETS = ['src/modules', 'src/core', 'src/web'];

// مصطلحات تقنية ممنوعة في أي نص يقرأه مستخدم أعمال.
export const BANNED = [
  /\bAPI\b/, /\bSchema\b/i, /\bEntity\b/, /\bAdapter\b/, /\bQueue\b/, /\bWorker\b/, /\bTransaction\b/i,
  /\bJSON\b/, /\bSQL\b/, /\bDatabase\b/, /\bDB\b/, /\bBackend\b/, /\bFrontend\b/, /\bCache\b/i,
  /\bundefined\b/, /\bnull\b/, /\bNaN\b/, /\[object/, /\bUUID\b/, /\bID:/, /\bTimestamp\b/i,
  /\bOutbox\b/i, /\bInbox\b/i, /\bSandbox\b/i, /\bSMTP\b/i, /\bEndpoint\b/i, /\bPayload\b/i,
  /\bToken\b/i, /\bEnum\b/i, /\bBoolean\b/i, /\bRAG\b/,
  /سكيما|كيوري|انتيتي|باك اند|فرونت اند/,
];

// قيم مخزَّنة (حالات/تصنيفات) يجب ألا تُطبع كما هي — تُعرض بمعناها العربي دائماً.
export const RAW_ENUM = new RegExp('\\b(' + [
  'RED', 'AMBER', 'GREEN',
  'IN_PROGRESS', 'NOT_STARTED', 'ON_HOLD', 'IN_REVIEW', 'PARTIALLY_PAID',
  'COMPLETED', 'CANCELLED', 'PLANNED', 'TODO', 'BLOCKED',
  'PENDING', 'DELIVERED', 'ACCEPTED', 'INVOICED', 'ISSUED', 'OVERDUE',
  'SUSPENDED', 'QUEUED', 'SENDING', 'PROCESSING', 'APPROVED', 'REJECTED',
  'QUALIFIED', 'NEGOTIATION',
].join('|') + ')\\b');

// كلمات مسموحة رغم لاتينيتها: أسماء منتجات وصيغ ملفات وبروتوكول الروابط.
const ALLOW = /Excel|CSV|xlsx|EVC|Consulting|SST|IBM Plex|PDF|SAR|https/;

// ── استخراج النصوص الثابتة ────────────────────────────────────────────────────
// يعيد [{ text, idx }] لكل نص ثابت ('…' / "…" / `…` بلا تعابير ${…}).
// الرموز التي يأتي بعدها تعبير نمطي لا قسمة (بداية تعبير)
const RE_START = /[(,=:[!&|?{};+\-*%~^]|^$/;

export function staticStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = ''; // آخر رمز غير فراغ — للتفريق بين القسمة والتعبير النمطي

  const skipRegex = (start) => { // start على '/'
    let j = start + 1, inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) return j + 1;
      else if (c === '\n') return start + 1; // ليس تعبيراً نمطياً فعلياً
      j++;
    }
    return j;
  };
  const readQuoted = (start) => { // '…' أو "…" ⟵ { text, end }
    const q = src[start];
    let j = start + 1, text = '';
    while (j < n) {
      const c = src[j];
      if (c === '\\') { text += src[j + 1] || ''; j += 2; continue; }
      if (c === q) return { text, end: j + 1 };
      if (c === '\n') return { text, end: j }; // نص غير مغلق — لا نبتلع بقية الملف
      text += c; j++;
    }
    return { text, end: j };
  };
  const readTemplate = (start) => { // `…` مع تخطي ${…} بالكامل (وما بداخلها من نصوص وقوالب)
    let j = start + 1, text = '';
    while (j < n) {
      const c = src[j];
      if (c === '\\') { text += src[j + 1] || ''; j += 2; continue; }
      if (c === '`') return { text, end: j + 1 };
      if (c === '$' && src[j + 1] === '{') {
        j += 2;
        let depth = 1;
        let p = '('; // آخر رمز غير فراغ داخل التعبير — للتفريق بين القسمة والتعبير النمطي
        while (j < n && depth > 0) {
          const d = src[j];
          if (d === '{') { depth++; j++; p = d; }
          else if (d === '}') { depth--; j++; p = d; }
          // النصوص داخل التعبير نفسه (شرط ثلاثي يبني HTML مثلاً) نصوص واجهة كاملة — تُجمع أيضاً
          else if (d === '`') { const r = readTemplate(j); out.push({ text: r.text, idx: j }); j = r.end; p = d; }
          else if (d === "'" || d === '"') { const r = readQuoted(j); out.push({ text: r.text, idx: j }); j = r.end; p = d; }
          else if (d === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; }
          else if (d === '/' && src[j + 1] === '*') { j += 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j += 2; }
          // تعبير نمطي داخل التعبير — قد يحوي علامات اقتباس: replace(/"/g, '')
          else if (d === '/' && RE_START.test(p)) { j = skipRegex(j); p = '/'; }
          else { if (!/\s/.test(d)) p = d; j++; }
        }
        text += ' ';
        continue;
      }
      text += c; j++;
    }
    return { text, end: j };
  };

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '/' && RE_START.test(prev)) { i = skipRegex(i); prev = '/'; continue; }
    if (c === "'" || c === '"') { const r = readQuoted(i); out.push({ text: r.text, idx: i }); i = r.end; prev = c; continue; }
    if (c === '`') { const r = readTemplate(i); out.push({ text: r.text, idx: i }); i = r.end; prev = c; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// ما يقرأه المستخدم فعلاً: النص خارج الوسوم + قيم السمات النصية التي تُقرأ (بما فيها قارئ الشاشة).
export function visibleText(text) {
  const readable = [];
  // كود المتصفح داخل <script> وقواعد <style> ليست نصاً معروضاً — تُحذف بجسمها أولاً
  // (وإن انقطع الوسم بسبب تعبير ${…} نحذف حتى نهاية المقطع).
  const noCode = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<script\b[\s\S]*$/i, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<style\b[\s\S]*$/i, ' ');
  const stripped = noCode.replace(/<[^>]*>/g, (tag) => {
    for (const m of tag.matchAll(/\b(?:title|aria-label|placeholder|alt|aria-description)\s*=\s*(["']?)([^"'>]*)\1/gi)) readable.push(m[2]);
    return ' ';
  });
  return `${stripped} ${readable.join(' ')}`;
}

// يعيد أول مصطلح محظور في النص (أو null إن كان نظيفاً).
export function bannedTermIn(text) {
  for (const rx of [...BANNED, RAW_ENUM]) {
    const m = text.match(rx);
    if (m && !ALLOW.test(m[0])) return m[0];
  }
  return null;
}

// ── التشغيل ───────────────────────────────────────────────────────────────────
function walk(p, out) {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return out;
  if (st.isDirectory()) { readdirSync(p).forEach((f) => walk(join(p, f), out)); return out; }
  if (/\.(js|mjs)$/.test(p)) out.push(p);
  return out;
}
const collect = (targets) => [...new Set(targets.flatMap((t) => walk(join(ROOT, t), [])))];
// ملف المعجم والفاحص نفسه يحويان قوائم المحظورات كتعريف — ليست نصوص واجهة.
const isDefinitionFile = (f) => f.endsWith('glossary.js') || f.endsWith('check-glossary.mjs');
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

export function run() {
  const uiFiles = collect(UI_TARGETS).filter((f) => !isDefinitionFile(f));
  const errFiles = collect(ERROR_TARGETS).filter((f) => !isDefinitionFile(f));
  const problems = [];
  const add = (rel, line, term, where, sample) =>
    problems.push({ rel, line, term, where, sample: sample.replace(/\s+/g, ' ').trim().slice(0, 90) });

  // (1) نصوص الواجهة
  for (const f of uiFiles) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    for (const s of staticStrings(src)) {
      if (!/[؀-ۿ]/.test(s.text)) continue; // نص بلا عربية = تنسيق/مفتاح داخلي لا نص واجهة
      const shown = visibleText(s.text);
      const term = bannedTermIn(shown);
      if (term) add(rel, lineOf(src, s.idx), term, 'نص واجهة', shown);
    }
  }

  // (2) رسائل الأخطاء الظاهرة للمستخدم
  const ERROR_CALL = /\b(badRequest|forbidden|notFound|conflict)\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
  for (const f of errFiles) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    for (const m of src.matchAll(ERROR_CALL)) {
      const msg = m[3].replace(/\$\{[^}]*\}/g, ' ');
      const line = lineOf(src, m.index);
      const term = bannedTermIn(msg);
      if (term) add(rel, line, term, 'رسالة خطأ', msg);
      if (msg.trim() && !/[؀-ۿ]/.test(msg)) add(rel, line, 'رسالة غير عربية', 'رسالة خطأ', msg);
    }
  }

  for (const p of problems) console.error(`✗ ${p.rel}:${p.line} — مصطلح محظور "${p.term}" داخل ${p.where}: ${p.sample}`);
  if (problems.length) {
    console.error(`\n${problems.length} مخالفة — النص الظاهر للمستخدم يجب أن يكون عربياً خالياً من المصطلحات التقنية والقيم الخام.`);
    return 1;
  }
  console.log(`✓ فحص المعجم: ${uiFiles.length} ملف واجهة + رسائل الأخطاء في ${errFiles.length} ملفاً — لا مصطلحات محظورة ولا قيم خام.`);
  return 0;
}

// يُنفَّذ فقط عند التشغيل المباشر — الاستيراد في الاختبارات لا يشغّل الفحص.
if (process.argv[1] && process.argv[1].endsWith('check-glossary.mjs')) process.exit(run());
