#!/usr/bin/env node
// محوّل صادرات اجتماعات تيمز إلى نصٍّ يُقرأ: يأخذ ملف HTML مصدَّراً من لوحة النص الحرفي في
// تيمز — سطرٌ واحدٌ من ترميز Fluent-UI لا يُقرأ ولا يُبحَث فيه — ويُخرج ماركداون بمتحدّثيه
// ومواقيته. لماذا سكربت لا أمرٌ عابر: جلسات التعريف والملاحظات تتكرّر، والنسخة النظيفة هي
// ما يُودَع في docs/meetings/ بينما يبقى الأصل خارج المستودع.
//
// الاستخدام:
//   node scripts/transcript-to-md.mjs <ملف.html>                 # إلى الخرج القياسي
//   node scripts/transcript-to-md.mjs <ملف.html> --out <ملف.md>  # إلى ملف
//   node scripts/transcript-to-md.mjs <ملف.html> --title "..." --date 2026-08-05
//
// السلامة: لا يقرأ إلا الملف المُمرَّر، ولا يكتب إلا حيث يُطلب صراحةً بـ--out.
//   • صادرة تيمز تحمل في روابط صور الأشخاص رموزَ وصولٍ (AuthToken) ومعرّفاتِ دليلٍ
//     (AadObjectId) — ولذلك يبني هذا المحوّل خرجه من ثلاثة حقول فقط (متحدّث، وقت، نص)،
//     ثم يفحص الناتج فحصاً أخيراً ويرفض الكتابة إن ظهر فيه أثرُ رمزٍ. أسرارٌ لا تُنقل.
//   • الاكتمال محروس: عدد المداخلات المستخرَجة يجب أن يساوي عدد خلايا القائمة في الأصل،
//     ولا تُقبل مداخلةٌ فارغة. تغييرُ ترميزِ تيمز يُخفق بصوتٍ عالٍ لا يبتر النص صامتاً.
import { readFileSync, writeFileSync } from 'node:fs';

// ── الترميز الذي نعتمد عليه (من صادرة تيمز) ───────────────────────────────────
// الصادرة قائمةُ خلايا؛ في كل خلية نصُّ مداخلة، وعند تغيُّر المتحدّث ترويسةٌ باسمه ووقته.
// نطابق أسماء الأصناف بلاحقةٍ رقمية متغيّرة (entryText-443 اليوم، غيرها غداً).
const CELL = /<div role="presentation" class="ms-List-cell"/g;
const SPLIT = /(?=<div role="presentation" class="ms-List-cell")/;
const SPEAKER = /class="itemDisplayNameRTL-\d+">([\s\S]*?)<\/span>/;
const STAMP = /id="Header-timestamp-\d+"[^>]*>([\s\S]*?)<\/span>/;
const ENTRY = /class="(?:entryText|eventText)-\d+[^"]*"[^>]*>([\s\S]*?)<\/div>/;

// أثرُ رمزٍ أو معرّفِ دليل — إن ظهر في الخرج فالمحوّل مخترَق ويجب أن يتوقّف.
const SECRET = /AuthToken|AadObjectId|personaphoto|eyJ[A-Za-z0-9_-]{10}/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// نصٌّ مجرّد من الترميز: الوسوم تُستبدل بفراغ (لا بلا شيء) كي لا تلتحم كلمتان، ثم يُطوى
// الفراغ. هذا هو الحقل الوحيد الذي يعبر من الأصل إلى الخرج.
export function plain(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

// ── الاستخراج ─────────────────────────────────────────────────────────────────
// المتحدّث والوقت يردان في ترويسةٍ عند تغيُّرهما فقط، فيُحملان إلى ما بعدهما.
export function parseTranscript(html) {
  const cells = html.split(SPLIT).slice(1);
  const expected = (html.match(CELL) || []).length;
  const rows = [];
  let speaker = null;
  let stamp = null;
  for (const cell of cells) {
    const s = cell.match(SPEAKER);
    if (s) speaker = plain(s[1]);
    const t = cell.match(STAMP);
    if (t) stamp = plain(t[1]);
    const e = cell.match(ENTRY);
    if (e) rows.push({ stamp, speaker, text: plain(e[1]) });
  }
  return { rows, expected };
}

// مداخلات المتحدّث نفسه المتتابعة تُدمج في نوبةٍ واحدة: الصادرة تقطع الكلام كل بضع ثوانٍ،
// والقارئ يريد فقرةً لا شظايا. الوقت المحفوظ هو وقت أول شظيّةٍ في النوبة.
export function mergeTurns(rows) {
  const turns = [];
  for (const r of rows) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === r.speaker) last.text += ` ${r.text}`;
    else turns.push({ ...r });
  }
  return turns;
}

