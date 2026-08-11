// ── حارسٌ بنيويّ: لا استعلامَ مهامٍ ينسى المعلَّقة ────────────────────────────
//
// المهمة التي تنتظر اعتماد مدير كاتبها لم تُضَف بعد، وحجبُها ليس شرطاً في موضعٍ أو موضعين:
// جدول المهام يُقرأ من عشرين موضعاً — قوائم، ولوحات، وعدّادات، وتقارير فترة، ومساعد. ومن
// نسي موضعاً واحداً عرض عملاً لم يوافق عليه أحد، **ولا يظهر النسيان في أي اختبار سلوكي**
// لأن الاختبار لا يعرف الموضع الذي لم يُكتب بعد.
//
// فالحارس يقرأ الشيفرة نفسها: كل استعلامٍ يسرد أو يعدّ من `task` يجب أن يحمل الشرط، أو أن
// يكون **قراءةَ صفٍّ بمعرّفه** (وهذه يحرسها فحصٌ صريح في خدمتها، لا شرطُ استعلام).
//
// وهو أيضاً وثيقة: من يضيف استعلاماً جديداً يسقط عنده هذا الفحص فيقرأ السبب قبل أن يمرّ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../src', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// استخراج نصوص الاستعلامات: كل ما بين علامتَي اقتباس من النوع نفسه (مع تخطّي الهروب).
// لا نحتاج تحليلاً كاملاً للغة — نحتاج نصّ الاستعلام كما يُرسَل إلى المحرّك.
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '`' || c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out.push(src.slice(i + 1, j));
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i) + 1 || src.length; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; }
    else i++;
  }
  return out;
}

// قراءةُ صفٍّ واحد بمعرّفه: ليست قائمة ولا عدّاداً، فحارسُها فحصٌ في خدمتها
// (`updateTask` و`addEntry` وحلّ المرجع في المساعد) لا شرطٌ في الاستعلام.
const BY_ID = /\b(?:t\.)?id\s*(?:=\s*\?|IN\s*\()/i;

// استثناءٌ واحد موثَّق: سجلّ التدقيق في `projects.js` يسرد **ما جرى** على المشروع لا عمله،
// والمهمة المعلَّقة جرى عليها شيءٌ فعلاً (أُنشئت ورُفع طلبها) — فإخفاء ذلك يُخفي واقعة حدثت.
const ALLOWED_MARKERS = [/audit_log/];

// الحاجزُ نفسه، أينما ورد: نصاً في الاستعلام، أو دالةً تُركَّب فيه.
const GUARD = /approval_state|approvedTaskSql|ownOrApprovedTaskSql|myWorkOrMyPendingSql/;

test('كل استعلام يسرد المهام يحجب ما ينتظر اعتماداً — أو يقرأ صفاً بمعرّفه', () => {
  const misses = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    // شرطُ الملف: الحاجز مركزيّ في هذا المستودع (`where.join` و`tw.where` و`NOT_PERSONAL`)،
    // فلا يظهر نصّه داخل الاستعلام المركَّب. فمن يُركّب استعلامه من متغيّر يُقبَل **بشرط** أن
    // يكون ملفه يعرف الحاجز أصلاً — وهذا بالضبط ما يسقط عند من أضاف استعلاماً ولم يفكّر فيه.
    const fileKnowsGuard = GUARD.test(src);
    for (const lit of stringLiterals(src)) {
      // `task_` يستبعد الجداول المجاورة (task_comment وغيرها) — الحارس على جدول المهام وحده.
      if (!/\bFROM\s+task\b(?!_)/i.test(lit) && !/\bJOIN\s+task\b(?!_)/i.test(lit)) continue;
      if (GUARD.test(lit)) continue;
      if (BY_ID.test(lit)) continue;
      if (ALLOWED_MARKERS.some((re) => re.test(lit))) continue;
      // استعلامٌ مركَّب من متغيّر داخل ملفٍ يعرف الحاجز: مقبول، ويحرسه فحصٌ سلوكي في
      // tests/integration/task-approval.test.js. أمّا الحرفيُّ الكامل فلا عذر له.
      if (lit.includes('${') && fileKnowsGuard) continue;
      misses.push(`${file.replace(SRC, 'src')} :: ${lit.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  assert.deepEqual(misses, [],
    'استعلامُ مهامٍ بلا حاجز الاعتماد — أضِف `${approvedTaskSql(\'t.\')}` أو وثّق استثناءه هنا:\n'
    + misses.join('\n'));
});

test('والحارس نفسه يعمل — نصٌّ مصنوع بلا شرط يُلتقَط', () => {
  const bad = 'SELECT * FROM task WHERE deleted_at IS NULL';
  assert.ok(/\bFROM\s+task\b(?!_)/i.test(bad));
  assert.ok(!/approval_state|approvedTaskSql/.test(bad));
  assert.ok(!BY_ID.test(bad), 'قاعدة «صفٌّ بمعرّفه» تبتلع استعلام قائمة');
});