export function countSpeakers(turns) {
  const tally = new Map();
  for (const t of turns) {
    if (!t.speaker) continue;
    tally.set(t.speaker, (tally.get(t.speaker) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]);
}

// ── الصياغة ───────────────────────────────────────────────────────────────────
export function toMarkdown(turns, meta = {}) {
  const title = meta.title || 'نصُّ اجتماع';
  const speakers = countSpeakers(turns);
  const out = [`# ${title}`, ''];
  if (meta.date) out.push(`**التاريخ:** ${meta.date}  `);
  const span = turns.filter((t) => t.stamp).pop();
  if (span) out.push(`**المدة:** ${span.stamp}  `);
  out.push(`**المتحدّثون:** ${speakers.map(([n, c]) => `${n} (${c})`).join(' · ')}  `);
  out.push(`**النوبات:** ${turns.length}`);
  out.push('');
  out.push('> نصٌّ حرفيٌّ من تفريغ تيمز الآلي، بلا تحرير: أخطاء التفريغ وتشويه الأسماء');
  out.push('> مُبقاةٌ كما وردت، لأن إعادة الصياغة تُفقد النصَّ قيمته كدليلٍ على ما قيل.');
  out.push('> الأصل خارج المستودع (يحمل رموز وصول). وُلِّد هذا الملف بـ`scripts/transcript-to-md.mjs`.');
  out.push('');
  out.push('---');
  out.push('');
  for (const t of turns) {
    if (!t.speaker) {
      out.push(`_${t.text}_`, '');
      continue;
    }
    out.push(`### [${t.stamp || '—'}] ${t.speaker}`, '', t.text, '');
  }
  return out.join('\n');
}

// ── التشغيل ───────────────────────────────────────────────────────────────────
export function convert(html, meta = {}) {
  const { rows, expected } = parseTranscript(html);
  if (!rows.length) throw new Error('لم يُعرَف أيُّ كلامٍ في الملف — أهو صادرةُ نصٍّ حرفيٍّ من تيمز؟');
  if (rows.length !== expected) {
    throw new Error(`اكتمالٌ منقوص: ${rows.length} مداخلة من ${expected} خليّة — تغيَّر ترميزُ الصادرة، فلا تُقبل نسخةٌ مبتورة.`);
  }
  const blank = rows.findIndex((r) => !r.text);
  if (blank >= 0) throw new Error(`المداخلة رقم ${blank + 1} خرجت فارغة — تغيَّر ترميزُ الصادرة.`);
  const md = toMarkdown(mergeTurns(rows), meta);
  if (SECRET.test(md)) throw new Error('عُثر على أثرِ رمزِ وصولٍ في الناتج — أُوقفت الكتابة. أسرارٌ لا تُنقل.');
  return { md, entries: rows.length, turns: mergeTurns(rows).length };
}

// وسائطٌ بسيطة: كل `--اسم قيمة` علمٌ، وما بقي حرّاً هو مسار الملف.
export function parseArgs(args) {
  const flags = {};
  const free = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { flags[args[i].slice(2)] = args[i + 1] ?? ''; i += 1; }
    else free.push(args[i]);
  }
  return { flags, src: free[0] || null };
}

function run(argv) {
  const { flags, src } = parseArgs(argv.slice(2));
  const flag = (name) => flags[name] || null;
  if (!src) {
    console.error('الاستخدام: node scripts/transcript-to-md.mjs <ملف.html> [--out <ملف.md>] [--title "..."] [--date YYYY-MM-DD]');
    return 1;
  }
  let result;
  try {
    result = convert(readFileSync(src, 'utf8'), { title: flag('title'), date: flag('date') });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
  const out = flag('out');
  if (out) {
    writeFileSync(out, result.md, 'utf8');
    console.log(`✓ ${result.entries} مداخلة في ${result.turns} نوبة — كُتبت في ${out} بلا أثرِ رمز.`);
  } else {
    process.stdout.write(result.md);
  }
  return 0;
}

// يُنفَّذ فقط عند التشغيل المباشر — الاستيراد في الاختبارات لا يحوّل شيئاً.
if (process.argv[1] && process.argv[1].endsWith('transcript-to-md.mjs')) process.exit(run(process.argv));
